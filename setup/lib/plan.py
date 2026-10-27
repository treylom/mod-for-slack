#!/usr/bin/env python3
"""plan.py — checks the setup wizard's result file (setup.json) before anything is installed from it.

  python3 -I plan.py FILE                     check only            → rc 0 usable · 2 not usable (one «  - <where>: <why>» line each, stdout)
  python3 -I plan.py FILE --normalize         check, then print the file with every default filled in (stdout) → rc 0 / 2
  python3 -I plan.py FILE --out OUT           check, then write the normalized file to OUT (replace in one step · 0644) → rc 0 / 2
        [--home DIR]                          «~/» and default folders are made absolute under DIR (default: the real home)

The shape = the contract «setup.json» (design doc, section 5): {schema:1, mode, mux, slack:{enabled, channel_id, owner_user_id, guests},
wiki:{path|null}, mcp:[], codex, doctor, browser, memory, children, bots:[{name, role, work_dir, source, persona_dir}], import:{from:[], to}}.
children = «하위 세션 쓰기» (true/false · default true): false = the bots get no child-session tools and the contract without them.
router = «하위 라우터(판정 모델이 고름)» {mode: off | shadow | on, judge: "bundled" | [command words]} (default off): an owner
message that reached the bot while its child sessions work in other threads → a judge program picks the child it belongs to.
shadow = judge and record only · on = the picked child gets it too · shadow/on need a judge · off (or children false) = nothing written.
Optional per bot: slack_bot_user_id · model (the installer carries them into the bot's config).
There is no secret column: a key named like a token / secret / password, or a value shaped like a token, is refused (rc 2) —
the value itself is never printed. Tokens go in only through «slackmod set-token <bot>» in a terminal.
A file that leaves a column out gets that column's recommended default (--normalize) — so a short answers file works.
Standard library only · python 3.8+.
"""
import json
import os
import re
import sys

NAME = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
ROLE = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
MCP_NAME = re.compile(r'^[a-z][a-z0-9-]{0,40}$')
CHAN = re.compile(r'^[CG][A-Z0-9]{8,12}$')
USER = re.compile(r'^[UW][A-Z0-9]{8,12}$')
GUEST = re.compile(r'^U[A-Z0-9]{8,}$')
MODEL = re.compile(r'^[A-Za-z0-9._\[\]-]{1,60}$')
ITEM = re.compile(r'^[a-z0-9-]{1,30}:[A-Za-z0-9._-]{1,100}$')   # detect.sh item ids: kind:name
BAD_PATH_CHARS = set('\n\r\t\'"$`\\')
SECRET_SHAPE = re.compile(r'(?<![A-Za-z0-9])(xox[abprs]-|xapp-|sk-[A-Za-z0-9_-]{10,}|ghp_|gho_|ghs_|github_pat_|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10})')
SECRET_KEY = re.compile(r'token|secret|passw|credential|api[_-]?key|private[_-]?key|auth', re.I)

MODES = ('quick', 'full', 'blank')
MUX = ('auto', 'tmux', 'cmux', 'herdr', 'orca')
BROWSERS = ('playwright', 'aside', 'none')
MEMORIES = ('later', 'hindsight', 'kumiho')
SOURCES = ('import', 'role-default', 'blank')
ROLE_DEFAULTS = ('lead', 'watch', 'research')   # 총괄 · 감시/일정 · 조사
RESERVED_NAMES = ('slackmod', 'allbots', 'allbots-stop')
ROUTER_MODES = ('off', 'shadow', 'on')           # 끔 · 기록만 · 켬 (the harness's own words — any other word would read as off)
BUNDLED_JUDGE = 'bundled'                        # the example judge the kit installs (it reads its key from the bot's .env)
KEYS = {'': ('schema', 'mode', 'mux', 'slack', 'wiki', 'mcp', 'codex', 'doctor', 'browser', 'memory', 'children', 'router', 'bots', 'import'),
        'slack': ('enabled', 'channel_id', 'owner_user_id', 'guests'),
        'wiki': ('path',), 'import': ('from', 'to'), 'router': ('mode', 'judge'),
        'bot': ('name', 'role', 'work_dir', 'source', 'persona_dir', 'slack_bot_user_id', 'model')}


def safe_key(k):
    # a key name is echoed in messages — never one that is itself token-shaped
    k = str(k)
    return '<token-shaped name>' if SECRET_SHAPE.search(k) else k


