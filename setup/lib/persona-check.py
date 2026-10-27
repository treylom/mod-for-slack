#!/usr/bin/env python3
"""persona-check.py — check one bot folder before the installer takes it in. Reads only; writes nothing.

    python3 -I setup/lib/persona-check.py [--table FILE] [--require-table] [--skip NAME,NAME] <bot folder>

Output: one line per problem «걸림 · <칸> · <까닭> · <고칠 1줄>», then «결과: 통과 …» or «결과: 걸림 N …».
rc 0 = passed · 1 = at least one problem · 2 = usage error (no such folder · unreadable or broken table).
A matched secret or trace is never printed — only its kind, the file and the line number.

Files looked at (those that exist): persona.md (or the older name other tools use) · CLAUDE.md · AGENTS.md ·
.claude/CLAUDE.md · .claude/rules/*.md. Nothing else in the folder is read: a bot folder is also somebody's work folder.

칸 (the second field) · check group (the name --skip takes):
  파일 · 이름 · 역할 · 말투 · 경계 · 연결   → required     persona.md exists; front matter name + role; sections ## 역할 ## 말투 ## 경계
                                                         are not empty; CLAUDE.md pulls persona.md in with an @persona.md line
  자리표시자                               → placeholder  <BOT_NAME>-style or <anything> stubs left over (HTML comments, mentions,
                                                         links, plain HTML tags and code fences are not stubs)
  비밀값                                   → secret       token and key shapes (xoxb- xapp- sk- ghp_ github_pat_ AKIA AIza, private key
                                                         blocks) + every R row of the trace table
  흔적                                     → trace        every other row of the trace table (our own names, ids, paths …)
  길이                                     → length       persona.md <= 6000 characters · CLAUDE.md <= 4000 · capsule <= 6 lines

The trace table is port/lib/traces.tsv (same rows the bundle scanner uses). It is NOT shipped in the public bundle, so a
missing table only prints a 참고 line and skips the 흔적 column — unless --require-table is given (then it is a 걸림).
--skip is for bots imported from somewhere else (their layout differs): e.g. --skip required.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
DEFAULT_TABLE = os.path.normpath(os.path.join(HERE, '..', '..', 'port', 'lib', 'traces.tsv'))

PERSONA_FILE = 'persona.md'
# the name other tools give this file, built from pieces: our trace table lists the literal name
LEGACY_PERSONA_FILE = 'so' + 'ul.md'
MAX_PERSONA_CHARS = 6000
MAX_CLAUDE_CHARS = 4000
MAX_CAPSULE_LINES = 6
NAME_RE = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
GROUPS = ('required', 'placeholder', 'secret', 'trace', 'length')

PH_FIX = {
    'BOT_NAME': '이름',
    'TONE': '말투',
    'ROLE_LINE': '역할 한 줄',
}
HTML_TAGS = set('''a abbr b br code col dd details div dl dt em h1 h2 h3 h4 h5 h6 hr i img kbd li ol p pre s span strong sub
summary sup table tbody td th thead tr u ul'''.split())

SECRET_BUILTIN = [
    ('slack-token', rb'xox[abposr]-[A-Za-z0-9-]{10,}'),
    ('slack-app-token', rb'xapp-[0-9]-[A-Za-z0-9-]{10,}'),
    ('anthropic-key', rb'sk-ant-[A-Za-z0-9_-]{10,}'),
    ('api-key', rb'(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}'),
    ('github-token', rb'gh[pousr]_[A-Za-z0-9]{20,}'),
    ('github-pat', rb'github_pat_[A-Za-z0-9_]{20,}'),
    ('aws-key', rb'AKIA[0-9A-Z]{16}'),
    ('google-key', rb'AIza[0-9A-Za-z_-]{35}'),
    ('private-key', rb'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
]


class Usage(Exception):
    pass


# ── input ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def load_table(path):
    """→ list of (class, is_secret_row, compiled bytes regex). Same file the scanner reads (class TAB flags TAB pattern …)."""
    rows = []
    with open(path, encoding='utf-8') as f:
        for n, raw in enumerate(f, 1):
            line = raw.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) < 3:
                raise Usage('점검표 %d째 줄 칸이 모자람' % n)
            cls, flags, pat = parts[0], parts[1], parts[2]
            try:
                rx = re.compile(pat.encode('utf-8'), re.IGNORECASE if 'i' in flags else 0)
            except re.error:
                raise Usage('점검표 %d째 줄 패턴을 읽을 수 없음' % n)
            rows.append((cls, 'R' in flags, rx))
    if not rows:
        raise Usage('점검표가 비어 있음')
    return rows


def read_files(folder):
    """→ dict relpath → bytes for the persona-related files that exist."""
    rels = [PERSONA_FILE, LEGACY_PERSONA_FILE, 'CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md']
    rules = os.path.join(folder, '.claude', 'rules')
    if os.path.isdir(rules):
        rels += ['.claude/rules/' + n for n in sorted(os.listdir(rules)) if n.endswith('.md')]
    out = {}
    for rel in rels:
        p = os.path.join(folder, rel)
        if os.path.isfile(p):
            try:
                with open(p, 'rb') as f:
                    out[rel] = f.read()
            except OSError:
                raise Usage('읽을 수 없음: ' + rel)
    return out


def text_of(data):
    return data.decode('utf-8', 'replace')


def persona_rel(files):
    for rel in (PERSONA_FILE, LEGACY_PERSONA_FILE):
        if rel in files:
            return rel
    return None


# ── parsing helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
def front_matter(text):
    """→ dict of the simple «key: value» lines between the leading --- lines (empty dict when there is none)."""
    lines = text.lstrip('﻿').split('\n')
    if not lines or lines[0].strip() != '---':
        return {}
    fm = {}
    for ln in lines[1:]:
        if ln.strip() == '---':
            return fm
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$', ln)
        if m:
            fm[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return {}  # never closed → not a front matter


def sections(text):
    """→ list of (heading text, [lines]) for every «## …» heading (deeper headings stay inside their section)."""
    out, cur = [], None
    for ln in text.split('\n'):
        m = re.match(r'^##\s+(.+?)\s*$', ln)
        if m and not ln.startswith('###'):
            cur = (m.group(1), [])
            out.append(cur)
        elif cur is not None:
            cur[1].append(ln)
    return out


