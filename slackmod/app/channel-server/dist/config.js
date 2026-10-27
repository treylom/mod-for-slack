// Shared paths, env loading, and logging for both the resident server
// (server.ts) and the per-session MCP stdio proxy (mcp.ts).
import { existsSync, mkdirSync, chmodSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
/**
 * State directory holding the .env, the Unix socket, and the singleton
 * pidfile. Defaults to the same `~/.claude/channels/slack/` convention the
 * `/slack:configure` setup skill already uses, so a fresh checkout only
 * needs the .env dropped in place — no new path to learn.
 */
export const STATE_DIR = process.env.CLAUDE_CHANNEL_SLACK_DIR ?? join(homedir(), '.claude', 'channels', 'slack');
export const ENV_PATH = join(STATE_DIR, '.env');
export const SOCKET_PATH = join(STATE_DIR, 'primary.sock');
export const PID_PATH = join(STATE_DIR, 'primary.pid');
const REQUIRED_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'ALLOWED_SLACK_USER_ID', 'SLACK_CHANNEL_ID'];
/**
 * Splits the comma-separated SLACK_CHANNEL_ID into ids, first one first.
 * Blank entries and stray whitespace are dropped so a trailing comma or a
 * `C1, C2` spelling both parse. Throws rather than returning an empty list:
 * an empty channel set would silently drop every channel message, which is
 * safe but undiagnosable (same fail-fast argument as botUserId in server.ts).
 */
export function parseChannelIds(raw) {
    const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0)
        throw new Error('SLACK_CHANNEL_ID has no channel ids after parsing');
    // ANY_MEMBER_CHANNEL may appear anywhere but first: the first entry is the
    // primary channel (outbound fallback) and must be a real id.
    if (ids[0] === ANY_MEMBER_CHANNEL)
        throw new Error(`SLACK_CHANNEL_ID: the first entry must be a channel id, not '${ANY_MEMBER_CHANNEL}'`);
    return ids;
}
/** Volume cap per allowed peer bot (2026-10-25): defaults for SLACK_PEER_BOT_RATE_MAX / SLACK_PEER_BOT_RATE_WINDOW_S. */
export const PEER_RATE_DEFAULT_MAX = 30;
export const PEER_RATE_DEFAULT_WINDOW_S = 600;
/**
 * Reads the two peer-bot cap keys from the bridge .env. Plain digits (at most 7) only: anything else —
 * a sign, a decimal, an exponent, text — is ignored with a warning and the DEFAULT applies, so a typo can
 * never switch the cap off. The one way to switch it off is a deliberate MAX=0. A window of 0 seconds
 * would make the cap meaningless, so it falls back to the default too. An unset or blank key is silent.
 * A warning names the key, never the value.
 */
export function parsePeerRate(env) {
    const warnings = [];
    const read = (key, fallback, min) => {
        const raw = (env[key] ?? '').trim();
        if (raw === '')
            return fallback;
        if (/^\d{1,7}$/.test(raw) && Number(raw) >= min)
            return Number(raw);
        warnings.push(`${key} is not a plain whole number${min > 0 ? ' of at least ' + min : ''} — using the default ${fallback}`);
        return fallback;
    };
    const max = read('SLACK_PEER_BOT_RATE_MAX', PEER_RATE_DEFAULT_MAX, 0);
    const windowS = read('SLACK_PEER_BOT_RATE_WINDOW_S', PEER_RATE_DEFAULT_WINDOW_S, 1);
    return { max, windowMs: windowS * 1000, warnings };
}
/**
 * Wildcard entry for SLACK_CHANNEL_ID (2026-09-23): `C…,*` means "the primary
 * channel plus every channel this bot has been invited to". The invite then
 * IS the allowlist — no .env edit and bridge restart per new channel. Slack
 * only delivers channel events for conversations the bot is a member of, and
 * the sender gate still applies: inviting the bot — by anyone the workspace
 * lets invite apps — is the opt-in, and the sender gate still limits what is
 * forwarded. Note the outbound side widens too (see README, hardening (a)).
 */
export const ANY_MEMBER_CHANNEL = '*';
/**
 * `app_mention` payloads carry no `channel_type` (see the payload examples at
 * docs.slack.dev/reference/events/app_mention), and Slack never dispatches
 * `app_mention` for DMs. With the default subscription (`app_mention` +
 * `message.im`, no `message.channels`) channel posts arrive only as
 * `app_mention`, so a missing type is tagged 'channel' — otherwise the `*`
 * wildcard gate, which requires 'channel'/'group', would silently drop every
 * channel that is not listed explicitly. A type Slack did send is kept.
 */
export function mentionChannelType(channelType) {
    return channelType ?? 'channel';
}
export function log(scope, message) {
    // stderr only — stdout is the MCP stdio transport in mcp.ts and must stay
    // pure JSON-RPC. server.ts has no such constraint but uses stderr too for
    // one consistent habit across both entry points.
    process.stderr.write(`[${new Date().toISOString()}] [${scope}] ${message}\n`);
}
/**
 * Creates the state directory as 0700 if missing, and tightens it to 0700
 * if it already existed with looser permissions (e.g. created by a stray
 * `mkdir -p` without the mode, or a leftover from before this project
 * existed). This is the code-side half of what the `/slack:configure` skill
 * previously only documented as a one-time manual `chmod 700` — see
 * README.md "Security model" for the audit finding this closes.
 */
export function ensureStateDir() {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    chmodSync(STATE_DIR, 0o700);
}
/**
 * Loads and validates the .env file. Never logs or returns anything beyond
 * what the caller explicitly reads off the returned object — callers must
 * not print token values (see README "Token handling").
 */
export function loadEnv() {
    if (!existsSync(ENV_PATH)) {
        throw new Error(`missing ${ENV_PATH} — copy .env.example there and fill in real values (see README.md "Setup").`);
    }
    const mode = statSync(ENV_PATH).mode & 0o777;
    if (mode !== 0o600) {
        log('config', `WARN ${ENV_PATH} has mode ${mode.toString(8)}, expected 0600 (secrets may be group/world-readable). ` +
            `Fix with: chmod 600 ${ENV_PATH}`);
    }
    const raw = readFileSync(ENV_PATH, 'utf8');
    const values = {};
    for (const rawLine of raw.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;
        const eq = line.indexOf('=');
        if (eq === -1)
            continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    const missing = REQUIRED_KEYS.filter((key) => !values[key]);
    if (missing.length > 0) {
        throw new Error(`${ENV_PATH} is missing required key(s): ${missing.join(', ')}`);
    }
    return values;
}
