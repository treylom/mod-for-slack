#!/usr/bin/env python3
# rooms.py — SlackMod «프로젝트 방» + 웹 현황판 설정 (표준 모듈만 · install.sh 가 ~/.slackmod/lib 에 둔다 · bin/slackmod 가 부름)
#
#   rooms.py new   --root ROOT <이름> --goal "목표 한 줄" [--step "다음 일"]… [--thread <Slack 스레드 주소>]
#                  → ROOT/rooms/<YYYY-MM-DD>-<이름>/ 에 00-context · 01-spec · 02-progress · 03-outcome 네 파일
#                    01-spec «의존 그래프»(mermaid) = 처음부터 실제 값: 🔄 착수 — <목표> → ⏳ <다음 일>… → 🏁 목표.
#                    빈 자리표(🔴)는 넣지 않는다 — 자리표만 깔면 현황판에서 그 방은 «단계 0» 빈 칸으로 남는다.
#   rooms.py list  --root ROOT                       → 방마다 한 줄(이름 · 목표)
#   rooms.py board-config --root ROOT [--port N]     → ROOT/web-board/ 에 web.json · web.key(처음 한 번만 · 0600) · roster.yaml
#                                                      (출력 = 설정 파일 경로 한 줄 · 열쇠 값은 찍지 않음)
#   rooms.py board-url --root ROOT                   → 처음 열 주소(열쇠 포함) 한 줄 — 터미널에서만 쓰세요
#
# 현황판(app/mods-harness/tools/web-board/server.mjs)이 읽는 꼴에 맞춘다: 방 폴더 이름 «YYYY-MM-DD-…» · 01-spec 의
# «의존 그래프» 뒤 첫 ```mermaid 덩이 · 노드 X["상태 이모지 글"] · 화살표 A --> B · 스레드 주소 = 00-context 의 첫 Slack 주소.
import argparse
import datetime
import json
import os
import re
import secrets
import sys

NAME_RX = re.compile(r'^[A-Za-z0-9가-힣_-][A-Za-z0-9가-힣._-]{0,99}$')
PERMALINK_RX = re.compile(r'^https://[a-z0-9][a-z0-9-]{0,62}\.slack\.com/archives/[CDG][A-Z0-9]{6,20}/p\d{16}$')
BOT_RX = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')
SLACK_UID_RX = re.compile(r'^U[A-Z0-9]{6,20}$')
TEXT_MAX = 200
LABEL_MAX = 60
STEPS_MAX = 12          # 노드 = 착수 1 + 다음 일 + 목표 1 ≤ 14 (회의 방 규칙 «노드 ≤15»)
PORT_DEFAULT = 8794


def die(msg, rc=2):
    print('slackmod room: ' + msg, file=sys.stderr)
    sys.exit(rc)


def one_line(v, what):
    s = re.sub(r'[ \t]+', ' ', str(v or '')).strip()
    if not s:
        die(what + ' 이(가) 비었습니다')
    for ch in s:
        c = ord(ch)
        if c < 0x20 or c == 0x7f or c in (0x85, 0x2028, 0x2029):
            die(what + ' 에 줄바꿈·제어 문자가 있습니다(한 줄만)')
    if len(s) > TEXT_MAX:
        die('%s 이(가) %d자를 넘습니다' % (what, TEXT_MAX))
    try:   # 폴더를 만들기 «전»에 — 쓰다가 깨져 반쯤 만든 방이 남지 않게(UTF-8 이 아닌 글 · 독립 재검 FIX-1)
        s.encode('utf-8')
    except UnicodeEncodeError:
        die(what + ' 이(가) UTF-8 글자가 아닙니다')
    # 마크다운 덩이(```)를 열 수 있는 글자 = 바꿈 — 목표 글이 01-spec 안에 가짜 그래프 덩이를 만들지 못하게
    return s.replace('`', "'")


def label(t):
    # 노드 글(mermaid ["…"])과 현황판 파서(노드 ["…"] · 화살표 -->)를 깨는 글자는 바꾸고 60자로 자른다
    for a, b in (('"', "'"), ('[', '('), (']', ')'), ('{', '('), ('}', ')'), ('|', '/')):
        t = t.replace(a, b)
    t = re.sub(r'-+>', '→', t)
    if len(t) > LABEL_MAX:
        t = t[:LABEL_MAX - 1].rstrip() + '…'
    return t