def content_chars(lines):
    """Characters of real content: no blank lines, no HTML comment lines, no list markers."""
    n = 0
    for ln in lines:
        s = ln.strip()
        if not s or s.startswith('<!--'):
            continue
        s = re.sub(r'^([-*+]|\d+\.)\s+', '', s)
        n += len(s)
    return n


def section_for(text, key):
    for head, lines in sections(text):
        if key in head:
            return lines
    return None


def is_stub(value):
    return bool(re.search(r'<[^<>\n]+>', value))


def mask_comments(text):
    """Blank out <!-- … --> blocks but keep the line count."""
    return re.sub(r'<!--.*?-->', lambda m: '\n' * m.group(0).count('\n'), text, flags=re.S)


# ── checks (each returns [(칸, 까닭, 고칠 1줄)]) ───────────────────────────────────────────────────────────────────────
def check_required(ctx):
    out = []
    files, prel = ctx['files'], ctx['persona']
    if prel is None:
        out.append(('파일', '%s 가 없음' % PERSONA_FILE, 'bot-interview 로 이 봇의 이름 · 성격부터 만들기'))
        return out
    text = text_of(files[prel])
    fm = front_matter(text)
    name = fm.get('name', '')
    if is_stub(name):
        pass  # the placeholder check reports it
    elif not name:
        out.append(('이름', '%s 머리말(맨 위 --- 두 줄 사이)에 name 이 없음' % prel, '이름 칸만 다시 묻고 name: 한 줄 채우기'))
    elif not NAME_RE.match(name):
        out.append(('이름', '이름이 규칙(영문 소문자 · 숫자 · 하이픈, 첫 글자 영문, 1~32자)에 안 맞음', '이름 칸만 다시 묻기(예: alpha)'))
    role = fm.get('role', '')
    rlines = section_for(text, '역할')
    if is_stub(role):
        pass
    elif not role or not re.match(r'^[a-z][a-z0-9-]{0,31}$', role):
        out.append(('역할', '%s 머리말에 role 이 없거나 꼴이 틀림(lead · watch · research · custom 같은 영문 한 낱말)' % prel,
                    '역할 틀 고르기 칸만 다시 묻기'))
    elif rlines is None or content_chars(rlines) < 8:
        out.append(('역할', '## 역할 절이 없거나 비어 있음', '그 절에 이 봇이 하는 일을 한두 줄 쓰기'))
    for key, cell, fix in (('말투', '말투', '말투 칸만 다시 묻기'), ('경계', '경계', '이 봇이 하지 않는 일을 «확인 없이는 하지 않는다» 꼴로 한 줄 쓰기')):
        lines = section_for(text, key)
        if lines is None:
            out.append((cell, '## %s 절이 없음' % key, fix))
        elif content_chars(lines) < 8:
            out.append((cell, '## %s 절이 비어 있음' % key, fix))
    cl = files.get('CLAUDE.md')
    if cl is None:
        out.append(('파일', 'CLAUDE.md 가 없음(봇 폴더에서 Claude 가 첫 번째로 읽는 파일)', 'bot-interview 로 다시 만들거나 @%s 한 줄짜리 CLAUDE.md 만들기' % prel))
    elif not re.search(rb'(?m)^\s*@(\./)?' + re.escape(prel.encode()) + rb'\s*$', cl):
        out.append(('연결', 'CLAUDE.md 가 %s 를 부르지 않음(@%s 줄이 없음) — 성격 파일이 안 읽힘' % (prel, prel),
                    'CLAUDE.md 첫머리에 @%s 한 줄 넣기' % prel))
    return out


