#!/usr/bin/env python3
"""history.py — count (numbers only) what this computer's Claude Code conversation logs show (read only · JSON on stdout).

  python3 -I history.py --home H [--days 30] [--now ISO] [--notice]

--notice → prints the notice the wizard shows BEFORE reading, and stops (reads nothing).
Otherwise: {"schema":1,"read":true,"days":30,"sessions":n,"folders":[{"path","sessions"}](top 10 · most first · ties by path),
            "tools":{"Edit":n,…},"exts":{".md":n,…},"kinds":{"code","writing","research","data"},"skipped_lines":n}
- Reads H/.claude/projects/*/*.jsonl whose file time is within --days of --now (default: the clock). One file = one session.
- Folders come from each line's top-level «cwd» (folder names under projects/ are not decoded — that mapping is lossy).
- Tools = «name» of tool_use blocks in assistant lines · exts = only the EXTENSION of file_path / path / notebook_path.
- Message text is never printed or stored. Broken lines are skipped (counted in skipped_lines). Only the first 50MB of a file.
rc 0 = done · 2 = usage.
"""
import datetime
import json
import os
import re
import sys
import time

NOTICE = ('설치 도우미가 이 컴퓨터의 Claude Code 대화 기록을 읽어 숫자만 셉니다 — 자주 일한 폴더, 자주 쓴 도구, 자주 고친 파일 종류. '
          '글 내용은 저장하지도 보여 주지도 않고, 숫자는 추천과 작업 폴더 후보에만 씁니다. '
          '원하지 않으시면 «기록 읽지 않기»를 고르세요.')
SECRET_SHAPE = re.compile(r'(?<![A-Za-z0-9])(xox[abprs]-|xapp-|sk-[A-Za-z0-9_-]{10,}|ghp_|gho_|ghs_|github_pat_|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10})')
TOOL_NAME = re.compile(r'^[A-Za-z0-9_.:-]{1,120}$')
EXT_SHAPE = re.compile(r'^\.[A-Za-z0-9_+-]{1,10}$')
MAX_BYTES = 50 * 1024 * 1024
TOP_FOLDERS = 10
PATH_KEYS = ('file_path', 'path', 'notebook_path')
CODE_EXT = {'.py', '.js', '.ts', '.tsx', '.go', '.rs', '.java', '.rb', '.sh', '.c', '.cpp'}
WRITING_EXT = {'.md', '.txt', '.docx'}
DATA_EXT = {'.csv', '.xlsx', '.ipynb', '.json'}
CODE_TOOLS = {'Edit', 'Write', 'MultiEdit'}
WRITING_TOOLS = {'Edit', 'Write'}
RESEARCH_TOOLS = {'WebSearch', 'WebFetch'}


def usage(msg):
    sys.stderr.write('history: %s\n' % msg)
    sys.stderr.write('usage: python3 -I history.py --home H [--days 30] [--now ISO] [--notice]\n')
    sys.exit(2)