def secret_findings(node, where='setup'):
    out = []
    if isinstance(node, dict):
        for k, v in node.items():
            k = safe_key(k)
            if SECRET_KEY.search(k):
                out.append('%s.%s: 비밀값 칸은 없습니다 — 토큰은 터미널의 «slackmod set-token» 으로만 넣습니다' % (where, k))
            elif k == '<token-shaped name>':
                out.append('%s: 칸 이름이 토큰·키 꼴로 보입니다(looks like a secret)' % where)
            out.extend(secret_findings(v, '%s.%s' % (where, k)))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out.extend(secret_findings(v, '%s[%d]' % (where, i)))
    elif isinstance(node, str) and SECRET_SHAPE.search(node):
        out.append('%s: 토큰·키 꼴로 보이는 값입니다(looks like a secret) — 여기에 적지 마세요' % where)
    return out


def expand(p, home):
    if isinstance(p, str) and p.startswith('~/'):
        return home + p[1:]
    return p


def abs_ok(p):
    return isinstance(p, str) and p.startswith('/') and not any(c in BAD_PATH_CHARS for c in p) and '..' not in p.split('/')


def unknown_keys(d, allowed, where):
    return ['%s.%s: 모르는 칸입니다(없애거나 이름을 확인하세요)' % (where, safe_key(k)) for k in d if k not in allowed]


def judge_words_ok(j):
    # a judge command = 1~16 words, each one line of 1~300 characters, the first not an option (the harness runs it without a shell)
    return (isinstance(j, list) and 1 <= len(j) <= 16 and all(isinstance(x, str) and 0 < len(x) <= 300 and not any(c in x for c in '\n\r\t\0') for x in j)
            and not j[0].startswith('-'))


def router_problems(rt, where):
    if not isinstance(rt, dict):
        return [where + ': 객체여야 합니다 — {"mode": "off"} 꼴']
    out = unknown_keys(rt, KEYS['router'], where)
    mode = rt.get('mode', 'off')
    if mode not in ROUTER_MODES:
        out.append(where + '.mode: off · shadow · on 중 하나(끔 · 기록만 · 켬)')
    j = rt.get('judge')
    if j is not None and j != BUNDLED_JUDGE and not judge_words_ok(j):
        out.append(where + '.judge: "bundled"(동봉 판정기) 또는 판정 명령 낱말 목록(1~16개 · 한 줄씩 · 첫 낱말은 프로그램)')
    elif j is None and mode in ('shadow', 'on'):
        out.append(where + '.judge: 기록만·켬 은 판정기가 있어야 합니다 — "bundled"(동봉 판정기) 또는 판정 명령 낱말 목록')
    return out


