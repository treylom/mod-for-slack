// slack-app-driver-test.js — the wizard's browser step (setup/lib/slack-app-driver.js) against a LOCAL fake Slack site
// (fake-slack-apps-server.py) in a real headless Chromium (Playwright from this machine's cache · no network).
//   node slack-app-driver-test.js <playwright module dir> <base url> <log file> <mode file>
// Prints PASS/FAIL lines (and SKIP when the browser cannot start). The person's own steps (pick the workspace · Next) are
// played by this test between the driver's calls.
'use strict';
const path = require('path');
const fs = require('fs');
const [PW, BASE, LOG, MODE] = process.argv.slice(2);
const D = require(path.join(__dirname, '..', 'lib', 'slack-app-driver.js'));
const APP_TOKEN = 'xa' + 'pp-1-AFAKE12345-0000000000000-BAITAPPTOKENBAITAPPTOKENBAITAPPTOKEN0123456789';   // split: the trace scan must not see a token shape
const BOT_TOKEN = 'xo' + 'xb-0000000000-1111111111111-BAITBOTTOKENBAITBOT01';
let fails = 0;
const ok = (c, m) => { if (c) console.log('PASS ' + m); else { fails++; console.log('FAIL ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
const setMode = m => fs.writeFileSync(MODE, m + '\n');
const pad = () => require('crypto').randomBytes(256).toString('hex');
const unseal = (hex, p) => { const b = Buffer.from(hex, 'hex'), k = Buffer.from(p, 'hex'); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i] ^ k[i]); return s; };
const manifest = JSON.stringify({ display_information: { name: 'SlackMod research' }, features: { bot_user: { display_name: 'research' } } }, null, 2);

// a page wrapper that records which page methods the driver calls (to prove «after Create: the address bar only»)
function recorder(page) {
  const calls = [];
  const p = new Proxy(page, { get(t, k) { const v = t[k]; if (typeof v !== 'function') return v; return function (...a) { calls.push(String(k)); return v.apply(t, a); }; } });
  return { p, calls };
}
// a page that answers like aside's (1.26.1104 · read-only pairs on a real Slack app page 2026-11-07, ro11–ro16): after goto() or
// reload() in the same tab the ROLE query (getByRole) answers from the page it left — 0 matches for ≥44 s of polling, while the
// DOM (locator · getByText · evaluate) is fine — until waitForLoadState() is called. A fresh tab (openTab) is fine.
function asideLike(page) {
  let stale = false;
  return new Proxy(page, { get(t, k) {
    const v = t[k];
    if (typeof v !== 'function') return v;
    if (k === 'goto' || k === 'reload') return async function (...a) { const r = await v.apply(t, a); stale = true; return r; };
    if (k === 'waitForLoadState') return async function (...a) { const r = await v.apply(t, a); stale = false; return r; };
    if (k === 'getByRole') return function (...a) { return stale ? t.locator('aside-stale-role-tree-matches-nothing') : v.apply(t, a); };
    return v.bind(t);
  } });
}

(async () => {
  let pw, browser;
  let why = 'no Playwright copy';
  for (const cand of String(PW).split(':').filter(Boolean)) {
    try { pw = require(cand); browser = await pw.chromium.launch({ headless: true }); break; } catch (e) { why = String(e.message).split('\n')[0]; browser = null; }
  }
  if (!browser) { console.log('SKIP browser did not start: ' + why); process.exit(0); }
  const ctx = await browser.newContext();
  let rec = null;
  const io = { openTab: async (url) => { const pg = await ctx.newPage(); await pg.goto(url); rec = recorder(asideLike(pg)); return rec.p; }, sleep };
  // localhost plays app.slack.com (settings pages) and the consent host, like the real *.slack.com pair
  const o = { base: BASE, appOrigin: BASE.replace('127.0.0.1', 'localhost'), consentHost: 'localhost', manifest, appName: 'SlackMod research' };
  const person = async (ws) => { const pg = rec.p; if (ws) await pg.selectOption('#ws', 'T1'); await pg.getByRole('button', { name: 'Next', exact: true }).click(); };

  // 1. the stop-before-keys run: open → (person) → create → stop
  setMode('ok'); fs.writeFileSync(LOG, '');
  let r = await D.open(io, o);
  ok(r.state === 'pick-workspace', 'open stops at «pick-workspace» (' + JSON.stringify(r) + ')');
  ok(await rec.p.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue()) === manifest, 'the editor holds our manifest');
  r = await D.waitReview(io, o, 1500);
  ok(r.state === 'waiting', 'nothing picked yet → «waiting» (no clicks)');
  await person(false);   // Next without a workspace: the fake site refuses, still the manifest step
  r = await D.waitReview(io, o, 1500);
  ok(r.state === 'waiting', 'Next without a workspace → still «waiting»');
  await person(true);
  r = await D.waitReview(io, o, 5000);
  ok(r.state === 'review', 'workspace picked + Next → «review»');
  const before = rec.calls.length;
  r = await D.create(io, o);
  ok(r.state === 'created' && r.app === 'AFAKE12345' && r.by === 'wizard', 'create → «created» AFAKE12345 (' + (r.reason || r.state) + ')');
  const after = rec.calls.slice(before);
  const lastRole = after.lastIndexOf('getByRole');
  const tail = after.slice(lastRole + 1);
  ok(lastRole >= 0 && tail.length > 0 && tail.every(c => c === 'url'), 'after the Create click the driver read only the address bar (' + tail.length + ' × url)');
  let L = log();
  ok(!L.some(l => /\/oauth|\/made\/|\/clicked\/|AOTHER/.test(l)), 'no token page · no bait click · no other app (requests: ' + L.length + ')');
  ok(L.filter(l => /^127\.0\.0\.1 GET \/apps\/AFAKE12345$/.test(l)).length === 1 && L.filter(l => /^localhost GET \/app-settings\/TFAKE0001\/AFAKE12345\/general$/.test(l)).length === 1,
    'Create → /apps/<id>?created=1 → the app-settings page on the other host, once each (Slack’s own redirect)');
  r = await D.create(io, o);
  ok(r.state === 'fallback', 'a second create on the same run is refused (' + (r.reason || '') + ')');
  let refused = 0;
  for (const k of ['create', 'gen_token', 'generate', 'allow', 'nope']) { try { await D._test.click(rec.p, D._test.opts(o), k); } catch (e) { if (/refused/.test(e.message)) refused++; } }
  ok(refused === 5, 'clicks on the new app page with no keys run: refused 5/5');
  r = await D.keys(io, Object.assign({}, o, { padApp: pad(), padBot: pad(), keys: true }));
  ok(r.state === 'fallback' && r.reason === 'no-tab', 'keys after a stop-before-keys run: «no-tab» (the tab was forgotten? ' + JSON.stringify(r) + ')');
  ok(!log().some(l => /\/made\//.test(l)), 'no token was made');

  // 1b. the real review screen names no app, so «ours» = the same dialog held exactly our manifest at the last look.
  //     The person changed the manifest before Next → no Create.
  setMode('ok'); fs.writeFileSync(LOG, '');
  r = await D.open(io, o);
  await rec.p.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setValue(cm.getValue().replace('SlackMod research', 'Someone else')); });
  r = await D.waitReview(io, o, 1500);
  ok(r.state === 'waiting', 'manifest edited by the person: still «waiting» before Next');
  await person(true);
  r = await D.waitReview(io, o, 5000);
  ok(r.state === 'review', 'edited manifest + Next → «review»');
  r = await D.create(io, o);
  ok(r.state === 'fallback' && r.reason === 'review-modal', 'manifest not ours at the last look → no Create (' + JSON.stringify(r) + ')');
  ok(!log().some(l => /AFAKE12345/.test(l)), 'and no app was made');
  // 1c. the review sits in another dialog than the one that held our manifest → no Create
  r = await D.open(io, o); await person(true);
  r = await D.waitReview(io, o, 5000);
  await rec.p.evaluate(() => { document.querySelector('.ReactModal__Content').id = 'another-dialog'; });
  r = await D.create(io, o);
  ok(r.state === 'fallback' && r.reason === 'review-modal', 'review in another dialog → no Create (' + JSON.stringify(r) + ')');
  ok(!log().some(l => /AFAKE12345/.test(l)), 'and still no app was made');

  // 2. the full run: open → (person) → create → keys — on the R2 5th run's site (2026-11-07): the new app's Install App page
  //    stays greyed (status not «approved», no address, no banner) for its first seconds (real: 4 / 20 / 37 s all greyed ·
  //    here LATE_S = 8 s) → the driver reloads it with spacing until it is live, then installs
  setMode('late'); fs.writeFileSync(LOG, '');
  const pA = pad(), pB = pad();
  const ok2 = Object.assign({}, o, { padApp: pA, padBot: pB, keys: true, installWait: 1500, installBudget: 30000 });
  r = await D.open(io, ok2); ok(r.state === 'pick-workspace', 'full run: open');
  await person(true);
  r = await D.waitReview(io, ok2, 5000); ok(r.state === 'review', 'full run: review');
  r = await D.create(io, ok2); ok(r.state === 'created', 'full run: created (' + (r.reason || r.state) + ')');
  r = await D.keys(io, ok2);
  ok(r.state === 'keys' && r.app === 'AFAKE12345', 'keys → «keys» (' + r.state + ' ' + (r.reason || '') + ')');
  const out = JSON.stringify(r);
  ok(!/xox[a-z]-|xapp-|BAIT/.test(out), 'the result carries no token-shaped text (bait 0)');
  ok(r.app_sealed && unseal(r.app_sealed, pA) === APP_TOKEN, 'app token: sealed in the page, unsealed with the run’s pad = the page value');
  ok(r.bot_sealed && unseal(r.bot_sealed, pB) === BOT_TOKEN, 'bot token: sealed in the page, unsealed with the run’s pad = the page value');
  ok(!!r.app_sealed && unseal(r.app_sealed, pB) !== APP_TOKEN, 'the other pad does not open it (two pads)');
  L = log();
  ok(!L.some(l => /\/clicked\//.test(l)), 'no bait button clicked (Show · Copy · Revoke · Done · Delete App · Reinstall · Cancel) — ' + (L.filter(l => /clicked/.test(l)).join(' | ') || 'none'));
  ok(!L.some(l => /AOTHER/.test(l)), 'no other app touched');
  ok(L.some(l => /^localhost GET \/oauth\/v2\/authorize/.test(l)), 'went through the consent page');
  // every Install App page load left one «age=status» word: greyed ones say «empty», the live ones «approved»
  const dg = String(r.diag || ''), dw = dg ? dg.split(',') : [];
  ok(/^[a-z0-9_=+,-]+$/.test(dg) && dw.filter(x => /=empty$/.test(x)).length >= 2 && /=approved$/.test(dw[dw.length - 1] || ''),
    'diagnosis = one «age=status» per load: ≥2 «empty» then «approved» (' + dg + ')');
  const ages = dw.map(x => Number(x.split('=')[0]));
  ok(ages.length > 0 && ages[0] <= 5 && dw.filter(x => /=empty$/.test(x)).every(x => Number(x.split('=')[0]) <= 8) && ages[ages.length - 1] >= 7,
    'diagnosis ages count from THIS app’s creation (first ≤5 s · greyed ≤8 s · live ≥7 s · the site turns it on at 8 s) (' + ages.join(' ') + ')');
  ok(L.filter(l => /^127\.0\.0\.1 GET \/apps\/AFAKE12345\/install-on-team$/.test(l)).length === dw.length + 2,
    'installed from the Install App page: every load in the diagnosis + Slack’s return (code · success) (' + L.filter(l => /install-on-team/.test(l)).length + ' = ' + dw.length + ' + 2)');
  ok(!L.some(l => /\/oauth$/.test(l)), 'the greyed OAuth & Permissions page was not used at all (' + L.filter(l => /\/oauth$/.test(l)).length + ')');
  ok(L.filter(l => /\/made\/app-token/.test(l)).length === 1, 'one app token made');
  r = await D.keys(io, ok2);
  ok(r.state === 'fallback' && r.reason === 'no-tab', 'keys twice: «no-tab»');

  // 2j. R2 6th run (2026-11-07 18:41): the Install App page was live from the first load (status «approved» at 2 s, 19 loads)
  //     but aside's role query, after goto(), still answered from the page it left → «install-greyed» with every word
  //     «approved». On a site that is live at once (mode ok) the driver must install on the FIRST load.
  {
    const raw = await ctx.newPage(), al = asideLike(raw);   // the double itself, as measured (pair: no wait 0 · wait > 0)
    await al.goto(BASE + '/apps');
    const n0 = await al.getByRole('button').count(), d0 = await al.locator('button').count();
    await al.waitForLoadState('load');
    const n1 = await al.getByRole('button').count();
    ok(n0 === 0 && d0 > 0 && n1 > 0, 'aside-like page: after goto the role query sees 0 while the DOM has ' + d0 + ' · after waitForLoadState ' + n1);
    await raw.close();
  }
  setMode('ok'); fs.writeFileSync(LOG, '');
  const o6 = Object.assign({}, o, { padApp: pad(), padBot: pad(), keys: true, installWait: 1500, installBudget: 20000 });
  r = await D.open(io, o6); await person(true); await D.waitReview(io, o6, 5000); r = await D.create(io, o6);
  const c6 = rec.calls.length;
  r = await D.keys(io, o6);
  const dw6 = String(r.diag || '').split(',').filter(Boolean);
  ok(r.state === 'keys' && dw6.length === 2 && dw6.every(x => /^\d+=approved$/.test(x)),
    '6th-run shape (live at once): keys with ONE load per statement (installWait · keysBot), no reload (' + r.state + ' ' + (r.reason || '') + ' · diag ' + r.diag + ')');
  const k6 = rec.calls.slice(c6), gotoAt = k6.map((c, i) => c === 'goto' ? i : -1).filter(i => i >= 0);
  ok(gotoAt.length >= 1 && gotoAt.every(i => { const nx = k6.slice(i + 1).findIndex(c => c === 'getByRole'); const w = k6.slice(i + 1).indexOf('waitForLoadState'); return w >= 0 && (nx < 0 || w < nx); }),
    'every goto is followed by waitForLoadState before the next role query (' + gotoAt.length + ' goto)');
  const lastGoto = gotoAt.length ? gotoAt[gotoAt.length - 1] : -1;
  const consentWait = k6.findIndex((c, i) => i > lastGoto + 1 && c === 'waitForLoadState' && k6[i - 1] === 'url' && k6[i + 1] === 'getByRole');
  ok(k6.filter(c => c === 'waitForLoadState').length === gotoAt.length + 1 && consentWait > 0,
    'one more load wait than goto: the consent page (reached by a click) is re-synced right after it is seen and before «Allow» is looked for ('
    + k6.filter(c => c === 'waitForLoadState').length + ' waits · ' + gotoAt.length + ' goto · at ' + consentWait + ')');

  // 2b. R2 3rd run (2026-11-07): on the new app's FIRST oauth load «Install to …» stays greyed (the page could not load the
  //     app's install status · real banner «… reload the page») → the driver loads the page again → live → keys
  const grey = (wait) => Object.assign({}, o, { padApp: pad(), padBot: pad(), keys: true, installWait: wait });
  const safeKeys = (oo) => D.keys(io, oo).catch(e => ({ state: 'exception', reason: String(e && e.message || e).split('\n')[0].slice(0, 60) }));
  const oauthLoads = () => log().filter(l => /^localhost GET \/app-settings\/TFAKE0001\/AFAKE12345\/oauth$/.test(l)).length;
  const installLoads = () => log().filter(l => /^127\.0\.0\.1 GET \/apps\/AFAKE12345\/install-on-team$/.test(l)).length;
  setMode('status-slow'); fs.writeFileSync(LOG, '');
  let og = grey(2500);
  r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
  r = await safeKeys(og);
  ok(r.state === 'keys' && r.app === 'AFAKE12345', 'greyed «Install to» on the first Install App load → load again → keys (' + r.state + ' ' + (r.reason || '') + ')');
  ok(installLoads() === 5 && log().some(l => /^localhost GET \/oauth\/v2\/authorize/.test(l)), 'Install App page: wait 2 loads (greyed · live) + install 1 + Slack’s return (code · success) = 5 (' + installLoads() + ') · then the consent page');
  ok(/^\d+=empty\+e,\d+=approved,\d+=approved$/.test(String(r.diag || '')), 'diagnosis: «empty» + load-error line, then «approved» twice (' + r.diag + ')');
  ok(!log().some(l => /clicked|AOTHER/.test(l)), 'and no bait / no other app');
  // 2c. never live → stop with the reason that says which (no consent page, no click)
  for (const [mode, why] of [['status-never', 'install-greyed'], ['status-error', 'install-status-error']]) {
    setMode(mode); fs.writeFileSync(LOG, '');
    og = Object.assign(grey(1500), { installBudget: 5000 });
    r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
    const t1 = Date.now();
    r = await safeKeys(og);
    const took = Date.now() - t1;
    ok(r.state === 'fallback' && r.reason === why && r.app === 'AFAKE12345', mode + ' → «' + why + '» (' + JSON.stringify(r) + ')');
    ok(installLoads() >= 3 && took >= 5000 && took < 15000 && !log().some(l => /\/oauth\/v2\/authorize|clicked/.test(l)),
      mode + ': reloaded until the budget (5 s) was used, no consent page, no click (' + installLoads() + ' loads · ' + took + ' ms)');
    const dws = String(r.diag || '').split(',');
    ok(dws.length === installLoads() && dws.every(x => /^\d+=empty(\+e)?$/.test(x)) && !/BAIT|xox|xapp/.test(JSON.stringify(r)),
      mode + ': diagnosis = every load «empty» · no token text from the props (' + r.diag + ')');
  }
  // 2f. a visible decision stops at once (no wait, no click): denied · request pending
  for (const [mode, st, why, word] of [['status-denied', 'fallback', 'install-denied', 'denied+d'], ['status-pending', 'approval', 'install-pending', 'pending+r']]) {
    setMode(mode); fs.writeFileSync(LOG, '');
    og = Object.assign(grey(1500), { installBudget: 20000 });
    r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
    r = await safeKeys(og);
    ok(r.state === st && r.reason === why && installLoads() === 1 && new RegExp('^\\d+=' + word.replace('+', '\\+') + '$').test(String(r.diag || ''))
      && !log().some(l => /\/oauth\/v2\/authorize|clicked/.test(l)), mode + ' → «' + st + ' ' + why + '» after 1 load, no click (' + JSON.stringify(r) + ' · ' + installLoads() + ')');
  }
  // 2i. keysBot alone (the wizard's --install-wait 0 path) also stops at once on a visible decision
  setMode('status-denied'); fs.writeFileSync(LOG, '');
  og = grey(1500);
  r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
  r = await D.keysApp(io, og);
  r = await D.keysBot(io, og);
  ok(r.state === 'fallback' && r.reason === 'install-denied' && installLoads() === 1 && !log().some(l => /\/oauth\/v2\/authorize|clicked/.test(l)),
    'keysBot alone on a denied app → «install-denied» after 1 load, no click (' + JSON.stringify(r) + ')');
  setMode('status-slow'); fs.writeFileSync(LOG, '');
  og = grey(1500);
  r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
  r = await D.keysApp(io, og);
  r = await D.keysBot(io, og);
  ok(r.state === 'keys' && installLoads() === 4 && /^\d+=empty\+e,\d+=approved$/.test(String(r.diag || '')),
    'keysBot alone: greyed first load → reloads itself → keys (2 loads + Slack’s return = 4 · ' + installLoads() + ' · ' + r.diag + ')');
  // 2g. installWait alone: never clicks · «install-ready» on a live page · refused with no keys run
  setMode('ok'); fs.writeFileSync(LOG, '');
  og = grey(1500);
  r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
  r = await D.keysApp(io, og);
  r = await D.installWait(io, og, 60000);
  ok(r.state === 'install-ready' && r.app === 'AFAKE12345' && /^\d+=approved$/.test(r.diag || '') && installLoads() === 1
    && !log().some(l => /\/oauth\/v2\/authorize|clicked/.test(l)), 'installWait: live → «install-ready», 1 load, nothing pressed (' + JSON.stringify(r) + ')');
  setMode('late'); fs.writeFileSync(LOG, '');
  og = grey(1500);
  r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
  r = await D.keysApp(io, og);
  r = await D.installWait(io, og, 30000);
  const iw = String(r.diag || '').split(',');
  ok(r.state === 'install-ready' && iw.length >= 3 && /=approved$/.test(iw[iw.length - 1]) && installLoads() === iw.length && !log().some(l => /\/oauth\/v2\/authorize|clicked/.test(l)),
    'installWait: ONE statement reloads a greyed page by itself until live (' + installLoads() + ' loads · ' + r.diag + ')');
  D._test.S.page = null; D._test.S.app = null;
  r = await D.installWait(io, og, 1000);
  ok(r.state === 'fallback' && r.reason === 'no-tab', 'installWait with no run: «no-tab»');
  // 2h. installLook: the status word only (pairs) — the props also carry a bait token that must never come out
  {
    const pg = await ctx.newPage();
    const lk = async (html, props) => {
      await pg.setContent(html);
      if (props !== undefined) await pg.evaluate((pp) => { const e = document.getElementById('i'); e['__reactFiber$t1'] = { memoizedProps: {}, return: { memoizedProps: pp, return: null } }; }, props);
      return D._test.installLook(pg);
    };
    const bait = { botToken: BOT_TOKEN, userToken: 'BAITUSER' };
    const A = '<a id="i" aria-disabled="true">Install to <b>W</b></a>';
    const got = [await lk('<p>nothing</p>'), await lk(A), await lk(A, { x: 1 }),
      await lk(A, Object.assign({ appStatusData: { appStatus: '', installUrl: 'BAITURL' } }, bait)),
      await lk(A, Object.assign({ appStatusData: { appStatus: 'approved' } }, bait)),
      await lk(A, Object.assign({ appStatusData: { appStatus: 'Approved!' } }, bait)),
      await lk(A, Object.assign({ appStatusData: { appStatus: BOT_TOKEN } }, bait)),
      await lk(A, Object.assign({ appStatusData: {} }, bait)),
      await lk('<button id="i" disabled>Request to Workspace Install Submitted</button>', { appStatusData: { appStatus: 'pending' } }),
      await lk('<div>Someone who manages apps on your workspace has denied your request to workspace install this app.</div>' + A, { appStatusData: { appStatus: 'denied' } }),
      await lk('<p>Click <strong>Request to Workspace Install</strong> to send the request.</p>' + A, { appStatusData: { appStatus: '' } })];
    const want = ['no-button', 'no-fiber', 'no-data', 'empty', 'approved', 'other', 'other', 'none', 'pending', 'denied', 'empty'];
    ok(got.map(g => g.st).join() === want.join(), 'installLook: no control · no fiber · no data · "" · approved · odd text · token-shaped · missing · pending · denied = ' + got.map(g => g.st).join());
    ok(!/BAIT|xox|xapp/.test(JSON.stringify(got)) && got.every((g, i) => Object.keys(g).sort().join() === (i === 0 ? 'admin,denied,loaderr,noscope,request,st' : 'admin,denied,loaderr,noscope,request,roleable,st')
      && Object.keys(g).every(k => k === 'st' ? typeof g[k] === 'string' : typeof g[k] === 'boolean')), 'installLook returns only the word + 5 yes/no (+ «roleable» when a control is there · no token, no URL)');
    ok(got[1].roleable === false && got[8].roleable === true && (await lk('<a id="i" href="http://localhost:9/oauth/v2/authorize">Install to <b>W</b></a>')).roleable === true,
      'installLook «roleable»: <a> without address no · <button> yes · <a href> yes');
    {   // diagnosis letters for a load that was not live: b = role query blind to a control the DOM has · h = live-looking link,
        // address not the consent page · t = the load wait gave up (pairs)
      const T2 = D._test, kA = T2.S.app, kD = T2.S.diag, kM = T2.S.made;
      const U = 'https://api.slack.com/apps/AFAKE12345/install-on-team';
      const look = (roleable) => async () => ({ st: 'approved', loaderr: false, denied: false, request: false, noscope: false, admin: false, roleable });
      const el = (href) => ({ isVisible: async () => true, isEnabled: async () => true, getAttribute: async (n) => (n === 'href' ? href : null) });
      const pgOf = (nLink, href, roleable, loadThrows) => ({ goto: async () => {}, url: () => U, evaluate: look(roleable),
        waitForLoadState: async () => { if (loadThrows) throw new Error('Timeout'); },
        getByRole: (role) => ({ count: async () => (role === 'link' ? nLink : 0), first: () => el(href) }) });
      const one = async (pg) => { T2.S.app = 'AFAKE12345'; T2.S.diag = []; T2.S.made = Date.now() - 3000;
        const l = await T2.installLoad({ sleep }, pg, T2.opts({ base: 'https://api.slack.com', installWait: 600 })); return [l.how, T2.diagStr()]; };
      const got2 = [await one(pgOf(0, null, true)), await one(pgOf(0, null, false)), await one(pgOf(1, 'https://evil.example/oauth/v2/authorize', true)),
        await one(pgOf(1, 'https://slack.com/oauth/v2/authorize?x=1', true)), await one(pgOf(1, 'https://slack.com/oauth/v2/authorize?x=1', true, true))];
      T2.S.app = kA; T2.S.diag = kD; T2.S.made = kM;
      ok(got2[0][1] === '3=approved+b' && got2[1][1] === '3=approved' && got2[2][1] === '3=approved+h' && got2[3][0] === 'install_link' && got2[3][1] === '3=approved'
        && got2[4][0] === 'install_link' && got2[4][1] === '3=approved+t',
        'diagnosis letters: blind role query +b (roleable) / none (no address) · other address +h · live = no letter · load wait gave up +t and still live = ' + got2.map(g => g.join(':')).join(' '));
    }
    ok(got[8].request === true && got[9].denied === true && got[4].denied === false && got[4].request === false && got[9].request === false && got[10].request === false,
      'installLook: «Request to … Install» CONTROL / «has denied» line seen (yes 2/2 · no 4/4 — neither the denied line nor an info line naming the button is the button)');
    {   // the age in the diagnosis = when the page was OPENED (its status is fetched then), not when it was read 2 s later
      const T1 = D._test, kA = T1.S.app, kD = T1.S.diag, kM = T1.S.made;
      T1.S.app = 'AFAKE12345'; T1.S.diag = []; T1.S.made = Date.now() - 10400;
      const U = 'https://api.slack.com/apps/AFAKE12345/install-on-team';
      const slow = { goto: async () => {}, url: () => U, getByRole: () => ({ count: async () => 0 }),
        evaluate: async () => ({ st: 'empty', loaderr: false, denied: false, request: false, noscope: false, admin: false }) };
      await T1.installLoad({ sleep }, slow, T1.opts({ base: 'https://api.slack.com', installWait: 2000 }));
      const ad = T1.diagStr();
      T1.S.app = kA; T1.S.diag = kD; T1.S.made = kM;
      ok(ad === '10=empty', 'diagnosis age = at page open (10 s), not after the 2 s watch (12 s) (' + ad + ')');
    }
    // a load that throws (goto time-out · navigation race) is noted «goto-error», not lost
    const T0 = D._test, keepApp = T0.S.app, keepDiag = T0.S.diag;
    T0.S.app = 'AFAKE12345'; T0.S.diag = [];
    const boom = { goto: async () => { throw new Error('Timeout 30000ms exceeded'); }, url: () => 'https://api.slack.com/apps/AFAKE12345/install-on-team' };
    const gl = await T0.installLoad({ sleep }, boom, T0.opts({ base: 'https://api.slack.com', installWait: 500 })).catch(e => ({ threw: String(e.message).slice(0, 40) }));
    const gd = T0.diagStr();
    T0.S.app = keepApp; T0.S.diag = keepDiag;
    ok(gl.how === null && gl.look && gl.look.st === 'goto-error' && /=goto-error$/.test(gd), 'installLoad: a page load that throws → not live + «goto-error» in the diagnosis (' + JSON.stringify(gl) + ' · ' + gd + ')');
    const dc = D._test.decided;
    ok(String(dc({ st: 'denied' })) === 'install-denied,' && String(dc({ st: 'empty', denied: true })) === 'install-denied,' && String(dc({ st: 'pending' })) === 'install-pending,approval'
      && String(dc({ st: 'empty', request: true })) === 'install-request,approval' && dc({ st: 'approved', request: true }) === null && dc({ st: 'empty', loaderr: true }) === null
      && dc({ st: 'aaa_eligible' }) === null && dc({ st: 'no-fiber' }) === null, 'decided(): denied / pending / request stop · approved / empty / load error / aaa_eligible / no-fiber wait');
    await pg.close();
  }
  // 2e. the Install App page shows no token after the install → the OAuth & Permissions page (its token field) does
  setMode('token-elsewhere'); fs.writeFileSync(LOG, '');
  og = grey(2500);
  r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
  r = await safeKeys(og);
  ok(r.state === 'keys' && !!r.bot_sealed && unseal(r.bot_sealed, og.padBot) === BOT_TOKEN, 'no token on the Install App page → read on the oauth page (' + r.state + ' ' + (r.reason || '') + ')');
  ok(oauthLoads() === 1 && !log().some(l => /clicked|AOTHER/.test(l)), 'oauth page loaded once, after the install · no bait (' + oauthLoads() + ')');
  // … but not when the statement is out of time (here: no time at all) → «bot-token», no second page
  fs.writeFileSync(LOG, '');
  og = Object.assign(grey(2500), { tokenFallbackBy: 0 });
  r = await D.open(io, og); await person(true); await D.waitReview(io, og, 5000); r = await D.create(io, og);
  r = await safeKeys(og);
  ok(r.state === 'fallback' && r.reason === 'bot-token' && oauthLoads() === 0, 'out of time → «bot-token», oauth page not loaded (' + JSON.stringify(r) + ' · ' + oauthLoads() + ')');
  ok(D._test.opts({ tokenFallbackBy: 999999 }).tokenFallbackBy === 80000 && D._test.opts({}).tokenFallbackBy === 80000, 'tokenFallbackBy can only be lowered (cap 80 s)');
  ok(D._test.opts({ installBudget: 999999 }).installBudget === 300000 && D._test.opts({}).installBudget === 300000 && D._test.opts({ installBudget: 4000 }).installBudget === 4000,
    'installBudget (keys() in tests) can only be lowered (cap 300 s)');
  // 2d. live(): what counts as an install control to press (pairs: yes / no)
  if (typeof D._test.live !== 'function') ok(false, 'live(): not in this driver');
  else {
    const pg = await ctx.newPage();
    const lv = async (html, role) => { await pg.setContent(html); return D._test.live(pg, D._test.opts(o), role || 'link', /^Install to /); };
    const yes = [await lv('<a href="http://localhost:9/oauth/v2/authorize?client_id=1">Install to W</a>'),
      await lv('<button>Install to W</button>', 'button')];
    const no = [await lv('<a aria-disabled="true">Install to W</a>'),
      await lv('<a href="http://localhost:9/oauth/v2/authorize" aria-disabled="true">Install to W</a>'),
      await lv('<a href="http://evil.example/oauth/v2/authorize">Install to W</a>'),
      await lv('<a href="http://localhost:9/oauth/v2/authorizeX">Install to W</a>'),
      await lv('<a href="/oauth/v2/authorize">Install to W</a>'),
      await lv('<button disabled>Install to W</button>', 'button'),
      await lv('<button aria-disabled="true">Install to W</button>', 'button'),
      await lv('<a style="display:none" href="http://localhost:9/oauth/v2/authorize">Install to W</a>')];
    ok(yes.every(Boolean) && no.every(v => v === false), 'live(): consent link · enabled button = yes ' + yes.filter(Boolean).length + '/2 · greyed / no address / other host / other path / relative / disabled / hidden = no ' + no.filter(v => v === false).length + '/8');
    await pg.close();
    // a page API whose isEnabled() ignores aria-disabled (aside's may): the driver's own aria-disabled check still says no
    const stub = (attrs) => ({ getByRole: () => ({ count: async () => 1, first: () => ({ isVisible: async () => true, isEnabled: async () => true,
      getAttribute: async (n) => (n in attrs ? attrs[n] : null) }) }) });
    const consentHref = 'http://localhost:9/oauth/v2/authorize?client_id=1';
    const sYes = await D._test.live(stub({ href: consentHref }), D._test.opts(o), 'link', /^Install to /);
    const sNo = await D._test.live(stub({ href: consentHref, 'aria-disabled': 'true' }), D._test.opts(o), 'link', /^Install to /);
    ok(sYes === true && sNo === false, 'live(): aria-disabled="true" is refused even when isEnabled() says yes (yes ' + sYes + ' · no ' + sNo + ')');
  }

  // 3. not signed in
  setMode('login'); fs.writeFileSync(LOG, '');
  r = await D.open(io, o);
  ok(r.state === 'login', 'signed out → «login» (' + (r.reason || '') + ')');
  ok(!log().some(l => /signin|clicked/.test(l)), 'the sign-in link was not followed (the person signs in)');

  // 4. the workspace needs admin approval
  setMode('approval'); fs.writeFileSync(LOG, '');
  r = await D.open(io, ok2); await person(true); await D.waitReview(io, ok2, 5000); await D.create(io, ok2);
  r = await D.keys(io, ok2);
  ok(r.state === 'approval' && r.reason === 'admin-approval' && r.app === 'AFAKE12345', 'admin approval → «approval» (no Request clicked: ' + !log().some(l => /clicked/.test(l)) + ')');
  ok(!log().some(l => /clicked/.test(l)), 'Request to Install was not clicked');

  // 5. the person closes the dialog
  setMode('ok');
  r = await D.open(io, o);
  await rec.p.evaluate(() => { document.getElementById('modal').innerHTML = ''; });
  r = await D.waitReview(io, o, 5000);
  ok(r.state === 'cancelled', 'dialog closed by the person → «cancelled»');

  // 5b. the person wanders to another app's page instead of creating ours → no keys on someone else's app
  r = await D.open(io, ok2);
  await rec.p.goto(BASE + '/apps/AOTHER0001/general');
  r = await D.waitReview(io, ok2, 3000);
  ok(r.state === 'fallback' && r.reason === 'not-our-app', 'person went to another app → «not-our-app» (' + JSON.stringify(r) + ')');
  r = await D.keys(io, ok2);
  ok(r.state === 'fallback' && r.reason === 'no-tab', 'and keys then refuses («no-tab»)');
  // 5c. the person presses Create themselves → our app → keys still fine
  fs.writeFileSync(LOG, '');
  r = await D.open(io, ok2); await person(true);
  await D.waitReview(io, ok2, 5000);
  await rec.p.getByRole('button', { name: 'Create', exact: true }).click();
  r = await D.waitReview(io, ok2, 5000);
  ok(r.state === 'created' && r.by === 'person' && r.app === 'AFAKE12345', 'person pressed Create → «created» by person (our name on the page)');
  r = await D.keys(io, ok2);
  ok(r.state === 'keys', 'then keys run on our app (' + r.state + ')');

  // 6. fences without a run
  const w = D._test.where;
  const oo = D._test.opts({ base: 'https://api.slack.com' });
  const at = u => w({ url: () => u }, oo).at;
  ok(at('https://api.slack.com/apps') === 'list' && at('https://api.slack.com/apps/A0123456/general') === 'app-general' && at('https://api.slack.com/apps/A0123456/oauth') === 'app-oauth', 'where: list · app-general · app-oauth');
  ok(at('https://evil.example/apps') === 'other' && at('http://api.slack.com/apps') === 'other' && at('https://api.slack.com.evil.example/apps') === 'other', 'where: other origins are «other»');
  const ag = u => { const r = w({ url: () => u }, oo); return r.at + ':' + (r.app || ''); };
  ok(ag('https://app.slack.com/app-settings/TZZTEAM01/AZZAPP001/general') === 'app-general:AZZAPP001' && ag('https://app.slack.com/app-settings/TZZTEAM01/AZZAPP001/oauth') === 'app-oauth:AZZAPP001'
    && ag('https://app.slack.com/app-settings/TZZTEAM01/AZZAPP001/socket-mode') === 'app-other:AZZAPP001', 'where: app.slack.com/app-settings/<T>/<A>/general · oauth · other page (the real place after Create)');
  ok(at('https://app.slack.com.evil.example/app-settings/TZZTEAM01/AZZAPP001/general') === 'other' && at('http://app.slack.com/app-settings/TZZTEAM01/AZZAPP001/general') === 'other'
    && at('https://evil.example/app-settings/TZZTEAM01/AZZAPP001/general') === 'other' && at('https://app.slack.com/app-settings/AZZAPP001/general') === 'other'
    && at('https://app.slack.com/client/TZZTEAM01/AZZAPP001') === 'other', 'where: app-settings only on https://app.slack.com, only with a team and an app id');
  ok(ag('https://api.slack.com/apps/AZZAPP001/install-on-team') === 'app-install:AZZAPP001' && ag('https://app.slack.com/app-settings/TZZTEAM01/AZZAPP001/install-on-team') === 'app-install:AZZAPP001'
    && ag('https://api.slack.com/apps/AZZAPP001/install-on-teams') === 'app-other:AZZAPP001' && at('https://evil.example/apps/AZZAPP001/install-on-team') === 'other',
    'where: the Install App page on both hosts · nothing else is «app-install»');
  ok(at('https://ws.slack.com/oauth/v2/authorize') === 'consent' && at('https://ws.slack.com.evil.example/oauth') === 'other' && at('https://evilslack.com/oauth') === 'other', 'where: consent only on slack.com hosts');
  const T = D._test;
  T.CLICKS.zz = { at: 'app-general', role: 'button', name: 'Show', exact: true };
  T.CLICKS.zy = { at: 'app-oauth', role: 'button', name: /Reinstall/, exact: false };
  ok(T.specOk(T.CLICKS, 'zz') === null && T.specOk(T.CLICKS, 'zy') === null, 'a DENY name is refused even when put in the table');
  delete T.CLICKS.zz; delete T.CLICKS.zy;
  T.S.app = null;
  let gref = 0;
  for (const wh of ['general', 'oauth', 'install', 'https://evil.example', '../AOTHER0001/general']) { try { await T.go({ goto: async () => {} }, oo, wh); } catch (e) { if (/refused/.test(e.message)) gref++; } }
  ok(gref === 5, 'go(): no app of this run → general/oauth/install/other refused 5/5');
  T.S.app = 'AFAKE12345';
  let gone = '', gone2 = '', gref2 = 0;
  await T.go({ goto: async (u) => { gone = u; } }, oo, 'oauth');
  await T.go({ goto: async (u) => { gone2 = u; } }, oo, 'install');
  for (const wh of ['install-on-team', 'toString', 'constructor', 'delete']) { try { await T.go({ goto: async () => {} }, oo, wh); } catch (e) { if (/refused/.test(e.message)) gref2++; } }
  ok(gone === 'https://api.slack.com/apps/AFAKE12345/oauth' && gone2 === 'https://api.slack.com/apps/AFAKE12345/install-on-team' && gref2 === 4,
    'go(): only this run’s app pages (oauth · install → install-on-team · other names refused ' + gref2 + '/4)');
  // the install control is pressed only on THIS run's app Install App page
  let iref = 0;
  for (const u of ['https://api.slack.com/apps/AOTHER0001/install-on-team', 'https://api.slack.com/apps/AFAKE12345/oauth', 'https://app.slack.com/app-settings/TZZTEAM01/AFAKE12345/oauth']) {
    for (const k of ['install_link', 'install_btn']) { try { await T.click({ url: () => u, getByRole: () => { throw new Error('looked'); } }, oo, k); } catch (e) { if (/refused/.test(e.message)) iref++; } }
  }
  ok(iref === 6, 'install clicks: another app’s Install App page · our oauth page (both hosts) → refused ' + iref + '/6');
  // home(): back on OUR app's install / oauth page only
  const hm = u => T.home({ url: () => u }, oo, 'AFAKE12345');
  ok(hm('https://api.slack.com/apps/AFAKE12345/install-on-team') && hm('https://app.slack.com/app-settings/TZZTEAM01/AFAKE12345/oauth')
    && !hm('https://api.slack.com/apps/AOTHER0001/install-on-team') && !hm('https://api.slack.com/apps/AFAKE12345/general') && !hm('https://ws.slack.com/oauth/v2/authorize'),
    'home(): our install / oauth page yes 2/2 · other app / general / consent no 3/3');
  T.S.app = null;
  ok(Object.keys(T.CLICKS).every(k => T.specOk(T.CLICKS, k)), 'every row of the click table passes DENY (' + Object.keys(T.CLICKS).length + ' rows)');

  await browser.close();
  console.log(fails ? 'RESULT FAIL ' + fails : 'RESULT PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL exception ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); process.exit(1); });
