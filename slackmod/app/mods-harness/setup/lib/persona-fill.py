#!/usr/bin/env python3
"""persona-fill.py — fill the role skeletons with interview answers. Asks nothing; the interview skill (or a test) hands it a file.

    python3 -I setup/lib/persona-fill.py --answers FILE [--out-root DIR] [--templates DIR] [--profile FILE] [--dry-run] [--force]

Answers file (JSON · no secret fields — never put a token or a password in it):
    {"schema": 1,
     "anchors": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "...", "F": "..."},   # optional · user profile · written once
     "bots": [{"name": "alpha",                  # a-z 0-9 - · starts with a letter · 1~32
               "role": "lead|watch|research|custom",
               "tone": "one line",                # empty = the role's default tone
               "signature": "one short closing line",         # optional
               "boundary": ["extra rule", "..."],              # optional · up to 5 · added to the role's own boundaries
               "role_line": "one line",                        # custom only (required there)
               "role_details": ["..."],                        # custom only · optional
               "dir": "/abs/bot/folder"}]}                     # where persona.md + CLAUDE.md go (default OUT_ROOT/name)

Writes <dir>/persona.md and <dir>/CLAUDE.md from templates/roles/<role>/ (custom: templates/custom/). A file this tool made before
(it carries «generated: bot-interview») is rewritten; any other existing file is left alone (--force overwrites it after saving a
.bak-<time> copy). The user profile (default ~/.slackmod/USER-PROFILE.md) is written once and never overwritten; its lines A, C, F
become a short «사용자 컨텍스트» section of each persona.md.

Output: «쓰기 · <path> · 바뀜|그대로» lines, then «결과: 바뀜 N · 그대로 M · 건너뜀 K». Running twice changes nothing the second time.
rc 0 = done · 2 = input error · 3 = a file was left alone (not ours, no --force).
"""
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
NAME_RE = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
ROLES = ('lead', 'watch', 'research', 'custom')
MARK = b'generated: bot-interview'
DEFAULT_TONE = {
    'lead': '차분한 존댓말. 결론부터, 짧게.',
    'watch': '간결한 존댓말. 시각과 숫자부터.',
    'research': '근거부터 말하는 존댓말. 확실한 것과 추정을 구분한다.',
    'custom': '차분한 존댓말. 결론부터, 짧게.',
}
LIMIT = {'tone': 160, 'signature': 60, 'boundary': 200, 'role_line': 160, 'role_details': 200, 'anchor': 600}
CTX = (('A', '주로 하는 일'), ('C', '가장 막히는 점'), ('F', '바라는 것'))


class Usage(Exception):
    pass


def clean(v, what, limit):
    if v is None:
        return ''
    if not isinstance(v, str):
        raise Usage('%s 는 글이어야 함' % what)
    if re.search(r'[\x00-\x08\x0b-\x1f\x7f]', v):
        raise Usage('%s 에 제어 문자가 있음' % what)
    v = re.sub(r'\s+', ' ', v).strip()
    if len(v) > limit:
        raise Usage('%s 가 %d자(상한 %d자)' % (what, len(v), limit))
    return v


def clean_list(v, what, limit, maxn):
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > maxn:
        raise Usage('%s 는 글 목록(최대 %d개)이어야 함' % (what, maxn))
    return [x for x in (clean(i, what, limit) for i in v) if x]


