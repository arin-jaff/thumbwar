"""user settings. one json file, merged over defaults."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

PATH = Path(os.environ.get("THUMBWAR_SETTINGS", "~/.thumbwar.json")).expanduser()

DEFAULTS: Dict[str, Any] = {
    # the disclaimer overlay after agents finish
    "countdown_seconds": 3,        # 0 means no countdown, just a dismiss button
    "auto_return": True,           # at zero, bring thumbwar back to the front
    "overlay_always": False,       # show the system overlay even when not away
    "overlay_needs_you": True,     # overlay when an agent starts waiting on you
    # away mode
    "auto_away": False,            # slip away automatically when agents are cooking
    "auto_away_after": 30,         # seconds of no input before auto away
    # feel
    "rumble": True,
    "rumble_intensity": 0.8,       # 0..1 scales every pattern
    "deadzone": 0.12,
    "sound": True,                 # synthesized ui sounds
    "sound_volume": 0.4,           # 0..1
    "theme": "mint",               # mint | peach | lavender | midnight
    # wispr flow push to talk. set wispr's shortcut to the same combo.
    "wispr_key": "ctrl+alt+cmd+space",
    # sessions
    "session_cmd": "claude",
    "roots": ["~/Documents/gh_repos"],
    "merge_method": "squash",
    # paddle quick slots: back and upper paddles fire these instantly
    "quick_slots": {"l4": "/clear", "r4": "/compact", "pl": "/cost", "pr": "/context"},
}


def load() -> Dict[str, Any]:
    """defaults, with known keys of the right shape merged over them.

    a hand edited file is expected. a wrong type in it would otherwise wedge
    a background loop at runtime, so type mismatches fall back to the default.
    """
    data: Dict[str, Any] = dict(DEFAULTS)
    try:
        on_disk = json.loads(PATH.read_text())
    except (OSError, ValueError):
        return data
    if not isinstance(on_disk, dict):
        return data
    for key, value in on_disk.items():
        if key not in DEFAULTS:
            continue
        want = DEFAULTS[key]
        if isinstance(want, bool):
            ok = isinstance(value, bool)
        elif isinstance(want, (int, float)):
            ok = isinstance(value, (int, float)) and not isinstance(value, bool)
        else:
            ok = isinstance(value, type(want))
        if ok:
            data[key] = value
    return data


def save(data: Dict[str, Any]) -> None:
    keep = {k: v for k, v in data.items() if k in DEFAULTS}
    try:
        PATH.write_text(json.dumps(keep, indent=2) + "\n")
    except OSError:
        pass
