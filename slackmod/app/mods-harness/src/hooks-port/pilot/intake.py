"""Directive intake policy. Explicit identity/paths, strict errors, no transport."""
import fcntl, hashlib, json, os, pathlib, re, sqlite3, time

CHANNEL = re.compile(r'<channel\b([^>]*)>(.*?)</channel>', re.S)
ATTR = re.compile(r'(\w+)="([^"]*)"')
WORDS = ('해주세요','하세요','해요','진행','지시','처방','수리','고쳐','만들','올려','해봐','하자','부탁')
EXEMPT = re.compile(r'intake-exempt:\s*(.*)')


def items(text, owner_ids):
    found=[]
    for attrs,body in CHANNEL.findall(text or ''):
        a=dict(ATTR.findall(attrs));mid=a.get('message_id') or a.get('ts')
        directive=any(w in body for w in WORDS) or (len(body)>=20 and not body.rstrip().endswith(('?','？')))
        if a.get('user_id') in owner_ids and mid and directive and mid not in found:found.append(mid)
    return found


def lookup(ids, options):
    path=pathlib.Path(options['ledgerDb'])
    # A broken SQLite file is not an invitation to fall back to a stale export.
    con=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=.3)
    try:
        return [mid for mid in ids if not con.execute('SELECT 1 FROM directives WHERE source LIKE ? OR dispatch LIKE ? OR evidence LIKE ? OR adopted LIKE ? LIMIT 1',tuple('%'+mid+'%' for _ in range(4))).fetchone()]
    finally:con.close()


def audit_once(path, session, mid, mode):
    """Idempotent receipt for accepted prompt delivery, never the message body."""
    p=pathlib.Path(path)
    if not p.is_absolute() or p.is_symlink():raise ValueError('unsafe audit path')
    p.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    st=p.parent.stat()
    if st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('audit directory not private')
    fd=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'r+',encoding='utf8') as f:
        fcntl.flock(f,fcntl.LOCK_EX)
        key=hashlib.sha256(json.dumps([session,mid,mode]).encode()).hexdigest()
        rows=[json.loads(line) for line in f if line.strip()]
        if any(row.get('key')==key for row in rows):return
        f.write(json.dumps({'key':key,'at':time.time(),'session':session,'message_id':mid,'mode':mode})+'\n')
        f.flush()


def handle(event, options):
    owners=options['ownerIds']
    if not isinstance(owners,list) or not owners or not all(isinstance(x,str) and x for x in owners):raise ValueError('ownerIds required')
    name=event['hook_event_name']
    if name=='UserPromptSubmit':text=event['prompt']
    elif name=='PreToolUse':
        if not re.search(options.get('sendMatcher',r'mcp__.*discord.*reply'),event.get('tool_name','')):return None
        messages=event['messages']
        text=next((m['text'] for m in reversed(messages) if m['role']=='user' and isinstance(m.get('text'),str) and not (not m['text'] and m.get('toolResults'))), '')
    else:raise ValueError('unsupported intake event')
    mids=items(text,owners)
    if not mids:return None
    if name=='PreToolUse':
        output=event.get('tool_input') or {};answer=str(output.get('text') or output.get('content') or output.get('message') or '')
        exempt=EXEMPT.search(answer)
        if exempt and exempt.group(1).strip():
            for mid in mids:audit_once(options['auditPath'],event['session_id'],mid,'exempt')
            return None
    missing=lookup(mids,options)
    if not missing:return None
    ids=', '.join(missing)
    if name=='UserPromptSubmit':
        for mid in missing:audit_once(options['auditPath'],event['session_id'],mid,'start')
        return {'hookSpecificOutput':{'hookEventName':name,'additionalContext':f'[intake-gate] directive {ids} is not in the ledger. First action: record its source/dispatch or an explicit exemption.'}}
    return {'hookSpecificOutput':{'hookEventName':name,'permissionDecision':'deny','permissionDecisionReason':f'[intake-gate] record directive {ids} in the ledger before sending.'}}