def check(st, home):
    """→ list of problem lines (empty = usable). `st` is the loaded JSON value."""
    if not isinstance(st, dict):
        return ['setup: 최상위가 JSON 객체여야 합니다']
    out = secret_findings(st)
    if st.get('schema') != 1:
        out.append('setup.schema: 1 이어야 합니다')
    out += unknown_keys(st, KEYS[''], 'setup')
    mode = st.get('mode', 'quick')
    if mode not in MODES:
        out.append('setup.mode: quick · full · blank 중 하나')
    if st.get('mux', 'auto') not in MUX:
        out.append('setup.mux: ' + ' · '.join(MUX) + ' 중 하나')
    if st.get('browser', 'playwright') not in BROWSERS:
        out.append('setup.browser: ' + ' · '.join(BROWSERS) + ' 중 하나')
    if st.get('memory', 'later') not in MEMORIES:
        out.append('setup.memory: ' + ' · '.join(MEMORIES) + ' 중 하나')
    for k in ('codex', 'doctor', 'children'):
        if k in st and not isinstance(st[k], bool):
            out.append('setup.%s: true 또는 false' % k)
    if 'router' in st:
        out += router_problems(st['router'], 'setup.router')
    mcp = st.get('mcp', [])
    if not isinstance(mcp, list) or len(mcp) > 8 or any(not isinstance(x, str) or not MCP_NAME.fullmatch(x) for x in mcp):
        out.append('setup.mcp: 이름 목록(소문자·숫자·-, 최대 8개)')
    # wiki
    wiki = st.get('wiki', {})
    if not isinstance(wiki, dict):
        out.append('setup.wiki: 객체여야 합니다')
    else:
        out += unknown_keys(wiki, KEYS['wiki'], 'setup.wiki')
        wp = wiki.get('path')
        if wp is not None and not abs_ok(expand(wp, home)):
            out.append('setup.wiki.path: 위키 폴더의 절대 경로, 또는 null(위키 없음)')
    # slack
    sl = st.get('slack', {})
    owner = ''
    if not isinstance(sl, dict):
        out.append('setup.slack: 객체여야 합니다')
    else:
        out += unknown_keys(sl, KEYS['slack'], 'setup.slack')
        enabled = sl.get('enabled', bool(sl.get('channel_id') or sl.get('owner_user_id')))
        if not isinstance(enabled, bool):
            out.append('setup.slack.enabled: true 또는 false')
            enabled = True
        ch, owner = sl.get('channel_id'), sl.get('owner_user_id')
        for key, val, rx, hint in (('channel_id', ch, CHAN, '채널 ID(C 로 시작)'), ('owner_user_id', owner, USER, '봇에게 말할 사람의 Slack 사용자 ID(U 로 시작)')):
            if enabled or val not in ('', None):
                if not isinstance(val, str) or not rx.fullmatch(val):
                    out.append('setup.slack.%s: %s — Slack 연결을 건너뛰려면 enabled 를 false 로' % (key, hint))
        owner = owner if isinstance(owner, str) else ''
        g = sl.get('guests', [])
        if not isinstance(g, list) or len(g) > 50 or any(not isinstance(x, str) or not GUEST.fullmatch(x) for x in g) or len(set(map(str, g))) != len(g):
            out.append('setup.slack.guests: Slack 사용자 ID 목록(U 로 시작 · 중복 없음 · 빈 목록 = 손님 없음)')
        elif owner and owner in g:
            out.append('setup.slack.guests: 주인(owner_user_id) 은 손님 목록에 넣지 않습니다')
    # import
    imp = st.get('import', {})
    if not isinstance(imp, dict):
        out.append('setup.import: 객체여야 합니다')
    else:
        out += unknown_keys(imp, KEYS['import'], 'setup.import')
        fr = imp.get('from', [])
        if not isinstance(fr, list) or len(fr) > 200 or any(not isinstance(x, str) or not ITEM.fullmatch(x) for x in fr):
            out.append('setup.import.from: 가져올 항목 이름 목록(kind:name 꼴 — detect.sh 가 알려 준 것)')
        to = imp.get('to')
        if to is not None and not abs_ok(expand(to, home)):
            out.append('setup.import.to: 사본을 둘 폴더의 절대 경로 또는 null')
    # bots
    bots = st.get('bots')
    if bots is None:
        bots = []   # a missing column — normalize() fills the role defaults (quick / full)
    if not isinstance(bots, list):
        out.append('setup.bots: 목록이어야 합니다')
        bots = []
    if mode == 'blank' and bots:
        out.append('setup.bots: 빈 판(blank)은 봇이 0 이어야 합니다')
    if len(bots) > 4:
        out.append('setup.bots: 봇은 최대 4개')
    if 'bots' in st and mode != 'blank' and isinstance(st['bots'], list) and len(st['bots']) == 0:
        out.append('setup.bots: 빈 판이 아니면 봇이 1~4개 필요합니다(없으면 칸을 아예 빼면 역할 기본값 셋)')
    names, wds = [], []
    for i, b in enumerate(bots):
        where = 'setup.bots[%d]' % i
        if not isinstance(b, dict):
            out.append(where + ': 객체여야 합니다')
            continue
        out += unknown_keys(b, KEYS['bot'], where)
        n = b.get('name')
        if not isinstance(n, str) or not NAME.fullmatch(n):
            out.append(where + '.name: 소문자 영문으로 시작, 소문자·숫자·- 만, 1~32자')
        elif n in RESERVED_NAMES:
            out.append(where + '.name: «%s» 는 예약된 이름입니다' % n)
        elif n in names:
            out.append(where + '.name: 같은 이름이 두 번 있습니다')
        else:
            names.append(n)
        if 'role' in b and (not isinstance(b['role'], str) or not ROLE.fullmatch(b['role'])):
            out.append(where + '.role: 소문자·숫자·- (예: lead · watch · research)')
        if b.get('source', 'blank') not in SOURCES:
            out.append(where + '.source: import · role-default · blank 중 하나')
        for key in ('work_dir', 'persona_dir'):
            if key in b and not abs_ok(expand(b[key], home)):
                out.append(where + '.' + key + ': 절대 경로(따옴표·$·공백 제어문자 없이)')
        wd = expand(b.get('work_dir'), home) if isinstance(b.get('work_dir'), str) else (home + '/bots/' + n if isinstance(n, str) else None)
        if wd is not None:
            if wd in wds:
                out.append(where + '.work_dir: 다른 봇과 같은 폴더입니다')
            wds.append(wd)
        sid = b.get('slack_bot_user_id', '')
        if sid not in ('', None) and (not isinstance(sid, str) or not USER.fullmatch(sid)):
            out.append(where + '.slack_bot_user_id: 비우거나 봇의 Slack 사용자 ID(U 로 시작)')
        if owner and sid == owner:
            out.append(where + '.slack_bot_user_id: 사람(owner_user_id)의 ID 와 같습니다')
        m = b.get('model', '')
        if m not in ('', None) and (not isinstance(m, str) or not MODEL.fullmatch(m)):
            out.append(where + '.model: 비우거나 sonnet · opus 같은 모델 이름')
    for n in names:
        if n + '-stop' in names:
            out.append('setup.bots: «%s» 와 «%s» 는 꺼짐 이름(…-stop)이 겹칩니다' % (n, n + '-stop'))
    return out


