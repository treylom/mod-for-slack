#!/usr/bin/env python3
"""slack-app-auto.py — setup wizard: make one bot's Slack app in the user's own browser, stopping before any token.

  python3 -I slack-app-auto.py check                       rc 0 = a browser tool the wizard can drive is here (Aside)
  python3 -I slack-app-auto.py manifest --bot NAME          print the manifest with the bot's names in it
  python3 -I slack-app-auto.py run --bot NAME [--wait SEC] [--keys] [--install-wait SEC] [--root DIR]
                                                            do it (one Aside session · see below)

«run» opens ONE «aside repl» session and feeds it slack-app-driver.js, one statement at a time:
  1. open      https://api.slack.com/apps → Create New App → Paste a manifest → Continue → manifest in the editor → stop
  2. wait      (looks only) until the person has picked the workspace and pressed Next — up to --wait seconds (default 300 ·
               the whole run stays under the wizard's 10-minute tool limit)
  3. create    the review is in the same dialog that held exactly our manifest at the last look (the real review screen
               names no app) → Create → reads only the address bar until the app page → stop
  4. keys      (only with --keys) on that new app only: app-level token (connections:write) [one statement] · then the
               Install App page is reloaded with spacing until Slack lights «Install to …» [installWait statements, ≤80 s each,
               up to --install-wait seconds (default 300) and never past ~9.5 min of the whole run] · Install · Allow · bot
               token [one statement]. Slack lights the button once the app status it fetches at each page load says
               «approved» (R2 6th run 11-07: «approved» from 2 s). The R2 3rd–6th runs' «greyed» was aside's role query still
               answering from the page it left after goto() — the driver now waits for each page's load. Every load adds one
               «age=status» word to the result line («diag=…»: seconds since the app was made = the status word the page
               fetched · +flags e=load error d=denied r=request s=no scope a=ask an admin b=the role query saw no install
               control the page has h=a live-looking link whose address is not the consent page t=the load wait gave up)
               — only those words, no values.
               Each token leaves the page only XOR-sealed with a one-time pad made here for this run; this program unseals
               it in memory, checks its shape (xoxb- / xapp-) and pipes both straight into «<root>/bin/slackmod set-token
               <bot>» (stdin · the kit's own 0600 save). The values are never printed, logged, written elsewhere or kept.
Then the session ends (Aside closes the tab it opened). Without --keys tokens are never made or opened: the person makes
them on the app page and types them into «slackmod set-token» in a terminal.

Output: one line «SLACKMOD_APP state=<state> [app=<A…>] [reason=<word>]» and one Korean line for the person.
Nothing else from the browser session is printed (its banner and log lines stay inside this process). A driver result is
read only from a line that carries this run's random marker (a page cannot print it: it never sees the statement text).
rc: 0 created (no --keys) / tokens saved (--keys) · 10 sign in to Slack first · 11 nothing created (no Next in time ·
    dialog closed) · 12 the page did not look as expected (use the guide; «app=» tells whether the app was made) ·
    13 no browser tool / it did not start · 14 tokens read but not saved (run «slackmod set-token <bot>») ·
    15 the workspace needs an admin to approve the install · 2 usage.
Tests: SLACKMOD_ASIDE = path of a stand-in «aside» program.
"""
import json
import os
import secrets
import re
import select
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DRIVER = os.path.join(HERE, 'slack-app-driver.js')
MANIFESTS = (os.path.join(REPO, 'slackmod', 'slack-app-manifest.json'), os.path.join(REPO, 'port', 'slack-app-manifest.json'))
BOT_NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,31}$')
ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
RESULT_TAG = 'SLACKMOD_APP_RESULT_'
DONE = re.compile(r'\[(ok|error) \|')
STATES = {'pick-workspace', 'waiting', 'review', 'created', 'app-token', 'install-ready', 'install-wait', 'keys', 'login', 'cancelled',
          'approval', 'fallback'}