def write_new(path, text, mode=0o600):
    # 새 파일만(있으면 실패) · 링크 안 따라감
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), mode)
    with os.fdopen(fd, 'w', encoding='utf-8') as fh:
        fh.write(text)


def private_dir(p):
    if os.path.islink(p):
        die('링크인 폴더는 쓰지 않습니다: ' + os.path.basename(p))
    os.makedirs(p, mode=0o700, exist_ok=True)
    os.chmod(p, 0o700)


def root_dir(p):
    # 설치 루트(~/.slackmod)는 install.sh 의 것(755) — 없으면 만들기만 · 권한은 안 바꿈(독립 재검 FIX-3)
    if os.path.islink(p):
        die('링크인 폴더는 쓰지 않습니다: ' + os.path.basename(p))
    os.makedirs(p, mode=0o755, exist_ok=True)


def cmd_new(a):
    if not NAME_RX.fullmatch(a.name or ''):   # fullmatch: 끝 줄바꿈 붙은 이름도 거절(재검 NOTE-1)
        die('방 이름 = 영문·숫자·한글·- _ . 만(1~100자 · 맨 앞 . 안 됨) — 예: website-renewal')
    goal = one_line(a.goal, '목표(--goal)')
    steps = [one_line(s, '다음 일(--step)') for s in (a.step or [])]
    if len(steps) > STEPS_MAX:
        die('다음 일은 %d개까지입니다' % STEPS_MAX)
    thread = (a.thread or '').strip()
    if thread and not PERMALINK_RX.match(thread):
        die('--thread 는 Slack 스레드 주소 꼴만(https://<워크스페이스>.slack.com/archives/<채널>/p<16자리>) — Slack 에서 «링크 복사»한 주소')
    now = datetime.datetime.now()
    if a.now:
        now = datetime.datetime.fromisoformat(a.now)
    day = now.strftime('%Y-%m-%d')
    stamp = now.strftime('%Y-%m-%d %H:%M')
    rooms = os.path.join(a.root, 'rooms')
    root_dir(a.root)
    private_dir(rooms)
    room = '%s-%s' % (day, a.name)
    folder = os.path.join(rooms, room)
    try:
        os.mkdir(folder, 0o700)
    except FileExistsError:
        die('이미 있는 방입니다: ' + room, 3)
    # 의존 그래프: 착수(🔄 목표) → 다음 일(⏳)… → 🏁 목표 — 모두 개설 입력에서 온 실제 글
    ids = ['A'] + ['S%d' % (i + 1) for i in range(len(steps))]
    lines = ['  A["🔄 착수 — %s"]' % label(goal)]
    for i, s in enumerate(steps):
        lines.append('  %s --> %s["⏳ %s"]' % (ids[i], ids[i + 1], label(s)))
    lines.append('  %s --> G["🏁 목표 — %s"]' % (ids[-1], label(goal)))
    graph = '```mermaid\nflowchart TD\n' + '\n'.join(lines) + '\n```\n'
    # 스레드 링크 원천(현황판 threadUrlOf) = 02 개설 줄의 채널·ts + 00-context 의 같은 주소 — 목표 글은 이 두 곳에 안 씀
    # (목표 속 다른 Slack 주소·«스레드 C… ts» 글이 방 링크를 가로채지 못하게 · 독립 재검 FIX-2 · 목표 정본 = 01-spec)
    m = re.match(r'^https://[^/]+/archives/([CDG][A-Z0-9]+)/p(\d{10})(\d{6})$', thread) if thread else None
    ctx = ('# %s — 00-context\n\n## 만든 때\n%s\n' % (room, stamp)
           + ('\n## Slack 스레드\n%s\n' % thread if thread else ''))
    spec = ('# %s\n\n## 목표 (한 문장)\n%s\n\n'
            '## 의존 그래프 (노드 = 작업 단위 · 화살표 = 먼저 끝낼 일 · 상태가 바뀔 때마다 고침 · 노드 15개까지)\n'
            '<!-- graph-updated: %s -->\n%s'
            '> 상태 = ✅ 끝 · 🔄 하는 중 · ⏳ 기다림 · ❌ 막힘 · ❓ 사람 판단 · 🏁 목표 — 노드 글 맨 앞에 하나.\n'
            % (a.name, goal, stamp, graph))
    prog = ('# 02-progress — %s\n\n[%s] slackmod | 개설 | 방 만들기%s (목표 = 01-spec)\n'
            % (a.name, stamp, (' · 스레드 %s %s.%s' % m.groups()) if m else ''))
    outc = '# 03-outcome — %s\n\n(끝날 때 — 결정 · 산출 · 남은 일)\n' % a.name
    try:
        for f, t in (('00-context.md', ctx), ('01-spec.md', spec), ('02-progress.md', prog), ('03-outcome.md', outc)):
            write_new(os.path.join(folder, f), t)
    except Exception:   # 쓰다 깨지면 이번에 만든 것만 지움(다음 시도가 «이미 있는 방»에 막히지 않게)
        for f in os.listdir(folder):
            os.unlink(os.path.join(folder, f))
        os.rmdir(folder)
        raise
    print('방 만듦: %s (노드 %d · 그래프 = %s)' % (room, len(ids) + 1, os.path.join(folder, '01-spec.md')))


