"""pull requests through the gh cli, scoped to a session's cwd."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List

_FIELDS = ("number,title,headRefName,baseRefName,author,isDraft,"
           "mergeable,reviewDecision,statusCheckRollup,additions,deletions,url")


async def _run(args: List[str], cwd: str) -> tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "gh", *args, cwd=cwd,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except OSError as exc:
        return 127, "", f"gh not found: {exc}"
    out, err = await proc.communicate()
    return proc.returncode or 0, out.decode(), err.decode()


def _checks(rollup: Any) -> Dict[str, int]:
    counts = {"pass": 0, "fail": 0, "pending": 0}
    for c in rollup or []:
        s = (c.get("conclusion") or c.get("state") or "").upper()
        if s in ("SUCCESS", "NEUTRAL", "SKIPPED"):
            counts["pass"] += 1
        elif s in ("FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"):
            counts["fail"] += 1
        else:
            counts["pending"] += 1
    return counts


async def pr_list(cwd: str) -> Dict[str, Any]:
    code, out, err = await _run(["pr", "list", "--json", _FIELDS], cwd)
    if code != 0:
        return {"error": err.strip().splitlines()[-1] if err.strip() else "gh pr list failed"}
    prs = []
    for p in json.loads(out or "[]"):
        prs.append({
            "number": p["number"], "title": p["title"],
            "head": p["headRefName"], "base": p["baseRefName"],
            "author": (p.get("author") or {}).get("login", ""),
            "draft": p.get("isDraft", False),
            "mergeable": p.get("mergeable", ""),
            "review": p.get("reviewDecision") or "",
            "checks": _checks(p.get("statusCheckRollup")),
            "additions": p.get("additions", 0),
            "deletions": p.get("deletions", 0),
            "url": p.get("url", ""),
        })
    return {"prs": prs}


async def pr_merge(cwd: str, number: int, method: str = "squash") -> Dict[str, Any]:
    flag = {"squash": "--squash", "merge": "--merge", "rebase": "--rebase"}.get(method, "--squash")
    code, out, err = await _run(["pr", "merge", str(number), flag], cwd)
    if code != 0:
        return {"error": err.strip().splitlines()[-1] if err.strip() else "merge failed"}
    return {"ok": True, "number": number}


async def pr_checkout(cwd: str, number: int) -> Dict[str, Any]:
    code, out, err = await _run(["pr", "checkout", str(number)], cwd)
    if code != 0:
        return {"error": err.strip().splitlines()[-1] if err.strip() else "checkout failed"}
    return {"ok": True, "number": number}
