"""push to talk for wispr flow.

stick click down posts the configured hotkey down, release posts it up,
so wispr's own push to talk shortcut does the recording. set wispr's
shortcut to the same combo as the `wispr_key` setting.

uses ornnpad's KeySynth (quartz), so it needs accessibility granted to
the terminal that runs thumbwar. best effort by design: if synthesis is
unavailable we say so once and stay quiet.
"""

from __future__ import annotations


class PushToTalk:
    def __init__(self, combo: str) -> None:
        self.combo = combo
        self.down = False
        self.error = ""
        self._synth = None
        try:
            from ornnpad import KeySynth
            self._synth = KeySynth()
        except ImportError:
            self.error = "push to talk needs ornnpad. pip install 'thumbwar[pad]'"

    def set_combo(self, combo: str) -> None:
        if self.down:
            self.release()
        self.combo = combo

    def press(self) -> bool:
        if not self._synth or self.down:
            return False
        try:
            self._synth.down(self.combo)
            self.down = True
            return True
        except Exception as exc:
            self.error = f"key synth failed: {exc}"
            return False

    def release(self) -> bool:
        if not self._synth or not self.down:
            return False
        try:
            self._synth.up(self.combo)
            self.down = False
            return True
        except Exception as exc:
            # stay marked down so the next release retries rather than
            # leaving cmd and friends held down across the whole system
            self.error = f"key synth failed: {exc}"
            return False
