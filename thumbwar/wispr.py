"""push to talk for wispr flow.

stick click down posts the configured hotkey down, release posts it up,
so wispr's own push to talk shortcut does the recording. two spellings:

  a combo like ``ctrl+alt+cmd+space``  synthesized via ornnpad's KeySynth
  ``fn`` (or ``globe``)                wispr's default hotkey. not a real
                                       keycode, so we post the flagsChanged
                                       event the physical globe key makes.

either way it needs accessibility granted to the terminal that runs
thumbwar. best effort by design: if synthesis is unavailable we say so
once and stay quiet. note the fn path reaches apps that watch modifier
flags (wispr does); macos's own globe features sit below event taps and
may ignore synthetic presses.
"""

from __future__ import annotations

FN_KEYCODE = 63


def _is_fn(combo: str) -> bool:
    return combo.strip().lower() in ("fn", "globe")


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

    @staticmethod
    def _fn_post(down: bool) -> None:
        import Quartz
        ev = Quartz.CGEventCreateKeyboardEvent(None, FN_KEYCODE, down)
        # the physical globe key arrives as flagsChanged, not keydown
        Quartz.CGEventSetType(ev, Quartz.kCGEventFlagsChanged)
        Quartz.CGEventSetFlags(
            ev, Quartz.kCGEventFlagMaskSecondaryFn if down else 0)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)

    def press(self) -> bool:
        if self.down:
            return False
        try:
            if _is_fn(self.combo):
                self._fn_post(True)
            elif self._synth:
                self._synth.down(self.combo)
            else:
                return False
            self.down = True
            return True
        except Exception as exc:
            self.error = f"key synth failed: {exc}"
            return False

    def release(self) -> bool:
        if not self.down:
            return False
        try:
            if _is_fn(self.combo):
                self._fn_post(False)
            elif self._synth:
                self._synth.up(self.combo)
            else:
                return False
            self.down = False
            return True
        except Exception as exc:
            # stay marked down so the next release retries rather than
            # leaving cmd and friends held down across the whole system
            self.error = f"key synth failed: {exc}"
            return False
