#!/usr/bin/env python3
"""fake-slack-apps-server.py — a local stand-in for the Slack app pages the wizard's browser step walks (test helper, never
ships to users · bait tokens only).

    python3 -I fake-slack-apps-server.py <port file> <log file> <mode file>

Binds 127.0.0.1 on a free port and writes it to <port file>. «127.0.0.1» plays api.slack.com; «localhost» (same port) plays
app.slack.com (the app settings pages) AND the workspace's install consent page (other hosts · told apart by path, like the
real *.slack.com ones). Every request is logged as «<host> <METHOD> <path>». Pages:
  /apps                       app list + Create New App → dialog (From scratch / Paste a manifest) → Continue → editor
                              (.CodeMirror with a CodeMirror-like object) + Workspace select + Next → review + Create →
                              /apps/AFAKE12345?created=1 → 302 localhost /app-settings/TFAKE0001/AFAKE12345/general
  /apps/<id>/general|oauth    302 → localhost /app-settings/TFAKE0001/<id>/general|oauth (real redirect · measured: Aside
                              browser history 10-28 · 11-03 · 11-06 ×2, and an existing app opened read-only on 11-06)
  localhost /app-settings/TFAKE0001/<id>/general   App Credentials (bait signing secret) · Generate Token and Scopes → dialog
                              (Token Name · Add Scope → connections:write · Generate → BAIT xapp- value + Copy + Done) ·
                              Show / Delete App bait buttons
  localhost /app-settings/TFAKE0001/<id>/oauth     not installed yet: «Install to Fake Workspace» as an <a aria-disabled>
                              with NO address (no link role) on EVERY load, no banner — the new app's real page (R2 3rd run
                              4 s · 4th run 4 / 21 / 38 s old, 2026-11-07 · Slack's code enables it only for a fetched status
                              «approved»). Installed: a BAIT xoxb- value + Copy + a «Reinstall to …» bait link.
  /apps/<id>/install-on-team  the old Install App page, on the api host (no redirect · measured 11-07 on an existing app,
                              history 10-24 · 10-28 · 11-03): «Install to Fake Workspace» → localhost
                              /oauth/v2/authorize?…install_redirect=install-on-team → Allow / Cancel → 127.0.0.1
                              /apps/<id>/install-on-team?code&state → ?success → the same page with a BAIT xoxb- value
                              (Bot User OAuth Token) + Copy + a «Reinstall to …» bait link. Allow goes back to the page the
                              install started from (install_redirect), like the real one.
                              Like the real page (its code · Aside cache 10-28 … 11-07): the button is live only when the
                              app status the page fetched ONCE at load is «approved»; the button element carries a React-like
                              fiber chain whose props hold appStatusData {appStatus …} next to appInfo.scopes and a BAIT
                              botToken (the real props carry the tokens too — the driver must copy out the status word only).
  AOTHER0001                  another app — the driver must never come here
Like the real site (measured 2026-11-06 on api.slack.com/apps): a HIDDEN cookie panel [role=dialog «Privacy Preference
Center»] comes before anything else (the real list page has it · here every page has it, the harder case), the create dialog is ONE persistent element
(.ReactModal__Content · role=alertdialog · a fixed id) whose content changes per step, and the review step does NOT show the
app name anywhere. A bait button, when clicked, calls GET /clicked/<name> (so the log shows it). The mode file holds one word, re-read on every
request: ok (status «approved» at once) · late (R2 5th run, 2026-11-07: a new app's status is not «approved» — greyed,
no address, no banner — until it is LATE_S seconds old · real: 4 / 20 / 37 s all greyed) · status-denied (status «denied» + the
page's «… has denied your request …» line) · status-pending (status «pending»: only a greyed «Request to Workspace Install
Submitted» button) · login (no Create New App, a «sign in» link) · approval (consent shows «Request to Install», no Allow) ·
status-slow (the Install App page's FIRST load stays greyed with the «error … loading app status … reload» banner, later
loads go live) · status-never (Install App page always greyed, no banner, but WITH its address and a click that does nothing
— the Link when the install address is known and the status is not «approved») · status-error (Install App page always
greyed, no address, with the banner) · token-elsewhere (the Install App page after the install shows no token; the oauth page
does).
Stops when the file «<mode file>.stop» appears.
"""
import http.server
import json
import os
import sys
import time