def cmd_list(a):
    rooms = os.path.join(a.root, 'rooms')
    try:
        names = sorted(n for n in os.listdir(rooms) if re.match(r'^\d{4}-\d{2}-\d{2}-', n))
    except FileNotFoundError:
        names = []
    if not names:
        print('방 없음 — 만들기: slackmod room new <이름> --goal "목표 한 줄"')
        return
    for n in names:
        goal = ''
        try:
            with open(os.path.join(rooms, n, '01-spec.md'), encoding='utf-8') as fh:
                m = re.search(r'^## 목표 \(한 문장\)\n(.+)$', fh.read(), re.M)
                goal = m.group(1) if m else ''
        except OSError:
            goal = '(01-spec 없음)'
        print('%s · %s' % (n, goal))


def bots_of(root):
    # config.json 의 bots[] (이름 · Slack 사용자 ID) — 없으면 bots.list 의 이름만
    out = []
    try:
        with open(os.path.join(root, 'config.json'), encoding='utf-8') as fh:
            cfg = json.load(fh)
        for b in cfg.get('bots') or []:
            n = b.get('name') if isinstance(b, dict) else None
            if isinstance(n, str) and BOT_RX.match(n):
                uid = b.get('slack_bot_user_id') or ''
                out.append((n, uid if isinstance(uid, str) and SLACK_UID_RX.match(uid) else ''))
    except (OSError, ValueError, AttributeError):
        pass
    if not out:
        try:
            with open(os.path.join(root, 'bots.list'), encoding='utf-8') as fh:
                out = [(n, '') for n in (x.strip() for x in fh) if BOT_RX.match(n)]
        except OSError:
            pass
    return out


def board_dir(root):
    d = os.path.join(root, 'web-board')
    root_dir(root)
    private_dir(d)
    return d


