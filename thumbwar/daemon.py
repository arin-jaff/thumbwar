"""run thumbwar in the background, at login, via launchd.

`thumbwar daemon install` writes a launch agent that starts the server
(no browser tab) when you log in and restarts it if it dies. the deck
is then always one bookmark away, and the disclaimer overlay can find
you even when you never started anything by hand.

nothing here runs unless you ask: install, uninstall, status.
"""

from __future__ import annotations

import argparse
import os
import plistlib
import subprocess
import sys
from pathlib import Path

LABEL = "com.thumbwar.server"
PLIST = Path("~/Library/LaunchAgents/com.thumbwar.server.plist").expanduser()
LOG = Path("~/Library/Logs/thumbwar.log").expanduser()


def plist_bytes(port: int) -> bytes:
    """the launch agent, built with plistlib so quoting is never our bug."""
    return plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": [sys.executable, "-m", "thumbwar",
                             "--no-open", "--port", str(port)],
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "StandardOutPath": str(LOG),
        "StandardErrorPath": str(LOG),
    })


def _launchctl(*args: str) -> int:
    try:
        return subprocess.run(["launchctl", *args], capture_output=True).returncode
    except OSError:
        return 1


def _domain() -> str:
    return f"gui/{os.getuid()}"


def install(port: int) -> None:
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    PLIST.write_bytes(plist_bytes(port))
    _launchctl("bootout", f"{_domain()}/{LABEL}")      # reinstall path, may fail
    if _launchctl("bootstrap", _domain(), str(PLIST)) == 0:
        print(f"installed. thumbwar now runs at login on port {port}.")
        print(f"deck: http://127.0.0.1:{port}/ · logs: {LOG}")
    else:
        print("wrote the plist but launchctl bootstrap failed. try logging out"
              f" and back in, or: launchctl bootstrap {_domain()} {PLIST}")


def uninstall() -> None:
    _launchctl("bootout", f"{_domain()}/{LABEL}")
    try:
        PLIST.unlink()
        print("uninstalled. thumbwar will not start at login anymore.")
    except FileNotFoundError:
        print("nothing to uninstall.")


def status() -> None:
    if not PLIST.exists():
        print("not installed. `thumbwar daemon install` to run at login.")
        return
    code = _launchctl("print", f"{_domain()}/{LABEL}")
    print(f"installed at {PLIST}")
    print("running." if code == 0 else "installed but not loaded. log out and in, or bootstrap it.")


def cli(argv) -> None:
    ap = argparse.ArgumentParser(prog="thumbwar daemon",
                                 description="run thumbwar in the background at login")
    ap.add_argument("action", choices=["install", "uninstall", "status"])
    ap.add_argument("--port", type=int, default=8710)
    args = ap.parse_args(argv)
    if args.action == "install":
        install(args.port)
    elif args.action == "uninstall":
        uninstall()
    else:
        status()
