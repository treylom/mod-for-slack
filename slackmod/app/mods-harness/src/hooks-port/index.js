// Native gate only. Node launch/config code must never enter the mod import graph.
import { normalizeEvent, mergeClassicResult, registrationIds } from './bridge.js';
import { PROMPT_RUNNER_TIMEOUT_MS, toolRunnerTimeoutMs } from './budget.js';
// Same two lines in the four lane files: the validator follows $ only into same-file functions. The first call pins the verdict for this process (a later /clear changes the session id, the launcher's does not).
let optInAnchor
async function optedIn($) { if (optInAnchor === undefined) { const bot = await $.env.get('MODS_HARNESS_BOT'); const expected = await $.env.get('MODS_HARNESS_SESSION_ID'); optInAnchor = Boolean(bot) && Boolean(expected) && expected === await $.session.id() } return optInAnchor }
let laneRegistered = false;
let finalized = false;
let registrationErrors = ['common-register-not-finalized'];
let boundLaunch = '';
let lifecycleRegistered = false;
const PROMPT_WARNING = '[mods-harness] 프롬프트 정책 실행 오류: 입력은 수신했으며 도구 안전 검사는 계속 적용합니다.';

function supportedEvents() {
  return lifecycleRegistered ? ['PreToolUse','UserPromptSubmit','SessionStart','Stop'] : ['PreToolUse'];
}

// pinned-legacy hooks that read transcript_path get the engine's Messages-API form (blocks intact: text,
// tool_use, tool_result) — the closest thing to the classic transcript file. Media bodies are dropped (size).
// Inline on purpose: config code must not enter the mod import graph.
export function wantsApiMessages(config) {
  const h = config?.hooks || {};
  return (h.entries || []).some(x => x && x.nativePolicy === 'pinned-legacy' &&
    h.policyOptions?.[typeof x.optionsKey === 'string' ? x.optionsKey : x.nativePolicy]?.transcriptFromMessages === true);
}
export function slimApiMessages(list) {
  return (Array.isArray(list) ? list : []).map(m => ({role:m.role, content:(Array.isArray(m.content) ? m.content : []).map(b =>
    b && (b.type === 'image' || b.type === 'document') ? {type:b.type, omitted:true} : b)}));
}

async function callRunner($, name, fields) {
  if (!finalized || registrationErrors.length) throw new Error('registration incomplete');
  const configPath = await $.env.get('MODS_HARNESS_CONFIG');
  const bot = await $.env.get('MODS_HARNESS_BOT');
  const expected = await $.env.get('MODS_HARNESS_SESSION_ID');
  if (!boundLaunch || boundLaunch !== expected || !configPath || !bot) throw new Error('launch identity mismatch');
  const sid = await $.session.id();
  const config = JSON.parse(await $.fs.read(configPath, 'text'));
  const ids = registrationIds(config.hooks, {nativeOnly:true, supportedEvents:supportedEvents()});
  const event = {...fields, hook_event_name:name, session_id:sid, cwd:await $.session.cwd()};
  if (wantsApiMessages(config)) event.apiMessages = slimApiMessages(await $.session.messages({as:'api'}));
  const raw = await $.process.run([config.paths.pythonExecutable, config.paths.hookRunner,
    '--config', configPath, '--session', sid, '--launch-session', boundLaunch, '--bot', bot], {
    stdin:JSON.stringify({event,registeredGateIds:ids,registrationErrors}), timeoutMs:PROMPT_RUNNER_TIMEOUT_MS,
  });
  if (raw.exitCode !== 0) throw new Error('runner failure');
  const result = JSON.parse(raw.stdout);
  if (typeof result.ok !== 'boolean' || typeof result.deny !== 'boolean') throw new Error('runner invalid result');
  return result;
}

// A gate's own reason travels next to the stable code (runner `detail`), so the model learns why it was refused.
export function withDetail(r) { return r && r.reason ? (typeof r.detail === 'string' && r.detail ? `${r.reason}: ${r.detail}` : r.reason) : '' }