def normalize(st, home):
    """Fill every defaulted column (call only after check() is empty). Order is fixed so the same input prints the same bytes."""
    mode = st.get('mode', 'quick')
    sl = st.get('slack', {}) if isinstance(st.get('slack'), dict) else {}
    enabled = sl.get('enabled', bool(sl.get('channel_id') or sl.get('owner_user_id')))
    wiki = st.get('wiki', {}) if isinstance(st.get('wiki'), dict) else {}
    imp = st.get('import', {}) if isinstance(st.get('import'), dict) else {}
    rt = st.get('router', {}) if isinstance(st.get('router'), dict) else {}
    wp = wiki.get('path')
    bots_in = st.get('bots')
    if bots_in is None:
        bots_in = [] if mode == 'blank' else [{'name': r, 'role': r, 'source': 'role-default'} for r in ROLE_DEFAULTS]
    bots = []
    for b in bots_in:
        n = b['name']
        wd = expand(b.get('work_dir') or home + '/bots/' + n, home)
        row = {'name': n, 'role': b.get('role', 'custom'), 'work_dir': wd, 'source': b.get('source', 'blank'),
               'persona_dir': expand(b.get('persona_dir') or wd, home)}
        for opt in ('slack_bot_user_id', 'model'):
            if b.get(opt):
                row[opt] = b[opt]
        bots.append(row)
    return {
        'schema': 1, 'mode': mode, 'mux': st.get('mux', 'auto'),
        'slack': {'enabled': enabled, 'channel_id': sl.get('channel_id') or '', 'owner_user_id': sl.get('owner_user_id') or '',
                  'guests': sl.get('guests', [])},
        'wiki': {'path': expand(wp, home) if wp else None},
        'mcp': st.get('mcp', []), 'codex': st.get('codex', False), 'doctor': st.get('doctor', True),
        'browser': st.get('browser', 'playwright'), 'memory': st.get('memory', 'later'), 'children': st.get('children', True),
        'router': {'mode': rt.get('mode', 'off'), 'judge': rt.get('judge')},
        'bots': bots,
        'import': {'from': imp.get('from', []), 'to': expand(imp.get('to'), home) if imp.get('to') else None},
    }


def main(argv):
    path, home, out_path, do_norm = None, os.path.normpath(os.path.expanduser('~')), None, False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--normalize':
            do_norm = True
        elif a == '--out' and i + 1 < len(argv):
            out_path = argv[i + 1]; i += 1
        elif a == '--home' and i + 1 < len(argv):
            home = os.path.normpath(argv[i + 1]); i += 1
        elif a in ('-h', '--help'):
            print(__doc__.strip())
            return 0
        elif path is None and not a.startswith('--'):
            path = a
        else:
            print('plan.py: 모르는 옵션 ' + a, file=sys.stderr)
            return 2
        i += 1
    if not path:
        print('plan.py: setup.json 경로를 주세요', file=sys.stderr)
        return 2
    try:
        with open(path, encoding='utf-8') as f:
            st = json.load(f)
    except FileNotFoundError:
        print('  - %s: 파일이 없습니다' % path)
        return 2
    except ValueError as exc:
        print('  - %s: JSON 이 아닙니다(%s · %s 째 줄)' % (path, type(exc).__name__, getattr(exc, 'lineno', '?')))
        return 2
    probs = check(st, home)
    if probs:
        for p in probs:
            print('  - ' + p)
        return 2
    norm = normalize(st, home)
    text = json.dumps(norm, indent=2, ensure_ascii=False) + '\n'
    if out_path:
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        tmp = out_path + '.tmp-%d' % os.getpid()
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(text)
        os.chmod(tmp, 0o644)
        os.replace(tmp, out_path)
        print('OK %s (모드 %s · 봇 %d · Slack %s)' % (out_path, norm['mode'], len(norm['bots']), '연결' if norm['slack']['enabled'] else '나중에'))
    elif do_norm:
        sys.stdout.write(text)
    else:
        print('OK (모드 %s · 봇 %d · Slack %s)' % (norm['mode'], len(norm['bots']), '연결' if norm['slack']['enabled'] else '나중에'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
