"""pinned-legacy — run ONE original settings hook, hash-pinned, with an isolated environment (A33 groups 3·5 · bot 10-17).

Same pattern as the group-1/2 bridges (원본 분류 코드 해시 고정 호출): the original script stays a private dependency,
is read once with O_NOFOLLOW, checked against sourceSha256, and executed from that exact text (no second read of
the path). Differences from running it as a plain `command` entry:
- hash pin: a changed source refuses (fail-closed) instead of silently running new code;
- environment: only HOME/PATH/LANG plus the names the entry lists — no inherited secrets or bypass switches;
- transcript: the mods route has `messages`, not a transcript file; when the entry asks for it, a private JSONL
  file in the classic shape is written for the run and removed after (fidelity is per hook — see fixtures);
- failures: a crash, timeout, non-JSON or unknown exit is an execution error (the runner turns it into a tool deny
  or a prompt pass+warning per the approved contract), never a silent pass. Exit 2 keeps its classic meaning: block.
  A hook that catches its own failure and exits 0 («fail-open» on stderr) is caught only when the entry sets
  failOpenStderr — without it that case is indistinguishable from an allow, so every entry must set it or say why not.
- helpers: pinnedSiblings pins files the hook imports or runs (checked before and after the run; a swap between the
  two checks is not caught — the same window the bash/sh path has).
"""
import json, os, pathlib, re, shutil, stat, subprocess, tempfile
from rsync_safety import source

INTERPRETERS = {'python3', 'bash', 'sh'}
CLASSIC_KEYS = ('hook_event_name', 'session_id', 'cwd', 'transcript_path', 'permission_mode', 'tool_name', 'tool_use_id',
                'tool_input', 'tool_response', 'prompt', 'source', 'agent_id', 'stop_hook_active', 'last_assistant_message')
BASE_ENV = ('PATH', 'LANG', 'LC_ALL', 'TMPDIR')
PY_LAUNCHER = ("import json,os,sys\n"
               "p,t,iso,a=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]\n"
               "sys.argv=[p]+json.loads(a)\n"
               "iso=='1' or sys.path.insert(0,os.path.dirname(p))\n"
               "exec(compile(t,p,'exec'),{'__name__':'__main__','__file__':p})\n")


def _interpreter(options):
    name = options.get('interpreter')
    if name not in INTERPRETERS: raise ValueError('interpreter must be one of python3|bash|sh')
    path = options.get('interpreterPath') or shutil.which(name)
    if not path or not os.path.isabs(path) or not os.access(path, os.X_OK): raise ValueError('interpreter missing')
    return path


def _env(options):
    env = {k: os.environ[k] for k in BASE_ENV if k in os.environ}
    home = options.get('home') or os.environ.get('HOME')
    if not home or not os.path.isabs(home): raise ValueError('home must be absolute')
    env['HOME'] = home
    for name in options.get('envPass', []):            # names only; values come from the runner's own environment
        if not isinstance(name, str) or not name.replace('_', '').isalnum(): raise ValueError('bad env name')
        if name in os.environ: env[name] = os.environ[name]
    for name, value in (options.get('envSet') or {}).items():
        if not isinstance(name, str) or not name.replace('_', '').isalnum() or not isinstance(value, str): raise ValueError('bad env pair')
        env[name] = value
    return env


def _args(options):
    args = options.get('args') or []
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args): raise ValueError('args must be a list of strings')
    return args


def _check_siblings(options):
    """pinnedSiblings {absolute path: sha256}: helper files the hook imports or runs — pinned like the entry file."""
    sib = options.get('pinnedSiblings') or {}
    if not isinstance(sib, dict): raise ValueError('pinnedSiblings must be an object')
    for path, digest in sib.items(): source(path, digest)


