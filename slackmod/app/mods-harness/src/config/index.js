// lane: config · owner: hooks lane
// Pure validation — safe for mod runtime (no node imports).
import {validNativeEntry} from '../hooks-port/catalog.js';
import {entryTimeoutCapMs, validateConfiguredEventBudgetMs} from '../hooks-port/budget.js';

const SCHEMA_VERSION = 1;
const HOOK_STRATEGY = 'isolated-settings';
const SLACK_USER_RE = /^U[A-Z0-9]{8,}$/;
const BOT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORBIDDEN_LAUNCH_KEYS = new Set([
  'hooks',
  'disableAllHooks',
  'setting_sources',
  'settingSources',
  'env',
  'apiKey',
  'token',
  'secret',
]);

const ALLOWED_LAUNCH_KEYS = new Set([
  'model',
  'effort',
  'appendSystemPrompt',
  'maxTurns',
]);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function pushPath(errs, prefix, msg) {
  errs.push(prefix ? `${prefix}: ${msg}` : msg);
}

function validateAbsolutePath(errs, prefix, value, label) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    pushPath(errs, prefix, `${label} must be an absolute path`);
    return;
  }
  if (value.includes('\0')) pushPath(errs, prefix, `${label} is invalid`);
}

function looksLikeSecretString(s) {
  if (typeof s !== 'string' || s.length < 8) return false;
  if (/^sk-[A-Za-z0-9_-]{20,}$/.test(s)) return true;
  if (/^xox[baprs]-/.test(s)) return true;
  return false;
}

function validateLaunchSettings(errs, prefix, launchSettings) {
  if (launchSettings === undefined) return;
  if (!isPlainObject(launchSettings)) {
    pushPath(errs, prefix, 'launchSettings must be an object');
    return;
  }
  for (const key of Object.keys(launchSettings)) {
    if (FORBIDDEN_LAUNCH_KEYS.has(key)) {
      pushPath(errs, prefix, `launchSettings key not allowed: ${key}`);
      continue;
    }
    if (!ALLOWED_LAUNCH_KEYS.has(key)) {
      pushPath(errs, prefix, `launchSettings key not approved: ${key}`);
      continue;
    }
    const v = launchSettings[key];
    if (typeof v === 'string' && looksLikeSecretString(v)) {
      pushPath(errs, prefix, 'launchSettings must not contain inline secrets');
    }
  }
}

