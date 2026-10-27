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

export interface ChannelEnv {
  SLACK_BOT_TOKEN: string;
  SLACK_APP_TOKEN: string;
  ALLOWED_SLACK_USER_ID: string;
  // One or more C… channel ids, comma-separated (2026-08-13). A single id —
  // the only form that existed before — keeps behaving exactly as it did; the
  // first id in the list stays the "primary" one used as the outbound
  // fallback when a message carries no channel of its own (permission asks).
  SLACK_CHANNEL_ID: string;
  // OPTIONAL (2026-09-23): emoji name this bot reacts with the moment it accepts an
  // inbound — its per-bot "read receipt" (maintainer: every bot reacts differently so
  // one glance shows who received a broadcast). Unset = 'eyes'.
  SLACK_BOT_EMOJI?: string;
  // OPTIONAL (2026-09-26): '1' turns on the per-bot Slack notice for a peer bot that
  // mentions this one but is not on ALLOWED_SLACK_BOT_USER_IDS (drop-notice.ts). Unset =
  // record the drop only. Per-bot so it can be enabled on one bridge first.
  SLACK_DROP_NOTICE?: string;
  // OPTIONAL: '1' turns on the raw receipt log (raw-log.ts): one metadata-only JSONL line per message
  // event — sender id, channel, timestamp, no body — in ~/.claude-state/bridge-raw-<bot>.jsonl, rotated at
  // 64 MiB to one `.1`. Unset (or anything but exactly '1') = no file. This .env key is the only switch.
  // Turn it on only for a silence watcher that reads the file.
  SLACK_RAW_LOG?: string;
  // OPTIONAL (2026-10-18): '0' stops broadcasting threaded DM replies into the DM
  // (reply_broadcast). Unset = broadcast (the maintainer's default: DM replies go in the
  // message's thread AND show in the DM so they notify).
  SLACK_DM_REPLY_BROADCAST?: string;
  // OPTIONAL (2026-10-19): owner-tag DM copy (owner-tag-copy.ts). When this bot's reply to a
  // non-DM conversation tags the owner (<@ALLOWED_SLACK_USER_ID>), one short copy (template line +
  // the first line of the post) also goes into this bot's DM with the owner. OFF unless
  // SLACK_OWNER_TAG_DM_COPY_CHANNEL (the D… id of that DM) is set.
  SLACK_OWNER_TAG_DM_COPY_CHANNEL?: string;
  // OPTIONAL: owner id when it differs from ALLOWED_SLACK_USER_ID. Unset = ALLOWED_SLACK_USER_ID.
  SLACK_OWNER_TAG_DM_COPY_USER?: string;
  // OPTIONAL: first line of the copy; `{bot}` and `{link}` (required) are filled in.
  // Unset = "[{bot}] mentioned you in a thread — {link}".
  SLACK_OWNER_TAG_DM_COPY_TEMPLATE?: string;
  // OPTIONAL (2026-10-22): '1' turns on the per-bot Slack notice for a peer bot that IS
  // on ALLOWED_SLACK_BOT_USER_IDS but posted without mentioning this one (drop reason
  // 'bot-no-mention'). Unset = record the drop only. Separate from SLACK_DROP_NOTICE and
  // rate-limited on its own: with message.channels subscribed it can fire on any peer post.
  // 2026-10-24: this .env key is the only switch (no process-env fallback — one pilot bot,
  // not every bot started from one shell); see no-mention-notice.ts.
  SLACK_DROP_NOTICE_NO_MENTION?: string;
  // Read only to refuse a double switch (2026-10-24): the 10-13 pilot candidate's key for
  // the same drop. If it is on together with SLACK_DROP_NOTICE_NO_MENTION, neither posts.
  SLACK_DROP_PILOT_NOTICE?: string;
  // The pilot's global emergency key; truthy here (or in the process env) also keeps the
  // no-mention notice OFF — one emergency stop for both paths.
  SLACK_DROP_PILOT_EMERGENCY_OFF?: string;
  // (B) bot-interop (2026-08-07) — OPTIONAL and absent by default.
  // Comma-separated U… ids of OTHER bridge bots allowed to speak to this
  // one. Unset/empty = every bot message drops, which is exactly the
  // pre-(B) behavior (fail closed, zero regression for existing installs).
  // Parsing lives in server.ts next to the gate that uses it. There is
  // deliberately no chain-limit knob (2026-08-07 주인 "빼자" — the ported
  // Discord device is mention-pass + allowlist only; see server.ts). The
  // per-sender volume cap below (2026-10-25) is not a chain limit.
  ALLOWED_SLACK_BOT_USER_IDS?: string;
  // OPTIONAL (2026-10-25): volume cap per allowed peer bot — at most SLACK_PEER_BOT_RATE_MAX posts from one
  // peer reach the session within any SLACK_PEER_BOT_RATE_WINDOW_S seconds; the rest are dropped
  // ('bot-rate-limited') and one log line per sender per window says so. Plain digits only. Unset = 30 per
  // 600 s. MAX=0 switches the cap off; a bad value is ignored (default, with a warning). Owner and guests are
  // never counted. See parsePeerRate below.
  SLACK_PEER_BOT_RATE_MAX?: string;
  SLACK_PEER_BOT_RATE_WINDOW_S?: string;
  // OPTIONAL, absent by default: comma-separated U… ids of PEOPLE (besides ALLOWED_SLACK_USER_ID, the
  // owner) who may talk to this bot in a channel it listens to. A guest post passes only with this bot's
  // own @mention, never in a DM, and reaches the session tagged meta.sender_role="guest" (conversation
  // only — see mcp.ts instructions). Unset/empty = no guests = the owner-only gate, unchanged.
  ALLOWED_SLACK_GUEST_IDS?: string;
  // OPTIONAL, bot only: path to a dedicated 32-byte signing key for
  // typesafe approval button receipts. Unset keeps the feature disabled.
  TYPESAFE_APPROVAL_BUTTON_KEY_FILE?: string;
  // OPTIONAL: non-secret, shared per-bot table. Both paths must be set for a
  // bot's button listener; unknown or disabled rows keep existing behavior.
  TYPESAFE_APPROVAL_BUTTON_BOTS_FILE?: string;
}