def _fail_open(options, stdout, stderr):
    """failOpenStderr: regex for the hook's own «I failed, letting it through» line. A clean exit with no output but
    that line is an execution error under the new contract (tool = deny · prompt = pass + warning), not a pass."""
    pat = options.get('failOpenStderr')
    if pat and not (stdout or '').strip() and re.search(pat, stderr or ''): raise RuntimeError('legacy hook failed open')


def _classic_content(role, blocks):
    """The classic file stores a typed user prompt as a plain string, not a block list; hooks test for that
    (discord-mention-gate:87 counts inbound <channel> tags only from string content). A user message made only of
    text blocks goes back to that string. Tool results and mixed messages keep their blocks."""
    if role == 'user' and blocks and all(isinstance(b, dict) and b.get('type') == 'text' and isinstance(b.get('text'), str) for b in blocks):
        return '\n'.join(b['text'] for b in blocks)
    return blocks


def transcript_lines(messages, api_messages=None):
    """mods messages → classic transcript JSONL lines {type, message:{role, content[]}}.
    Preferred: apiMessages ($.session.messages({as:'api'}) — blocks intact, media bodies dropped by the lane).
    Fallback: SessionMessage rows {role, text, toolUses[{tool_use_id, tool, input}], toolResults[{tool_use_id, text, isError}]}.
    Limit either way: the engine's view after compaction (summary in place), not the full classic file."""
    out = []
    if isinstance(api_messages, list) and api_messages:
        for m in api_messages:
            if isinstance(m, dict) and m.get('role') in ('user', 'assistant') and isinstance(m.get('content'), list):
                out.append(json.dumps({'type': m['role'], 'message': {'role': m['role'], 'content': _classic_content(m['role'], m['content'])}}, ensure_ascii=False))
        return out
    for m in messages or []:
        if not isinstance(m, dict): continue
        role = m.get('role')
        if role not in ('user', 'assistant'): continue
        content = []
        for tr in m.get('toolResults') or []:
            if isinstance(tr, dict): content.append({'type': 'tool_result', 'tool_use_id': tr.get('tool_use_id'), 'content': tr.get('text', ''), 'is_error': bool(tr.get('isError'))})
        if isinstance(m.get('text'), str) and m['text']: content.append({'type': 'text', 'text': m['text']})
        content = _classic_content(role, content)
        for tu in m.get('toolUses') or []:
            if isinstance(tu, dict): content.append({'type': 'tool_use', 'id': tu.get('tool_use_id'), 'name': tu.get('tool'), 'input': tu.get('input')})
        out.append(json.dumps({'type': role, 'message': {'role': role, 'content': content}}, ensure_ascii=False))
    return out


def rewrite_as_deny(event, out):
    """rewriteAsDeny (dispatch-shape, approved 10-17 option 나): the runner refuses input rewriting, so a legacy
    updatedInput becomes a deny whose reason names the changed fields — the model re-calls with those values and
    that new call is evaluated by every gate from the start."""
    h = out.get('hookSpecificOutput') if isinstance(out, dict) else None
    if not isinstance(h, dict) or h.get('updatedInput') is None: return out
    new, old = h['updatedInput'], event.get('tool_input') or {}
    if not isinstance(new, dict): raise ValueError('legacy updatedInput is not an object')
    changed = [k for k in sorted(set(new) | set(old)) if new.get(k) != old.get(k)]
    if not changed:   # dispatch-shape:134-141 echoes the input unchanged when the judge agrees or is down → plain pass
        rest = {k: v for k, v in h.items() if k != 'updatedInput'}
        return {**{k: v for k, v in out.items() if k != 'hookSpecificOutput'}, **({'hookSpecificOutput': rest} if len(rest) > 1 else {})}
    shown = ', '.join('%s=%s' % (k, json.dumps(new[k], ensure_ascii=False)[:200]) for k in changed if k != 'prompt')
    if 'prompt' in changed: shown = (shown + ', ' if shown else '') + 'prompt(바뀜)'
    why = '게이트 추천으로 다시 호출하세요: ' + (shown or '(바뀐 칸 없음)')
    if h.get('permissionDecisionReason'): why += ' — ' + str(h['permissionDecisionReason'])[:300]
    return {'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny', 'permissionDecisionReason': why}}


