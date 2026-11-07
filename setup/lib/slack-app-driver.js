// slack-app-driver.js — setup wizard helper: make ONE Slack app from the SlackMod manifest in the user's own browser and,
// when asked, also make its two tokens and hand them over SEALED (never as plain text). Composed and run by
// slack-app-auto.py inside «aside repl» (Playwright-style page API); the tests load it with a fake page and a local fake site.
//
//   open()       https://api.slack.com/apps · Create New App · Paste a manifest · Continue · manifest into the editor → STOP
//                («pick-workspace»): the person picks the workspace and presses Next.
//   waitReview() looks only (no clicks): has the person reached the review screen yet?
//   create()     the review sits in the SAME dialog that held exactly our manifest at the last look (the real review screen
//                names no app · measured 2026-11-06) → Create → reads only the address bar until the new app's page → STOP
//                («created»). Unless the run asked for keys ({keys: true}) the tab is forgotten right there.
//   keysApp()    (only when the wizard asks for keys) on OUR new app only: Generate Token and Scopes · name ·
//                connections:write · Generate → the xapp- value, sealed inside the page → «app-token».
//   installWait() (only when the wizard asks for keys · looks and reloads, never clicks) OUR app's Install App page, loaded
//                again every ~installWait until «Install to …» is live («install-ready») or this statement's time is up
//                («install-wait» · the wizard calls it again up to its own budget). Both Slack install pages draw «Install
//                to …» greyed unless the app status the page fetched ONCE at load is «approved» (their code · Aside cache
//                10-28 … 11-07), so only a new load can light it. On 9-10 new apps were «approved» at 5-45 s old; in 11 not
//                one of 7 loads under ~55 s was (R2 3rd·4th·5th run) and both 11 installs began at 146 s / 231 s (history).
//                Each load leaves one «age=status» word pair in the run's diagnosis (S.diag): the status word the page
//                fetched, copied out of the page's own React props (only that word — the same props hold the tokens).
//                Stops early only on a visible decision: status «denied» → «install-denied» · «pending» → «approval».
//   keysBot()    Install App page (api.slack.com/apps/<A>/install-on-team) · Install to … (only once it is live · up to 3
//                page loads) · Allow (consent page) → back on our app → the xoxb- value, sealed inside the page → «keys».
//                Not the new OAuth & Permissions page (same status rule; its token field is the second place to read).
//                (two calls because aside gives one statement 120 s · keys() = both, for tests) Sealed = XOR with a one-time pad the wizard made for this
//                run; the plain value never leaves the page, is never printed, never screenshotted.
// Fences:
//   - every click is one row of CLICKS, and only on the screen that row names («list» = the app list · «app-general» /
//     «app-oauth» / «app-install» = OUR new app's pages · «consent» = Slack's install consent page). DENY names are never
//     clicked.
//   - goes only to https://api.slack.com/apps and to OUR new app's general / oauth / install-on-team pages (no other app, no
//     other site).
//     Slack itself redirects an app's pages (and Create) to https://app.slack.com/app-settings/<team>/<app>/<page>
//     (measured 2026-11-06: R2 retry · Aside browser history 10-28 · 11-03 · 11-06 · an existing app opened read-only);
//     where() reads both forms as the same app page.
//   - reads only yes/no answers and counts, the create dialog's element id, the address bar, the two sealed values and the
//     Install App page's ONE status word (lower-case letters/_ only, else «other»); nothing else leaves the browser.
//   - «the dialog» = the one VISIBLE .ReactModal__Content (the real app list page keeps a hidden cookie panel [role=dialog]
//     ahead of the real dialog — a first-match «[role=dialog]» selector finds the cookie panel · measured 2026-11-06).
//   - after «created» (no keys) or «keys» the tab is forgotten: every later call answers «no-tab».
var SLACKMOD_APP = (function () {
  'use strict';
  var BASE = 'https://api.slack.com';
  var LIST_PATH = /^\/apps\/?$/;
  var APP_PATH = /^\/apps\/(A[A-Z0-9]{6,20})(?:\/([a-z-]+))?\/?$/;
  var APP_ORIGIN = 'https://app.slack.com';
  var SETTINGS_PATH = /^\/app-settings\/T[A-Z0-9]{6,20}\/(A[A-Z0-9]{6,20})(?:\/([a-z-]+))?\/?$/;
  var MODAL = '.ReactModal__Content';
  var INSTALL_LOADS = 3;   // × o.installWait (15 s) ≈ 50 s · keysBot stays inside aside's 120 s per statement
  var INSTALL_STEP = 80000;   // ms: one installWait statement at most (+ one last load ≤ ~35 s · inside aside's 120 s)
  var INSTALL_BUDGET = 300000;   // ms: keys() (tests) waits this long at most — the wizard keeps its own budget
  var LOAD_WAIT = 10000;   // ms: after goto, wait for the page's load at most this long (see go())
  var TOKEN_FALLBACK_BY = 80000;   // ms since keysBot began: later than this, no second page for the bot token (+ ≈20 s)
                                   // (o.tokenFallbackBy may only lower it · tests)
  var CLICKS = {
    create_new_app: { at: 'list', role: 'button', name: 'Create New App', exact: true },
    from_manifest: { at: 'list', role: 'radio', name: /paste a manifest/i, exact: false },
    continue: { at: 'list', role: 'button', name: 'Continue', exact: true },
    create: { at: 'list', role: 'button', name: 'Create', exact: true },
    gen_token: { at: 'app-general', role: 'button', name: 'Generate Token and Scopes', exact: true },
    add_scope: { at: 'app-general', role: 'button', name: 'Add Scope', exact: true },
    scope_cw: { at: 'app-general', role: 'option', name: /^connections:write/, exact: false },
    generate: { at: 'app-general', role: 'button', name: 'Generate', exact: true },
    install_btn: { at: 'app-install', role: 'button', name: /^Install to /, exact: false },
    install_link: { at: 'app-install', role: 'link', name: /^Install to /, exact: false },
    allow: { at: 'consent', role: 'button', name: /^(Allow|허용)$/, exact: false }
  };
  var FILLS = { token_name: { at: 'app-general', role: 'textbox', name: /Token Name/, value: 'slackmod' } };
  // never clicked, whatever the table above says (second fence · checked on the table name AND on the control's own text)
  var DENY = /show|copy|revoke|regenerate|reinstall|delete|remove|request|credential|secret|cancel|삭제|복사|요청|취소|재설치/i;
  var TOKEN = { app: '^xapp-[0-9A-Za-z-]{20,250}$', bot: '^xoxb-[0-9A-Za-z-]{20,250}$' };
  var S = { page: null, app: null, seen: null, made: 0, diag: [], loadErr: false };   // seen = {id, ours}: the manifest dialog
                                    // at the last look · made = when our app page came up · diag = «age=status» · loadErr: see go()

  function res(state, extra) {
    var r = { state: state };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] != null) r[k] = extra[k];
    return r;
  }
  function parse(url) {
    try { var u = new URL(url); return { origin: u.origin, host: u.hostname, path: u.pathname }; } catch (e) { return null; }
  }
  function opts(o) {
    o = o || {};
    var base = String(o.base || BASE).replace(/\/+$/, '');
    var b = parse(base), a = parse(String(o.appOrigin || APP_ORIGIN));
    return { base: base, origin: b ? b.origin : '', appOrigin: a ? a.origin : '', consentHost: String(o.consentHost || 'slack.com'),
      manifest: String(o.manifest || ''), appName: String(o.appName || ''),
      padApp: String(o.padApp || ''), padBot: String(o.padBot || ''), keys: o.keys === true,
      installWait: Math.max(500, Math.min(20000, Number(o.installWait) || 15000)),
      installBudget: Math.max(0, Math.min(INSTALL_BUDGET, Number(o.installBudget) || INSTALL_BUDGET)),
      tokenFallbackBy: o.tokenFallbackBy == null ? TOKEN_FALLBACK_BY : Math.max(0, Math.min(TOKEN_FALLBACK_BY, Number(o.tokenFallbackBy) || 0)) };
  }
  var PAGES = { general: 'app-general', oauth: 'app-oauth', 'install-on-team': 'app-install' };
  function pageAt(p) { return Object.prototype.hasOwnProperty.call(PAGES, p || '') ? PAGES[p] : 'app-other'; }
  // where(page, o) → {at: 'list' | 'app-general' | 'app-oauth' | 'app-install' | 'app-other' | 'consent' | 'other', app}
  function where(page, o) {
    var u = parse(page.url());
    if (!u) return { at: 'other' };
    if (u.origin === o.origin) {
      if (LIST_PATH.test(u.path)) return { at: 'list' };
      var m = APP_PATH.exec(u.path);
      if (m) return { at: pageAt(m[2]), app: m[1] };
      return { at: 'other' };
    }
    if (u.origin === o.appOrigin) {   // the same app pages after Slack's redirect (falls through for any other path)
      var s = SETTINGS_PATH.exec(u.path);
      if (s) return { at: pageAt(s[2]), app: s[1] };
    }
    var ch = o.consentHost;
    if ((u.host === ch || u.host.slice(-(ch.length + 1)) === '.' + ch) && /^\/oauth(\/|$)/.test(u.path)) return { at: 'consent' };
    return { at: 'other' };
  }
  function label(spec) { return typeof spec.name === 'string' ? spec.name : String(spec.name.source); }
  function specOk(table, key) {
    if (!Object.prototype.hasOwnProperty.call(table, key)) return null;
    var spec = table[key];
    return DENY.test(label(spec)) ? null : spec;
  }
  function atOk(page, o, spec) {
    var w = where(page, o);
    if (w.at !== spec.at) return false;
    if (spec.at === 'app-general' || spec.at === 'app-oauth' || spec.at === 'app-install') return !!S.app && w.app === S.app;
    return true;
  }
  async function click(page, o, key) {
    var spec = specOk(CLICKS, key);
    if (!spec) throw new Error('refused: ' + String(key).slice(0, 40));
    if (!atOk(page, o, spec)) throw new Error('refused: wrong screen for ' + key);
    var loc = page.getByRole(spec.role, { name: spec.name, exact: spec.exact });
    if ((await loc.count()) !== 1) return false;
    var text = String((await loc.first().textContent()) || '');
    if (DENY.test(text)) throw new Error('refused: ' + key);
    await loc.first().click();
    return true;
  }
  async function fill(page, o, key) {
    var spec = specOk(FILLS, key);
    if (!spec || !atOk(page, o, spec)) throw new Error('refused: ' + String(key).slice(0, 40));
    var loc = page.getByRole(spec.role, { name: spec.name });
    if ((await loc.count()) !== 1) return false;
    await loc.first().fill(spec.value);
    return true;
  }
  // only four places, and the three app pages only for the app this run made
  var GO = { general: 'general', oauth: 'oauth', install: 'install-on-team' };
  // aside (1.26.1104 · read-only pairs on a real Slack app page 2026-11-07): after page.goto() in the same tab the ROLE query
  // (getByRole) keeps answering from the page it left — 0 links in 10/10 trials of up to ~44 s of polling while the DOM holds
  // all of them (once it came back after other page calls, trigger unknown) — while with page.waitForLoadState() after the
  // goto the page was there in ~2 s, 11/11 (install · oauth · general). The R2 6th run (and, by inference, 3rd–5th) stopped on
  // this («install» · «install-greyed» with status «approved» on all 19 loads). So every navigation (all go through here)
  // waits for the load, at most loadMs (default LOAD_WAIT), never throws for it (S.loadErr = it gave up · diagnosis «t»),
  // and returns when goto() came back, so a caller can keep its own watch window.
  async function go(page, o, which, loadMs) {
    var path = which === 'list' ? '/apps' : (S.app && Object.prototype.hasOwnProperty.call(GO, which)) ? '/apps/' + S.app + '/' + GO[which] : null;
    if (!path) throw new Error('refused: go ' + String(which).slice(0, 20));
    await page.goto(o.base + path);
    var t = Date.now();
    S.loadErr = false;
    if (typeof page.waitForLoadState === 'function') {
      var ms = Math.max(1, Math.min(LOAD_WAIT, loadMs == null ? LOAD_WAIT : Number(loadMs) || 1));
      try { await page.waitForLoadState('load', { timeout: ms }); } catch (e) { S.loadErr = true; }
    }
    return t;
  }
  function consentHref(h, o) {   // the address is tested, never read out
    var u = parse(String(h || '')), ch = o.consentHost;
    return !!u && (u.host === ch || u.host.slice(-(ch.length + 1)) === '.' + ch) && /^\/oauth\/v2\/authorize\/?$/.test(u.path);
  }
  // an install control the person could press NOW: visible · enabled · not aria-disabled · a link only when it points at
  // Slack's consent page
  async function live(page, o, role, name) {
    var loc = page.getByRole(role, { name: name, exact: false });
    if ((await loc.count()) < 1) return false;
    var f = loc.first();
    if (!(await f.isVisible()) || !(await f.isEnabled()) || (await f.getAttribute('aria-disabled')) === 'true') return false;
    if (role !== 'link') return true;
    return consentHref(await f.getAttribute('href'), o);
  }
  // after a load that was not live, on a page whose install control is a link with an address or a button (lk.roleable):
  // «b» = the role query sees no install control at all (the tool, not Slack) · «h» = it sees a pressable link whose
  // address is not the consent page · else nothing
  async function roleWhy(page, o) {
    var re = /^((Re)?[Ii]nstall to |Request to (Workspace |Org )?Install)/;   // the same controls installLook finds
    var ln = page.getByRole('link', { name: re, exact: false });
    var nl = await ln.count(), nb = await page.getByRole('button', { name: re, exact: false }).count();
    if (nl + nb < 1) return 'b';
    if (nl < 1) return '';
    var f = ln.first();
    if (!(await f.isVisible()) || (await f.getAttribute('aria-disabled')) === 'true') return '';
    return consentHref(await f.getAttribute('href'), o) ? '' : 'h';
  }
  async function seen(page, role, name, exact) {
    var loc = page.getByRole(role, { name: name, exact: !!exact });
    var n = await loc.count();
    return n >= 1 && (await loc.first().isVisible());
  }
  async function poll(io, fn, ms, step) {
    var end = Date.now() + ms;
    for (;;) {
      var v = await fn();
      if (v) return v;
      if (Date.now() >= end) return null;
      await io.sleep(step || 500);
    }
  }
  // the one visible dialog: count · element id · has our editor · holds EXACTLY our manifest · Create buttons in it
  function look(page, o) {
    return page.evaluate(function (a) {
      var ms = [].filter.call(document.querySelectorAll(a.m), function (e) {
        var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      });
      var out = { n: ms.length, id: '', editor: false, ours: false, creates: 0 };
      if (ms.length !== 1) return out;
      var cm = ms[0].querySelector('.CodeMirror');
      out.id = String(ms[0].id || '');
      out.editor = !!(cm && cm.CodeMirror);
      out.ours = out.editor && cm.CodeMirror.getValue() === a.v;
      out.creates = [].filter.call(ms[0].querySelectorAll('button'), function (b) { return (b.textContent || '').trim() === 'Create'; }).length;
      return out;
    }, { m: MODAL, v: o.manifest });
  }
  // may Create be pressed? the review is in the same dialog that held exactly our manifest at the last look, and only it
  async function reviewOk(page, o) {
    var l = await look(page, o);
    return !!(S.seen && S.seen.ours && S.seen.id && l.n === 1 && l.id === S.seen.id && !l.editor && l.creates === 1);
  }
  async function editorReady(page) {
    return await page.evaluate(function () { var el = document.querySelector('.CodeMirror'); return !!(el && el.CodeMirror); });
  }
  // runs INSIDE the page: find one value of the token shape (fields first, then text) and return it XOR-ed with the pad
  // as hex — or null. The plain value is never returned.
  function sealIn(page, inModal, re, pad) {
    return page.evaluate(function (a) {
      var rx = new RegExp(a.re), root = document.body;
      if (a.m) {   // only inside the one visible dialog
        var ms = [].filter.call(document.querySelectorAll(a.m), function (e) {
          var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        });
        root = ms.length === 1 ? ms[0] : null;
      }
      if (!root) return null;
      var found = null, i;
      var fields = root.querySelectorAll('input, textarea');
      for (i = 0; i < fields.length && !found; i++) { var v = (fields[i].value || '').trim(); if (rx.test(v)) found = v; }
      if (!found) {
        var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (!found && w.nextNode()) { var t = (w.currentNode.nodeValue || '').trim(); if (rx.test(t)) found = t; }
      }
      if (!found || found.length * 2 > a.pad.length) return null;
      var out = '';
      for (i = 0; i < found.length; i++) {
        var x = found.charCodeAt(i) ^ parseInt(a.pad.substr(i * 2, 2), 16);
        out += (x < 16 ? '0' : '') + x.toString(16);
      }
      found = null;
      return out;
    }, { m: inModal ? MODAL : '', re: re, pad: pad });
  }

  async function open(io, o0) {
    var o = opts(o0);
    if (!o.manifest || !o.appName) return res('fallback', { reason: 'no-manifest' });
    S.page = null; S.app = null; S.seen = null;
    var page = await io.openTab(o.base + '/apps');
    await io.sleep(1500);
    if (where(page, o).at !== 'list') return res('login', { reason: 'not-app-list' });
    var btn = await poll(io, function () { return seen(page, 'button', CLICKS.create_new_app.name, true); }, 15000);
    if (!btn) {
      var signin = (await page.getByRole('link', { name: /sign in/i }).count()) + (await page.getByRole('button', { name: /sign in/i }).count());
      return res(signin > 0 ? 'login' : 'fallback', { reason: signin > 0 ? 'sign-in' : 'no-create-button' });
    }
    if (!(await click(page, o, 'create_new_app'))) return res('fallback', { reason: 'create-new-app' });
    var radio = await poll(io, function () { return seen(page, 'radio', CLICKS.from_manifest.name, false); }, 10000);
    if (!radio || !(await click(page, o, 'from_manifest'))) return res('fallback', { reason: 'from-manifest' });
    if (!(await click(page, o, 'continue'))) return res('fallback', { reason: 'continue' });
    if (!(await poll(io, function () { return editorReady(page); }, 10000))) return res('fallback', { reason: 'editor' });
    var put = await page.evaluate(function (m) {
      var cm = document.querySelector('.CodeMirror').CodeMirror;
      cm.setValue(m); cm.refresh();
      return cm.getValue() === m;
    }, o.manifest);
    if (!put) return res('fallback', { reason: 'editor-value' });
    var l = await look(page, o);
    if (!l.ours || !l.id) return res('fallback', { reason: 'editor-dialog' });
    S.seen = { id: l.id, ours: true };
    S.page = page;
    return res('pick-workspace');
  }

  // looks only: 'review' (the person pressed Next) · 'waiting' · 'created' (the person pressed Create) · 'cancelled' · …
  async function waitReview(io, o0, ms) {
    var o = opts(o0), page = S.page, shut = 0;
    if (!page) return res('fallback', { reason: 'no-tab' });
    var r = await poll(io, async function () {
      var w;
      try { w = where(page, o); } catch (e) { S.page = null; return res('fallback', { reason: 'tab-closed' }); }
      if (w.app && w.at !== 'list') {
        // the person pressed Create (or went somewhere else): only OUR app's page counts — its name must be on the page
        var ours = await page.evaluate(function (n) {
          return [].slice.call(document.querySelectorAll('h1, h2, a, span')).some(function (e) { return (e.textContent || '').trim() === n; });
        }, o.appName);
        if (!ours) { S.page = null; S.app = null; return res('fallback', { reason: 'not-our-app' }); }
        if (o.keys) S.app = w.app; else { S.page = null; S.app = null; }
        S.made = Date.now(); S.diag = [];
        return res('created', { app: w.app, by: 'person' });
      }
      if (w.at !== 'list') { S.page = null; return res('fallback', { reason: 'moved' }); }
      var l = await look(page, o);
      if (l.editor) S.seen = { id: l.id, ours: l.ours };   // still the manifest step: which dialog · exactly our manifest?
      if (await seen(page, 'button', CLICKS.create.name, true)) return res('review');
      shut = l.n > 0 ? 0 : shut + 1;   // no visible dialog twice in a row (a dialog redrawing between steps is not a cancel)
      if (shut >= 2) { S.page = null; return res('cancelled'); }
      return null;
    }, Math.max(0, ms || 0), 1000);
    return r || res('waiting');
  }

  async function create(io, o0) {
    var o = opts(o0), page = S.page;
    if (!page) return res('fallback', { reason: 'no-tab' });
    if (where(page, o).at !== 'list') return res('fallback', { reason: 'moved' });
    if (!(await reviewOk(page, o))) return res('fallback', { reason: 'review-modal' });
    if (!(await click(page, o, 'create'))) return res('fallback', { reason: 'create' });
    // from here on: the address bar only
    var app = await poll(io, function () { var w = where(page, o); return w.app && w.at !== 'list' ? w.app : null; }, 30000);
    if (!app) { S.page = null; return res('fallback', { reason: 'no-app-page' }); }
    if (o.keys) S.app = app; else { S.page = null; S.app = null; }   // no keys asked: forget the tab right here
    S.made = Date.now(); S.diag = [];
    return res('created', { app: app, by: 'wizard' });
  }

  function keysReady(o) {
    if (!S.page || !S.app || !o.keys) return res('fallback', { reason: 'no-tab' });
    if (!/^[0-9a-f]{512,}$/.test(o.padApp) || !/^[0-9a-f]{512,}$/.test(o.padBot) || o.padApp === o.padBot) {
      var app = S.app; S.page = null; S.app = null;
      return res('fallback', { reason: 'no-pad', app: app });
    }
    return null;
  }
  function stopper(app) {
    return function (reason, state) {
      var d = diagStr(); S.page = null; S.app = null;
      return res(state || 'fallback', { reason: reason, app: app, diag: d || null });
    };
  }
  // the run's diagnosis: one «age=status[+flags]» word per Install App page load (age = seconds from our app page coming up to
  // this load's start)
  var DIAG_MAX = 24;
  function diagStr() {
    var d = S.diag || [];
    return (d.length > DIAG_MAX ? 'more' + (d.length - DIAG_MAX) + ',' : '') + d.slice(-DIAG_MAX).join(',');
  }
  function note(lk, at) {   // at = when the page was opened (its status is fetched then), not when it was read
    var age = S.made ? String(Math.max(0, Math.round(((at || Date.now()) - S.made) / 1000))) : 'x';
    var fl = (lk.loaderr ? 'e' : '') + (lk.denied ? 'd' : '') + (lk.request ? 'r' : '') + (lk.noscope ? 's' : '') + (lk.admin ? 'a' : '')
      + (lk.why === 'b' || lk.why === 'h' ? lk.why : '') + (lk.loadErr ? 't' : '');
    S.diag.push(age + '=' + lk.st + (fl ? '+' + fl : ''));
  }
  // READ ONLY · runs inside the page: the Install App page's state, as ONE status word + five yes/no (four lines of the page's
  // own text · «request» = a control that says «Request to … Install»). The word is the app status the page fetched at load (Slack's InstallToTeamButton props appStatusData.appStatus),
  // found on the install control's React fiber chain. Those props also hold the tokens: only the word is copied out —
  // lower-case letters/_ (≤24), «empty» for "", else «other»; «no-button» / «no-fiber» / «no-data» when it is not there.
  function installLook(page) {
    return page.evaluate(function () {
      var word = function (s) { return typeof s === 'string' ? (s === '' ? 'empty' : (/^[a-z_]{1,24}$/.test(s) ? s : 'other')) : (s === undefined ? 'none' : 'other'); };
      var body = document.body ? String(document.body.innerText || document.body.textContent || '') : '';
      var ctls = document.querySelectorAll('a, button');
      var out = { st: 'no-button', loaderr: /error occurred while loading/i.test(body), denied: /has denied your request/i.test(body),
        request: [].some.call(ctls, function (e) { return /^Request to (Workspace |Org )?Install/.test((e.textContent || '').trim()); }),
        noscope: /Add at least one permission scope/i.test(body), admin: /contact an administrator/i.test(body) };
      var els = [].filter.call(ctls, function (e) {
        return /^((Re)?[Ii]nstall to |Request to (Workspace |Org )?Install)/.test((e.textContent || '').trim());
      });
      if (!els.length) return out;
      var el = els[0], fk = null;
      out.roleable = el.tagName === 'BUTTON' || el.hasAttribute('href');   // has a role the driver's role query can see
      for (var k in el) if (k.indexOf('__reactFiber$') === 0) { fk = k; break; }
      out.st = fk ? 'no-data' : 'no-fiber';
      for (var f = fk ? el[fk] : null, i = 0; f && i < 60; i++, f = f.return) {
        var p = f.memoizedProps;
        if (p && typeof p === 'object' && p.appStatusData && typeof p.appStatusData === 'object') { out.st = word(p.appStatusData.appStatus); break; }
      }
      return out;
    });
  }
  // a visible decision that waiting will not change: someone denied it · a request is pending / must be sent
  function decided(lk) {
    if (lk.st === 'denied' || lk.denied) return ['install-denied', null];
    if (lk.st === 'pending') return ['install-pending', 'approval'];
    if (lk.request && lk.st !== 'approved') return ['install-request', 'approval'];
    return null;
  }
  async function greyWhy(page) {   // which of three (counts only) — the receipt says it
    if ((await page.getByText(/error occurred while loading/i).count()) > 0) return 'install-status-error';
    return (await page.getByText(/^Install to /).count()) > 0 ? 'install-greyed' : 'install';
  }
  // one load of OUR app's Install App page: a live install control within o.installWait, or not · then what the page says
  // (a load that throws — a navigation race, a goto time-out — is noted «goto-error» and counts as not live: the run's
  // diagnosis must survive it, it is what the next receipt is for)
  async function installLoad(io, page, o) {
    var how = null, lk = { st: 'off-page' }, at = Date.now(), loadErr = false;
    try {
      var tg = await go(page, o, 'install', o.installWait);   // the load wait counts inside the watch window
      loadErr = S.loadErr;
      how = await poll(io, async function () {
        if (await live(page, o, 'button', CLICKS.install_btn.name)) return 'install_btn';
        if (await live(page, o, 'link', CLICKS.install_link.name)) return 'install_link';
        return null;
      }, Math.max(0, o.installWait - (Date.now() - tg)));
    } catch (e) {
      note({ st: 'goto-error' }, at);
      return { how: null, look: { st: 'goto-error' } };
    }
    var w = where(page, o);
    if (w.at === 'app-install' && w.app === S.app) {
      try { lk = await installLook(page); } catch (e) { lk = { st: 'look-error' }; }
      if (!how && lk.roleable) { try { lk.why = await roleWhy(page, o); } catch (e) { lk.why = ''; } }
    }
    lk.loadErr = loadErr;
    note(lk, at);
    return { how: how, look: lk };
  }
  // back on our app after the consent page: its install page or its oauth page, nothing else
  function home(page, o, app) { var w = where(page, o); return (w.at === 'app-install' || w.at === 'app-oauth') && w.app === app; }
  // a token is read only while the tab is on the page that should show it (our app · that page)
  function sealOn(page, o, at, inModal, re, pad) {
    var w = where(page, o);
    if (w.at !== at || w.app !== S.app) return Promise.resolve(null);
    return sealIn(page, inModal, re, pad);
  }

  async function keysApp(io, o0) {
    var o = opts(o0), bad = keysReady(o);
    if (bad) return bad;
    var page = S.page, app = S.app, stop = stopper(app);
    // 1. app-level token (Basic Information)
    if (where(page, o).at !== 'app-general') await go(page, o, 'general');
    if (!(await poll(io, function () { return seen(page, 'button', CLICKS.gen_token.name, true); }, 15000))) return stop('gen-token');
    if (!(await click(page, o, 'gen_token'))) return stop('gen-token');
    if (!(await poll(io, function () { return seen(page, 'textbox', FILLS.token_name.name, false); }, 10000))) return stop('token-name');
    if (!(await fill(page, o, 'token_name'))) return stop('token-name');
    if (!(await click(page, o, 'add_scope'))) return stop('add-scope');
    if (!(await poll(io, function () { return seen(page, 'option', CLICKS.scope_cw.name, false); }, 10000))) return stop('scope');
    if (!(await click(page, o, 'scope_cw'))) return stop('scope');
    if (!(await click(page, o, 'generate'))) return stop('generate');
    var sealedApp = await poll(io, function () { return sealOn(page, o, 'app-general', true, TOKEN.app, o.padApp); }, 15000);
    if (!sealedApp) return stop('app-token');
    return res('app-token', { app: app, app_sealed: sealedApp });
  }

  async function keysBot(io, o0) {
    var o = opts(o0), bad = keysReady(o);
    if (bad) return bad;
    var page = S.page, app = S.app, stop = stopper(app), t0 = Date.now();
    // 2. install (Install App page → consent → back) · up to INSTALL_LOADS loads (after installWait said «install-ready» the
    // first one is live) · only a LIVE control · a visible decision (denied / pending) stops at once
    var how = null;
    for (var n = 0; n < INSTALL_LOADS && !how; n++) {
      var l = await installLoad(io, page, o);
      how = l.how;
      var dec = how ? null : decided(l.look);
      if (dec) return stop(dec[0], dec[1]);
    }
    if (!how) return stop(await greyWhy(page));
    if (!(await click(page, o, how))) return stop('install-click');
    var at = await poll(io, function () { return where(page, o).at === 'consent' ? 'consent' : null; }, 30000);
    if (at === 'consent') {
      // came by a click, not go(): a click-led page change kept the role query working in the real runs (Create → the app's
      // settings page, R2 3rd–6th), but this page is never seen before a run — re-sync it the same way (cheap, inside the 15 s)
      var tc = Date.now();
      if (page.waitForLoadState) { try { await page.waitForLoadState('load', { timeout: 10000 }); } catch (e) { /* the poll below says */ } }
      var allow = await poll(io, function () { return seen(page, 'button', CLICKS.allow.name, false); }, Math.max(0, 15000 - (Date.now() - tc)));
      if (!allow) {
        var req = await page.getByRole('button', { name: /request|요청/i }).count();
        return stop(req > 0 ? 'admin-approval' : 'consent', req > 0 ? 'approval' : null);
      }
      if (!(await click(page, o, 'allow'))) return stop('allow');
      if (!(await poll(io, function () { return home(page, o, app); }, 30000))) return stop('after-allow');
    } else if (!home(page, o, app)) {
      return stop('consent');   // no consent page in 30 s: only fine if we are back on our app's install / oauth page already
    }
    // Slack returns to the page the install started from (install-on-team?success · history 09-24 … 11-03): read the token
    // there; if that page does not show it, the OAuth & Permissions page does (an <input> «… token field» · its code) —
    // only while this statement still has time (aside gives one statement 120 s)
    var here = where(page, o).at;
    var sealedBot = await poll(io, function () { return sealOn(page, o, here, false, TOKEN.bot, o.padBot); }, 15000);
    if (!sealedBot && here !== 'app-oauth' && Date.now() - t0 < o.tokenFallbackBy) {
      var tg = await go(page, o, 'oauth', 15000);   // the load wait counts inside the 15 s
      sealedBot = await poll(io, function () { return sealOn(page, o, 'app-oauth', false, TOKEN.bot, o.padBot); }, Math.max(0, 15000 - (Date.now() - tg)));
    }
    if (!sealedBot) return stop('bot-token');
    var dg = diagStr();
    S.page = null; S.app = null;
    return res('keys', { app: app, bot_sealed: sealedBot, diag: dg || null });
  }

  // looks and reloads only (no click): OUR app's Install App page until «Install to …» is live («install-ready») or about ms
  // have gone («install-wait» + the reason it would stop with now) · at least one load · ms ≤ INSTALL_STEP
  async function installWait(io, o0, ms) {
    var o = opts(o0), bad = keysReady(o);
    if (bad) return bad;
    var page = S.page, app = S.app, stop = stopper(app), t0 = Date.now();
    var step = Math.max(0, Math.min(INSTALL_STEP, Number(ms) || 0));
    for (;;) {
      var l = await installLoad(io, page, o);
      if (l.how) return res('install-ready', { app: app, diag: diagStr() });
      var dec = decided(l.look);
      if (dec) return stop(dec[0], dec[1]);
      if (Date.now() - t0 + o.installWait + 2000 > step) break;
    }
    return res('install-wait', { app: app, reason: await greyWhy(page), diag: diagStr() });
  }

  async function keys(io, o0) {   // all in one call (tests · the wizard calls keysApp · installWait … · keysBot itself)
    var a = await keysApp(io, o0);
    if (a.state !== 'app-token') return a;
    var o = opts(o0), t0 = Date.now(), w;
    do { w = await installWait(io, o0, Math.min(INSTALL_STEP, Math.max(0, o.installBudget - (Date.now() - t0)))); }
    while (w.state === 'install-wait' && Date.now() - t0 < o.installBudget);
    if (w.state === 'install-wait') return stopper(w.app)(w.reason || 'install-greyed');
    if (w.state !== 'install-ready') return w;
    var b = await keysBot(io, o0);
    if (b.state !== 'keys') return b;
    return res('keys', { app: b.app, app_sealed: a.app_sealed, bot_sealed: b.bot_sealed, diag: b.diag });
  }

  function forget() { S.page = null; S.app = null; S.seen = null; return res('forgotten'); }

  return { open: open, waitReview: waitReview, create: create, keysApp: keysApp, installWait: installWait, keysBot: keysBot, keys: keys, forget: forget,
    _test: { CLICKS: CLICKS, FILLS: FILLS, DENY: DENY, TOKEN: TOKEN, where: where, click: click, fill: fill, go: go, live: live, roleWhy: roleWhy, specOk: specOk, opts: opts, S: S, home: home,
      installLook: installLook, installLoad: installLoad, decided: decided, diagStr: diagStr,
      reviewOk: function (o0) { return S.page ? reviewOk(S.page, opts(o0)) : Promise.resolve(false); } } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SLACKMOD_APP;
