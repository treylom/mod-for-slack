#!/usr/bin/env python3
"""Bounded turn journal under hooks-port; same-user private dirs only."""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import re
import sys
import time
import uuid

from protocol import Refusal, digest, load, private_dir, registry_current, secure_read

VERSION = 1
TERMINAL = frozenset({'eligible', 'held', 'warning'})
ALLOWED_EVENTS = frozenset({
    'SessionStart',
    'UserPromptSubmit',
})
TURN_ID_RE = re.compile(r'^.{1,256}$')
ANSWER_HASH_RE = re.compile(r'^[0-9a-f]{64}$')


def turn_sha(turn_id):
    return hashlib.sha256(turn_id.encode('utf-8')).hexdigest()


def validate_uuid(value, label):
    try:
        uuid.UUID(str(value))
    except Exception:
        raise Refusal('invalid-' + label)


def validate_turn_id(turn_id):
    if not isinstance(turn_id, str) or not TURN_ID_RE.fullmatch(turn_id):
        raise Refusal('invalid-turn-id')


def journal_dir(cfg, launch_session, current_session):
    validate_uuid(launch_session, 'launch-session')
    validate_uuid(current_session, 'session')
    root = cfg['paths'].get('runtimeRoot')
    if not isinstance(root, str) or not root:
        raise Refusal('runtime-root-missing')
    base = private_dir(pathlib.Path(root) / 'hooks-port')
    return private_dir(private_dir(base / launch_session) / current_session)


def record_path(folder, kind, turn_id):
    return folder / (kind + '-' + turn_sha(turn_id) + '.json')


def lock_path(folder, turn_id):
    return folder / ('.' + turn_sha(turn_id) + '.lock')