// A gate's ask in a bot window is refused, not put to a dialog: under bypassPermissions (the bots' mode) the
// official ask opens an approval dialog and waits with no timeout for a person who is not watching (ask probe
// 2026-10-18, 29 runs). The prefix keeps it distinguishable from a gate's own deny for the model and the logs.
export const ASK_AS_DENY_PREFIX = '물어보기 판정이었음(봇 창은 확인 창 없이 막음): ';
export function askAsDeny(local) {
  if (local && local.deny) return local.deny;
  if (local && local.ask) return ASK_AS_DENY_PREFIX + (typeof local.ask === 'string' ? local.ask : 'hook requires approval');
  return '';
}

async function runNativeEvent($, name, fields) {
  const result = await callRunner($,name,fields);
  if (!result.ok || result.deny) {
    if (result.failureKind === 'policy') return {block:withDetail(result) || 'policy refusal'};
    throw new Error('policy execution unavailable');
  }
  return mergeClassicResult(name,result,{});
}

async function journal($, operation, fields) {
  const configPath = await $.env.get('MODS_HARNESS_CONFIG');
  const bot = await $.env.get('MODS_HARNESS_BOT');
  const expected = await $.env.get('MODS_HARNESS_SESSION_ID');
  const sid = await $.session.id();
  const config = JSON.parse(await $.fs.read(configPath,'text'));
  // Independent of hookRunner: its death must not also erase the warning.
  const out = await $.process.run([config.paths.pythonExecutable,$.plugin.root + '/src/hooks-port/journal.py',
    '--config',configPath,'--session',sid,'--bot',bot],{
    stdin:JSON.stringify({operation,launchSessionId:boundLaunch || expected,...fields}),timeoutMs:1500,
  });
  if (out.exitCode !== 0 || JSON.parse(out.stdout).ok !== true) throw new Error('journal unavailable');
}

async function promptWarning($, e, events) {
  const turnId = e.turnId || 'prompt-' + crypto.randomUUID();
  try { await journal($,'prompt-warning',{turnId,events}); }
  catch (err) { console.warn('[mods-harness] prompt-warning record fallback: ' + JSON.stringify({turnId,events,failureKind:'execution'})); }
  return PROMPT_WARNING;
}

async function answerHash(text) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text || ''));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}

// Common entry must call this AFTER registerSession and BEFORE finalization.
// Parent dispatch then drops its owned thread before our injection/audit runs.
export function registerPromptLifecycle(on, options) {
  on('prompt.submit', {text:/[\s\S]*/}, async ($, e, next) => {
    if (!(await optedIn($))) return next(e);
    // Managed hosts bypass prompt.context too. Re-evaluate the read-only
    // startup warning on every accepted prompt, including clear/compact.
    // Only catalogued SessionStart policies are enabled on this route.
    let startup = {}, result = {};
    const errors = [];
    try { startup = await runNativeEvent($, 'SessionStart', {source:'startup'}); }
    catch (err) { errors.push('SessionStart'); }
    try { result = await runNativeEvent($, 'UserPromptSubmit', {prompt:e.text, messages:await $.session.messages()}); }
    catch (err) { errors.push('UserPromptSubmit'); }
    if (startup.block || startup.preventContinuation || result.block || result.preventContinuation) return {drop:'harness prompt policy refused'};
    const warnings = errors.length ? [await promptWarning($,e,errors)] : [];
    return next({...e,context:[...(e.context || []),...(startup.additionalContext || []),...(result.additionalContext || []),...warnings]});
  }).catch(async ($, e, next) => {
    if (!(await optedIn($))) return next(e);
    return next.called ? next(e) : next({...e,context:[...(e.context || []),await promptWarning($,e,['UserPromptSubmit'])]});
  });
  on('turn.start', {turnId:/^/}, async ($,e,next) => {
    if (!(await optedIn($))) return next(e);
    if (!e.agentId) {
      try { await journal($,'turn-start',{turnId:e.turnId}); }
      catch (err) { console.warn('[mods-harness] completion receipt unavailable; missing receipt means held'); }
    }
    return next(e);
  }).catch(($,e,next)=>next(e));
  on('turn.complete', {turnId:/^/}, async ($,e,next) => {
    if (!(await optedIn($))) return next(e);
    if (!e.agentId) {
      let result;
      try { result = await callRunner($,'Stop',{turn_id:e.turnId,stop_hook_active:false,last_assistant_message:e.answer,messages:await $.session.messages()}); }
      catch (err) { result = {ok:false,deny:true,failureKind:'execution',reason:'completion-policy-unavailable'}; }
      try { await journal($,'turn-complete',{turnId:e.turnId,reason:e.reason,result,answerHash:await answerHash(e.answer)}); }
      catch (err) { console.warn('[mods-harness] completion receipt unavailable; missing receipt means held'); }
    }
    // This is a receipt only, never a block, replacement answer, or new turn.
    return next(e);
  }).catch(($,e,next)=>next(e));
  lifecycleRegistered = true;
}