def parse_now(s):
    t = s.strip()
    if t.endswith('Z') or t.endswith('z'):
        t = t[:-1] + '+00:00'
    try:
        dt = datetime.datetime.fromisoformat(t)
    except ValueError:
        usage('--now is not an ISO time: %s' % s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.timestamp()


def parse_args(argv):
    a = {'home': None, 'days': 30, 'now': None, 'notice': False}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k in ('-h', '--help'):
            sys.stdout.write(__doc__)
            sys.exit(0)
        if k == '--notice':
            a['notice'] = True
            i += 1
            continue
        if k in ('--home', '--days', '--now'):
            if i + 1 >= len(argv):
                usage('%s needs a value' % k)
            a[k[2:]] = argv[i + 1]
            i += 2
            continue
        usage('unknown argument %s' % k)
    if a['notice']:
        return a
    if not a['home'] or not os.path.isdir(a['home']):
        usage('--home must be a folder')
    try:
        a['days'] = int(a['days'])
    except (TypeError, ValueError):
        usage('--days must be a whole number')
    if a['days'] < 1 or a['days'] > 3650:
        usage('--days must be 1..3650')
    a['now'] = parse_now(a['now']) if a['now'] is not None else time.time()
    return a


def session_files(home, now, days):
    base = os.path.join(home, '.claude', 'projects')
    cutoff = now - days * 86400
    out = []
    try:
        dirs = sorted(os.listdir(base))
    except OSError:
        return out
    for d in dirs:
        dp = os.path.join(base, d)
        if os.path.islink(dp) or not os.path.isdir(dp):
            continue
        try:
            names = sorted(os.listdir(dp))
        except OSError:
            continue
        for n in names:
            fp = os.path.join(dp, n)
            if not n.endswith('.jsonl') or os.path.islink(fp) or not os.path.isfile(fp):
                continue
            try:
                mt = os.path.getmtime(fp)
            except OSError:
                continue
            if cutoff <= mt <= now + 86400:
                out.append(fp)
    return out


def read_lines(fp):
    with open(fp, 'rb') as f:
        data = f.read(MAX_BYTES + 1)
    truncated = len(data) > MAX_BYTES
    if truncated:
        data = data[:MAX_BYTES]
        cut = data.rfind(b'\n')
        data = data[:cut + 1] if cut >= 0 else b''
    return data.split(b'\n')


def ext_of(v):
    if not isinstance(v, str) or not v:
        return None
    e = os.path.splitext(os.path.basename(v))[1].lower()
    return e if EXT_SHAPE.match(e) else None


def bump(d, k, n=1):
    d[k] = d.get(k, 0) + n


def main():
    a = parse_args(sys.argv[1:])
    if a['notice']:
        sys.stdout.write(NOTICE + '\n')
        return 0
    home = os.path.abspath(a['home'])
    files = session_files(home, a['now'], a['days'])
    folders = {}
    tools = {}
    exts = {}
    kinds = {'code': 0, 'writing': 0, 'research': 0, 'data': 0}
    skipped = 0
    for fp in files:
        cwds = set()
        try:
            lines = read_lines(fp)
        except OSError:
            continue
        for raw in lines:
            if not raw.strip():
                continue
            try:
                row = json.loads(raw.decode('utf-8'))
            except (UnicodeDecodeError, ValueError):
                skipped += 1
                continue
            if not isinstance(row, dict):
                skipped += 1
                continue
            cwd = row.get('cwd')
            if isinstance(cwd, str) and os.path.isabs(cwd) and not SECRET_SHAPE.search(cwd) and '\n' not in cwd:
                cwds.add(os.path.normpath(cwd))
            if row.get('type') != 'assistant':
                continue
            msg = row.get('message')
            content = msg.get('content') if isinstance(msg, dict) else None
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict) or b.get('type') != 'tool_use':
                    continue
                name = b.get('name')
                if not isinstance(name, str) or not TOOL_NAME.match(name) or SECRET_SHAPE.search(name):
                    continue
                bump(tools, name)
                if name in RESEARCH_TOOLS:
                    kinds['research'] += 1
                inp = b.get('input')
                if not isinstance(inp, dict):
                    continue
                for key in PATH_KEYS:
                    e = ext_of(inp.get(key))
                    if not e:
                        continue
                    bump(exts, e)
                    if e in CODE_EXT and name in CODE_TOOLS:
                        kinds['code'] += 1
                    if e in WRITING_EXT and name in WRITING_TOOLS:
                        kinds['writing'] += 1
                    if e in DATA_EXT:
                        kinds['data'] += 1
        for c in cwds:
            bump(folders, c)
    top = sorted(folders.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_FOLDERS]
    out = {
        'schema': 1,
        'read': True,
        'days': a['days'],
        'sessions': len(files),
        'folders': [{'path': p, 'sessions': n} for p, n in top],
        'tools': dict(sorted(tools.items())),
        'exts': dict(sorted(exts.items())),
        'kinds': kinds,
        'skipped_lines': skipped,
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
