"""Memory index gate — session MEMORY.md index-only size limit (pilot, pure Python).

Intentional differences from legacy stdin hook:
- No MEMORY_INDEX_GATE environment bypass; always enforced when invoked.
- SessionStart index path is under options.memoryHome, not process HOME.
- Unreadable or missing Edit/MultiEdit target file raises OSError (fail closed);
  legacy treated missing file as empty string.
- Caller receives exceptions; no stderr swallowing or exit 0 on errors.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

TARGET_RE = re.compile(r"(/memory/MEMORY\.md|/agent-memory/[^/]+/MEMORY\.md)$")

_DEFAULT_LIMIT = 4500


def _cwd_slug(cwd: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "-", str(Path(cwd).resolve()))


def memory_index_path(memory_home: str, cwd: str) -> Path:
    """Path to cwd-scoped MEMORY.md under memoryHome/.claude/projects/<slug>/memory/."""
    base = Path(memory_home).expanduser().resolve()
    return base / ".claude" / "projects" / _cwd_slug(cwd) / "memory" / "MEMORY.md"


def _result_size(tool: str, tool_input: dict[str, Any]) -> int | None:
    path = tool_input.get("file_path") or ""
    if not TARGET_RE.search(path):
        return None
    if tool == "Write":
        content = tool_input.get("content")
        if not isinstance(content, str):
            raise ValueError("Write content must be text")
        return len(content)
    if tool in ("Edit", "MultiEdit"):
        cur = Path(path).read_text(encoding="utf-8")
        edits = tool_input.get("edits") or [tool_input]
        for edit in edits:
            old = edit.get("old_string") or ""
            new = edit.get("new_string") or ""
            if not old:
                continue
            if edit.get("replace_all"):
                cur = cur.replace(old, new)
            else:
                cur = cur.replace(old, new, 1)
        return len(cur)
    return None


def _session_start_warning(path: Path, count: int, limit: int) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": (
                f"[memory-index-gate] session index {path.name} = {count:,} chars > limit {limit:,} "
                "— keep index-only (topic lines + slugs); move body text to memory/<slug>.md "
                "and reduce below the limit (see memory.md section 6). Record before/after char counts in handoff."
            ),
        }
    }


def _pretool_deny(count: int, limit: int) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"[memory-index-gate] write result MEMORY.md = {count:,} chars > limit {limit:,} "
                "— index is topic lines + slugs only; put narrative body in memory/<slug>.md "
                "(memory.md section 6)."
            ),
        }
    }


def handle(event: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Evaluate hook event; return legacy-shaped hook output or None."""
    opts = options or {}
    limit = opts.get("limit", _DEFAULT_LIMIT)
    if type(limit) is not int or limit <= 0:
        raise ValueError("limit must be a positive integer")
    memory_home = opts.get("memoryHome")
    if not isinstance(memory_home, str) or not Path(memory_home).is_absolute():
        raise ValueError("memoryHome option is required")

    ev = event.get("hook_event_name") or ""
    if ev == "SessionStart":
        cwd = event.get("cwd") or ""
        p = memory_index_path(str(memory_home), cwd)
        try:
            n = len(p.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        if n > limit:
            return _session_start_warning(p, n, limit)
        return None

    if ev == "PreToolUse":
        tool = event.get("tool_name") or ""
        tool_input = event.get("tool_input") or {}
        if not isinstance(tool_input, dict):
            raise TypeError("tool_input must be a dict")
        n = _result_size(tool, tool_input)
        if n is not None and n > limit:
            return _pretool_deny(n, limit)
        return None
    raise ValueError("unsupported memory event")