PORT_FILE, LOG_FILE, MODE_FILE = sys.argv[1:4]
APP_TOKEN = 'xa' + 'pp-1-AFAKE12345-0000000000000-BAITAPPTOKENBAITAPPTOKENBAITAPPTOKEN0123456789'   # split: the trace scan must not see a token shape
BOT_TOKEN = 'xo' + 'xb-0000000000-1111111111111-BAITBOTTOKENBAITBOT01'
SIGNING = 'BAITSIGNINGSECRETBAITSIGNING0001'
INSTALLED = {'AFAKE12345': False}
INSTALL_LOADS = {}   # Install App page loads of a not-yet-installed app since it was made
CREATED_AT = {}   # when «?created=1» was served (the app's age = now − this)
LATE_S = 8   # mode «late»: the status turns «approved» this many seconds after the app was made
BOT_SCOPES = ['chat:write', 'reactions:write', 'app_mentions:read', 'im:history', 'im:read', 'channels:history', 'groups:history', 'files:read']


def mode():
    try:
        with open(MODE_FILE, encoding='utf-8') as f:
            return f.read().strip() or 'ok'
    except OSError:
        return 'ok'


COOKIE = ('<div id="onetrust-consent-sdk"><div id="onetrust-pc-sdk" class="otPcCenter" role="dialog" '
          'aria-label="Privacy Preference Center" style="display:none"><h2>Privacy Preference Center</h2><p>We use three kinds of '
          'cookies on our websites: required, functional, and advertising.</p><button>Confirm My Choices</button></div></div>')

BAIT_JS = """
function bait(name) { fetch('/clicked/' + encodeURIComponent(name)); }
"""

LIST = """<!doctype html><html><head><title>Your Apps</title></head><body>%(cookie)s
<h1>Your Apps</h1>
%(top)s
<table><tr><td><a href="/apps/AOTHER0001/general">Someone else's app</a></td><td>AOTHER0001</td></tr></table>
<div id="modal"></div>
<script>
%(bait)s
var M = document.getElementById('modal');
function dialog(inner) {   // one element for every step (like the real site), only its content changes
  var d = document.getElementById('573e28dd-0000-4000-8000-00000000c0de');
  if (!d) { d = document.createElement('div'); d.id = '573e28dd-0000-4000-8000-00000000c0de'; d.className = 'ReactModal__Content ReactModal__Content--after-open c-sk-modal'; d.setAttribute('role', 'alertdialog'); M.appendChild(d); }
  d.innerHTML = inner;
}
function closeD() { M.innerHTML = ''; }
function step1() {
  dialog('<h2>Create an app</h2><label><input type="radio" name="how" value="scratch">From scratch</label>' +
         '<label><input type="radio" name="how" value="manifest">Paste a manifest</label>' +
         '<button onclick="bait(\\'Cancel\\'); closeD()">Cancel</button><button id="cont">Continue</button>');
  document.getElementById('cont').onclick = function () {
    var r = document.querySelector('input[value=manifest]');
    if (r.checked) step2();
  };
}
function step2() {
  dialog('<h2>Enter app manifest below</h2><div class="CodeMirror"></div>' +
         '<label>Workspace <select id="ws" aria-label="Workspace"><option value="">Select a workspace</option>' +
         '<option value="T1">Fake Workspace</option></select></label><p id="err"></p>' +
         '<button onclick="bait(\\'Cancel\\'); closeD()">Cancel</button><button id="next">Next</button>');
  var el = document.querySelector('.CodeMirror');
  el.CodeMirror = { v: window.__man || '{"example": true}', setValue: function (x) { this.v = x; }, getValue: function () { return this.v; }, refresh: function () {} };
  document.getElementById('next').onclick = function () {
    if (!document.getElementById('ws').value) { document.getElementById('err').textContent = 'Pick a workspace'; return; }
    window.__man = el.CodeMirror.getValue();
    step3();
  };
}
function step3() {   // the real review screen names no app: only what it does
  dialog('<h2>Review your app</h2><h3>How it works</h3><p>What starts it</p><p>@mention or direct messages.</p>' +
         '<p>What it does</p><p>Reads direct messages, channel messages, or files.</p>' +
         '<button onclick="bait(\\'Back\\')">Back</button><button id="create">Create</button>');
  document.getElementById('create').onclick = function () { location.href = '/apps/AFAKE12345?created=1'; };
}
</script></body></html>"""