# «age=status[+flags]» per Install App page load (driver's diagStr) — a strict grammar, so nothing else can ride along
DIAG_WORD = r'(?:[0-9]{1,5}|x)=[a-z_-]{1,24}(?:\+[edrsabht]{1,8})?'
DIAG = re.compile(r'^(?:more[0-9]{1,4},)?' + DIAG_WORD + r'(?:,' + DIAG_WORD + r'){0,23}$')
SEALED = re.compile(r'^[0-9a-f]{50,512}$')
TOKEN_SHAPE = {'bot': re.compile(r'^xoxb-[0-9A-Za-z-]{20,250}$'), 'app': re.compile(r'^xapp-[0-9A-Za-z-]{20,250}$')}
PAD_BYTES = 256
APP_ID = re.compile(r'^A[A-Z0-9]{6,20}$')
REASON = re.compile(r'^[a-z][a-z-]{0,39}$')
STEP_TIMEOUT = 140   # aside repl gives each statement 120 s
WAIT_STEP_MS = 90000
INSTALL_STEP_MS = 80000   # one installWait statement (+ its last load) stays inside aside's 120 s
RUN_BUDGET = 570   # s: the whole run stays under the wizard's 10-minute tool limit …
KEYS_RESERVE = 130   # … leaving one keysBot statement (≤120 s) after the install wait …
LOAD_SLACK = 47   # … and the one page load a wait statement may run past its time (goto ≤30 s + 15 s watch + look)
RC = {'created': 0, 'saved': 0, 'login': 10, 'waiting': 11, 'cancelled': 11, 'fallback': 12, 'runner': 13, 'not-saved': 14,
      'approval': 15}
SAY = {
    'created': '앱을 만들었습니다. 여기서 멈춥니다 — 열쇠 두 개는 직접 만들고 복사해 터미널에 넣으세요.',
    'saved': '앱을 만들고 워크스페이스에 설치한 뒤 열쇠 두 개를 봇에 저장했습니다(값은 이 대화와 출력에 나오지 않았습니다).',
    'not-saved': '앱과 열쇠는 만들었지만 봇에 저장하지 못했습니다 — 터미널에서 slackmod set-token 으로 넣으세요(앱 화면에서 복사).',
    'approval': '이 워크스페이스는 앱 설치에 관리자 승인이 필요합니다. 승인이 나면 안내서 3·5절대로 이어 가세요.',
    'login': '브라우저가 Slack 에 로그인돼 있지 않습니다. 그 브라우저에서 직접 로그인한 뒤 다시 하세요(비밀번호는 채팅에 쓰지 마세요).',
    'waiting': '워크스페이스 고르기와 Next 를 기다리다 시간이 다 됐습니다. 앱은 만들지 않았습니다.',
    'cancelled': '만들기 창이 닫혔습니다. 앱은 만들지 않았습니다.',
    'fallback': '화면이 예상과 달라 멈췄습니다. 안내서(docs/slack-app.md)대로 직접 이어 가세요.',
    'runner': '브라우저 도구(Aside)를 쓸 수 없습니다. 안내서(docs/slack-app.md)대로 직접 만드세요.',
}


def usage(msg):
    sys.stderr.write('slack-app-auto: %s\n' % msg)
    sys.stderr.write('usage: python3 -I slack-app-auto.py check | manifest --bot NAME | run --bot NAME [--wait SEC] [--keys] '
                     '[--install-wait SEC] [--root DIR]\n')
    sys.exit(2)


def find_aside():
    p = os.environ.get('SLACKMOD_ASIDE') or shutil.which('aside')
    return p if p and os.path.isfile(p) and os.access(p, os.X_OK) else None


def manifest_for(bot, path=None):
    src = path or next((m for m in MANIFESTS if os.path.isfile(m)), None)
    if not src:
        usage('slack-app-manifest.json not found next to the setup folder')
    with open(src, encoding='utf-8') as f:
        man = json.load(f)
    man['display_information']['name'] = 'mod-for-slack ' + bot
    man['features']['bot_user']['display_name'] = bot
    return man


def clean(raw):
    """raw driver result → only the fields we know, in the shapes we expect (anything else = «bad-result»)."""
    try:
        d = json.loads(raw)
    except ValueError:
        return {'state': 'fallback', 'reason': 'bad-result'}
    if not isinstance(d, dict) or d.get('state') not in STATES:
        return {'state': 'fallback', 'reason': 'bad-result'}
    out = {'state': d['state']}
    app, reason, by, diag = d.get('app'), d.get('reason'), d.get('by'), d.get('diag')
    for k in ('app_sealed', 'bot_sealed'):
        v = d.get(k)
        if v is not None:
            if not (isinstance(v, str) and SEALED.fullmatch(v) and len(v) % 2 == 0):
                return {'state': 'fallback', 'reason': 'bad-result'}
            out[k] = v
    if app is not None:
        if not (isinstance(app, str) and APP_ID.fullmatch(app)):
            return {'state': 'fallback', 'reason': 'bad-result'}
        out['app'] = app
    if reason is not None:
        if not (isinstance(reason, str) and REASON.fullmatch(reason)):
            return {'state': 'fallback', 'reason': 'bad-result'}
        out['reason'] = reason
    if by in ('person', 'wizard'):
        out['by'] = by
    if diag is not None:
        if not (isinstance(diag, str) and DIAG.fullmatch(diag)):
            return {'state': 'fallback', 'reason': 'bad-result'}
        out['diag'] = diag
    if out['state'] in ('created', 'app-token', 'install-ready', 'install-wait', 'keys') and 'app' not in out:
        return {'state': 'fallback', 'reason': 'bad-result'}
    want = {'app-token': {'app_sealed'}, 'keys': {'bot_sealed'}}.get(out['state'], set())
    if {k for k in ('app_sealed', 'bot_sealed') if k in out} != want:
        return {'state': 'fallback', 'reason': 'bad-result'}
    return out


