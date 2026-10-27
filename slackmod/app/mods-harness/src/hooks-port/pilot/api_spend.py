"""Portable API spend gate (PreToolUse). Strict errors; no env bypass.

Intentional differences from legacy stdin hook:
- No API_SPEND_OFF environment bypass.
- Options carry ledgerPath, limits, scope, known_cost_krw; bot from options['bot'].
- Ledger uses commandHash (SHA256) instead of plaintext last_cmd.
- Missing/malformed ledger, options, or paths raise; caller maps execution failure to deny.
- Corrupted ledger is not silently reset.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import tempfile
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

KST = timezone(timedelta(hours=9))

BILLING_PATTERNS = [
    r"(OPENAI|ANTHROPIC|GRAFT|GEMINI|OPENROUTER)_API_KEY",
    r"api\.openai\.com",
    r"api\.anthropic\.com",
    r"generativelanguage\.googleapis\.com",
    r"\bgraft\b[^|;]*--deep",
    r"GRAFT_BASE_URL",
]

DENY_TMPL = """[API 지출 관문] {headline}

다음 실행을 붙이기 전에 한 가지만 확인하세요: 이 실행으로 최종 결과의 어떤 문장이나 숫자가 바뀝니까? 바뀌는 것이 없으면(정밀도만 오르면) 지금 값으로 마치세요.

꼭 필요하면 명령 앞에 API_SPEND_OK=1 을 붙이세요(승인 기록이 남습니다).
한도 조정 = 설정 hooks.policyOptions.api-spend"""


def _deny(headline: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": DENY_TMPL.format(headline=headline),
        }
    }


def _command_hash(cmd: str) -> str:
    return hashlib.sha256(cmd.encode("utf-8")).hexdigest()


def _validate_options(options: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(options, dict):
        raise ValueError("options required")
    ledger = options.get("ledgerPath")
    if not isinstance(ledger, str) or not ledger:
        raise ValueError("ledgerPath required")
    path = Path(ledger)
    if not path.is_absolute():
        raise ValueError("ledgerPath must be absolute")
    if path.is_symlink():
        raise ValueError("unsafe ledger path")
    bot = options.get("bot")
    if not isinstance(bot, str) or not bot:
        raise ValueError("bot required")
    max_single = options.get("max_single_krw")
    max_calls = options.get("max_calls_per_session")
    if type(max_single) is not int or type(max_calls) is not int:
        raise ValueError("spend limits required")
    if max_single <= 0 or max_calls < 0:
        raise ValueError("invalid spend limits")
    if "scope" not in options or "known_cost_krw" not in options:raise ValueError("scope and known costs required")
    scope = options.get("scope")
    if scope is not None and (not isinstance(scope, list) or not all(isinstance(x,str) and x for x in scope)):
        raise ValueError("scope must be a list or null")
    known = options.get("known_cost_krw")
    if known is not None and not isinstance(known, dict):
        raise ValueError("known_cost_krw must be a mapping")
    return {
        "ledgerPath": path,
        "bot": bot,
        "max_single_krw": max_single,
        "max_calls_per_session": max_calls,
        "scope": scope,
        "known_cost_krw": known or {},
    }


def _ledger_parent_private(parent: Path) -> None:
    for item in [parent, *parent.parents]:
        if item.is_symlink():raise ValueError("symlink ledger ancestor")
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    st = parent.stat()
    if st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise ValueError("ledger directory not private")


def _read_ledger_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    if path.is_symlink():
        raise ValueError("unsafe ledger path")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "r", encoding="utf-8") as fh:
        st=os.fstat(fh.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:raise ValueError("unsafe ledger metadata")
        fcntl.flock(fh, fcntl.LOCK_SH)
        try:
            raw = fh.read()
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("ledger corrupted") from exc
    if not isinstance(data, dict):
        raise ValueError("ledger schema invalid")
    return data


def _write_ledger_file(path: Path, data: dict[str, Any]) -> None:
    parent = path.parent
    _ledger_parent_private(parent)
    fd, tmp_name = tempfile.mkstemp(dir=parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            os.fchmod(fh.fileno(), 0o600)
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        tmp_path = Path(tmp_name)
        os.replace(tmp_path, path)
        os.chmod(path, 0o600)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _mutate_ledger(path: Path, mutator):
    _ledger_parent_private(path.parent)
    # Lock inode is stable while the data file is atomically replaced. Both
    # first creation and cap check happen inside this same critical section.
    fd=os.open(path.with_name(path.name+'.lock'),os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        st=os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:raise ValueError('unsafe lock metadata')
        fcntl.flock(fd,fcntl.LOCK_EX)
        data=_read_ledger_file(path)
        result=mutator(data)
        _write_ledger_file(path,data)
        return result
    finally:
        os.close(fd)


def _is_billing(cmd: str) -> bool:
    return any(re.search(p, cmd) for p in BILLING_PATTERNS)


def _session_entry(ledger: dict[str, Any], session: str) -> dict[str, Any]:
    entry = ledger.get(session)
    if entry is None:
        return {
            "billed": 0,
            "approved": 0,
            "first_seen": datetime.now(KST).isoformat(timespec="seconds"),
        }
    if not isinstance(entry, dict):
        raise ValueError("ledger schema invalid")
    return dict(entry)


def handle(event: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if event.get("hook_event_name") != "PreToolUse":
        raise ValueError("unsupported api spend event")
    session = event.get("session_id")
    if not isinstance(session, str) or not session:
        raise ValueError("session_id required")

    cfg = _validate_options(options)
    ti = event.get("tool_input") or {}
    if not isinstance(ti, dict):
        raise ValueError("invalid tool input")
    cmd = ti.get("command") or ""
    if not isinstance(cmd, str) or not cmd:
        return None

    ledger_path = cfg["ledgerPath"]

    if "API_SPEND_OK=1" in cmd:

        def approve_mut(ledger: dict[str, Any]) -> None:
            entry = _session_entry(ledger, session)
            n=entry.get("approved",0)
            if type(n) is not int or n<0:raise ValueError("invalid approval counter")
            entry["approved"] = n+1
            entry["commandHash"] = _command_hash(cmd)
            ledger[session] = entry

        _mutate_ledger(ledger_path, approve_mut)
        return None

    if not _is_billing(cmd):
        return None

    scope = cfg["scope"]
    if isinstance(scope, list) and cfg["bot"] not in scope:
        return None

    for name, spec in cfg["known_cost_krw"].items():
        if not isinstance(spec,dict) or not isinstance(spec.get('pattern'),str) or type(spec.get('krw')) is not int or spec['krw']<0:
            raise ValueError('invalid known cost')
        if re.search(spec['pattern'],cmd) and spec['krw']>=cfg['max_single_krw']:
            return _deny(f"이 명령 1회 실행 추정 비용이 {spec['krw']:,}원으로 단건 상한 {cfg['max_single_krw']:,}원 이상이다(등록 단가: {name}).")

    cap = int(cfg["max_calls_per_session"])
    def bill_mut(ledger: dict[str, Any]):
        ent = _session_entry(ledger, session)
        b = ent.get('billed',0)
        if type(b) is not int or b<0:raise ValueError('invalid billed counter')
        if b >= cap:
            return _deny(f"이 세션에서 유료 API 를 태우는 명령이 이미 {b}회 실행됐다(상한 {cap}회).")
        ent['billed'] = b+1
        ent['commandHash'] = _command_hash(cmd)
        ledger[session] = ent
        return None
    return _mutate_ledger(ledger_path,bill_mut)