export function finalizeRegistration({ errors = [] } = {}) {
  registrationErrors = errors.map(String);
  finalized = laneRegistered && registrationErrors.length === 0;
}

export function register(on, options) {
  optInAnchor = undefined;
  laneRegistered = false;
  finalized = false;
  boundLaunch = '';
  lifecycleRegistered = false;
  registrationErrors = ['common-register-not-finalized'];
  // Distinct matcher: session lane owns unfiltered session.start. Anchor once
  // to actual startup identity. /clear changes UUID, not this process anchor.
  on('session.start', {cwd: /^\//}, async ($, e, next) => {
    if (!(await optedIn($))) return next(e);
    const expected = await $.env.get('MODS_HARNESS_SESSION_ID');
    const actual = await $.session.id();
    boundLaunch = expected && actual === expected ? expected : '';
    return next(e);
  }).catch(($, e, next) => { boundLaunch = ''; return next(e); });

  // Must precede settings PreToolUse; tool.check is too late. Regex matcher
  // coexists with the session lane's unfiltered tool.call.
  on('tool.call', {tool: /^/}, async ($, e, next) => {
    if (!(await optedIn($))) return next(e);
    if (!finalized || registrationErrors.length) return {deny:'harness registration incomplete'};
    const configPath = await $.env.get('MODS_HARNESS_CONFIG');
    const bot = await $.env.get('MODS_HARNESS_BOT');
    const expected = await $.env.get('MODS_HARNESS_SESSION_ID');
    const sid = await $.session.id();
    if (!configPath || !bot || !boundLaunch || boundLaunch !== expected) return {deny:'harness launch identity mismatch'};
    const config = JSON.parse(await $.fs.read(configPath, 'text'));
    const ids = registrationIds(config.hooks, {nativeOnly:true, supportedEvents:supportedEvents()});
    const event = normalizeEvent('PreToolUse', e, {sessionId:sid, cwd:await $.session.cwd()});
    if (config.hooks.entries.some(x => x.nativePolicy)) event.messages = await $.session.messages();
    if (wantsApiMessages(config)) event.apiMessages = slimApiMessages(await $.session.messages({as:'api'}));
    const runnerTimeoutMs = toolRunnerTimeoutMs(config.hooks, event);
    const raw = await $.process.run([config.paths.pythonExecutable, config.paths.hookRunner,
      '--config', configPath, '--session', sid, '--launch-session', boundLaunch, '--bot', bot], {
      stdin: JSON.stringify({event, registeredGateIds:ids, registrationErrors}), timeoutMs:runnerTimeoutMs,
    });
    if (raw.exitCode !== 0) return {deny:'harness runner execution failed'};
    const run = JSON.parse(raw.stdout);
    if (!run.ok || run.deny) return {deny:withDetail(run) || 'harness gate refused'};
    const local = mergeClassicResult('PreToolUse', run, {});
    // Never silently allow an ask here; see askAsDeny for why it is not put to the official dialog.
    const refused = askAsDeny(local);
    if (refused) return {deny:refused};
    const downstream = await next(e);
    if (downstream.deny) return downstream;
    return {...downstream, ...(local.additionalContext ? {context:[...(downstream.context || []), ...local.additionalContext]} : {})};
  }).catch(async ($, e, next) => {
    if (!(await optedIn($))) return next(e);
    return next.called ? next(e) : {deny:'harness handler failure'};
  });
  // No classic.* / Stop / SubagentStop handler: identity errors cannot create
  // a completion-block loop, including on unmanaged machines.
  laneRegistered = true;
}
