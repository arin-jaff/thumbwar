"""thumbwar entry point."""

from __future__ import annotations

import argparse
import subprocess

from aiohttp import web

from . import __version__
from .server import Hub, build_app

ORANGE = "\x1b[38;2;240;130;79m"
MINT = "\x1b[38;2;76;220;163m"
DIM = "\x1b[2m"
RESET = "\x1b[0m"

BANNER = rf"""
{ORANGE} ✻{RESET}  ▀█▀ █ █ █ █ █▄█ █▀▄ █ █ █▀█ █▀▄
{ORANGE}    {MINT} █ {RESET} █▀█ █ █ █ █ █▀▄ ▀▄▀ █▀█ █▀▄
{ORANGE}    {MINT} ▀ {RESET} ▀ ▀ ▀▀▀ ▀ ▀ ▀▀  ▀ ▀ ▀ ▀ ▀ ▀
{DIM}    vibe coding, gamified · v{__version__}{RESET}
"""


def main() -> None:
    ap = argparse.ArgumentParser(prog="thumbwar",
                                 description="a controller cockpit for parallel claude code agents")
    ap.add_argument("--host", default="127.0.0.1",
                    help="bind address. keep it on loopback unless you know why not")
    ap.add_argument("--port", type=int, default=8710)
    ap.add_argument("--synthetic", action="store_true",
                    help="fake pad input, for trying the ui with no hardware")
    ap.add_argument("--no-pad", action="store_true",
                    help="skip the hid pad entirely, use browser gamepad or keyboard")
    ap.add_argument("--no-open", action="store_true",
                    help="do not open the browser on start")
    args = ap.parse_args()

    hub = Hub(host=args.host, port=args.port,
              synthetic=args.synthetic, no_pad=args.no_pad)
    app = build_app(hub)

    print(BANNER)
    print(f"    deck up at {MINT}{hub.url}{RESET}\n")
    if not args.no_open:
        subprocess.Popen(["open", hub.url])
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