const REQUIRED_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'ALLOWED_SLACK_USER_ID', 'SLACK_CHANNEL_ID'] as const;

/**
 * Splits the comma-separated SLACK_CHANNEL_ID into ids, first one first.
 * Blank entries and stray whitespace are dropped so a trailing comma or a
 * `C1, C2` spelling both parse. Throws rather than returning an empty list:
 * an empty channel set would silently drop every channel message, which is
 * safe but undiagnosable (same fail-fast argument as botUserId in server.ts).
 */
export function parseChannelIds(raw: string): string[] {
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('SLACK_CHANNEL_ID has no channel ids after parsing');
  // ANY_MEMBER_CHANNEL may appear anywhere but first: the first entry is the
  // primary channel (outbound fallback) and must be a real id.
  if (ids[0] === ANY_MEMBER_CHANNEL) throw new Error(`SLACK_CHANNEL_ID: the first entry must be a channel id, not '${ANY_MEMBER_CHANNEL}'`);
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
export function parsePeerRate(env: { SLACK_PEER_BOT_RATE_MAX?: string; SLACK_PEER_BOT_RATE_WINDOW_S?: string }): {
  max: number;
  windowMs: number;
  warnings: string[];
} {
  const warnings: string[] = [];
  const read = (key: 'SLACK_PEER_BOT_RATE_MAX' | 'SLACK_PEER_BOT_RATE_WINDOW_S', fallback: number, min: number): number => {
    const raw = (env[key] ?? '').trim();
    if (raw === '') return fallback;
    if (/^\d{1,7}$/.test(raw) && Number(raw) >= min) return Number(raw);
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
export function mentionChannelType(channelType: string | undefined): string {
  return channelType ?? 'channel';
}

export function log(scope: string, message: string): void {
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
export function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(STATE_DIR, 0o700);
}

/**
 * Loads and validates the .env file. Never logs or returns anything beyond
 * what the caller explicitly reads off the returned object — callers must
 * not print token values (see README "Token handling").
 */
export function loadEnv(): ChannelEnv {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      `missing ${ENV_PATH} — copy .env.example there and fill in real values (see README.md "Setup").`,
    );
  }

  const mode = statSync(ENV_PATH).mode & 0o777;
  if (mode !== 0o600) {
    log(
      'config',
      `WARN ${ENV_PATH} has mode ${mode.toString(8)}, expected 0600 (secrets may be group/world-readable). ` +
        `Fix with: chmod 600 ${ENV_PATH}`,
    );
  }

  const raw = readFileSync(ENV_PATH, 'utf8');
  const values: Record<string, string> = {};
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
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

  return values as unknown as ChannelEnv;
}