GENERAL = """<!doctype html><html><head><title>Basic Information</title></head><body>%(cookie)s
<nav><a href="%(api)s/apps/%(app)s/general">Basic Information</a> <a href="%(api)s/apps/%(app)s/oauth">OAuth &amp; Permissions</a>
<a href="%(api)s/apps/%(app)s/install-on-team">Install App</a></nav>
<h1>Basic Information</h1><h2>%(name)s</h2>
<h2>App Credentials</h2><p>App ID %(app)s</p><p>Signing Secret <span class="secret">%(signing)s</span>
<button onclick="bait('Show')">Show</button></p>
<h2>App-Level Tokens</h2><button id="gen">Generate Token and Scopes</button>
<h2>Delete App</h2><button onclick="bait('Delete App')">Delete App</button>
<div id="modal"></div>
<script>
%(bait)s
var M = document.getElementById('modal');
function tdialog(inner) {
  var d = document.getElementById('9b1f0a77-0000-4000-8000-0000000070cc');
  if (!d) { d = document.createElement('div'); d.id = '9b1f0a77-0000-4000-8000-0000000070cc'; d.className = 'ReactModal__Content ReactModal__Content--after-open c-sk-modal'; d.setAttribute('role', 'dialog'); M.appendChild(d); }
  d.innerHTML = inner;
}
document.getElementById('gen').onclick = function () {
  tdialog('<label>Token Name <input type="text" id="tn"></label> <button id="add">Add Scope</button><div id="opts"></div>' +
    '<p id="scopes"></p><button onclick="bait(\\'Cancel\\')">Cancel</button><button id="go">Generate</button>');
  document.getElementById('add').onclick = function () {
    document.getElementById('opts').innerHTML = '<div role="listbox"><div role="option" id="o1">connections:write</div>' +
      '<div role="option" id="o2">authorizations:read</div></div>';
    document.getElementById('o1').onclick = function () { document.getElementById('scopes').textContent = 'connections:write'; document.getElementById('opts').innerHTML = ''; };
    document.getElementById('o2').onclick = function () { bait('authorizations:read'); };
  };
  document.getElementById('go').onclick = function () {
    if (!document.getElementById('tn').value || document.getElementById('scopes').textContent !== 'connections:write') return;
    fetch('/made/app-token');
    tdialog('<h2>slackmod</h2>' +
      '<input type="text" readonly value="%(apptoken)s"> <button onclick="bait(\\'Copy\\')">Copy</button>' +
      '<button onclick="bait(\\'Revoke\\')">Revoke</button><button onclick="bait(\\'Done\\')">Done</button>');
  };
};
</script></body></html>"""

OAUTH = """<!doctype html><html><head><title>OAuth &amp; Permissions</title></head><body>%(cookie)s
<nav><a href="%(api)s/apps/%(app)s/install-on-team">Install App</a></nav>
<h1>OAuth &amp; Permissions</h1>
%(body)s
<script>%(bait)s</script></body></html>"""