function validateBot(errs, prefix, bot, names) {
  if (!isPlainObject(bot)) {
    pushPath(errs, prefix, 'bot must be an object');
    return;
  }
  if (typeof bot.name !== 'string' || !BOT_NAME_RE.test(bot.name)) {
    pushPath(errs, prefix, 'bot.name invalid');
  } else if (names.has(bot.name)) {
    pushPath(errs, prefix, 'duplicate bot name');
  } else {
    names.add(bot.name);
  }
  if (typeof bot.migrated !== 'boolean') pushPath(errs, prefix, 'bot.migrated must be boolean');
  if (typeof bot.tmux_session !== 'string' || !bot.tmux_session.trim()) {
    pushPath(errs, prefix, 'bot.tmux_session required');
  }
  if (typeof bot.slack_user_id !== 'string' || !SLACK_USER_RE.test(bot.slack_user_id)) {
    pushPath(errs, prefix, 'bot.slack_user_id must look like a Slack user id');
  }
  const ox = bot.opencodex;
  if (!isPlainObject(ox)) {
    pushPath(errs, prefix, 'bot.opencodex required');
    return;
  }
  if (typeof ox.model !== 'string' || !ox.model.trim()) pushPath(errs, prefix, 'opencodex.model required');
  if (ox.baseUrl != null && (typeof ox.baseUrl !== 'string' || !/^https?:\/\//.test(ox.baseUrl))) {
    pushPath(errs, prefix, 'opencodex.baseUrl must be http(s) URL');
  }
  if (typeof ox.credentialEnv !== 'string' || !ENV_NAME_RE.test(ox.credentialEnv)) {
    pushPath(errs, prefix, 'opencodex.credentialEnv must be an env var name');
  }
  validateAbsolutePath(errs, prefix, ox.claudeExecutable, 'opencodex.claudeExecutable');
  validateLaunchSettings(errs, prefix, bot.launchSettings);
}

function isValidMatcherRegex(matcher) {
  if (typeof matcher !== 'string') return false;
  try {
    new RegExp(matcher);
    return true;
  } catch {
    return false;
  }
}

// One native policy can serve many entries (pinned-legacy = one per legacy hook): optionsKey names the options
// object in hooks.policyOptions; default = the policy name. Same rule in protocol.py and runner.py.
export function optionsKey(entry) { return typeof entry?.optionsKey === 'string' ? entry.optionsKey : entry?.nativePolicy }

function validateHookEntry(errs, prefix, entry, ids) {
  if (!isPlainObject(entry)) {
    pushPath(errs, prefix, 'hook entry must be an object');
    return;
  }
  if (typeof entry.id !== 'string' || !entry.id.trim()) pushPath(errs, prefix, 'hook entry id required');
  else if (ids.has(entry.id)) pushPath(errs, prefix, 'duplicate hook id');
  else ids.add(entry.id);
  if (typeof entry.event !== 'string' || !entry.event.trim()) pushPath(errs, prefix, 'hook entry event required');
  if (typeof entry.matcher !== 'string') pushPath(errs, prefix, 'hook entry matcher required');
  else if (!isValidMatcherRegex(entry.matcher)) pushPath(errs, prefix, 'hook entry matcher is not a valid regex');
  if (entry.optionsKey !== undefined && (entry.nativePolicy === undefined || typeof entry.optionsKey !== 'string' || !entry.optionsKey.trim())) pushPath(errs, prefix, 'optionsKey must be a non-empty string on a native entry');
  if (entry.nativePolicy !== undefined) {
    if (!validNativeEntry(entry)) pushPath(errs, prefix, 'unknown native policy/event');
    if (entry.command !== undefined) pushPath(errs, prefix, 'native policy must not have a command');
  } else if (typeof entry.command !== 'string' || !entry.command.trim()) pushPath(errs, prefix, 'hook entry command required');
  if (typeof entry.blocking !== 'boolean') pushPath(errs, prefix, 'hook entry blocking must be boolean');
  const entryCap = entryTimeoutCapMs(entry);
  if (typeof entry.timeoutMs !== 'number' || !Number.isInteger(entry.timeoutMs) || entry.timeoutMs < 1 || entry.timeoutMs > entryCap) {
    pushPath(errs, prefix, `hook entry timeoutMs must be 1..${entryCap}`);
  }
  if (typeof entry.disposition !== 'string' || !entry.disposition.trim()) pushPath(errs, prefix, 'hook entry disposition required');
  if (entry.enabled === false) pushPath(errs, prefix, 'hook entry must not be disabled');
  if (entry.retired === true) pushPath(errs, prefix, 'hook entry must not be retired');
}

function validateRequiredGateIds(errs, hooks, entryById) {
  if (!Array.isArray(hooks.requiredGateIds)) return;
  if (hooks.requiredGateIds.length === 0) {
    pushPath(errs, 'hooks', 'requiredGateIds must be non-empty');
    return;
  }
  const seen = new Set();
  for (let i = 0; i < hooks.requiredGateIds.length; i++) {
    const gateId = hooks.requiredGateIds[i];
    const loc = `hooks.requiredGateIds[${i}]`;
    if (typeof gateId !== 'string' || !gateId.trim()) {
      pushPath(errs, loc, 'required gate id must be a non-empty string');
      continue;
    }
    if (seen.has(gateId)) {
      pushPath(errs, loc, 'duplicate required gate id');
      continue;
    }
    seen.add(gateId);
    const entry = entryById.get(gateId);
    if (!entry) {
      pushPath(errs, loc, 'required gate id is not present in hooks.entries');
      continue;
    }
    if (entry.enabled === false) pushPath(errs, loc, 'required gate is disabled');
    if (entry.retired === true) pushPath(errs, loc, 'required gate is retired');
    if (entry.blocking !== true) pushPath(errs, loc, 'required gate must be blocking');
    if (typeof entry.disposition !== 'string' || !entry.disposition.trim()) {
      pushPath(errs, loc, 'required gate disposition required');
    }
  }
}

export function validateConfig(value) {
  const errs = [];
  if (!isPlainObject(value)) return { ok: false, errors: ['config must be an object'] };
  if (value.schemaVersion !== SCHEMA_VERSION) errs.push('schemaVersion must be 1');

  validateLaunchSettings(errs, '', value.launchSettings);

  if (!Array.isArray(value.bots) || value.bots.length === 0) errs.push('bots must be a non-empty array');
  else {
    const names = new Set();
    value.bots.forEach((b, i) => validateBot(errs, `bots[${i}]`, b, names));
  }

  if (value.ui !== undefined) {
    const ui = value.ui;
    if (!isPlainObject(ui)) errs.push('ui must be an object');
    else {
      if (ui.system_name !== undefined && typeof ui.system_name !== 'string') errs.push('ui.system_name must be a string');
      if (ui.memory_tools !== undefined && (!Array.isArray(ui.memory_tools) || ui.memory_tools.some(r => !isPlainObject(r) || typeof r.label !== 'string' || typeof r.match !== 'string'))) errs.push('ui.memory_tools must be [{label, match}]');
      // r2 B (ui lane): a letter A–E; an unknown letter is not an error here (the ui lane draws B and says so in one line)
      if (ui.tree_style !== undefined && typeof ui.tree_style !== 'string') errs.push('ui.tree_style must be a string (A|B|C|D|E)');
      if (ui.cron_groups !== undefined && (!Array.isArray(ui.cron_groups) || ui.cron_groups.some(r => !isPlainObject(r) || typeof r.bot !== 'string' || !Array.isArray(r.match) || r.match.some(p => typeof p !== 'string')))) errs.push('ui.cron_groups must be [{bot, match: string[]}]');
    }
  }
  if (value.memory !== undefined) {
    const m = value.memory;
    if (!isPlainObject(m)) errs.push('memory must be an object');
    else {
      if (m.recall !== undefined && !isPlainObject(m.recall)) errs.push('memory.recall must be an object');
      for (const k of ['enabled', 'selfAllow']) {
        if (isPlainObject(m.recall) && m.recall[k] !== undefined && typeof m.recall[k] !== 'boolean') errs.push(`memory.recall.${k} must be a boolean`);
      }
      if (m.guard !== undefined && !isPlainObject(m.guard)) errs.push('memory.guard must be an object');
      for (const sec of ['feedback', 'project']) {
        if (m[sec] !== undefined && !isPlainObject(m[sec])) errs.push(`memory.${sec} must be an object`);
        if (isPlainObject(m[sec]) && m[sec].enabled !== undefined && typeof m[sec].enabled !== 'boolean') errs.push(`memory.${sec}.enabled must be a boolean`);
      }
      if (isPlainObject(m.guard)) {
        for (const k of ['writeRoots', 'fetchHosts']) {
          if (m.guard[k] !== undefined && (!Array.isArray(m.guard[k]) || m.guard[k].some(x => typeof x !== 'string'))) errs.push(`memory.guard.${k} must be a string array`);
        }
        if (m.guard.python !== undefined && (typeof m.guard.python !== 'string' || !m.guard.python.startsWith('/'))) errs.push('memory.guard.python must be an absolute path');
        if (m.guard.timeoutMs !== undefined && !(Number.isInteger(m.guard.timeoutMs) && m.guard.timeoutMs >= 500 && m.guard.timeoutMs <= 20000)) errs.push('memory.guard.timeoutMs must be an integer 500..20000');
      }
    }
  }
  if (value.tools !== undefined && (!isPlainObject(value.tools) || (value.tools.progress_append !== undefined && typeof value.tools.progress_append !== 'string'))) errs.push('tools.progress_append must be a string path');

  const paths = value.paths;
  if (!isPlainObject(paths)) errs.push('paths required');
  else {
    for (const k of ['vault_root', 'room_root', 'nodeExecutable', 'pythonExecutable', 'hookRunner', 'readinessRoot', 'runtimeRoot']) {
      validateAbsolutePath(errs, 'paths', paths[k], k);
    }
  }

  const hooks = value.hooks;
  const entryById = new Map();
  if (!isPlainObject(hooks)) errs.push('hooks required');
  else {
    if (hooks.strategy !== HOOK_STRATEGY) errs.push(`hooks.strategy must be ${HOOK_STRATEGY}`);
    if (!Array.isArray(hooks.requiredGateIds)) errs.push('hooks.requiredGateIds must be an array');
    if (!Array.isArray(hooks.entries)) errs.push('hooks.entries must be an array');
    else {
      const ids = new Set();
      hooks.entries.forEach((e, i) => {
        validateHookEntry(errs, `hooks.entries[${i}]`, e, ids);
        if (e && e.nativePolicy !== undefined && !isPlainObject(hooks.policyOptions?.[optionsKey(e)])) pushPath(errs, `hooks.entries[${i}]`, 'native policy options required');
        if (isPlainObject(e) && typeof e.id === 'string' && e.id.trim()) entryById.set(e.id, e);
      });
    }
    validateRequiredGateIds(errs, hooks, entryById);
    if (hooks.maxEventMs !== undefined && !validateConfiguredEventBudgetMs(hooks.maxEventMs)) {
      pushPath(errs, 'hooks', 'maxEventMs must be an integer in 1..7000; TypeSafe tool budget is derived');
    }
  }

  return errs.length ? { ok: false, errors: errs } : { ok: true, value };
}

export function getBot(config, name) {
  const v = validateConfig(config);
  if (!v.ok) return { ok: false, errors: v.errors };
  const bot = v.value.bots.find((b) => b.name === name);
  if (!bot) return { ok: false, errors: ['unknown bot'] };
  return { ok: true, bot };
}

export function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

export function shellQuote(arg) {
  if (typeof arg !== 'string') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function buildDetectorCommand(pythonExecutable, pluginRoot, configPath, sessionId) {
  const detector = `${pluginRoot}/src/hooks-port/detector.py`;
  const parts = [pythonExecutable, detector, '--config', configPath, '--session', sessionId];
  return parts.map(shellQuote).join(' ');
}

export function register(on, options) {
  // stub — mod lane no-op
}
