"""Pinned legacy aside classifier with configured private state and strict errors.
No browser or network tool is executed here. The source remains a dependency.
"""
import contextlib, fcntl, hashlib, io, json, math, os, pathlib, stat, time, types
from rsync_safety import source, private_parent


def handle(event, options):
    name=event.get('hook_event_name')
    if name not in ('UserPromptSubmit','PreToolUse'):raise ValueError('unsupported aside event')
    text=source(options['sourcePath'],options['sourceSha256'])
    state=pathlib.Path(options['stateDir']);journal=private_parent(state/'events.jsonl')
    module=types.ModuleType('mh_legacy_aside');module.__file__=options['sourcePath']
    exec(compile(text,options['sourcePath'],'exec'),module.__dict__)
    module.state_dir=lambda:str(state)
    def log_event(mode,kind,decision,session,cwd,digest_src,reason=None):
        row={'event':name,'phase':mode,'kind':kind,'decision':decision,'session':session,
             'tool_use_id':event.get('tool_use_id'),'inputHash':hashlib.sha256(str(digest_src).encode()).hexdigest(),'at':time.time()}
        fd=os.open(journal,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'a') as f:
            st=os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('unsafe audit metadata')
            fcntl.flock(f,fcntl.LOCK_EX);f.write(json.dumps(row)+'\n');f.flush()
    def ticket_valid(session):
        path=pathlib.Path(module.ticket_path(session))
        if path.is_symlink() or path.parent.is_symlink():raise ValueError('unsafe ticket')
        try:fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        except FileNotFoundError:return False
        with os.fdopen(fd) as f:
            st=os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('unsafe ticket metadata')
            value=json.load(f)
        expires=float(value['expires'])
        if not math.isfinite(expires):raise ValueError('invalid ticket expiry')
        return expires>time.time()
    module.log_event=log_event;module.ticket_valid=ticket_valid
    out=io.StringIO();err=io.StringIO();old=os.environ.get('ASIDE_WEB_GATE')
    try:
        os.environ['ASIDE_WEB_GATE']='enforce'
        with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
            if name=='UserPromptSubmit':module.run_prompt(event)
            else:module.run_tool(event)
    finally:
        if old is None:os.environ.pop('ASIDE_WEB_GATE',None)
        else:os.environ['ASIDE_WEB_GATE']=old
    if err.getvalue():raise RuntimeError('aside classifier diagnostic')
    if not out.getvalue().strip():return None
    value=json.loads(out.getvalue())
    if not isinstance(value,dict):raise ValueError('invalid aside result')
    return value