CONSENT = """<!doctype html><html><head><title>Install</title></head><body>
<h1>SlackMod wants to access Fake Workspace</h1>
%(buttons)s
<script>%(bait)s</script></body></html>"""


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype='text/html; charset=utf-8', loc=None):
        data = body.encode('utf-8')
        self.send_response(code)
        if loc:
            self.send_header('Location', loc)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        port = self.server.server_address[1]
        path, _, query = self.path.partition('?')
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write('%s GET %s\n' % (host, path))
        m = mode()
        api, app_host = 'http://127.0.0.1:%d' % port, 'http://localhost:%d' % port
        if host == 'localhost':
            if path.startswith('/oauth'):
                if m == 'approval':
                    b = '<button onclick="bait(\'Request to Install\')">Request to Install</button>'
                else:
                    redir = 'install-on-team' if 'install_redirect=install-on-team' in query.split('&') else 'oauth'
                    b = ('<button onclick="bait(\'Cancel\')">Cancel</button>'
                         '<button onclick="location.href=\'%s/apps/AFAKE12345/%s?code=FAKECODE&amp;state=s1\'">Allow</button>' % (api, redir))
                return self.send(200, CONSENT % {'buttons': b, 'bait': BAIT_JS})
                # (Allow goes back to the page named by install_redirect: oauth or install-on-team)
            parts = path.split('/')   # /app-settings/<T>/<A>/<page>
            if len(parts) == 5 and parts[1] == 'app-settings' and parts[2] == 'TFAKE0001' and parts[4] in ('general', 'oauth'):
                app = parts[3]
                if parts[4] == 'general':
                    name = 'SlackMod research' if app == 'AFAKE12345' else "Someone else's app"
                    return self.send(200, GENERAL % {'app': app, 'name': name, 'signing': SIGNING, 'bait': BAIT_JS,
                                                     'apptoken': APP_TOKEN, 'cookie': COOKIE, 'api': api})
                if app == 'AFAKE12345' and INSTALLED['AFAKE12345']:
                    body = ('<h2>OAuth Tokens</h2><label>Bot User OAuth Token <input type="text" readonly value="%s"></label>'
                            '<button onclick="bait(\'Copy\')">Copy</button><a href="#" onclick="bait(\'Reinstall to Fake Workspace\'); '
                            'return false">Reinstall to Fake Workspace</a>' % BOT_TOKEN)
                else:   # the new app's real page: greyed on every load, no address, no banner (see the docstring)
                    body = ('<h2>OAuth Tokens</h2><p>OAuth Tokens will be automatically generated when you finish installing '
                            'your app to your workspace.</p>'
                            '<a id="inst" aria-disabled="true" class="c-link c-button c-button--primary c-button--disabled">'
                            '<span>Install to <b>Fake Workspace</b></span></a>')
                return self.send(200, OAUTH % {'body': body, 'bait': BAIT_JS, 'cookie': COOKIE, 'api': api, 'app': app})
            return self.send(404, 'no')
        if path in ('/apps', '/apps/'):
            top = ('<p>You need to <a href="/signin">sign in to your Slack account</a> to create an app.</p>' if m == 'login'
                   else '<button onclick="step1()">Create New App</button>')
            return self.send(200, LIST % {'top': top, 'bait': BAIT_JS, 'cookie': COOKIE})
        parts = path.split('/')   # /apps/<A>[/<page>]
        if len(parts) in (3, 4) and parts[1] == 'apps' and parts[2].startswith('A'):
            app, page = parts[2], (parts[3] if len(parts) == 4 else '')
            if page == '' and 'created=1' in query.split('&'):
                INSTALLED[app] = False   # a new app: not installed yet
                INSTALL_LOADS[app] = 0
                CREATED_AT[app] = time.time()
                page = 'general'
            if page in ('oauth', 'install-on-team') and query.startswith('code='):
                INSTALLED[app] = True
                return self.send(302, '', loc='/apps/%s/%s?success=1' % (app, page))
            if page == 'install-on-team':
                if app == 'AFAKE12345' and INSTALLED.get(app):
                    shown = '' if m == 'token-elsewhere' else (
                        '<label>Bot User OAuth Token <input type="text" readonly value="%s"></label>' % BOT_TOKEN)
                    body = ('<h2>OAuth Tokens</h2>%s<button onclick="bait(\'Copy\')">Copy</button><a href="#" '
                            'onclick="bait(\'Reinstall to Fake Workspace\'); return false">Reinstall to Fake Workspace</a>' % shown)
                else:
                    INSTALL_LOADS[app] = INSTALL_LOADS.get(app, 0) + 1
                    first = INSTALL_LOADS[app] == 1
                    age = time.time() - CREATED_AT.get(app, 0)
                    late = m == 'late' and age < LATE_S
                    stuck = (m in ('status-never', 'status-error', 'status-denied') or (m == 'status-slow' and first) or late)
                    banner = m == 'status-error' or (m == 'status-slow' and first)
                    status = {'status-denied': 'denied', 'status-pending': 'pending'}.get(m, '' if (stuck or banner) else 'approved')
                    consent = '%s/oauth/v2/authorize?client_id=1.2&amp;install_redirect=install-on-team' % app_host
                    if m == 'status-pending':
                        ctrl = ('<button id="inst" disabled class="c-button c-button--primary"><span>Request to Workspace Install '
                                'Submitted</span></button>')
                    elif not stuck:
                        ctrl = ('<a id="inst" href="%s" target="_self" class="c-link c-button c-button--primary"><span>Install to '
                                '<b>Fake Workspace</b></span></a>' % consent)
                    else:
                        ctrl = ('<a id="inst" aria-disabled="true" class="c-link c-button c-button--primary c-button--disabled"%s>'
                                '<span>Install to <b>Fake Workspace</b></span></a>'
                                % (' href="%s" onclick="return false;"' % consent if m == 'status-never' else ''))
                    # the props the real button's fiber chain carries (InstallToTeamButton: appStatusData · appInfo · tokens)
                    props = {'appStatusData': {'appStatus': status, 'userCanInstallApp': True, 'installUrl': consent if status else '',
                                               'allowlist': [], 'orgOnlyScopesBlockWorkspaceInstall': False, 'orgAppStatus': ''},
                             'appInfo': {'id': app, 'scopes': {'bot': BOT_SCOPES, 'user': []}}, 'botToken': BOT_TOKEN, 'userToken': ''}
                    fiber = ('<script>(function () { var e = document.getElementById("inst"); var top = {memoizedProps: %s, return: null};'
                             ' e["__reactFiber$fk01"] = {memoizedProps: {className: "c-button"}, return: {memoizedProps: {children: 1},'
                             ' return: top}}; })();</script>' % json.dumps(props))
                    body = ('<h2>Install App to Your Team</h2>'
                            + ('<div role="alert">An error occurred while loading app status: Error. Please reload the page to '
                               'try again.</div>' if banner else '')
                            + ('<div role="alert">Someone who manages apps on your workspace has denied your request to '
                               'workspace install this app.</div>' if m == 'status-denied' else '')
                            + ctrl + fiber)
                return self.send(200, OAUTH.replace('OAuth &amp; Permissions</title>', 'Install App</title>')
                                 .replace('<h1>OAuth &amp; Permissions</h1>', '<h1>Install App</h1>')
                                 % {'body': body, 'bait': BAIT_JS, 'cookie': COOKIE, 'api': api, 'app': app})
            if page in ('general', 'oauth'):
                return self.send(302, '', loc='%s/app-settings/TFAKE0001/%s/%s' % (app_host, app, page))
        if path.startswith('/clicked/') or path.startswith('/made/'):
            return self.send(204, '')
        return self.send(404, 'not here')


srv = http.server.HTTPServer(('127.0.0.1', 0), H)
srv.timeout = 0.5
with open(PORT_FILE + '.tmp', 'w') as f:
    f.write(str(srv.server_address[1]))
os.replace(PORT_FILE + '.tmp', PORT_FILE)
while not os.path.exists(MODE_FILE + '.stop'):
    srv.handle_request()
