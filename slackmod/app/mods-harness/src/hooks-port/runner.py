#!/usr/bin/env python3
"""Run trusted legacy scripts under a bounded budget and issue per-call permits."""
import argparse, concurrent.futures, json, os, pathlib, re, shutil, signal, subprocess, sys, time
from protocol import Refusal, load, issue, registry_current
from pilot.catalog import EVENTS
from budget import effective_event_budget_ms, entry_timeout_cap_ms

class PolicyBlock(Refusal):
    """An explicit policy decision, distinct from unavailable execution.
    detail = the gate's own reason text (bounded), so the model sees why; the stable code stays in str(exc)."""
    def __init__(self, code, detail=None):
        super().__init__(code); self.detail = detail

class ExecutionRefusal(Refusal):
    """Unavailable execution that still carries one plain line for the person (detail) — an execution failure, never a policy
    decision (failureKind stays «execution»: which failure wins in run() and how lifecycle events treat it do not change)."""
    def __init__(self, code, detail=None):
        super().__init__(code); self.detail = detail

PIN_FILE = re.compile(r'[A-Za-z0-9._-]{1,80}')
DEFAULT_REPIN = '이 파일을 직접 고친 게 맞을 때만 설정 hooks.policyOptions 에서 그 파일의 확인 값(…Sha256)을 이 파일의 새 sha256 으로 바꾸기'   # same words as doctor.sh [13]

def pin_detail(output, options):
    """entry.py's pinFile / pinKind → «확인 값이 안 맞음: <file> · 다시 맞추기 = <one line>» (never a folder · never automatic:
    the fix line comes from the config's repinHint — the kit's = re-run its install.sh — or the default above)."""
    f, kind = output.get('pinFile'), output.get('pinKind')
    if not isinstance(f, str) or not PIN_FILE.fullmatch(f) or kind not in ('changed', 'mode', 'missing'): return None
    hint = options.get('repinHint')
    if not isinstance(hint, str) or not 0 < len(hint) <= 200 or any(c in hint for c in '\n\r\t\0'): hint = DEFAULT_REPIN
    if kind == 'mode': return '권한이 느슨함: %s (그룹·다른 사용자가 고칠 수 있음) · 고치기 = 그 파일에 chmod go-w (내용은 그대로 · 확인 값도 그대로)' % f
    if kind == 'missing': return '고정 파일이 없음: %s · 다시 맞추기 = %s' % (f, hint)
    return '확인 값이 안 맞음: %s · 다시 맞추기 = %s' % (f, hint)

def execute(entry, event, cfg, bot, deadline):
    native = entry.get('nativePolicy')
    for requirement in entry.get('requires', ['jq'] if entry['blocking'] and not native else []):
        executable = cfg['paths'].get(requirement + 'Executable') or shutil.which(requirement)
        if not executable or not os.access(executable, os.X_OK): raise Refusal('dependency-missing:' + entry['id'])
        if requirement == 'jq':
            live_jq = shutil.which('jq')
            if not live_jq or os.path.realpath(live_jq) != os.path.realpath(executable): raise Refusal('jq-path-mismatch:' + entry['id'])
            checked = subprocess.run([live_jq, '-R', '-s', '{hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:.}}'], input='probe', capture_output=True, text=True, timeout=0.5)
            if checked.returncode or json.loads(checked.stdout).get('hookSpecificOutput',{}).get('permissionDecision') != 'deny': raise Refusal('jq-encoding-failed:' + entry['id'])
    remaining = deadline - time.monotonic()
    cap = entry_timeout_cap_ms(entry)
    requested = entry.get('timeoutMs', 3000)
    if type(requested) is not int or requested < 1 or requested > cap: raise Refusal('invalid-entry-timeout:' + entry['id'])
    timeout = min(remaining, requested / 1000)
    if timeout <= 0: raise Refusal('event-timeout')
    cwd = bot.get('cwd') or cfg['paths'].get('hookCwd') or os.getcwd()
    argv = None
    payload = event
    if native:
        if native not in EVENTS: raise Refusal('unknown-native-policy')
        options = {**cfg['hooks']['policyOptions'][entry.get('optionsKey', native)], 'bot':bot['name']}   # optionsKey: one options object per entry
        argv = [cfg['paths']['pythonExecutable'],str(pathlib.Path(__file__).parent/'pilot/entry.py'),native]
        payload = {'event':event,'options':options}
    else: argv = ['/bin/sh', '-c', entry['command']]
    proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, cwd=cwd, start_new_session=True)
    try: stdout, stderr = proc.communicate(json.dumps(payload), timeout=timeout)
    except BaseException:
        try: os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        proc.communicate()
        raise Refusal('hook-timeout-or-interrupt:' + entry['id'])
    if len(stdout) > 2_000_000: raise Refusal('hook-output-too-large:' + entry['id'])
    if not stdout.strip():
        if proc.returncode: raise Refusal('hook-exit:' + entry['id'] + ':' + str(proc.returncode))
        if entry['blocking'] and stderr.strip(): raise Refusal('hook-stderr:' + entry['id'])
        return None, None
    try: output = json.loads(stdout)
    except ValueError:
        if proc.returncode: raise Refusal('hook-exit:' + entry['id'] + ':' + str(proc.returncode))
        if entry['blocking'] and stderr.strip(): raise Refusal('hook-stderr:' + entry['id'])
        if entry['blocking'] and not entry.get('allowTextOutput'): raise Refusal('hook-invalid-json:' + entry['id'])
        return None, stdout
    if not isinstance(output, dict): raise Refusal('hook-output-not-object:' + entry['id'])
    if native and 'nativePolicyError' in output: raise ExecutionRefusal('native-policy-error:' + entry['id'], pin_detail(output, options))
    h = output.get('hookSpecificOutput') or {}
    if not isinstance(h, dict): raise Refusal('hook-invalid-output:' + entry['id'])
    decision = h.get('permissionDecision')
    if decision not in (None, 'allow', 'ask', 'deny'): raise Refusal('hook-invalid-decision:' + entry['id'])
    if decision == 'deny' or output.get('decision') == 'block' or output.get('continue') is False or (isinstance(h.get('decision'), dict) and h['decision'].get('behavior') == 'deny'):
        why = h.get('permissionDecisionReason') or output.get('reason') or output.get('stopReason')
        raise PolicyBlock('hook-denied:' + entry['id'], why.strip()[:500] if isinstance(why, str) and why.strip() else None)
    if entry['blocking'] and stderr.strip(): raise Refusal('hook-stderr:' + entry['id'])
    if proc.returncode: raise Refusal('hook-exit:' + entry['id'] + ':' + str(proc.returncode))
    if h.get('updatedInput') is not None: raise Refusal('input-rewrite-needs-reevaluation:' + entry['id'])
    return output, None

