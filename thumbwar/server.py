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

from . import gh, settings as settings_mod
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
                                  on_all_done=self.on_all_done)
        self.mgr.start()
        if not self.no_pad:
            self.pad = PadBridge(self.loop, broadcast=self.broadcast,
                                 synthetic=self.synthetic,
                                 deadzone=self.settings["deadzone"],
                                 intensity=self.settings["rumble_intensity"])
            if self.pad.start():
                self.pad.play("connect")
        self.loop.create_task(self._auto_away_loop())

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
            if self._overlay_task is None or self._overlay_task.done():
                self._overlay_task = self.loop.create_task(self._show_overlay(names))

    async def _show_overlay(self, names) -> None:
        body = ", ".join(names[:3]) + (" and more" if len(names) > 3 else "")
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "thumbwar.overlay",
            "--seconds", str(self.settings["countdown_seconds"]),
            "--title", "your agents are done",
            "--body", body or "come see what they made")
        code = await proc.wait()
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

    def touch(self) -> None:
        self.last_activity = time.monotonic()
        if not self.away:
            self.mgr.ack()

    def rumble(self, pattern: str) -> None:
        if self.pad and self.settings["rumble"]:
            self.pad.play(pattern)

    def dirs(self) -> list:
        rows = []
        for root in self.settings["roots"]:
            base = Path(os.path.expanduser(root))
            if not base.is_dir():
                continue
            for child in base.iterdir():
                try:
                    if child.is_dir() and (child / ".git").exists():
                        rows.append({"path": str(child), "name": child.name,
                                     "mtime": child.stat().st_mtime})
                except OSError:
                    continue
        rows.sort(key=lambda r: -r["mtime"])
        return rows[:40]

    # -- ws ----------------------------------------------------------------

    async def ws_handler(self, request: web.Request) -> web.WebSocketResponse:
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
        })
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    m = json.loads(msg.data)
                except ValueError:
                    continue
                await self.handle(ws, m)
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
        elif t == "overlay_test":
            self.loop.create_task(self._show_overlay(["overlay test"]))
        elif t == "interrupt_all":
            for s in self.mgr.sessions.values():
                if s.state == "working":
                    self.mgr.write(s.id, b"\x1b")
            self.rumble("interrupt")
            self.toast("sent esc to every working agent", "info")


# -- app ------------------------------------------------------------------


async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC / "index.html")


def build_app(hub: Hub) -> web.Application:
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/ws", hub.ws_handler)
    app.router.add_static("/static", STATIC)
    app.on_startup.append(hub.start)
    app.on_cleanup.append(hub.stop)
    return app