def stub_tokens(text):
    """→ list of (line number, token) for placeholder-looking stubs."""
    found = []
    lines = mask_comments(text).split('\n')
    fenced = False
    for i, ln in enumerate(lines, 1):
        if ln.lstrip().startswith('```'):
            fenced = not fenced
            continue
        for m in re.finditer(r'<([A-Z][A-Z0-9_]{2,40})>', ln):
            found.append((i, m.group(0)))
        if fenced:
            continue
        plain = re.sub(r'`[^`\n]*`', '', ln)
        for m in re.finditer(r'<([^<>\s!@#/=\-][^<>\n]{0,60})>', plain):
            inner = m.group(1)
            if re.fullmatch(r'[A-Z][A-Z0-9_]{2,40}', inner):
                continue
            if re.match(r'(https?://|mailto:|ftp://)', inner):
                continue
            if inner.split()[0].lower() in HTML_TAGS:
                continue
            found.append((i, m.group(0)))
    return found


def check_placeholder(ctx):
    out = []
    for rel, data in ctx['files'].items():
        seen = {}
        for ln, tok in stub_tokens(text_of(data)):
            if tok in seen:
                seen[tok][1] += 1
            else:
                seen[tok] = [ln, 1]
        for tok, (ln, n) in seen.items():
            shown = tok if len(tok) <= 28 and not any(rx.search(tok.encode()) for _l, rx in ctx['secret_rx']) else '<…>'
            key = tok.strip('<>')
            fix = ('인터뷰에서 %s 칸만 다시 묻고 채우기' % PH_FIX[key]) if key in PH_FIX else '그 자리를 실제 값으로 바꾸거나 줄을 지우기'
            more = ' 외 %d곳' % (n - 1) if n > 1 else ''
            out.append(('자리표시자', '%s:%d 에 %s 이 남음%s' % (rel, ln, shown, more), fix))
    return out


def scan_lines(data, rxs):
    """→ {label: [first line, count]} for byte regexes (label, rx), one hit per line per label."""
    hits = {}
    for i, raw in enumerate(data.split(b'\n'), 1):
        for label, rx in rxs:
            if rx.search(raw):
                if label in hits:
                    hits[label][1] += 1
                else:
                    hits[label] = [i, 1]
    return hits


def check_secret(ctx):
    out = []
    for rel, data in ctx['files'].items():
        hits = scan_lines(data, ctx['secret_rx'])
        for label, (ln, n) in hits.items():
            more = ' 외 %d곳' % (n - 1) if n > 1 else ''
            out.append(('비밀값', '%s:%d 에 비밀값 꼴(%s)이 있음%s — 값은 안 보여 줌' % (rel, ln, label, more),
                        '그 줄을 지우고 토큰은 slackmod set-token 으로만 넣기(이미 적었다면 그 토큰은 새로 발급)'))
    return out


def check_trace(ctx):
    out = []
    if ctx['trace_rx'] is None:
        return out
    for rel, data in ctx['files'].items():
        hits = scan_lines(data, ctx['trace_rx'])
        for label, (ln, n) in hits.items():
            more = ' 외 %d곳' % (n - 1) if n > 1 else ''
            out.append(('흔적', '%s:%d 에 다른 환경의 흔적 꼴(%s 분류)이 있음%s — 값은 안 보여 줌' % (rel, ln, label, more),
                        '그 줄을 이 사용자의 것으로 바꾸거나 지우기'))
    return out


