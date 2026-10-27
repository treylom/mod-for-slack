// Node-only: load config from disk and prepare Claude launch.
import fs from 'node:fs';
import path from 'node:path';
import {
  validateConfig,
  getBot,
  isUuid,
  buildDetectorCommand,
} from './index.js';

export { validateConfig, getBot, isUuid, buildDetectorCommand };

const SESSION_SETTINGS_NAME = 'config.session-settings.json';
const PRESERVE_ENV = ['USER', 'LOGNAME', 'TMUX', 'TMUX_PANE'];
const DETECTOR_HOOK_TIMEOUT_SEC = 7;
const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;

function resolveAbsolute(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) {
    throw new Error('configPath must be an absolute path');
  }
  return path.resolve(p);
}

function resolvePluginRoot(pluginRoot) {
  if (typeof pluginRoot !== 'string' || !pluginRoot.startsWith('/')) {
    throw new Error('pluginRoot must be an absolute path');
  }
  return path.resolve(pluginRoot);
}

function assertSessionId(sessionId) {
  if (!isUuid(sessionId)) {
    throw new Error('sessionId must be a UUID');
  }
  if (sessionId.includes('/') || sessionId.includes('..')) {
    throw new Error('sessionId invalid');
  }
  return sessionId;
}

function sessionDirUnderRuntime(runtimeRoot, sessionId) {
  const root = path.resolve(runtimeRoot);
  const dir = path.resolve(root, sessionId);
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('session path escapes runtimeRoot');
  }
  return dir;
}

function canonicalConfigJson(config) {
  const v = validateConfig(config);
  if (!v.ok) {
    const msg = v.errors.slice(0, 3).join('; ');
    throw new Error(msg || 'invalid config');
  }
  return JSON.stringify(v.value);
}

function assertConfigMatchesOnDisk(absConfigPath, normalizedConfig) {
  const onDisk = readJsonFile(absConfigPath);
  const expected = canonicalConfigJson(normalizedConfig);
  const actual = canonicalConfigJson(onDisk);
  if (expected !== actual) {
    throw new Error('config on disk does not match provided config');
  }
}

function assertNoSymlinkInPath(absPath) {
  let current = path.resolve(absPath);
  const root = path.parse(current).root;
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error('session path must not traverse a symlink');
      }
    } catch (e) {
      if (!(e && e.code === 'ENOENT')) {
        if (e instanceof Error && e.message.includes('symlink')) throw e;
        throw new Error('session path is not accessible');
      }
      // Continue toward existing ancestors even when this path is missing.
      current = path.dirname(current);
      continue;
    }
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertOwnedByProcess(absPath) {
  const st = fs.lstatSync(absPath);
  if (st.uid !== process.getuid()) {
    throw new Error('session path owner mismatch');
  }
}

function assertPrivateDirMode(absPath) {
  const st = fs.lstatSync(absPath);
  if (!st.isDirectory()) throw new Error('session path is not a directory');
  const mode = st.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error('session directory must not be group or world accessible');
  }
  if (mode !== SESSION_DIR_MODE) {
    throw new Error('session directory permissions invalid');
  }
}

function assertPrivateFileMode(absPath) {
  const st = fs.lstatSync(absPath);
  if (st.isSymbolicLink()) throw new Error('session settings must not be a symlink');
  if (!st.isFile()) throw new Error('session settings path invalid');
  const mode = st.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error('session settings must not be group or world accessible');
  }
  if (mode !== SESSION_FILE_MODE) {
    throw new Error('session settings permissions invalid');
  }
  assertOwnedByProcess(absPath);
}

function readJsonFile(configPath) {
  const abs = resolveAbsolute(configPath);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new Error('config file not found');
    throw new Error('config file unreadable');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('config file is not valid JSON');
  }
}

export function loadConfig({ configPath, env } = {}) {
  if (configPath == null) {
    const fromEnv = env && typeof env.MODS_HARNESS_CONFIG === 'string' ? env.MODS_HARNESS_CONFIG : null;
    if (!fromEnv) throw new Error('configPath required');
    configPath = fromEnv;
  }
  const parsed = readJsonFile(configPath);
  const v = validateConfig(parsed);
  if (!v.ok) {
    const msg = v.errors.slice(0, 3).join('; ');
    throw new Error(msg || 'invalid config');
  }
  return { config: v.value, configPath: resolveAbsolute(configPath) };
}

function buildSessionSettings(pythonExecutable, pluginRoot, configPath, sessionId) {
  const command = buildDetectorCommand(pythonExecutable, pluginRoot, configPath, sessionId);
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command,
              timeout: DETECTOR_HOOK_TIMEOUT_SEC,
              onFailure: 'block',
            },
          ],
        },
      ],
    },
  };
}

function countExternalHooks(settings) {
  let n = 0;
  const hooks = settings && settings.hooks;
  if (!hooks || typeof hooks !== 'object') return 0;
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const block of entries) {
      const inner = block && block.hooks;
      if (Array.isArray(inner)) n += inner.length;
    }
  }
  return n;
}