def read_answers(path):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, ValueError):
        raise Usage('답 파일을 읽을 수 없음: ' + path)
    if not isinstance(d, dict) or d.get('schema') != 1 or not isinstance(d.get('bots'), list) or not d['bots']:
        raise Usage('답 파일 꼴이 틀림(schema 1 · bots 목록 필요)')
    anchors = {}
    raw = d.get('anchors') or {}
    if not isinstance(raw, dict):
        raise Usage('anchors 는 칸 이름(A~F)별 글이어야 함')
    for k in 'ABCDEF':
        v = clean(raw.get(k), 'anchors.' + k, LIMIT['anchor'])
        if v:
            anchors[k] = v
    bots = []
    seen = set()
    for i, b in enumerate(d['bots']):
        if not isinstance(b, dict):
            raise Usage('bots[%d] 꼴이 틀림' % i)
        name = clean(b.get('name'), 'bots[%d].name' % i, 32)
        if not NAME_RE.match(name):
            raise Usage('bots[%d].name 은 영문 소문자로 시작하는 영문 소문자 · 숫자 · 하이픈 1~32자' % i)
        if name in seen:
            raise Usage('이름이 겹침: ' + name)
        seen.add(name)
        role = clean(b.get('role'), 'bots[%d].role' % i, 20)
        if role not in ROLES:
            raise Usage('bots[%d].role 은 %s 중 하나' % (i, ' · '.join(ROLES)))
        role_line = clean(b.get('role_line'), 'bots[%d].role_line' % i, LIMIT['role_line'])
        if role == 'custom' and not role_line:
            raise Usage('bots[%d] custom 역할은 role_line 이 필요' % i)
        bots.append({
            'name': name, 'role': role,
            'tone': clean(b.get('tone'), 'bots[%d].tone' % i, LIMIT['tone']) or DEFAULT_TONE[role],
            'signature': clean(b.get('signature'), 'bots[%d].signature' % i, LIMIT['signature']),
            'boundary': clean_list(b.get('boundary'), 'bots[%d].boundary' % i, LIMIT['boundary'], 5),
            'role_line': role_line,
            'role_details': clean_list(b.get('role_details'), 'bots[%d].role_details' % i, LIMIT['role_details'], 6),
            'dir': clean(b.get('dir'), 'bots[%d].dir' % i, 1024),
        })
    return anchors, bots


# ── user profile ─────────────────────────────────────────────────────────────────────────────────────────────────────
TITLES = {'A': '가장 시간을 많이 쓰는 일', 'B': '그중 하나의 시작에서 끝까지', 'C': '제일 지겹거나 막히는 지점',
          'D': '기계가 해도 될 반복 일', 'E': '자료를 모으고 다시 찾는 방법', 'F': '3개월 뒤 바라는 것 하나'}


def profile_text(anchors):
    full = all(k in anchors for k in 'ABCDEF')
    out = ['---', 'schema_version: user-profile-v1', 'interviewed: %s' % datetime.date.today().isoformat(),
           'completeness: %s' % ('full' if full else 'partial'), '---', '', '# 사용자 프로필', '']
    for k in 'ABCDEF':
        out += ['## %s. %s' % (k, TITLES[k]), '', anchors.get(k, '(답 없음)'), '']
    return '\n'.join(out)


def read_profile(path):
    """→ {letter: text} from a profile this tool (or the same layout) wrote."""
    try:
        with open(path, encoding='utf-8') as f:
            text = f.read()
    except OSError:
        return {}
    out, cur = {}, None
    for ln in text.split('\n'):
        m = re.match(r'^##\s+([A-F])\.\s', ln)
        if m:
            cur = m.group(1)
            out[cur] = []
        elif cur is not None and ln.strip():
            out[cur].append(ln.strip())
    return {k: ' '.join(v) for k, v in out.items() if v and ' '.join(v) != '(답 없음)'}


def context_lines(profile):
    out = []
    for k, label in CTX:
        v = profile.get(k)
        if v:
            v = v if len(v) <= 100 else v[:100].rstrip() + '…'
            out.append('- %s: %s' % (label, v))
    return out


# ── render ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def render(tpl, values, slots):
    """Placeholders first (template text only), then slot lines (answer text) — answer text is never re-substituted."""
    text = re.sub(r'<(BOT_NAME|TONE|ROLE_LINE)>', lambda m: values.get(m.group(1), m.group(0)), tpl)
    out = []
    for line in text.split('\n'):
        m = re.fullmatch(r'<!-- slot:([a-z-]+) -->', line.strip())
        if m:
            out.extend(slots.get(m.group(1), []))
        else:
            out.append(line)
    return '\n'.join(out)


