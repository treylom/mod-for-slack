"""Pinned legacy TypeSafe classifiers behind native tool.call.

The source and dependency manifest are trusted, same-user private configuration.
No tool command is executed. The outer runner owns the process-group deadline.
"""
import fcntl, hashlib, json, os, pathlib, re, stat, subprocess, sys
from rsync_safety import source, private_parent

POLICIES = {'typesafe-destructive', 'typesafe-dispatch', 'typesafe-signature'}
MODULES = {'typesafe_judge','typesafe_questions','typesafe_scope','typesafe_approval_registry',
           'typesafe_approval_button','typesafe_approval_deadline','typesafe_alert'}
AUDIT = re.compile(r'approval-consume-audit request_id=([a-f0-9]{32}) event_id=([a-f0-9]{64}|[0-9]{10}\.[0-9]{6}|[0-9]{17,20}) error=(deadline|notice|durability)')
WARNINGS = {
    '[typesafe-destr] warning: HTTP 402 판정 공백 · 승인 범위 밖 명령 통과',
    '[typesafe-destr] warning: 판정기 재시도 후에도 응답 없음 · 정적 위험 징후 없음 · 명령 통과',
    '[typesafe-destr] warning: 판정기 응답 없음(재시도 대상 아님) · 정적 위험 징후 없음 · 명령 통과',
}

def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()

def read_private(path):
    path=pathlib.Path(path)
    for item in (path,*path.parents):
        if item.is_symlink():raise ValueError('state symlink')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd) as f:
        st=os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('unsafe state')
        return json.load(f)

def validate(policy, options):
    if policy not in POLICIES:raise ValueError('unknown TypeSafe policy')
    source(options['sourcePath'],options['sourceSha256'])
    private_parent(pathlib.Path(options['stateDir'])/'audit.jsonl')
    if not isinstance(options.get('judgeEnvFile'),str) or not pathlib.Path(options['judgeEnvFile']).is_absolute():raise ValueError('explicit judge env file required')
    if options.get('judgeCredentialEnv') is not None and not re.fullmatch(r'[A-Z][A-Z0-9_]{0,127}',options['judgeCredentialEnv']):raise ValueError('credential env name required')
    modules=options['modules']
    if not isinstance(modules,dict) or set(modules)-MODULES:raise ValueError('invalid dependency manifest')
    required={'typesafe_judge','typesafe_questions'}
    if policy=='typesafe-destructive':required|={'typesafe_scope','typesafe_approval_registry','typesafe_approval_button','typesafe_approval_deadline'}
    if not required<=set(modules):raise ValueError('missing pinned dependency')
    for value in modules.values():source(value['path'],value['sha256'])
    if policy=='typesafe-dispatch' and type(options.get('dispatchHint')) is not bool:raise ValueError('explicit dispatchHint required')
    if policy=='typesafe-destructive':
        for key in ('approvalRoot','vaultRoot','rosterPath','privateReposPath','buttonBotsFile'):
            if not isinstance(options.get(key),str) or not pathlib.Path(options[key]).is_absolute():raise ValueError('absolute destructive path required')
        private_parent(pathlib.Path(options['approvalRoot'])/'anchor')
        if options.get('alertMode') not in ('off','legacy','v2'):raise ValueError('explicit alert mode required')
        if options['alertMode']!='off':
            sidecar=options['alertSender'];source(sidecar['path'],sidecar['sha256'])
            expected=pathlib.Path(options['sourcePath']).parent.parent/'scripts/slack-send.py'
            if pathlib.Path(sidecar['path'])!=expected:raise ValueError('alert sender location mismatch')
        if options['alertMode']=='v2' and 'typesafe_alert' not in modules:raise ValueError('missing alert dependency')

def audit(options,event,kind,code,diagnostic):
    p=private_parent(pathlib.Path(options['stateDir'])/'audit.jsonl')
    row={'kind':kind,'exit':code,'diagnosticHash':sha(diagnostic),'session':event.get('session_id'),
         'tool_use_id':event.get('tool_use_id'),'inputHash':sha(json.dumps(event.get('tool_input'),sort_keys=True))}
    fd=os.open(p,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
    with os.fdopen(fd,'a') as f:
        st=os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('unsafe audit')
        fcntl.flock(f,fcntl.LOCK_EX);f.write(json.dumps(row)+'\n');f.flush()

def consumed(options,event,line,claim_existed):
    m=AUDIT.fullmatch(line)
    cmd=(event.get('tool_input') or {}).get('command','')
    if not m or claim_existed or not cmd.startswith('DESTR_OK='+m[1]+' '):return False
    root=pathlib.Path(options['approvalRoot']);rid=m[1]
    claim=read_private(root/'claims'/f'{rid}.json')
    ev=read_private(root/'events'/f'{rid}.json')
    envelope=read_private(root/'requests'/f'{rid}.json');record=envelope['record']
    record_hash=sha(json.dumps(record,ensure_ascii=False,sort_keys=True,separators=(',',':')))
    return (ev['approval_id']==m[2] and claim['request_sha256']==ev['request_sha256']==envelope['sha256']==record_hash
            and record['command_sha256']==sha(cmd[len('DESTR_OK='+rid+' '):])
            and record['cwd']==str(pathlib.Path(event['cwd']).resolve()))

def translate(policy,event,options,code,out,err,claim_existed=False):
    if code not in (0,2):raise RuntimeError('TypeSafe execution failed')
    if code==2:
        audit(options,event,'policy-deny',code,err)
        return {'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','permissionDecisionReason':'['+policy+'] policy refused'}}
    output=json.loads(out) if out.strip() else None
    if output is not None and not isinstance(output,dict):raise ValueError('invalid TypeSafe output')
    lines=[l for l in err.splitlines() if l]
    for line in lines:
        if policy=='typesafe-destructive' and AUDIT.fullmatch(line):
            if not consumed(options,event,line,claim_existed):raise ValueError('unverified consumption notice')
        elif policy=='typesafe-destructive' and line in WARNINGS:
            pass
        else:raise RuntimeError('TypeSafe unexpected diagnostic')
    audit(options,event,'consumed-audit' if any(AUDIT.fullmatch(l) for l in lines) else 'policy-return',code,err)
    return output

def handle(policy,event,options):
    if event.get('hook_event_name')!='PreToolUse':raise ValueError('TypeSafe is tool-only')
    validate(policy,options)
    existed=False
    if policy=='typesafe-destructive':
        cmd=(event.get('tool_input') or {}).get('command','');m=re.match(r'^DESTR_OK=([a-f0-9]{32}) ',cmd)
        if m:existed=(pathlib.Path(options['approvalRoot'])/'claims'/f'{m[1]}.json').exists()
    audit(options,event,'execution-start',None,'')
    try:
        # Classifier/approval children stay in the runner's process group.
        # Explicit legacy/v2 alert senders retain the source's separate bounded
        # notification lifetime; they are not judge processes or permit issuers.
        r=subprocess.run([sys.executable,'-I',str(pathlib.Path(__file__).with_name('typesafe_exec.py'))],
                         input=json.dumps({'policy':policy,'event':event,'options':options}),text=True,capture_output=True)
        return translate(policy,event,options,r.returncode,r.stdout,r.stderr,existed)
    except Exception:
        audit(options,event,'execution-error',None,'')
        raise
    # A killed parent leaves execution-start without a terminal row. That is
    # incomplete, never permission; the outer runner refusal is authoritative.