function writeSessionArtifacts(runtimeRoot, sessionDir, settings) {
  assertNoSymlinkInPath(runtimeRoot);
  assertNoSymlinkInPath(sessionDir);
  fs.mkdirSync(runtimeRoot, {recursive:true, mode:SESSION_DIR_MODE});
  assertOwnedByProcess(runtimeRoot);
  assertPrivateDirMode(runtimeRoot);
  const settingsPath = path.join(sessionDir, SESSION_SETTINGS_NAME);
  const payload = JSON.stringify(settings, null, 2) + '\n';
  if (fs.existsSync(sessionDir)) {
    if (fs.lstatSync(sessionDir).isSymbolicLink()) {
      throw new Error('session directory must not be a symlink');
    }
    assertOwnedByProcess(sessionDir);
    assertPrivateDirMode(sessionDir);
    const entries = fs.readdirSync(sessionDir);
    const allowed = new Set([SESSION_SETTINGS_NAME]);
    const unexpected = entries.filter((e) => !allowed.has(e));
    if (unexpected.length > 0) {
      throw new Error('session directory already exists with conflicting content');
    }
    if (fs.existsSync(settingsPath)) {
      if (fs.lstatSync(settingsPath).isSymbolicLink()) {
        throw new Error('session settings must not be a symlink');
      }
      assertPrivateFileMode(settingsPath);
      let existing;
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        throw new Error('session directory already exists with conflicting content');
      }
      const next = JSON.stringify(settings);
      const prev = JSON.stringify(existing);
      if (next !== prev) {
        throw new Error('session directory already exists with conflicting content');
      }
      return settingsPath;
    }
  } else {
    fs.mkdirSync(sessionDir, { recursive: true, mode: SESSION_DIR_MODE });
    assertOwnedByProcess(sessionDir);
    assertPrivateDirMode(sessionDir);
  }
  let fd;
  try {
    fd = fs.openSync(settingsPath, 'wx', SESSION_FILE_MODE);
    fs.writeFileSync(fd, payload, { encoding: 'utf8' });
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw new Error('session settings file already exists');
    }
    throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  assertPrivateFileMode(settingsPath);
  return settingsPath;
}

function buildLaunchEnv({ bot, botName, configPath, sessionId, callerEnv }) {
  const env = {};
  for (const k of PRESERVE_ENV) {
    const v = callerEnv && callerEnv[k];
    if (typeof v === 'string' && v !== '') env[k] = v;
  }
  env.MODS_HARNESS_CONFIG = configPath;
  env.MODS_HARNESS_BOT = botName;
  env.MODS_HARNESS_SESSION_ID = sessionId;
  const baseUrl = bot.opencodex.baseUrl;
  if (typeof baseUrl === 'string' && baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  const credName = bot.opencodex.credentialEnv;
  if (typeof credName === 'string' && callerEnv && typeof callerEnv[credName] === 'string') {
    env[credName] = callerEnv[credName];
  }
  return env;
}

export function prepareLaunch(config, botName, { sessionId, pluginRoot, configPath, env: callerEnv } = {}) {
  const v = validateConfig(config);
  if (!v.ok) {
    const msg = v.errors.slice(0, 3).join('; ');
    throw new Error(msg || 'invalid config');
  }
  const cfg = v.value;
  if (!Array.isArray(cfg.hooks.requiredGateIds) || cfg.hooks.requiredGateIds.length === 0) {
    throw new Error('required gates must be configured');
  }
  const got = getBot(cfg, botName);
  if (!got.ok) throw new Error(got.errors[0] || 'unknown bot');
  const bot = got.bot;
  if (bot.migrated !== true) {
    throw new Error('bot is not migrated');
  }
  if (!configPath) throw new Error('configPath required');
  const absConfig = resolveAbsolute(configPath);
  assertConfigMatchesOnDisk(absConfig, cfg);
  const absPlugin = resolvePluginRoot(pluginRoot);
  const sid = assertSessionId(sessionId);
  const runtimeRoot = path.resolve(cfg.paths.runtimeRoot);
  const sessionDir = sessionDirUnderRuntime(runtimeRoot, sid);
  const settings = buildSessionSettings(cfg.paths.pythonExecutable, absPlugin, absConfig, sid);
  if (countExternalHooks(settings) !== 1) {
    throw new Error('session settings must contain exactly one hook');
  }
  const hookTimeout = settings.hooks.PreToolUse[0].hooks[0].timeout;
  if (hookTimeout !== DETECTOR_HOOK_TIMEOUT_SEC) {
    throw new Error('session hook timeout invalid');
  }
  const settingsPath = writeSessionArtifacts(runtimeRoot, sessionDir, settings);
  const executable = bot.opencodex.claudeExecutable;
  const requiredArgs = [
    '--setting-sources',
    '',
    '--settings',
    settingsPath,
    '--session-id',
    sid,
    '--plugin-dir',
    absPlugin,
  ];
  const argv = [executable, ...requiredArgs];
  const env = buildLaunchEnv({ bot, botName, configPath: absConfig, sessionId: sid, callerEnv });
  return {
    executable,
    argv,
    env,
    settingsPath,
    sessionId: sid,
    requiredArgs,
  };
}
