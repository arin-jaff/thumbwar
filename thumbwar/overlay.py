"""the disclaimer. a floating countdown card over everything.

runs as its own process (`python -m thumbwar.overlay`) so appkit owns a
clean main thread. shows over full screen apps and every space, so it
reaches you mid game, mid zwift, mid checkout.

exit codes tell the server what happened:
  0  countdown hit zero (or return was pressed): bring thumbwar back
  2  dismissed: the human waved it off
  3  appkit unavailable: fell back to a notification
"""

from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
import time

SPINNER = ["·", "✢", "✳", "✶", "✻", "✽"]

INK = (0.070, 0.192, 0.169)
MINT = (0.298, 0.863, 0.639)
ORANGE = (0.941, 0.510, 0.310)
FOAM = (0.918, 0.969, 0.937)

W, H = 460, 148
RETURN_AT_ZERO = 0
DISMISSED = 2


def _applescript_string(s: str) -> str:
    """quote a python string as an applescript literal. session names come
    from directory names, so they can contain quotes and backslashes."""
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _notify_fallback(title: str, body: str) -> None:
    script = (f"display notification {_applescript_string(body)} "
              f"with title {_applescript_string(title)}")
    try:
        subprocess.run(["osascript", "-e", script], timeout=5, capture_output=True)
    except (OSError, subprocess.TimeoutExpired):
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=3.0)
    ap.add_argument("--title", default="your agents are done")
    ap.add_argument("--body", default="")
    args = ap.parse_args()

    try:
        import AppKit
        import objc
    except ImportError:
        _notify_fallback(args.title, args.body or "come see what they made")
        sys.exit(3)

    def draw_text(s, x, y, size, rgb, *, bold=False, mono=False, alpha=1.0):
        font = (AppKit.NSFont.monospacedSystemFontOfSize_weight_(
                    size, AppKit.NSFontWeightSemibold) if mono
                else AppKit.NSFont.systemFontOfSize_weight_(
                    size, AppKit.NSFontWeightBold if bold
                    else AppKit.NSFontWeightMedium))
        attrs = {
            AppKit.NSFontAttributeName: font,
            AppKit.NSForegroundColorAttributeName:
                AppKit.NSColor.colorWithSRGBRed_green_blue_alpha_(*rgb, alpha),
        }
        AppKit.NSString.stringWithString_(s).drawAtPoint_withAttributes_(
            (x, y), attrs)

    class Card(AppKit.NSView):
        def initWithArgs_(self, a):
            self = objc.super(Card, self).initWithFrame_(
                AppKit.NSMakeRect(0, 0, W, H))
            if self is None:
                return None
            self.seconds = a.seconds
            self.title = a.title
            self.body = a.body or "come see what they made"
            self.began = time.monotonic()
            return self

        def isFlipped(self):
            return True

        def acceptsFirstMouse_(self, event):
            return True

        def mouseDown_(self, event):
            os._exit(DISMISSED)

        def keyDown_(self, event):
            code = event.keyCode()
            if code == 36:                       # return
                os._exit(RETURN_AT_ZERO)
            os._exit(DISMISSED)                  # any other key waves it off

        def tick_(self, timer):
            if self.seconds > 0:
                left = self.seconds - (time.monotonic() - self.began)
                if left <= 0:
                    os._exit(RETURN_AT_ZERO)
            self.setNeedsDisplay_(True)

        def drawRect_(self, rect):
            def color(rgb, a=1.0):
                return AppKit.NSColor.colorWithSRGBRed_green_blue_alpha_(*rgb, a)

            card = AppKit.NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
                AppKit.NSMakeRect(4, 4, W - 8, H - 8), 30, 30)
            color(INK, 0.95).setFill()
            card.fill()
            color(MINT, 0.35).setStroke()
            card.setLineWidth_(1.5)
            card.stroke()

            now = time.monotonic()
            frame = SPINNER[int(now * 8) % len(SPINNER)]
            draw_text(frame, 30, 40, 34, ORANGE, mono=True)
            draw_text(self.title, 78, 40, 21, FOAM, bold=True)
            draw_text(self.body, 78, 74, 13, MINT)
            hint = "click to dismiss" + ("" if self.seconds > 0 else " · return to jump back")
            draw_text(hint, 78, 108, 11, FOAM, alpha=0.55)

            if self.seconds > 0:
                left = max(0.0, self.seconds - (now - self.began))
                frac = left / self.seconds
                cx, cy, r = W - 66, H / 2, 34
                ring = AppKit.NSBezierPath.bezierPath()
                ring.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_clockwise_(
                    (cx, cy), r, 0, 360, False)
                ring.setLineWidth_(5)
                color(FOAM, 0.14).setStroke()
                ring.stroke()
                arc = AppKit.NSBezierPath.bezierPath()
                arc.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_clockwise_(
                    (cx, cy), r, 90, 90 - 360 * (1 - frac), True)
                arc.setLineWidth_(5)
                arc.setLineCapStyle_(AppKit.NSRoundLineCapStyle)
                color(MINT).setStroke()
                arc.stroke()
                num = str(int(math.ceil(left)))
                draw_text(num, cx - (11 * len(num)) / 2, cy - 14, 22, FOAM,
                          bold=True)

    class Panel(AppKit.NSPanel):
        def canBecomeKeyWindow(self):
            return True

    app = AppKit.NSApplication.sharedApplication()
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)

    screen = AppKit.NSScreen.mainScreen().frame()
    x = screen.origin.x + (screen.size.width - W) / 2
    y = screen.origin.y + screen.size.height - H - 64

    panel = Panel.alloc().initWithContentRect_styleMask_backing_defer_(
        AppKit.NSMakeRect(x, y, W, H),
        AppKit.NSWindowStyleMaskBorderless | AppKit.NSWindowStyleMaskNonactivatingPanel,
        AppKit.NSBackingStoreBuffered, False)
    panel.setLevel_(AppKit.NSScreenSaverWindowLevel)
    panel.setOpaque_(False)
    panel.setBackgroundColor_(AppKit.NSColor.clearColor())
    panel.setHasShadow_(True)
    panel.setCollectionBehavior_(
        AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces
        | AppKit.NSWindowCollectionBehaviorFullScreenAuxiliary
        | AppKit.NSWindowCollectionBehaviorStationary)

    card = Card.alloc().initWithArgs_(args)
    panel.setContentView_(card)
    panel.makeFirstResponder_(card)
    panel.makeKeyAndOrderFront_(None)

    AppKit.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
        1 / 30.0, card, "tick:", None, True)
    app.run()


if __name__ == "__main__":
    main()