def classic_event(event):
    return {k: event[k] for k in CLASSIC_KEYS if k in event}


def interpret(name, code, stdout, stderr):
    """classic hook result → runner output dict | None. Raises on anything that is not a clear classic answer."""
    text = (stdout or '').strip()
    if code == 2:                                       # classic: exit 2 = block, stderr is the reason
        return {'decision': 'block', 'reason': (stderr or 'blocked').strip()[:500]}
    if code != 0: raise RuntimeError('legacy hook exit %d' % code)
    if not text: return None
    try: value = json.loads(text)
    except ValueError:
        if name in ('UserPromptSubmit', 'SessionStart'):   # classic: plain stdout = context for these events
            return {'hookSpecificOutput': {'hookEventName': name, 'additionalContext': text[:10000]}}
        raise ValueError('legacy hook printed non-JSON')
    if not isinstance(value, dict): raise ValueError('legacy hook JSON is not an object')
    return value


def handle(event, options):
    name = event.get('hook_event_name')
    if name not in ('PreToolUse', 'UserPromptSubmit', 'SessionStart'): raise ValueError('unsupported pinned-legacy event')
    # vault-scope-run.sh reproduction: the wrapper skips the hook when cwd is outside its folder (exit 0 = no output)
    scope = options.get('cwdUnder')
    if scope:
        if not os.path.isabs(scope): raise ValueError('cwdUnder must be absolute')
        cwd_now = os.path.realpath(event.get('cwd') or '')
        if not (cwd_now == os.path.realpath(scope) or cwd_now.startswith(os.path.realpath(scope) + os.sep)): return None
    text = source(options['sourcePath'], options['sourceSha256'])
    _check_siblings(options)
    interp = _interpreter(options)
    args = _args(options)
    if options['interpreter'] == 'python3':
        # exact pinned text, with the original path as __file__/argv[0]; pythonIsolated = the wrapper's `python3 -I`
        # (no PYTHON* env, no user site, no script folder on sys.path — so the launcher does not add it either)
        iso = bool(options.get('pythonIsolated'))
        argv = [interp] + (['-I'] if iso else []) + ['-c', PY_LAUNCHER, options['sourcePath'], text, '1' if iso else '0', json.dumps(args)]
    else:
        # a shell script needs its own path ($0 / BASH_SOURCE) → run the path, and re-check the pin after the run
        argv = [interp, options['sourcePath']] + args
    payload = classic_event(event)
    tdir = None
    try:
        if options.get('transcriptFromMessages'):
            tdir = tempfile.mkdtemp(prefix='mh-transcript-')
            os.chmod(tdir, 0o700)
            tp = pathlib.Path(tdir) / 'transcript.jsonl'
            fd = os.open(tp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as f: f.write('\n'.join(transcript_lines(event.get('messages'), event.get('apiMessages'))) + '\n')
            payload['transcript_path'] = str(tp)
        cwd = options.get('cwd') or event.get('cwd') or os.environ.get('HOME')
        timeout = float(options.get('timeoutMs', 3000)) / 1000
        proc = subprocess.run(argv, input=json.dumps(payload, ensure_ascii=False), capture_output=True, text=True,
                              env=_env(options), cwd=cwd, timeout=timeout)
        if options['interpreter'] != 'python3': source(options['sourcePath'], options['sourceSha256'])   # swapped during the run → refuse
        _check_siblings(options)                                                                        # same for helpers
        if proc.returncode == 0: _fail_open(options, proc.stdout, proc.stderr)
        out = interpret(name, proc.returncode, proc.stdout, proc.stderr)
        return rewrite_as_deny(event, out) if options.get('rewriteAsDeny') and name == 'PreToolUse' else out
    finally:
        if tdir: shutil.rmtree(tdir, ignore_errors=True)
