"""Ledger reminder and completion policy, configured identity, strict SQLite reads."""
import fcntl, hashlib, json, os, pathlib, re, sqlite3
PENDING=('착수','부분','미발주','안 됨')
MARKER=re.compile(r'ledger-open:\s*\d+(?:[^\n]*?reason=([^\n]*))?')
VOID=re.compile(r'^(\d{1,2}:\d{2}|오후|아침|내일|다음\s*세션|회의\s*(?:뒤|후|산출))\s*(?:대기|재상정|발주|심사)?\s*$')
DATE=re.compile(r'\d{2}-\d{2}|\d{1,2}일|\d{1,2}:\d{2}')


def placeholder(value, aliases):
    s=(value or '').strip()
    return len(s)<8 or not (any(c.isdigit() for c in s) or any(a.lower() in s.lower() for a in aliases) or '/' in s)


def owner_matches(owner, aliases):
    text=(owner or '').lower();tokens=set(re.split(r'[^0-9a-z가-힣]+',text))
    return any((a.lower() in tokens) if len(a)<=2 else (a.lower() in text) for a in aliases)


def rows(options):
    aliases=options['aliases'];all_aliases=options.get('allAliases',aliases);people=options.get('personTokens',[])
    if not aliases or not all(isinstance(x,str) and x for x in aliases):raise ValueError('aliases required')
    con=sqlite3.connect(pathlib.Path(options['ledgerDb']).as_uri()+'?mode=ro',uri=True,timeout=.3)
    try:
        fields={r[1] for r in con.execute('PRAGMA table_info(directives)')}
        if not {'id','adopted','status','release_cond','owner','updated_at'}.issubset(fields):raise ValueError('ledger schema invalid')
        order='priority ASC,updated_at ASC' if 'priority' in fields else 'updated_at ASC'
        data=con.execute('SELECT id,adopted,status,release_cond,owner FROM directives ORDER BY '+order).fetchall()
    finally:con.close()
    result=[]
    for rid,adopted,status,release,owner in data:
        if status not in (*PENDING,'이월') or not owner_matches(owner,aliases):continue
        release=release or ''
        unbounded=any(p in release for p in people) and not DATE.search(release) and not any(c.isdigit() for c in release)
        if status!='이월' or placeholder(release,all_aliases) or unbounded:result.append((rid,adopted,status,unbounded,release))
    return result


def changed(event, options, selected):
    scope=json.dumps([event['session_id'],options['bot'],str(pathlib.Path(options['ledgerDb']).resolve())])
    key=hashlib.sha256(scope.encode()).hexdigest()
    folder=pathlib.Path(options['cacheDir']);folder.mkdir(mode=0o700,parents=True,exist_ok=True)
    st=folder.stat()
    if not folder.is_absolute() or folder.is_symlink() or st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('cache directory not private')
    digest=hashlib.sha256(json.dumps(selected,ensure_ascii=False).encode()).hexdigest()
    fd=os.open(folder/(key+'.state'),os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'r+',encoding='utf8') as cache:
        fcntl.flock(cache,fcntl.LOCK_EX)
        if cache.read()==digest:return False
        cache.seek(0);cache.truncate();cache.write(digest);cache.flush()
    return True


def handle(event, options):
    selected=rows(options);name=event['hook_event_name'];bot=options['bot']
    if name=='UserPromptSubmit':
        state_changed=changed(event,options,selected)
        if not selected or not state_changed:return None
        return {'hookSpecificOutput':{'hookEventName':name,'additionalContext':f'[ledger-loop] {bot}: {len(selected)} open rows. Prioritize the current request; this reminder is not a new dispatch.'}}
    if name!='Stop':raise ValueError('unsupported ledger event')
    if event.get('stop_hook_active') or not selected:return None
    ids=[r[0] for r in selected]
    if any(r[2]=='미발주' for r in selected):return {'decision':'block','reason':'[ledger-loop] undispatched rows: '+', '.join(r[0] for r in selected if r[2]=='미발주')}
    text=event.get('last_assistant_message') or '';m=MARKER.search(text);reason=(m.group(1) or '').strip() if m else ''
    if m and reason and not VOID.fullmatch(reason):
        # Use source-compatible configured patterns; identity-specific tokens do
        # not live in the public package.
        selfdeny=bool(re.search(options['selfDenyPurePattern'],reason)) or (bool(re.search(options['selfDenyStatePattern'],reason)) and not re.search(options['externalTriggerPattern'],reason))
        if selfdeny:
            if options.get('mode','warn')=='block':return {'decision':'block','reason':'[ledger-loop] invalid owner disclaimer'}
            return {'hookSpecificOutput':{'hookEventName':name,'additionalContext':'[ledger-loop] owner disclaimer is not a release condition'}}
        workable=[r[0] for r in selected if r[2] in ('착수','부분') and placeholder(r[4],options.get('allAliases',options['aliases']))]
        if not workable:return None
        if options.get('workableMode','block')=='block':return {'decision':'block','reason':'[ledger-loop] actionable rows: '+', '.join(workable)}
        return {'hookSpecificOutput':{'hookEventName':name,'additionalContext':'[ledger-loop] actionable rows: '+', '.join(workable)}}
    reason='[ledger-loop] open rows: '+', '.join(ids)
    if options.get('mode','warn')=='block':return {'decision':'block','reason':reason}
    return {'hookSpecificOutput':{'hookEventName':name,'additionalContext':reason}}