def matches(entry, event):
    if entry.get('enabled', True) is not True or entry['event'] != event['hook_event_name']: return False
    matcher = entry.get('matcher')
    if not matcher or matcher == '*': return True
    key = {'SessionStart':'source','SessionEnd':'reason','PreCompact':'trigger','Notification':'notification_type',
           'SubagentStart':'agent_type','SubagentStop':'agent_type','PermissionRequest':'tool_name'}.get(event['hook_event_name'], 'tool_name')
    return re.search(matcher, str(event.get(key, ''))) is not None

def run(config_path, session, bot_name, request, launch_session=None):
    result = {'ok': False, 'deny': True, 'outputs': [], 'context': [], 'permitIssued': False, 'receipt': {}}
    try:
        cfg, bot, required, config_hash = load(config_path, session, bot_name)
        event = request['event']
        if event.get('session_id') != session: raise Refusal('event-session-mismatch')
        registry_id = registry_current(cfg, bot_name, session)
        if request.get('registrationErrors') != []: raise Refusal('lane-registration-error-or-missing')
        registered = request.get('registeredGateIds', [])
        if len(registered) != len(set(registered)) or not set(required).issubset(registered): raise Refusal('missing-gate-registration')
        selected = [h for h in cfg['hooks']['entries'] if matches(h, event)]
        role = os.environ.get('MH_SESSION_ROLE', 'parent')
        if role == 'child':
            if cfg['hooks'].get('childPolicyReviewed') is not True: raise Refusal('child-hook-policy-unreviewed')
            selected = [h for h in selected if not h.get('parentOnly', False)]
        budget = effective_event_budget_ms(cfg['hooks'], event, selected)
        if budget is None: raise Refusal('invalid-event-budget')
        deadline = time.monotonic() + budget / 1000
        # The legacy engine also runs matching command hooks concurrently. Keep
        # output order deterministic; all gates must settle before permission.
        failures=[]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(execute,h,event,cfg,bot,deadline) for h in selected]
            for future in futures:
                try: output, context = future.result()
                except Exception as exc:
                    failures.append(exc)
                    continue
                if output is not None: result['outputs'].append(output)
                if context is not None: result['context'].append(context)
        # Explicit block wins over a sibling execution error. Otherwise a DB
        # outage in an earlier gate could hide a later prompt veto.
        if failures: raise next((e for e in failures if isinstance(e,PolicyBlock)),failures[0])
        if time.monotonic() > deadline: raise Refusal('event-timeout')
        if event['hook_event_name'] == 'PreToolUse' and event.get('tool_name') not in ('Read','Glob','Grep'): result['permitIssued'] = issue(cfg,session,event,config_hash,required,launch_session)
        result.update(ok=True,deny=False,reason='gates-passed')
        result['receipt'] = {'session_id':session,'launch_session_id':launch_session or session,'registry_id':registry_id,'configHash':config_hash,'requiredGateIds':required,'registrationErrors':[],
                             'matchedIds':[h['id'] for h in selected], 'matched':len(selected)}
    except Exception as exc:
        result['reason'] = str(exc) if isinstance(exc, Refusal) else 'runner-error:' + type(exc).__name__
        result['failureKind'] = 'policy' if isinstance(exc, PolicyBlock) else 'execution'
        if isinstance(exc, (PolicyBlock, ExecutionRefusal)) and exc.detail: result['detail'] = exc.detail
        result['outputs'] = []; result['context'] = []
    return result

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--config',required=True); ap.add_argument('--session',required=True); ap.add_argument('--launch-session'); ap.add_argument('--bot',default=os.environ.get('MODS_HARNESS_BOT')); a=ap.parse_args()
    try: request=json.load(sys.stdin)
    except Exception: request={}
    result=run(a.config,a.session,a.bot,request,a.launch_session);print(json.dumps(result));return 0
if __name__=='__main__':sys.exit(main())
