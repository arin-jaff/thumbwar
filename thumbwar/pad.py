"""bridge to ornnpad: raw hid events in, rumble out.

optional. when ornnpad (or the dongle) is missing the frontend falls back
to the browser gamepad api and everything still works, minus the low
latency path and the fancier gestures.

rumble is a small pattern language: a pattern is a list of
(low, high, seconds) steps. patterns are cancelled by the next one, and
"heartbeat" loops until "still" is played. intensity scales everything.
"""

from __future__ import annotations

import asyncio
from typing import Callable, Dict, List, Optional, Tuple

Step = Tuple[int, int, float]

PATTERNS: Dict[str, List[Step]] = {
    "tick":      [(0, 22000, 0.018)],                                # carousel detent
    "detent":    [(0, 30000, 0.022)],                                # wheel roll
    "thock":     [(18000, 34000, 0.05)],                             # wheel settle, snap
    "accept":    [(0, 40000, 0.03), (0, 0, 0.04), (0, 60000, 0.05)], # bright double
    "reject":    [(48000, 0, 0.11)],                                 # low thud
    "confirm":   [(20000, 52000, 0.09)],                             # merged, sent
    "done":      [(26000, 48000, 0.09), (0, 0, 0.09),
                  (26000, 48000, 0.09), (0, 0, 0.09), (36000, 62000, 0.14)],
    "error":     [(52000, 0, 0.08), (0, 0, 0.06), (52000, 0, 0.08)],
    "connect":   [(0, 30000, 0.04), (0, 0, 0.05), (14000, 40000, 0.07)],
    "interrupt": [(60000, 20000, 0.16)],
    "heartbeat": [(24000, 0, 0.06), (0, 0, 0.10), (38000, 0, 0.08), (0, 0, 0.9)],
    "still":     [],
}

#: crescendo for hold to confirm: play("ramp:0.4") maps progress 0..1
RAMP_MAX = (30000, 65000)


class PadBridge:
    def __init__(self, loop: asyncio.AbstractEventLoop, *,
                 broadcast: Callable[[dict], None],
                 synthetic: bool = False,
                 deadzone: float = 0.12,
                 intensity: float = 0.8) -> None:
        self.loop = loop
        self.broadcast = broadcast
        self.intensity = intensity
        self.available = False
        self.error = ""
        self.runner = None
        self._task: Optional[asyncio.Task] = None

        try:
            from ornnpad import PadRunner, Profile, SyntheticTransport
        except ImportError:
            self.error = "ornnpad is not installed. pip install 'thumbwar[pad]'"
            return

        profile = Profile()
        profile.thresholds.stick_deadzone = deadzone
        try:
            if synthetic:
                self.runner = PadRunner(transport=SyntheticTransport(), profile=profile)
            else:
                self.runner = PadRunner(profile=profile)
        except Exception as exc:
            self.error = f"pad init failed: {exc}"
            return

        forwarded = {"down", "up", "axis", "dpad", "gesture", "battery",
                     "connected", "disconnected"}

        @self.runner.on
        def _forward(event):
            if event.type.value in forwarded:
                self.loop.call_soon_threadsafe(
                    self.broadcast, {"t": "pad", "ev": event.to_dict()})

    def start(self) -> bool:
        if not self.runner:
            return False
        try:
            self.runner.start(background=True)
            self.available = True
        except Exception as exc:
            self.error = f"pad start failed: {exc}"
            self.available = False
        return self.available

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self.runner and self.available:
            self.runner.stop()
        self.available = False

    # -- rumble ------------------------------------------------------------

    def _buzz(self, low: int, high: int) -> None:
        if self.runner:
            self.runner.rumble(int(low * self.intensity), int(high * self.intensity))

    def play(self, name: str) -> None:
        if not self.available:
            return
        if self._task:
            self._task.cancel()
            self._task = None
        if name.startswith("ramp:"):
            try:
                p = min(1.0, max(0.0, float(name.split(":", 1)[1])))
            except ValueError:
                p = 0.0
            self._buzz(int(RAMP_MAX[0] * p), int(RAMP_MAX[1] * p * p))
            return
        steps = PATTERNS.get(name)
        if steps is None:
            return
        if not steps:
            self._buzz(0, 0)
            return
        self._task = self.loop.create_task(self._run(steps, loop=name == "heartbeat"))

    async def _run(self, steps: List[Step], *, loop: bool = False) -> None:
        try:
            while True:
                for low, high, dur in steps:
                    self._buzz(low, high)
                    await asyncio.sleep(dur)
                if not loop:
                    break
        except asyncio.CancelledError:
            raise
        finally:
            self._buzz(0, 0)