def bot_files(tdir, bot, ctx):
    rdir = os.path.join(tdir, 'custom' if bot['role'] == 'custom' else os.path.join('roles', bot['role']))
    values = {'BOT_NAME': bot['name'], 'TONE': bot['tone'], 'ROLE_LINE': bot['role_line']}
    sig = bot['signature']
    slots = {
        'signature-capsule': ['6. 끝 서명: ' + sig] if sig else [],
        'signature': ['- 보고 · 완료 글 끝 서명: ' + sig] if sig else [],
        'boundary': ['- ' + x for x in bot['boundary']],
        'role-details': ['- ' + x for x in bot['role_details']],
        'user-context': (['', '## 사용자 컨텍스트', ''] + ctx) if ctx else [],
    }
    res = {}
    for fn in ('persona.md', 'CLAUDE.md'):
        try:
            with open(os.path.join(rdir, fn), encoding='utf-8') as f:
                res[fn] = render(f.read(), values, slots)
        except OSError:
            raise Usage('틀 파일이 없음: %s/%s' % (rdir, fn))
    return res


def write_file(path, text, force, dry):
    """→ 'changed' | 'same' | 'kept' (left alone: not ours)."""
    new = text.encode('utf-8')
    old = None
    if os.path.isfile(path):
        with open(path, 'rb') as f:
            old = f.read()
    if old == new:
        return 'same'
    if old is not None and MARK not in old and not force:
        return 'kept'
    if dry:
        return 'changed'
    if old is not None and MARK not in old:
        bak = '%s.bak-%s' % (path, datetime.datetime.now().strftime('%Y%m%d%H%M%S'))
        with open(bak, 'wb') as f:
            f.write(old)
    tmp = '%s.tmp-%d' % (path, os.getpid())
    with open(tmp, 'wb') as f:
        f.write(new)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)
    return 'changed'


def parse_args(argv):
    o = {'answers': None, 'out_root': None, 'templates': os.path.join(HERE, '..', 'templates'), 'profile': None, 'dry': False, 'force': False}
    i = 0
    while i < len(argv):
        a = argv[i]
        keys = {'--answers': 'answers', '--out-root': 'out_root', '--templates': 'templates', '--profile': 'profile'}
        if a in keys and i + 1 < len(argv):
            o[keys[a]] = argv[i + 1]; i += 2
        elif a == '--dry-run':
            o['dry'] = True; i += 1
        elif a == '--force':
            o['force'] = True; i += 1
        elif a in ('-h', '--help'):
            print(__doc__.strip()); sys.exit(0)
        else:
            raise Usage('모르는 옵션: ' + a)
    if not o['answers']:
        raise Usage('--answers FILE 이 필요')
    return o


def run(argv):
    o = parse_args(argv)
    anchors, bots = read_answers(o['answers'])
    profile_path = o['profile'] or os.path.join(os.path.expanduser('~'), '.slackmod', 'USER-PROFILE.md')
    n_changed = n_same = n_kept = 0
    profile = {}
    if os.path.isfile(profile_path):
        print('쓰기 · %s · 그대로(이미 있음 — 다시 묻지 않음)' % profile_path)
        n_same += 1
        profile = read_profile(profile_path)
    elif anchors:
        if not o['dry']:
            os.makedirs(os.path.dirname(profile_path), mode=0o700, exist_ok=True)
            fd = os.open(profile_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                f.write(profile_text(anchors))
        print('쓰기 · %s · 바뀜' % profile_path)
        n_changed += 1
        profile = anchors
    ctx = context_lines(profile)
    for b in bots:
        d = b['dir'] or (os.path.join(o['out_root'], b['name']) if o['out_root'] else '')
        if not d:
            raise Usage('%s: dir 도 --out-root 도 없음' % b['name'])
        files = bot_files(o['templates'], b, ctx)
        if not o['dry']:
            os.makedirs(d, exist_ok=True)
        for fn, text in files.items():
            r = write_file(os.path.join(d, fn), text, o['force'], o['dry'])
            if r == 'kept':
                n_kept += 1
                print('쓰기 · %s · 건너뜀(이미 있는 파일이고 이 도구가 만든 것이 아님 — 덮으려면 --force, 사본은 .bak 에 남음)' % os.path.join(d, fn))
            else:
                n_changed += r == 'changed'
                n_same += r == 'same'
                print('쓰기 · %s · %s' % (os.path.join(d, fn), '바뀜' if r == 'changed' else '그대로'))
    print('결과: 바뀜 %d · 그대로 %d · 건너뜀 %d' % (n_changed, n_same, n_kept))
    return 3 if n_kept else 0


def main(argv):
    try:
        return run(argv)
    except Usage as e:
        print('persona-fill: %s' % e, file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
