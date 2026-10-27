"""Native rsync policy bridge; executes classifiers, never an rsync command.
Pinned legacy classifier + direction core remain explicit private dependencies.
Legacy dependency errors and variable-path blind spots deny instead of fail-open.
"""
import fcntl, hashlib, json, os, pathlib, re, stat, subprocess, sys


class PinError(ValueError):
    """A pinned file that cannot be trusted — kind: changed (sha256 ≠ the pin) · mode (group / others may write it) · missing.
    pin = the file's base name only: the block message names the file and the fix, never its folder (entry.py · runner.py)."""
    def __init__(self,msg,kind,path):
        super().__init__(msg);self.kind=kind;self.pin=os.path.basename(str(path))


class PinMissing(FileNotFoundError):
    """The pinned file is gone — still a FileNotFoundError (callers and tests rely on that), with the same pin / kind labels."""
    def __init__(self,path):
        super().__init__(2,'classifier missing');self.kind='missing';self.pin=os.path.basename(str(path))


def source(path, expected):
    p=pathlib.Path(path)
    if not p.is_absolute() or p.is_symlink():raise ValueError('unsafe classifier path')
    try:fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    except FileNotFoundError:raise PinMissing(p) from None
    with os.fdopen(fd,'rb') as f:
        st=os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid():raise ValueError('unsafe classifier metadata')
        if st.st_mode&0o022:raise PinError('unsafe classifier metadata','mode',p)
        raw=f.read()
    if not isinstance(expected,str) or hashlib.sha256(raw).hexdigest()!=expected:raise PinError('classifier changed','changed',p)
    return raw.decode('utf8')


def private_parent(path):
    p=pathlib.Path(path)
    if not p.is_absolute():raise ValueError('journal path must be absolute')
    for node in (p,*p.parents):
        if node.is_symlink():raise ValueError('journal symlink')
    p.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    st=p.parent.stat()
    if st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('journal directory not private')
    return p


def record(path,repo,src):
    path=private_parent(path);root=pathlib.Path(repo).resolve();target=pathlib.Path(src).resolve()
    try:rel=target.relative_to(root)
    except ValueError:return
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    fd=os.open(path,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'a') as f:
        st=os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('unsafe journal metadata')
        fcntl.flock(f,fcntl.LOCK_EX);f.write(str(rel)+'\t'+digest+'\n');f.flush()


def deny(message):
    return {'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','permissionDecisionReason':'[rsync-safety] '+message}}


def handle(event, options):
    if event.get('hook_event_name')!='PreToolUse':raise ValueError('unsupported rsync event')
    ti=event.get('tool_input') or {}
    if not isinstance(ti,dict):raise ValueError('invalid tool input')
    if event.get('tool_name')!='Bash':return None
    cmd=ti.get('command')
    if not isinstance(cmd,str):raise ValueError('command required')
    if 'rsync' not in cmd:return None
    for key in ('liveRoot','repoRoot'):
        if not isinstance(options.get(key),str) or not pathlib.Path(options[key]).is_absolute():raise ValueError('absolute scope root required')
    text=source(options['sourcePath'],options['sourceSha256'])
    begin="python3 2>/dev/null <<'PY'\n"
    if text.count(begin)!=1:raise ValueError('classifier boundary changed')
    body=text.split(begin,1)[1].split('\nPY\n',1)[0]
    env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'CMD':cmd,'LIVE_VAULT':options['liveRoot']}
    result=subprocess.run([sys.executable,'-I','-c',body],env=env,text=True,capture_output=True,timeout=2)
    if result.returncode or result.stderr:raise RuntimeError('classifier failure')
    lines=result.stdout.splitlines()
    if not lines:raise ValueError('empty classifier result')
    if lines[0].startswith('DENY|'):return deny(lines[0][5:])
    if lines[0]!='OK':raise ValueError('unknown classifier result')
    if any(l.startswith('SKIPVAR|') for l in lines):return deny('unresolved variable path cannot be checked')
    pairs=[]
    for line in lines[1:]:
        fields=line.split('|')
        if len(fields)!=3 or fields[0]!='PAIR':raise ValueError('invalid path pair')
        pairs.append(fields[1:])
    if not pairs:return None
    source(options['directionPath'],options['directionSha256'])
    journal=private_parent(options['journalPath'])
    direction_env={**env,'RSYNC_DIR_JOURNAL':str(journal),'RSYNC_DIR_REPO_ROOT':options['repoRoot']}
    for src,dest in pairs:
        sp=pathlib.Path(src.rstrip('/'));dp=pathlib.Path(dest)
        checks=[]
        if sp.is_file():checks=[(sp,dp/sp.name if dp.is_dir() else dp)]
        elif sp.is_dir():
            paths=[]
            for path in sp.rglob('*.md'):
                if path.is_file():paths.append(path)
                if len(paths)>60:return deny('direction file limit exceeded')
            base=dp if src.endswith('/') else dp/sp.name
            checks=[(p,base/p.relative_to(sp)) for p in paths]
        else:raise FileNotFoundError('source not readable')
        for file,destination in checks:
            r=subprocess.run([sys.executable,'-I',options['directionPath'],str(destination),str(file)],env=direction_env,text=True,capture_output=True,timeout=2)
            if r.stderr or r.returncode not in (0,3) or not r.stdout.startswith(('SAFE|','RED|')) or 'fail-open' in r.stdout:raise RuntimeError('direction classifier failure')
            if r.returncode==3:
                ack=re.search(r'''RSYNC_DIRECTION_ACK=('[^']*'|"[^"]*"|[^ ]*)''',cmd)
                if not ack or not ack.group(1):return deny(r.stdout.strip())
            record(journal,options['repoRoot'],file)
    return None