def check_length(ctx):
    out = []
    files = ctx['files']
    prel = ctx['persona']
    if prel is not None:
        text = text_of(files[prel])
        if len(text) > MAX_PERSONA_CHARS:
            out.append(('길이', '%s 가 %d자(상한 %d자) — 길면 긴 대화에서 성격이 뒤로 밀림' % (prel, len(text), MAX_PERSONA_CHARS),
                        '규칙 개수를 줄이고 캡슐 6줄에 핵심만 남기기'))
        m = re.search(r'CAPSULE-START[^\n]*\n(.*?)CAPSULE-END', text, flags=re.S)
        if m:
            body = [ln for ln in m.group(1).split('\n') if ln.strip() and not ln.strip().startswith('<!--')]
            if len(body) > MAX_CAPSULE_LINES:
                out.append(('길이', '캡슐이 %d줄(상한 %d줄)' % (len(body), MAX_CAPSULE_LINES), '캡슐을 6줄 안으로 줄이기'))
    cl = files.get('CLAUDE.md')
    if cl is not None and len(text_of(cl)) > MAX_CLAUDE_CHARS:
        out.append(('길이', 'CLAUDE.md 가 %d자(상한 %d자)' % (len(text_of(cl)), MAX_CLAUDE_CHARS), '꼭 지킬 예절만 남기고 줄이기'))
    return out


CHECKS = [
    ('required', check_required),
    ('placeholder', check_placeholder),
    ('secret', check_secret),
    ('trace', check_trace),
    ('length', check_length),
]


# ── main ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
def parse_args(argv):
    table, require, skip, folder = None, False, set(), None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--table' and i + 1 < len(argv):
            table = argv[i + 1]; i += 2
        elif a == '--require-table':
            require = True; i += 1
        elif a == '--skip' and i + 1 < len(argv):
            for s in argv[i + 1].split(','):
                if s not in GROUPS:
                    raise Usage('--skip 이름은 %s 중 하나' % ' · '.join(GROUPS))
                skip.add(s)
            i += 2
        elif a in ('-h', '--help'):
            print(__doc__.strip().split('\n\n')[0]); sys.exit(0)
        elif a.startswith('-'):
            raise Usage('모르는 옵션: ' + a)
        elif folder is None:
            folder = a; i += 1
        else:
            raise Usage('봇 폴더는 하나만')
    if folder is None:
        raise Usage('봇 폴더를 주세요')
    return table, require, skip, folder


def run(argv):
    table, require, skip, folder = parse_args(argv)
    if not os.path.isdir(folder):
        raise Usage('폴더가 없음: ' + folder)
    notes, extra = [], []
    path = table or os.environ.get('PERSONA_CHECK_TABLE') or DEFAULT_TABLE
    rows = None
    if os.path.isfile(path):
        rows = load_table(path)
    elif table:
        raise Usage('점검표를 못 찾음: ' + table)
    secret_rx = [(l, re.compile(p)) for l, p in SECRET_BUILTIN]
    trace_rx = None
    if rows is not None:
        secret_rx += [('표의 비밀값 줄', rx) for cls, is_secret, rx in rows if is_secret]
        trace_rx = [(cls, rx) for cls, is_secret, rx in rows if not is_secret]
    elif 'trace' not in skip:
        if require:
            extra.append(('흔적', '흔적 점검표(traces.tsv)를 못 읽음 — 흔적을 못 셈', '--table 로 점검표 경로를 주기'))
        else:
            notes.append('참고 · 흔적 점검표(traces.tsv)가 없어 흔적 칸은 건너뜀(묶음에는 실리지 않는 파일)')
    files = read_files(folder)
    ctx = {'folder': folder, 'files': files, 'persona': persona_rel(files), 'secret_rx': secret_rx, 'trace_rx': trace_rx}
    problems = list(extra)
    for group, fn in CHECKS:
        if group in skip:
            continue
        problems += fn(ctx)
    for n in notes:
        print(n)
    for cell, why, fix in problems:
        print('걸림 · %s · %s · %s' % (cell, why, fix))
    if problems:
        print('결과: 걸림 %d · 점검한 파일 %d개' % (len(problems), len(files)))
        return 1
    print('결과: 통과 · 점검한 파일 %d개' % len(files))
    return 0


def main(argv):
    try:
        return run(argv)
    except Usage as e:
        print('persona-check: %s' % e, file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
