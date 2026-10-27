"""Portable H2 feedback gate. Read-only, bounded, strict dependency failures."""
import json, math, pathlib, re, sqlite3, time, unicodedata


def from_keys(text):
    lines=text.lstrip('\ufeff').splitlines()
    if not lines or lines[0].strip()!='---':return []
    try:end=next(i for i in range(1,len(lines)) if lines[i].strip()=='---')
    except StopIteration:return []
    out=[]
    clean=lambda t:t.strip().strip('\"\'').strip()
    for i,line in enumerate(lines[1:end],1):
        m=re.match(r'^from:\s*(.*?)\s*$',line)
        if not m:continue
        val=m.group(1)
        if val.startswith('['):out.extend(clean(t) for t in val[1:].split(']')[0].split(',') if clean(t))
        elif not val or val.startswith('#'):
            for nxt in lines[i+1:end]:
                if not nxt.strip():continue
                item=re.match(r'^\s*-\s*(.*?)\s*$',nxt)
                if not item:break
                tok=clean(item.group(1).split(' #')[0])
                if tok:out.append(tok)
        else:
            tok=clean(val.split(' #')[0])
            if tok:out.append(tok)
        break
    return out


def _check(deadline):
    if time.monotonic()>=deadline:raise TimeoutError('policy budget exceeded')


def note_keys(directory, wanted, deadline):
    root=pathlib.Path(directory)
    if not root.is_dir():raise FileNotFoundError('notes directory unavailable')
    files=[]
    for p in root.rglob('*'):
        _check(deadline)
        n=unicodedata.normalize('NFC',p.name)
        if p.is_file() and n.endswith('.md') and not n.startswith('_틀-'):
            files.append(p)
            if len(files)>=2000:break
    found=set()
    for p in sorted(files,reverse=True):
        _check(deadline)
        with p.open('rb') as f:text=f.read(8192).decode('utf8','replace')
        found.update(from_keys(text))
        if wanted.issubset(found):break
    return found


def number(value):
    try:n=float(value)
    except (TypeError,ValueError):return None
    if not math.isfinite(n):raise ValueError('nonfinite feedback timestamp')
    return n


def block_time(row):
    after=number(row['block_after']);created=number(row['created_at']);stamp=number(row['ts'])
    if after is not None:return after
    if row['source']=='backfill' and created is not None:return created+43200
    if stamp is not None:return stamp+900
    return created+900 if created is not None else 0


def handle(event, options):
    if event['hook_event_name']!='PreToolUse':raise ValueError('unsupported feedback event')
    deadline=time.monotonic()+min(float(options.get('budgetSec',1)),1)
    ti=event.get('tool_input') or {}
    if not isinstance(ti,dict):raise ValueError('invalid tool input')
    bot=options['bot'];chat=next((ti[k] for k in ('chat_id','channel','channel_id') if isinstance(ti.get(k),str) and ti[k]),'')
    if not chat:return None
    body=next((ti[k] for k in ('text','content','message') if isinstance(ti.get(k),str) and ti[k]),'')
    completion=chat in options['completionChannels'];dm=chat in options['dmChannels']
    if completion and (bot==options['completionReporterBot'] or options['completionMention'] not in body):return None
    if not completion and not dm and not chat.startswith('D'):return None
    home=pathlib.Path(options['stateHome'])
    if (home/'H2_OFF').exists():raise ValueError('required feedback policy disabled')
    _check(deadline)
    con=sqlite3.connect((home/'h1.sqlite').as_uri()+'?mode=ro',uri=True,timeout=0)
    con.set_progress_handler(lambda:1 if time.monotonic()>=deadline else 0,2000)
    try:
        fields={r[1] for r in con.execute('PRAGMA table_info(pending)')}
        if not {'bot','channel','ts','cls','status'}.issubset(fields):raise ValueError('feedback schema invalid')
        columns=['channel','ts','cls','status']+[key if key in fields else 'NULL' for key in ('created_at','block_after','source')]
        records=con.execute('SELECT '+','.join(columns)+' FROM pending WHERE bot=?',(bot,)).fetchall()
    finally:con.close()
    if not completion and not dm and chat not in {r[0] for r in records}:return None
    rows=[dict(zip(('channel','ts','cls','status','created_at','block_after','source'),r)) for r in records if r[3]=='open']
    if not rows:return None
    for row in rows:row['ts']=str(row['ts']);row['source']=row['source'] or 'live'
    notes=note_keys(options['notesDir'],{r['ts'] for r in rows},deadline)
    rows=[r for r in rows if r['ts'] not in notes]
    if not rows:return None
    now=time.time();blocked=[r for r in rows if (completion and r['source']!='backfill') or block_time(r)<=now]
    _check(deadline)
    if blocked:
        return {'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','permissionDecisionReason':'[feedback-h2] unrecorded feedback: '+', '.join(r['ts'] for r in blocked[:10])}}
    if completion:return None
    minutes=max(1,int((min(block_time(r) for r in rows)-now+59)//60))
    return {'hookSpecificOutput':{'hookEventName':'PreToolUse','additionalContext':f'[feedback-h2] {len(rows)} unrecorded feedback candidates; DM gate starts in {minutes} minutes.'}}
