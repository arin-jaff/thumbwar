"""pty session manager.

every card in the deck is a real pty running claude code (or any command).
if tmux is installed the pty runs `tmux new -A`, so sessions survive a
server restart and can be adopted from a normal terminal too. without
tmux the command runs directly and lives as long as the server does.

status detection reads the byte stream itself:

  working    claude's status line ("esc to interrupt") repainted recently
  needs_you  a permission or plan prompt is on screen and nothing is moving
  ready      quiet at the prompt
  dead       the process exited

claude code also rings the terminal bell when it finishes. we treat BEL
as a strong "finished" signal on top of the working -> quiet transition.
"""

from __future__ import annotations

import asyncio
import base64
import fcntl
import os
import re
import shutil
import signal
import struct
import subprocess
import termios
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, List, Optional

_ANSI_RE = re.compile(
    rb"\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])"
)

#: claude paints with cursor moves rather than spaces, so after stripping
#: ansi the words run together. all matching is done space free.
#: phrases that mean claude is mid task, repainted with every spinner frame.
BUSY_MARKERS = (b"esctointerrupt", b"ctrl+btorun")
#: phrases that mean claude is waiting on a human decision.
PROMPT_MARKERS = (b"doyouwant", b"1.yes", b"entertoconfirm", b"proceed?", b"(y/n)")

#: seconds of busy-marker silence before a session stops counting as working.
BUSY_LINGER = 3.0
#: a work burst shorter than this never counts as "finished" (menu flickers).
MIN_WORK_SPAN = 4.0

RING_MAX = 128 * 1024


def feed_status(sess: "Session", chunk: bytes, now: float) -> bool:
    """update a session's status trackers from one output chunk.

    returns true when a fresh work burst began, so the manager can re arm
    its all done latch.
    """
    sess.output_at = now
    if b"\x07" in chunk:
        sess.bell_at = now
    plain = re.sub(rb"\s+", b"", _ANSI_RE.sub(b"", chunk)).lower()
    fresh_burst = False
    if any(m in plain for m in BUSY_MARKERS):
        if now - sess.busy_seen > BUSY_LINGER:
            sess.work_started = now
            sess.finished = False
            fresh_burst = True
        sess.busy_seen = now
        # a fresh work burst invalidates whatever prompt text came before
        sess.tail = ""
    sess.tail = (sess.tail + plain.decode("utf-8", "replace"))[-2000:]
    return fresh_burst


def tmux_name(sid: str, name: str) -> str:
    """the tmux session name for one of our sessions. one definition only,
    because kill has to reproduce it byte for byte."""
    return f"tw-{sid}-{name}"[:40]


def compute_state(sess: "Session", now: float) -> str:
    if sess.proc and sess.proc.poll() is not None:
        return "dead"
    if now - sess.busy_seen < BUSY_LINGER:
        return "working"
    if any(m.decode() in sess.tail for m in PROMPT_MARKERS):
        return "needs_you"
    return "ready"


@dataclass
class Session:
    id: str
    name: str
    cwd: str
    cmd: str
    pid: int = 0
    fd: int = -1
    proc: Optional[subprocess.Popen] = None
    cols: int = 100
    rows: int = 30
    state: str = "ready"
    adopted: bool = False
    created: float = field(default_factory=time.time)
    ring: bytearray = field(default_factory=bytearray)
    pending: bytearray = field(default_factory=bytearray)
    tail: str = ""                 # recent plain text, for prompt detection
    busy_seen: float = 0.0
    work_started: float = 0.0
    output_at: float = 0.0
    bell_at: float = 0.0
    finished: bool = False         # went working -> quiet, not yet acknowledged

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "cwd": self.cwd,
            "cmd": self.cmd, "state": self.state, "adopted": self.adopted,
            "created": self.created, "finished": self.finished,
        }


