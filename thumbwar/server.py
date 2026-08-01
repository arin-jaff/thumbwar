"""the hub. one aiohttp app: static ui, one websocket, everything else.

binds 127.0.0.1 on purpose. the websocket writes keystrokes into real
shells, so this must never listen on an interface other people can reach.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional, Set

from aiohttp import WSMsgType, web

from . import bt, gh, settings as settings_mod
from .pad import PadBridge
from .sessions import SessionManager
from .wispr import PushToTalk

STATIC = Path(__file__).parent / "static"


class Hub:
    def __init__(self, *, host: str, port: int,
                 synthetic: bool = False, no_pad: bool = False) -> None:
        self.host, self.port = host, port
        self.synthetic, self.no_pad = synthetic, no_pad
        self.settings = settings_mod.load()
        self.clients: Set[web.WebSocketResponse] = set()
        self.away = False
        self.last_activity = time.monotonic()
        self.loop: asyncio.AbstractEventLoop = None  # set in start
        self.mgr: SessionManager = None
        self.pad: Optional[PadBridge] = None
        self.ptt = PushToTalk(self.settings["wispr_key"])
        self._overlay_task: Optional[asyncio.Task] = None
        self.bt: Dict[str, Any] = {"connected": [], "paired": []}
        self._bt_at = 0.0

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    # -- fan out -----------------------------------------------------------

    def broadcast(self, msg: dict) -> None:
        data = json.dumps(msg, separators=(",", ":"))
        for ws in list(self.clients):
            if ws.closed:
                self.clients.discard(ws)
                continue
            asyncio.ensure_future(self._send(ws, data))

    async def _send(self, ws: web.WebSocketResponse, data: str) -> None:
        try:
            await ws.send_str(data)
        except (ConnectionError, RuntimeError):
            self.clients.discard(ws)

    def toast(self, text: str, kind: str = "info") -> None:
        self.broadcast({"t": "toast", "text": text, "kind": kind})

    # -- lifecycle ---------------------------------------------------------

    async def start(self, app: web.Application) -> None:
        self.loop = asyncio.get_running_loop()
        self.mgr = SessionManager(self.loop, broadcast=self.broadcast,
                                  on_all_done=self.on_all_done,
                                  on_needs_you=self.on_needs_you)
        self.mgr.start()
        if not self.no_pad:
            self.pad = PadBridge(self.loop, broadcast=self.broadcast,
                                 synthetic=self.synthetic,
                                 deadzone=self.settings["deadzone"],
                                 intensity=self.settings["rumble_intensity"])
            if self.pad.start():
                self.pad.play("connect")
        self.loop.create_task(self._auto_away_loop())
        self.loop.create_task(self._bt_scan())

    async def stop(self, app: web.Application) -> None:
        if self.pad:
            self.pad.stop()
        if self.ptt.down:
            self.ptt.release()
        await self.mgr.close()

    # -- done watching -----------------------------------------------------

    async def on_all_done(self, names) -> None:
        self.broadcast({"t": "alldone", "names": names})
        self.rumble("done")
        if self.away or self.settings["overlay_always"]:
            body = ", ".join(names[:3]) + (" and more" if len(names) > 3 else "")
            self._overlay("your agents are done", body or "come see what they made")

    async def on_needs_you(self, name: str) -> None:
        self.broadcast({"t": "needs_you", "name": name})
        if ((self.away or self.settings["overlay_always"])
                and self.settings["overlay_needs_you"]):
            self._overlay("an agent needs you", f"{name} is waiting on a decision")

    def _overlay(self, title: str, body: str) -> None:
        if self._overlay_task is None or self._overlay_task.done():
            self._overlay_task = self.loop.create_task(self._show_overlay(title, body))

    async def _show_overlay(self, title: str, body: str) -> None:
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "thumbwar.overlay",
                "--seconds", str(self.settings["countdown_seconds"]),
                "--title", title, "--body", body)
            code = await proc.wait()
        except OSError as exc:
            # never strand the human in away mode because a card failed to draw
            self.toast(f"the overlay could not open: {exc}", "error")
            code = 2
        self.broadcast({"t": "overlay_done", "code": code})
        if code == 0 and self.settings["auto_return"]:
            subprocess.Popen(["open", self.url])
        if code in (0, 2):
            self.away = False
            self.broadcast({"t": "away", "on": False})
            self.mgr.ack()

    async def _auto_away_loop(self) -> None:
        while True:
            await asyncio.sleep(5)
            if (self.settings["auto_away"] and not self.away
                    and any(s.state == "working" for s in self.mgr.sessions.values())
                    and time.monotonic() - self.last_activity > self.settings["auto_away_after"]):
                self.away = True
                self.broadcast({"t": "away", "on": True, "auto": True})

    # -- helpers -----------------------------------------------------------

    async def _bt_scan(self) -> None:
        self._bt_at = time.monotonic()
        self.bt = await bt.scan()
        self.broadcast({"t": "bt", **self.bt})

    def touch(self) -> None:
        self.last_activity = time.monotonic()
        if not self.away:
            self.mgr.ack()

    def rumble(self, pattern: str) -> None:
        if self.pad and self.settings["rumble"]:
            self.pad.play(pattern)

    def dirs(self) -> list:
        rows = []

        def visit(d: Path, depth: int) -> None:
            try:
                if (d / ".git").exists():
                    rows.append({"path": str(d), "name": d.name,
                                 "mtime": d.stat().st_mtime})
                    return
                if depth > 0:
                    for child in d.iterdir():
                        if child.is_dir() and not child.name.startswith("."):
                            visit(child, depth - 1)
            except OSError:
                pass

        for root in self.settings["roots"]:
            base = Path(os.path.expanduser(root))
            if base.is_dir():
                visit(base, 2)
        rows.sort(key=lambda r: -r["mtime"])
        return rows[:40]

    # -- ws ----------------------------------------------------------------

    async def ws_handler(self, request: web.Request) -> web.WebSocketResponse:
        # browsers do not apply the same origin policy to websockets, so
        # loopback alone would let any page you visit open this socket and
        # type into your shells. a browser cannot forge Origin; tools that
        # send none are already local processes with shell access anyway.
        origin = request.headers.get("Origin")
        if origin is not None and origin not in (
                f"http://127.0.0.1:{self.port}", f"http://localhost:{self.port}"):
            raise web.HTTPForbidden(text="bad origin")

        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self.clients.add(ws)
        await ws.send_json({
            "t": "hello",
            "sessions": [s.to_dict() for s in self.mgr.sessions.values()],
            "settings": self.settings,
            "pad": {"available": bool(self.pad and self.pad.available),
                    "error": self.pad.error if self.pad else "pad disabled"},
            "ptt": {"ok": self.ptt.error == "", "error": self.ptt.error},
            "tmux": bool(self.mgr.tmux_path()),
            "away": self.away,
            "bt": self.bt,
        })
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    m = json.loads(msg.data)
                except ValueError:
                    continue
                try:
                    await self.handle(ws, m)
                except Exception as exc:   # one bad message must not kill the deck
                    self.toast(f"that action failed: {exc}", "error")
        finally:
            self.clients.discard(ws)
        return ws

    async def handle(self, ws: web.WebSocketResponse, m: Dict[str, Any]) -> None:
        t = m.get("t")

        if t == "stdin":
            self.touch()
            try:
                self.mgr.write(m["id"], base64.b64decode(m.get("data", "")))
            except (KeyError, ValueError):
                pass
        elif t == "resize":
            self.mgr.resize(m.get("id", ""), int(m.get("cols", 80)), int(m.get("rows", 24)))
        elif t == "replay":
            data = self.mgr.replay(m.get("id", ""))
            if data:
                await ws.send_json({"t": "out", "id": m["id"], "data": data})
        elif t == "spawn":
            self.touch()
            try:
                self.mgr.spawn(m.get("cwd", "~"), m.get("name", ""),
                               m.get("cmd") or self.settings["session_cmd"])
            except RuntimeError as exc:
                self.toast(str(exc), "error")
                self.rumble("error")
        elif t == "adopt":
            self.touch()
            try:
                self.mgr.spawn(m.get("cwd", "~"), m.get("target", ""),
                               "tmux", adopt_tmux=m.get("target", ""))
            except RuntimeError as exc:
                self.toast(str(exc), "error")
        elif t == "kill":
            self.mgr.kill(m.get("id", ""))
        elif t == "duplicate":
            self.touch()
            src = self.mgr.sessions.get(m.get("id", ""))
            # an adopted card's cmd is the literal attach command; replaying
            # it inside a fresh tmux would just nest-and-die instantly.
            if src and src.adopted:
                self.toast("adopted sessions cannot be duplicated", "error")
            elif src:
                try:
                    self.mgr.spawn(src.cwd, src.name, src.cmd)
                except RuntimeError as exc:
                    self.toast(str(exc), "error")
        elif t == "restart":
            self.touch()
            src = self.mgr.sessions.get(m.get("id", ""))
            if src and src.adopted:
                self.toast("adopted sessions cannot be restarted from here", "error")
            elif src:
                cwd, name, cmd = src.cwd, src.name, src.cmd
                self.mgr.kill(src.id)
                try:
                    self.mgr.spawn(cwd, name, cmd)
                except RuntimeError as exc:
                    self.toast(str(exc), "error")
        elif t == "rumble":
            self.rumble(str(m.get("pattern", "")))
        elif t == "ptt":
            ok = self.ptt.press() if m.get("down") else self.ptt.release()
            await ws.send_json({"t": "ptt", "down": self.ptt.down, "ok": ok,
                                "error": self.ptt.error})
        elif t == "prs":
            cwd = m.get("cwd", "")
            result = await gh.pr_list(cwd)
            await ws.send_json({"t": "prs", "cwd": cwd, **result})
        elif t == "pr_merge":
            self.touch()
            result = await gh.pr_merge(m.get("cwd", ""), int(m.get("number", 0)),
                                       self.settings["merge_method"])
            if result.get("ok"):
                self.toast(f"pr #{result['number']} merged!", "mint")
                self.rumble("confirm")
            else:
                self.toast(result.get("error", "merge failed"), "error")
                self.rumble("error")
            await ws.send_json({"t": "pr_merged", **result})
        elif t == "pr_checkout":
            result = await gh.pr_checkout(m.get("cwd", ""), int(m.get("number", 0)))
            if result.get("ok"):
                self.toast(f"checked out pr #{result['number']}", "mint")
            else:
                self.toast(result.get("error", "checkout failed"), "error")
        elif t == "set":
            key, value = m.get("key"), m.get("value")
            if key in self.settings:
                self.settings[key] = value
                settings_mod.save(self.settings)
                if key == "rumble_intensity" and self.pad:
                    self.pad.intensity = float(value)
                elif key == "wispr_key":
                    self.ptt.set_combo(str(value))
                elif key == "deadzone" and self.pad and self.pad.runner:
                    self.pad.runner.profile.thresholds.stick_deadzone = float(value)
                self.broadcast({"t": "settings", "settings": self.settings})
        elif t == "away":
            self.away = bool(m.get("on"))
            if not self.away:
                self.mgr.ack()
            self.broadcast({"t": "away", "on": self.away})
        elif t == "ack":
            self.touch()
        elif t == "dirs":
            await ws.send_json({"t": "dirs", "dirs": self.dirs(),
                                "tmux": self.mgr.list_tmux()})
        elif t == "bt_scan":
            # system_profiler is slow; do not let a chip clicker spam it
            if time.monotonic() - self._bt_at > 30:
                self.loop.create_task(self._bt_scan())
        elif t == "overlay_test":
            self.loop.create_task(
                self._show_overlay("your agents are done", "overlay test"))
        elif t == "open_url":
            # a pad press has no browser user activation, so window.open is
            # blocked. hand the url to the os instead.
            url = str(m.get("url", ""))
            if url.startswith("https://"):
                subprocess.Popen(["open", url])
        elif t == "interrupt_all":
            for s in self.mgr.sessions.values():
                if s.state == "working":
                    self.mgr.write(s.id, b"\x1b")
            self.rumble("interrupt")
            self.toast("sent esc to every working agent", "info")


# -- app ------------------------------------------------------------------


async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC / "index.html")


@web.middleware
async def no_cache(request: web.Request, handler):
    # es module imports sit in the browser's memory cache, which happily
    # serves last week's deck after an upgrade. force revalidation.
    resp = await handler(request)
    resp.headers.setdefault("Cache-Control", "no-cache")
    return resp


def build_app(hub: Hub) -> web.Application:
    app = web.Application(middlewares=[no_cache])
    app.router.add_get("/", index)
    app.router.add_get("/ws", hub.ws_handler)
    app.router.add_static("/static", STATIC)
    app.on_startup.append(hub.start)
    app.on_cleanup.append(hub.stop)
    return app