class Repl:
    """one «aside repl» process: send a one-line statement, read until its «[ok |» / «[error |» line."""

    def __init__(self, exe):
        env = dict(os.environ, NO_COLOR='1')
        self.p = subprocess.Popen([exe, 'repl'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
        os.set_blocking(self.p.stdout.fileno(), False)
        self.buf = ''

    def send(self, line, timeout=STEP_TIMEOUT):
        try:
            self.p.stdin.write((line + '\n').encode('utf-8'))
            self.p.stdin.flush()
        except (BrokenPipeError, OSError):
            return None
        end = time.time() + timeout
        while time.time() < end:
            r, _, _ = select.select([self.p.stdout], [], [], 0.5)
            if r:
                d = self.p.stdout.read()
                if d == b'':
                    return None   # the session ended
                if d:
                    self.buf += ANSI.sub('', d.decode('utf-8', 'replace'))
                    m = DONE.search(self.buf)
                    if m:
                        out, self.buf = self.buf[:m.end()], self.buf[m.end():]
                        return out
            elif self.p.poll() is not None:
                return None
        return None

    def close(self):
        try:
            self.p.stdin.write(b'exit\n')
            self.p.stdin.flush()
            self.p.stdin.close()
        except (BrokenPipeError, OSError):
            pass
        try:
            self.p.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait()


def step(repl, call, tag):
    js = ('try { __r = await __sm.%s; console.log("%s " + JSON.stringify(__r)); } '
          'catch (e) { console.log("%s " + JSON.stringify({state: "fallback", reason: "exception"})); }') % (call, tag, tag)
    out = repl.send(js)
    if out is None:
        return {'state': 'fallback', 'reason': 'session-ended'}
    m = re.search(re.escape(tag) + r' (\{[^\n]*\})', out)
    return clean(m.group(1)) if m else {'state': 'fallback', 'reason': 'no-result'}


def unseal(hexs, pad):
    b = bytes.fromhex(hexs)
    return ''.join(chr(c ^ pad[i]) for i, c in enumerate(b))


def save_tokens(bot, root, bot_token, app_token):
    """pipe both values into the kit's own «slackmod set-token <bot>» (stdin) → True when it says it saved them."""
    exe = os.path.join(root, 'bin', 'slackmod')
    if not (os.path.isfile(exe) and os.access(exe, os.X_OK)):
        return False
    env = dict(os.environ, SLACKMOD_ROOT=root)
    try:
        p = subprocess.run([exe, 'set-token', bot], input=(bot_token + '\n' + app_token + '\n').encode('ascii'),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return p.returncode == 0 and b'saved (values not shown)' in p.stdout


def run(bot, wait, manifest_path, keys=False, root=None, install_wait=300):
    t_start = time.time()
    exe = find_aside()
    if not exe:
        return {'state': 'runner', 'reason': 'no-aside'}
    man = manifest_for(bot, manifest_path)
    with open(DRIVER, encoding='utf-8') as f:
        src = f.read()
    o = {'manifest': json.dumps(man, indent=2, ensure_ascii=True), 'appName': man['display_information']['name']}
    pads = {}
    if keys:
        pads = {'app': secrets.token_bytes(PAD_BYTES), 'bot': secrets.token_bytes(PAD_BYTES)}
        o['padApp'], o['padBot'], o['keys'] = pads['app'].hex(), pads['bot'].hex(), True
    tag = RESULT_TAG + secrets.token_hex(8)
    repl = Repl(exe)
    try:
        ready = repl.send('globalThis.__sm = (0, eval)(%s); var __r = null; var __o = %s; console.log("SLACKMOD_APP_READY")'
                          % (json.dumps(src + '\n;SLACKMOD_APP', ensure_ascii=True), json.dumps(o, ensure_ascii=True)))
        if ready is None or 'SLACKMOD_APP_READY' not in ready:
            return {'state': 'runner', 'reason': 'not-started'}
        r = step(repl, 'open(globalThis, __o)', tag)
        if r['state'] != 'pick-workspace':
            return r
        end = time.time() + wait
        while True:
            left = int(max(0, min(WAIT_STEP_MS, (end - time.time()) * 1000)))
            r = step(repl, 'waitReview(globalThis, __o, %d)' % left, tag)
            if r['state'] == 'review':
                r = step(repl, 'create(globalThis, __o)', tag)
                break
            if r['state'] == 'created':   # the person pressed Create themselves
                break
            if r['state'] != 'waiting' or time.time() >= end:
                return r
        if r['state'] != 'created' or not keys:
            return r
        app = r['app']
        a = step(repl, 'keysApp(globalThis, __o)', tag)
        if a['state'] != 'app-token':
            a.setdefault('app', app)
            return a
        if install_wait > 0:   # reload the Install App page with spacing until «Install to …» is live (never clicks)
            inst_end = min(time.time() + install_wait, t_start + RUN_BUDGET - KEYS_RESERVE - LOAD_SLACK)
            w = None
            while True:
                t1 = time.time()
                if t1 >= inst_end:
                    if w is None:
                        break   # no time left to wait at all (a slow person): keysBot's own three loads only
                    return {'state': 'fallback', 'app': app, 'reason': w.get('reason', 'install-greyed'), 'diag': w.get('diag')}
                left = int(min(INSTALL_STEP_MS, (inst_end - t1) * 1000))
                w = step(repl, 'installWait(globalThis, __o, %d)' % left, tag)
                if w['state'] == 'install-ready':
                    break
                if w['state'] != 'install-wait':
                    w.setdefault('app', app)
                    return w
                if time.time() - t1 < 5:   # a statement that came back at once: do not spin
                    time.sleep(min(5, max(0, inst_end - time.time())))
        r = step(repl, 'keysBot(globalThis, __o)', tag)
        if r['state'] != 'keys':
            r.setdefault('app', app)
            return r
        diag = r.get('diag')
        bt, at = unseal(r.pop('bot_sealed'), pads['bot']), unseal(a.pop('app_sealed'), pads['app'])
        try:
            if not (TOKEN_SHAPE['bot'].fullmatch(bt) and TOKEN_SHAPE['app'].fullmatch(at)):
                return {'state': 'not-saved', 'app': app, 'reason': 'token-shape', 'diag': diag}
            ok = save_tokens(bot, root, bt, at)
        finally:
            bt = at = None
        return {'state': 'saved' if ok else 'not-saved', 'app': app, 'diag': diag}
    finally:
        repl.close()


def main(argv):
    if not argv:
        usage('command missing')
    cmd, rest = argv[0], argv[1:]
    a = {'bot': None, 'wait': '300', 'install-wait': '300', 'manifest': None, 'root': os.path.join(os.path.expanduser('~'), '.slackmod'),
         'keys': False}
    i = 0
    while i < len(rest):
        k = rest[i]
        if k == '--keys':
            a['keys'] = True
            i += 1
        elif k in ('--bot', '--wait', '--install-wait', '--manifest', '--root') and i + 1 < len(rest):
            a[k[2:]] = rest[i + 1]
            i += 2
        else:
            usage('unknown argument: ' + k)
    if cmd == 'check':
        exe = find_aside()
        print('browser tool: ' + ('aside' if exe else 'none'))
        return 0 if exe else 1
    if cmd not in ('manifest', 'run'):
        usage('unknown command: ' + cmd)
    if not a['bot'] or not BOT_NAME.fullmatch(a['bot']):
        usage('--bot: lower-case letters, digits and «-», 1-32 characters')
    if cmd == 'manifest':
        print(json.dumps(manifest_for(a['bot'], a['manifest']), indent=2, ensure_ascii=False))
        return 0
    if not re.fullmatch(r'[0-9]{1,4}', a['wait']):
        usage('--wait: seconds (0-9999)')
    if not re.fullmatch(r'[0-9]{1,4}', a['install-wait']):
        usage('--install-wait: seconds (0-9999 · 0 = no wait, three page loads only)')
    if a['keys'] and not os.path.isfile(os.path.join(a['root'], 'bin', 'slackmod')):
        usage('--keys: the kit is not installed under ' + a['root'] + ' (no bin/slackmod) — install first')
    r = run(a['bot'], int(a['wait']), a['manifest'], a['keys'], a['root'], int(a['install-wait']))
    st = r['state'] if r['state'] in RC else 'fallback'
    line = 'SLACKMOD_APP state=' + r['state']
    if r.get('app'):
        line += ' app=' + r['app']
    if r.get('reason'):
        line += ' reason=' + r['reason']
    if r.get('diag') and DIAG.fullmatch(r['diag']):
        line += ' diag=' + r['diag']
    print(line)
    print(SAY.get(st, SAY['fallback']))
    return RC[st]


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