class SessionManager:
    def __init__(self, loop: asyncio.AbstractEventLoop, *,
                 broadcast: Callable[[dict], None],
                 on_all_done: Callable[[List[str]], Awaitable[None]]) -> None:
        self.loop = loop
        self.broadcast = broadcast
        self.on_all_done = on_all_done
        self.sessions: Dict[str, Session] = {}
        self._counter = 0
        self._all_done_latched = False
        self._ticker: Optional[asyncio.Task] = None

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        self._ticker = self.loop.create_task(self._tick_loop())

    async def close(self) -> None:
        if self._ticker:
            self._ticker.cancel()
        for s in list(self.sessions.values()):
            self._teardown(s, kill=not s.adopted)

    # -- spawning ----------------------------------------------------------

    def tmux_path(self) -> Optional[str]:
        return shutil.which("tmux")

    def spawn(self, cwd: str, name: str = "", cmd: str = "claude",
              adopt_tmux: str = "") -> Session:
        self._counter += 1
        sid = f"s{self._counter}"
        cwd = os.path.expanduser(cwd) or os.path.expanduser("~")
        name = name or os.path.basename(cwd.rstrip("/")) or sid

        tmux = self.tmux_path()
        if adopt_tmux and tmux:
            argv = [tmux, "attach-session", "-t", adopt_tmux]
        elif tmux:
            # -A attaches if a session of this name already exists. default
            # socket on purpose, so `tmux ls` in a normal terminal finds these
            # and list_tmux can offer survivors back for adoption.
            argv = [tmux, "new-session", "-A", "-s", tmux_name(sid, name), cmd]
        else:
            # a login shell so `claude` resolves from the user's real PATH
            shell = os.environ.get("SHELL", "/bin/zsh")
            argv = [shell, "-ilc", cmd]

        master, slave = os.openpty()
        sess = Session(id=sid, name=name, cwd=cwd, cmd=cmd, fd=master,
                       adopted=bool(adopt_tmux))
        self._set_winsize(master, sess.cols, sess.rows)

        env = dict(os.environ)
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        try:
            sess.proc = subprocess.Popen(
                argv, cwd=cwd, env=env, stdin=slave, stdout=slave,
                stderr=slave, start_new_session=True, close_fds=True,
            )
        except OSError as exc:
            os.close(master)
            os.close(slave)
            raise RuntimeError(f"could not start {argv[0]}: {exc}") from exc
        finally:
            try:
                os.close(slave)
            except OSError:
                pass

        sess.pid = sess.proc.pid
        os.set_blocking(master, False)
        self.sessions[sid] = sess
        self.loop.add_reader(master, self._on_readable, sess)
        self._all_done_latched = False
        self.broadcast({"t": "session", "session": sess.to_dict()})
        return sess

    def list_tmux(self) -> List[dict]:
        """sessions on the default tmux server, available to adopt."""
        tmux = self.tmux_path()
        if not tmux:
            return []
        try:
            out = subprocess.run(
                [tmux, "list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{?session_attached,1,0}"],
                capture_output=True, text=True, timeout=3,
            ).stdout
        except (OSError, subprocess.TimeoutExpired):
            return []
        rows = []
        ours = {f"tw-{s.id}" for s in self.sessions.values()}
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) == 3 and not any(parts[0].startswith(o) for o in ours):
                rows.append({"name": parts[0], "windows": int(parts[1]),
                             "attached": parts[2] == "1"})
        return rows

    # -- io ----------------------------------------------------------------

    def _on_readable(self, sess: Session) -> None:
        try:
            chunk = os.read(sess.fd, 65536)
        except BlockingIOError:
            return
        except OSError:
            chunk = b""
        if not chunk:
            self._teardown(sess, kill=False)
            return
        sess.ring.extend(chunk)
        if len(sess.ring) > RING_MAX:
            del sess.ring[: len(sess.ring) - RING_MAX]
        if feed_status(sess, chunk, time.monotonic()):
            self._all_done_latched = False
        self.broadcast({"t": "out", "id": sess.id,
                        "data": base64.b64encode(chunk).decode()})

    def write(self, sid: str, data: bytes) -> None:
        sess = self.sessions.get(sid)
        if not sess or sess.fd < 0:
            return
        if sess.state == "needs_you":
            sess.tail = ""            # the human just answered the prompt
        # the master is non blocking, so a big paste can write short. buffer
        # the tail and drain it when the pty is writable again.
        sess.pending.extend(data)
        self._drain(sess)

    def _drain(self, sess: Session) -> None:
        if sess.fd < 0 or not sess.pending:
            return
        try:
            n = os.write(sess.fd, sess.pending)
        except BlockingIOError:
            n = 0
        except OSError:
            sess.pending.clear()
            return
        del sess.pending[:n]
        try:
            if sess.pending:
                self.loop.add_writer(sess.fd, self._drain, sess)
            else:
                self.loop.remove_writer(sess.fd)
        except (ValueError, OSError):
            pass

    def resize(self, sid: str, cols: int, rows: int) -> None:
        sess = self.sessions.get(sid)
        if not sess or sess.fd < 0:
            return
        sess.cols, sess.rows = max(20, cols), max(5, rows)
        self._set_winsize(sess.fd, sess.cols, sess.rows)

    @staticmethod
    def _set_winsize(fd: int, cols: int, rows: int) -> None:
        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except OSError:
            pass

    def replay(self, sid: str) -> str:
        sess = self.sessions.get(sid)
        return base64.b64encode(bytes(sess.ring)).decode() if sess else ""

    # -- ending ------------------------------------------------------------

    def kill(self, sid: str) -> None:
        sess = self.sessions.get(sid)
        if not sess:
            return
        # under tmux the child is only the client. sighup would detach it and
        # leave claude running headless, so end the tmux session by name.
        # not in _teardown: shutdown tears down too, and survival is the point.
        tmux = self.tmux_path()
        if tmux and not sess.adopted:
            try:
                subprocess.run([tmux, "kill-session", "-t",
                                "=" + tmux_name(sess.id, sess.name)],
                               capture_output=True, timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                pass
        self._teardown(sess, kill=True)

    def _teardown(self, sess: Session, *, kill: bool) -> None:
        if sess.fd >= 0:
            for remove in (self.loop.remove_reader, self.loop.remove_writer):
                try:
                    remove(sess.fd)
                except (ValueError, OSError):
                    pass
            try:
                os.close(sess.fd)
            except OSError:
                pass
            sess.fd = -1
        sess.pending.clear()
        if kill and sess.proc and sess.proc.poll() is None:
            try:
                os.killpg(os.getpgid(sess.proc.pid), signal.SIGHUP)
            except (OSError, ProcessLookupError):
                pass
        if sess.proc:
            try:
                sess.proc.wait(timeout=0.2)     # reap, do not leave a zombie
            except (subprocess.TimeoutExpired, OSError):
                pass
        sess.state = "dead"
        self.sessions.pop(sess.id, None)
        self.broadcast({"t": "exit", "id": sess.id})

    # -- status ------------------------------------------------------------

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(0.5)
            now = time.monotonic()
            any_working = False
            for sess in list(self.sessions.values()):
                state = compute_state(sess, now)
                if state == "dead":
                    self._teardown(sess, kill=False)
                    continue
                if state == "working":
                    any_working = True
                was = sess.state
                if state != was:
                    sess.state = state
                    left_work = was == "working" and state in ("ready", "needs_you")
                    long_enough = sess.busy_seen - sess.work_started >= MIN_WORK_SPAN
                    rang = sess.bell_at >= sess.work_started > 0
                    if left_work and (long_enough or rang):
                        sess.finished = True
                    self.broadcast({"t": "status", "id": sess.id,
                                    "state": state, "finished": sess.finished})
            done = [s.name for s in self.sessions.values() if s.finished]
            if done and not any_working and not self._all_done_latched:
                self._all_done_latched = True
                await self.on_all_done(done)

    def ack(self) -> None:
        """the human is back. clear finished flags and re arm the watcher."""
        for s in self.sessions.values():
            if s.finished:
                s.finished = False
                self.broadcast({"t": "status", "id": s.id,
                                "state": s.state, "finished": False})
        self._all_done_latched = False
