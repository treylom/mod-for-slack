"""Same-user private permits; not a boundary against a malicious OS account owner."""
import hashlib, json, os, pathlib, re, stat, time, uuid
from pilot.catalog import EVENTS
from budget import entry_timeout_cap_ms

class Refusal(Exception): pass

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

def secure_read(path, private=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or (st.st_mode & (0o077 if private else 0o022)):
            raise Refusal('unsafe-file-metadata')
        with os.fdopen(fd, 'r') as stream:
            fd = -1
            return json.load(stream)
    finally:
        if fd >= 0: os.close(fd)

def load(config_path, session, bot_name):
    try: uuid.UUID(session)
    except Exception: raise Refusal('invalid-session')
    cfg = secure_read(config_path)
    bots = [b for b in cfg.get('bots', []) if b.get('name') == bot_name and b.get('migrated') is True]
    if len(bots) != 1: raise Refusal('bot-not-migrated')
    hooks = cfg['hooks']; required = hooks['requiredGateIds']; entries = hooks['entries']
    if not required or len(set(required)) != len(required): raise Refusal('required-gates-empty-or-duplicate')
    ids = [h['id'] for h in entries]
    if len(set(ids)) != len(ids): raise Refusal('duplicate-entry')
    for h in entries:
        if not h.get('disposition') or not h.get('event'): raise Refusal('incomplete-entry')
        if 'nativePolicy' in h:
            policy=h['nativePolicy']
            if not isinstance(policy,str) or h['event'] not in EVENTS.get(policy,[]): raise Refusal('unknown-native-policy-event')
            key=h.get('optionsKey',policy)
            if not isinstance(key,str) or not key.strip(): raise Refusal('invalid-native-policy-options')
            if 'command' in h or not isinstance(hooks.get('policyOptions',{}).get(key),dict): raise Refusal('invalid-native-policy-options')
        elif not h.get('command'): raise Refusal('incomplete-entry')
        cap = entry_timeout_cap_ms(h)
        timeout = h.get('timeoutMs', 3000)
        if type(timeout) is not int or timeout < 1 or timeout > cap: raise Refusal('invalid-entry-timeout')
        if h.get('enabled', True): re.compile(h.get('matcher') or '.*')
    for rid in required:
        found = [h for h in entries if h['id'] == rid and h.get('blocking') is True and h.get('enabled', True)]
        if len(found) != 1 or found[0]['disposition'] in ('retire', 'defer', 'connection-only'): raise Refusal('required-gate-unavailable')
    return cfg, bots[0], sorted(required), digest(cfg)

def private_dir(path):
    p = pathlib.Path(path)
    if not p.is_absolute(): raise Refusal('runtime-path-not-absolute')
    # Existing symlink ancestors are rejected too. /tmp on macOS is intentionally
    # a symlink, so launch preparation must pass its resolved /private/tmp path.
    for part in [*reversed(p.parents), p]:
        if part.is_symlink(): raise Refusal('runtime-symlink')
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    st = p.stat()
    if st.st_uid != os.getuid() or st.st_mode & 0o077: raise Refusal('runtime-not-private')
    return p

def registry_current(cfg, bot_name, session):
    """Read the session lane's canonical row; never create, rebind, or repair it."""
    # Match session/core.js safeName for the parent fallback; explicit child ids
    # are already allocated by that lane and must not be rewritten.
    fallback = re.sub(r'[^a-z0-9-]+', '-', bot_name.lower()).strip('-')[:40] or 'x'
    rid = os.environ.get('MH_SESSION_ID') or fallback
    if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', rid): raise Refusal('registry-id-invalid')
    raw = cfg.get('session', {}).get('registry_dir', str(pathlib.Path.home() / '.mods-harness/registry.d'))
    raw = re.sub(r'^\$HOME(?=/|$)', str(pathlib.Path.home()), raw)
    folder = pathlib.Path(raw).expanduser()
    if not folder.is_absolute(): raise Refusal('registry-path-not-absolute')
    for part in [*reversed(folder.parents), folder]:
        if part.is_symlink(): raise Refusal('registry-symlink')
    st = folder.stat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise Refusal('registry-not-private')
    # The folder is private. Session-lane atomic files may be 0644, never writable
    # by other users; do not chmod a file owned by another lane.
    row = secure_read(folder / (rid + '.json'))
    if row.get('id') != rid or row.get('bot') != bot_name: raise Refusal('registry-identity-mismatch')
    if row.get('session_uuid') != session: raise Refusal('registry-session-mismatch')
    if row.get('status') != 'running': raise Refusal('registry-session-not-running')
    return rid

def permit_path(cfg, session, event, launch_session=None):
    call = event.get('tool_use_id')
    if not isinstance(call, str) or not call: raise Refusal('missing-tool-use-id')
    root = private_dir(cfg['paths']['readinessRoot'])
    launch_session = launch_session or session
    for value in (session, launch_session):
        try: uuid.UUID(value)
        except Exception: raise Refusal('invalid-session')
    folder = private_dir(private_dir(root / launch_session) / session)
    return folder / (hashlib.sha256(call.encode()).hexdigest() + '.json')

# Claude Code (2.1.296) fills SendMessage's input with display-only copies before hooks and the
# transcript see it (backfillObservableInput: type="message", recipient=to, recipient_kind,
# content=first 50 chars of message; request_id/approve for object messages) and strips exactly
# this list again before the input goes back on the wire (chunk-rb5hrqm8.js: TAr + L0t). The
# tool runs on to/message/summary; these keys are derived from them. The mods tool.call side and
# the native PreToolUse side can see different copies (13/13 SendMessage denied
# permit-binding-mismatch in the 5 moved bots on 10-20), so the permit binds the input with the
# same keys removed, under the same guard. Kept as a strip list on purpose: a new display key
# fails closed (deny + ALARM); an allowlist would silently ignore a new executed field.
SENDMESSAGE_OBSERVABLE = ('type', 'recipient', 'recipient_kind', 'content', 'request_id', 'approve')

def bound_input(tool_name, tool_input):
    if tool_name != 'SendMessage' or not isinstance(tool_input, dict): return tool_input
    if 'to' not in tool_input or not ('message' in tool_input or 'notify_when_idle' in tool_input): return tool_input
    if not any(k in tool_input for k in SENDMESSAGE_OBSERVABLE): return tool_input
    return {k: v for k, v in tool_input.items() if k not in SENDMESSAGE_OBSERVABLE}

def binding(session, event, config_hash, required, launch_session=None):
    if event.get('session_id') != session or not event.get('tool_name'): raise Refusal('event-identity-mismatch')
    return {'session_id': session, 'launch_session_id': launch_session or session, 'tool_use_id': event.get('tool_use_id'), 'tool_name': event['tool_name'],
            'inputHash': digest(bound_input(event['tool_name'], event.get('tool_input'))), 'configHash': config_hash, 'requiredGateIds': required,
            'registrationErrors': []}

def issue(cfg, session, event, config_hash, required, launch_session=None):
    path = permit_path(cfg, session, event, launch_session)
    value = binding(session, event, config_hash, required, launch_session)
    now = time.time(); ttl = cfg['hooks'].get('permitTtlMs', 3000)
    if not isinstance(ttl, (int, float)) or not 0 < ttl <= 5000: raise Refusal('invalid-permit-ttl')
    value.update(issuedAt=now, expiresAt=now + ttl / 1000)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(value, f)
    return True

def consume(cfg, session, event, config_hash, required, launch_session=None):
    path = permit_path(cfg, session, event, launch_session)
    claimed = path.with_name(path.name + '.' + uuid.uuid4().hex + '.consumed')
    # Rename claims the one-use capability even if content is subsequently invalid.
    os.rename(path, claimed)
    try:
        value = secure_read(claimed, private=True)
        expected = binding(session, event, config_hash, required, launch_session)
        if any(value.get(k) != v for k, v in expected.items()): raise Refusal('permit-binding-mismatch')
        now = time.time()
        if not value['issuedAt'] <= now < value['expiresAt'] or value['expiresAt'] - value['issuedAt'] > 5.001:
            raise Refusal('permit-expired')
    finally: claimed.unlink(missing_ok=True)