def cmd_board_config(a):
    bots = bots_of(a.root)
    if not bots:
        die('봇이 없습니다 — install.sh 먼저', 1)
    d = board_dir(a.root)
    key = os.path.join(d, 'web.key')
    if not os.path.lexists(key):   # 열쇠 = 이 컴퓨터에서 처음 한 번 만듦 · 있으면 그대로(덮어쓰지 않음)
        write_new(key, secrets.token_urlsafe(32) + '\n')
    elif os.path.islink(key):
        die('web.key 가 링크입니다 — 지우고 다시 하세요', 1)
    # 담당 찾기 명부(현황판 rosterOf 가 읽는 세 줄 꼴) — 봇 이름 = 별칭 · 매번 새로 씀
    ro = ['bots:']
    for n, uid in bots:
        ro.append('  %s:' % n)
        if uid:
            ro.append('    slack_user_id: "%s"' % uid)
        ro.append('    aliases: [%s]' % n)
    roster = os.path.join(d, 'roster.yaml')
    # 사용자가 web.json 에 손으로 넣은 칸은 다시 켜도 남김: bot_names(봇 이름 → 화면 이름) · hide_words(화면에서 지울 낱말) · display_text(방 제목·노드 글) · port
    #   — 그 밖(host · 열쇠 자리 · 방 폴더 …)은 매번 새로 씀(손으로 0.0.0.0 을 넣어도 127.0.0.1 로 돌아감)
    old = {}
    wj = os.path.join(d, 'web.json')
    if os.path.isfile(wj) and not os.path.islink(wj):
        try:
            with open(wj, encoding='utf-8') as fh:
                old = json.load(fh)
        except (OSError, ValueError):
            old = {}
        old = old if isinstance(old, dict) else {}
    keep_names = {k: v.strip() for k, v in (old.get('bot_names') or {}).items()
                  if isinstance(k, str) and isinstance(v, str) and v.strip() and len(v) <= 40} if isinstance(old.get('bot_names'), dict) else {}
    keep_hide = [w for w in (old.get('hide_words') or []) if isinstance(w, str) and 3 <= len(w) <= 100] if isinstance(old.get('hide_words'), list) else []
    keep_display = old.get('display_text') if isinstance(old.get('display_text'), dict) else None   # 방 제목·노드 글 표시 글(손 칸 · 기본 null)
    port = a.port
    if port is None:
        op = old.get('port')
        port = op if isinstance(op, int) and not isinstance(op, bool) and 1024 <= op <= 65535 else PORT_DEFAULT
    conf = {
        # plugin_src 없음 = 서버 옆 ../../src (설치된 app/mods-harness/src) · 주소는 이 컴퓨터만(127.0.0.1)
        'mods_config': os.path.join(a.root, 'bots', bots[0][0], 'harness.json'),
        'host': ['127.0.0.1'],
        'port': port,
        'key_file': key,
        'pid_file': os.path.join(d, 'web.pid'),
        'rooms_root': os.path.join(a.root, 'rooms'),
        'roster_file': roster,
        'rooms_days': 31,
        'rooms_max': 40,
        'hide_words': keep_hide,
        'bot_names': keep_names,
        'display_text': keep_display,
        'setup_root': a.root,   # 설치·가이드 화면의 단계별 «끝남» 원천(/api/jobs setup)
        'slack_workspace_url': '',
    }
    for path, text in ((roster, '\n'.join(ro) + '\n'), (os.path.join(d, 'web.json'), json.dumps(conf, indent=2, ensure_ascii=False) + '\n')):
        tmp = path + '.tmp-%d' % os.getpid()
        write_new(tmp, text)
        os.replace(tmp, path)
    private_dir(os.path.join(a.root, 'rooms'))
    print(os.path.join(d, 'web.json'))


def cmd_board_url(a):
    d = os.path.join(a.root, 'web-board')
    try:
        with open(os.path.join(d, 'web.json'), encoding='utf-8') as fh:
            port = json.load(fh).get('port', PORT_DEFAULT)
        with open(os.path.join(d, 'web.key'), encoding='utf-8') as fh:
            k = fh.read().strip()
    except (OSError, ValueError):
        die('현황판 설정이 없습니다 — slackmod board start 먼저', 1)
    print('http://127.0.0.1:%d/?key=%s' % (port, k))


def main():
    ap = argparse.ArgumentParser(prog='slackmod room')
    sp = ap.add_subparsers(dest='cmd', required=True)
    n = sp.add_parser('new')
    n.add_argument('--root', required=True)
    n.add_argument('name')
    n.add_argument('--goal', required=True)
    n.add_argument('--step', action='append')
    n.add_argument('--thread', default='')
    n.add_argument('--now', default='', help=argparse.SUPPRESS)   # 시험용 시각
    l = sp.add_parser('list')
    l.add_argument('--root', required=True)
    b = sp.add_parser('board-config')
    b.add_argument('--root', required=True)
    b.add_argument('--port', type=int, default=None)   # 없으면 앞 web.json 의 port · 그것도 없으면 8794
    u = sp.add_parser('board-url')
    u.add_argument('--root', required=True)
    a = ap.parse_args()
    a.root = os.path.abspath(os.path.expanduser(a.root))
    if a.cmd == 'board-config' and a.port is not None and not (1024 <= a.port <= 65535):
        die('--port 는 1024~65535')
    {'new': cmd_new, 'list': cmd_list, 'board-config': cmd_board_config, 'board-url': cmd_board_url}[a.cmd](a)


if __name__ == '__main__':
    main()
