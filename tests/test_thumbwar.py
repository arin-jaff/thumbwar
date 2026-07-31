"""the smallest checks that fail if the load bearing logic breaks."""

import json
import os
import tempfile
import unittest

from thumbwar.gh import _checks
from thumbwar.sessions import Session, compute_state, feed_status

# claude paints with cursor moves instead of spaces. real capture shape.
WORKING_CHUNK = b"\x1b[38;5;214m\xe2\x9c\xbb\x1b[0m Brewing\x1b[8C(\x1b[1mesc\x1b[0m to interrupt)"
DIALOG_CHUNK = (b"Do you want to proceed?\r\n"
                b"\xe2\x9d\xaf \x1b[34m1. Yes\x1b[0m\r\n  2. No\r\n"
                b"Enter to confirm \xc2\xb7 Esc to cancel")
IDLE_CHUNK = b"\x1b[2m>\x1b[0m try 'fix the tests'"


class StatusDetection(unittest.TestCase):
    def sess(self):
        return Session(id="t", name="t", cwd="/", cmd="x")

    def test_working(self):
        s = self.sess()
        feed_status(s, WORKING_CHUNK, now=100.0)
        self.assertEqual(compute_state(s, 101.0), "working")

    def test_needs_you_after_quiet(self):
        s = self.sess()
        feed_status(s, WORKING_CHUNK, now=100.0)
        feed_status(s, DIALOG_CHUNK, now=101.0)
        self.assertEqual(compute_state(s, 110.0), "needs_you")

    def test_ready_when_idle(self):
        s = self.sess()
        feed_status(s, IDLE_CHUNK, now=100.0)
        self.assertEqual(compute_state(s, 110.0), "ready")

    def test_fresh_burst_clears_stale_dialog(self):
        s = self.sess()
        feed_status(s, DIALOG_CHUNK, now=100.0)
        feed_status(s, WORKING_CHUNK, now=110.0)
        # busy linger passed, and the old dialog text must not resurface
        self.assertEqual(compute_state(s, 120.0), "ready")

    def test_bell_recorded(self):
        s = self.sess()
        feed_status(s, b"ding\x07", now=100.0)
        self.assertEqual(s.bell_at, 100.0)


class ChecksRollup(unittest.TestCase):
    def test_counts(self):
        rollup = [
            {"conclusion": "SUCCESS"}, {"conclusion": "SKIPPED"},
            {"conclusion": "FAILURE"}, {"state": "IN_PROGRESS"},
        ]
        self.assertEqual(_checks(rollup), {"pass": 2, "fail": 1, "pending": 1})

    def test_empty(self):
        self.assertEqual(_checks(None), {"pass": 0, "fail": 0, "pending": 0})


class Settings(unittest.TestCase):
    def test_merge_ignores_unknown_and_survives_junk(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"rumble": False, "hacker": True}, f)
        os.environ["THUMBWAR_SETTINGS"] = f.name
        try:
            import importlib
            from thumbwar import settings as s
            importlib.reload(s)
            data = s.load()
            self.assertFalse(data["rumble"])
            self.assertNotIn("hacker", data)
            f2 = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
            f2.write("{not json")
            f2.close()
            os.environ["THUMBWAR_SETTINGS"] = f2.name
            importlib.reload(s)
            self.assertTrue(s.load()["rumble"])
        finally:
            os.environ.pop("THUMBWAR_SETTINGS", None)


if __name__ == "__main__":
    unittest.main()
