"""bluetooth gamepad discovery, for the pad chip.

the browser gamepad api cannot see a controller until it sends its
first input, and a paired-but-sleeping pad sends nothing at all. one
system_profiler scan tells us what is actually out there, so the chip
can say "press a button on your 8bitdo" instead of a dead "no pad".
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Dict, List

PAD_NAME = re.compile(
    r"8bitdo|controller|gamepad|dual\s*sense|dual\s*shock|xbox|joy-?con|stadia",
    re.I)


def parse_bt(text: str) -> Dict[str, List[str]]:
    """gamepad-looking devices from `system_profiler SPBluetoothDataType -json`."""
    out: Dict[str, List[str]] = {"connected": [], "paired": []}
    try:
        data = json.loads(text)
    except ValueError:
        return out
    if not isinstance(data, dict):
        return out
    for root in data.get("SPBluetoothDataType", []) or []:
        if not isinstance(root, dict):
            continue
        for key, bucket in (("device_connected", "connected"),
                            ("device_not_connected", "paired")):
            for entry in root.get(key, []) or []:
                if not isinstance(entry, dict):
                    continue
                for name, props in entry.items():
                    minor = str((props or {}).get("device_minorType", ""))
                    if minor.lower() in ("gamepad", "joystick") or PAD_NAME.search(name):
                        out[bucket].append(name)
    return out


async def scan(timeout: float = 12.0) -> Dict[str, List[str]]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "system_profiler", "SPBluetoothDataType", "-json",
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL)
    except OSError:
        return {"connected": [], "paired": []}
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return {"connected": [], "paired": []}
    return parse_bt(out.decode("utf-8", "replace"))