def atomic_write_json(path, value):
    path = pathlib.Path(path)
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            fd = -1
            json.dump(value, stream, sort_keys=True, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    finally:
        if fd >= 0:
            os.close(fd)
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def read_record(path):
    if not path.exists():
        return None
    return secure_read(path, private=True)


def base_fields(bot_name, session, launch_session, turn_id):
    return {
        'version': VERSION,
        'bot': bot_name,
        'sessionId': session,
        'launchSessionId': launch_session,
        'turnId': turn_id,
    }


def sanitize_events(events):
    if events is None:
        return []
    if not isinstance(events, list) or len(events) > 32:
        raise Refusal('invalid-events')
    out = []
    for item in events:
        if not isinstance(item, str) or item not in ALLOWED_EVENTS:
            raise Refusal('invalid-events')
        out.append(item)
    return out


def receipt_slice(receipt):
    if receipt is None:
        return {}
    if not isinstance(receipt, dict):
        raise Refusal('invalid-receipt')
    out = {}
    for key in (
        'session_id', 'launch_session_id', 'registry_id', 'configHash',
        'requiredGateIds', 'registrationErrors', 'matchedIds',
    ):
        if key in receipt:
            out[key] = receipt[key]
    if 'requiredGateIds' in out and not isinstance(out['requiredGateIds'], list):
        raise Refusal('invalid-receipt')
    if 'registrationErrors' in out and not isinstance(out['registrationErrors'], list):
        raise Refusal('invalid-receipt')
    return out


def completion_status(reason, result):
    if reason == 'answer' and result.get('ok') is True and result.get('deny') is False:
        return 'eligible'
    return 'held'


def safe_failure(result, reason):
    if reason == 'answer' and result.get('ok') is True and result.get('deny') is False:
        return None, None
    kind = result.get('failureKind')
    if kind not in (None, 'policy', 'execution'):
        kind = 'execution'
    if reason in ('aborted', 'refusal', 'error'):
        sym = reason
    elif isinstance(result.get('reason'), str) and re.fullmatch(
        r'[a-z][a-z0-9-]{0,63}', result.get('reason')
    ):
        sym = result['reason']
    else:
        sym = 'error'
    return kind or 'execution', sym


def records_compatible(existing, new):
    keys = (
        'status', 'reason', 'answerHash', 'failureKind', 'symbolicReason',
        'configHash', 'registry_id',
    )
    for key in keys:
        if existing.get(key) != new.get(key):
            return False
    if existing.get('requiredGateIds') != new.get('requiredGateIds'):
        return False
    return True


def with_turn_lock(folder, turn_id, fn):
    folder = pathlib.Path(folder)
    lock = lock_path(folder, turn_id)
    fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        return fn()
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def write_prompt_warning(cfg, bot_name, session, request):
    launch = request.get('launchSessionId') or session
    turn_id = request['turnId']
    validate_uuid(launch, 'launch-session')
    validate_turn_id(turn_id)
    registry_current(cfg, bot_name, session)
    folder = journal_dir(cfg, launch, session)
    path = record_path(folder, 'warning', turn_id)
    events = sanitize_events(request.get('events'))

    def work():
        existing = read_record(path)
        if existing is not None:
            if existing.get('status') != 'warning':
                raise Refusal('warning-conflict')
            return {'ok': True, 'path': str(path), 'status': 'warning', 'created': False}
        value = base_fields(bot_name, session, launch, turn_id)
        value.update(status='warning', failureKind='execution', at=time.time(), events=events)
        atomic_write_json(path, value)
        return {'ok': True, 'path': str(path), 'status': 'warning', 'created': True}

    return with_turn_lock(folder, turn_id, work)


def write_turn_start(cfg, bot_name, session, request):
    launch = request.get('launchSessionId') or session
    turn_id = request['turnId']
    validate_uuid(launch, 'launch-session')
    validate_turn_id(turn_id)
    registry_current(cfg, bot_name, session)
    folder = journal_dir(cfg, launch, session)
    path = record_path(folder, 'completion', turn_id)

    def work():
        existing = read_record(path)
        if existing is not None and existing.get('status') in TERMINAL:
            return {
                'ok': True,
                'path': str(path),
                'status': existing['status'],
                'created': False,
            }
        if existing is not None and existing.get('status') == 'pending':
            return {'ok': True, 'path': str(path), 'status': 'pending', 'created': False}
        value = base_fields(bot_name, session, launch, turn_id)
        value.update(status='pending', at=time.time())
        atomic_write_json(path, value)
        return {'ok': True, 'path': str(path), 'status': 'pending', 'created': True}

    return with_turn_lock(folder, turn_id, work)


def write_turn_complete(cfg, bot_name, session, request):
    launch = request.get('launchSessionId') or session
    turn_id = request['turnId']
    result = request.get('result')
    reason = request.get('reason')
    answer_hash = request.get('answerHash')
    validate_uuid(launch, 'launch-session')
    validate_turn_id(turn_id)
    if not isinstance(result, dict):
        raise Refusal('invalid-result')
    if reason not in ('answer', 'aborted', 'refusal', 'error'):
        raise Refusal('invalid-reason')
    if not isinstance(answer_hash, str) or not ANSWER_HASH_RE.fullmatch(answer_hash):
        raise Refusal('invalid-answer-hash')
    registry_id = registry_current(cfg, bot_name, session)
    folder = journal_dir(cfg, launch, session)
    path = record_path(folder, 'completion', turn_id)
    failure_kind, symbolic = safe_failure(result, reason)
    status = completion_status(reason, result)
    slice_ = receipt_slice(result.get('receipt'))
    if slice_.get('session_id') and slice_['session_id'] != session:
        raise Refusal('receipt-session-mismatch')
    if slice_.get('launch_session_id') and slice_['launch_session_id'] != launch:
        raise Refusal('receipt-launch-mismatch')

    if status == 'eligible':
        expected = {'session_id':session,'launch_session_id':launch,'registry_id':registry_id,
                    'configHash':digest(cfg),'requiredGateIds':sorted(cfg['hooks']['requiredGateIds']),'registrationErrors':[]}
        if any(slice_.get(k) != v for k,v in expected.items()):raise Refusal('receipt-binding-mismatch')
    value = base_fields(bot_name, session, launch, turn_id)
    value.update(
        status=status,
        reason=reason,
        answerHash=answer_hash,
        failureKind=failure_kind,
        symbolicReason=symbolic,
        at=time.time(),
        registry_id=slice_.get('registry_id', registry_id),
        configHash=digest(cfg),
        requiredGateIds=sorted(cfg['hooks']['requiredGateIds']),
        matchedIds=slice_.get('matchedIds', []),
        registrationErrors=slice_.get('registrationErrors', []),
    )

    def work():
        existing = read_record(path)
        completion_ids = {e['id'] for e in cfg['hooks']['entries'] if e['event']=='Stop' and e.get('enabled',True) and e['id'] in cfg['hooks']['requiredGateIds']}
        if status == 'eligible' and (not completion_ids or not completion_ids.issubset(set(slice_.get('matchedIds',[])))):
            value.update(status='held', failureKind='execution', symbolicReason='completion-gate-not-evaluated')
        if status == 'eligible' and existing is None:
            value.update(status='held', failureKind='execution', symbolicReason='missing-turn-start')
        if existing is not None and existing.get('status') in TERMINAL:
            if records_compatible(existing, value):
                return {
                    'ok': True,
                    'path': str(path),
                    'status': existing['status'],
                    'created': False,
                }
            raise Refusal('terminal-conflict')
        atomic_write_json(path, value)
        return {'ok': True, 'path': str(path), 'status': value['status'], 'created': True}

    return with_turn_lock(folder, turn_id, work)


def write_receipt(cfg, bot_name, session, operation, request):
    if operation == 'prompt-warning':
        return write_prompt_warning(cfg, bot_name, session, request)
    if operation == 'turn-start':
        return write_turn_start(cfg, bot_name, session, request)
    if operation == 'turn-complete':
        return write_turn_complete(cfg, bot_name, session, request)
    raise Refusal('unknown-operation')


def handle(config_path, session, bot_name, request):
    operation = request.get('operation')
    if operation not in ('prompt-warning', 'turn-start', 'turn-complete'):
        raise Refusal('unknown-operation')
    cfg, bot, _required, _config_hash = load(config_path, session, bot_name)
    return write_receipt(cfg, bot['name'], session, operation, request)


def fail_response(exc):
    return {'ok': False, 'reason': 'journal-error:' + type(exc).__name__}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    ap.add_argument('--session', required=True)
    ap.add_argument('--bot', required=True)
    args = ap.parse_args()
    try:
        request = json.load(sys.stdin)
    except Exception as exc:
        print(json.dumps(fail_response(exc)))
        return 1
    try:
        result = handle(args.config, args.session, args.bot, request)
    except Refusal as exc:
        print(json.dumps(fail_response(exc)))
        return 1
    except Exception as exc:
        print(json.dumps(fail_response(exc)))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())

