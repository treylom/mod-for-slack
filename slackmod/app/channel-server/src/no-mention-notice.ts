// No-mention notifier, one policy (2026-10-24). Extends the 10-22 opt-in notice
// for 'bot-no-mention' drops (drop-notice.ts) with:
//   - one switch: the per-bot .env key SLACK_DROP_NOTICE_NO_MENTION=1 only (no
//     process-env fallback — that would turn on every bot started from one shell,
//     and the pilot is one receiving bot). If the 10-13 pilot candidate's own key
//     SLACK_DROP_PILOT_NOTICE is also on, both are refused: two paths never post
//     for the same drop.
//   - the 10-13 policy's shared emergency-off file, checked on every drop.
//   - one notice per (sender, channel, thread root), persisted for a day, on top
//     of the 30-min pair / 10-per-hour budget: a sender that answers the notice
//     without a mention never draws a second one in that thread (no notice loop).
//   - three receipts kept apart and joined by one notice id (the text ends in
//     ` · nm:<id>`): 'posted' (or 'post-failed') where the notice was sent,
//     'bridge-received' where the sender's bridge accepted it as a trusted notice,
//     'session-reached' when that bridge's MCP proxy handed it to a session
//     ('session-none' when no session was attached). Receipts are metadata only.
// No network here: the caller passes the post function.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type DropNotifier, ensureOwnDir, noMentionNoticeText, openOwnFile } from './drop-notice.js';

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

// ---- the one switch -----------------------------------------------------------

/** The 10-13 pilot candidate reads its key this way (drop-pilot.ts): 1/true/yes/on. */
export function pilotSwitchOn(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? '').trim());
}

export interface NoMentionSwitch {
  enabled: boolean;
  /** Both this key and the pilot key are on: refused, nothing is posted. */
  conflict: boolean;
}

type PilotKeys = { SLACK_DROP_PILOT_NOTICE?: string; SLACK_DROP_PILOT_EMERGENCY_OFF?: string };

/**
 * `env` = this bot's .env; `processEnv` = process.env. Only the .env key turns
 * this notice on. The pilot's two keys are read exactly as the pilot reads them
 * (.env value, else process env — drop-pilot server.ts:116-117), so the process
 * env can only turn things OFF here: the pilot's global emergency key stops
 * this notice too, and a pilot switched on from either place is a conflict.
 */
export function resolveNoMentionSwitch(
  env: { SLACK_DROP_NOTICE_NO_MENTION?: string } & PilotKeys,
  processEnv: PilotKeys | Record<string, string | undefined> = {},
): NoMentionSwitch {
  const on = env.SLACK_DROP_NOTICE_NO_MENTION === '1';
  if (pilotSwitchOn(env.SLACK_DROP_PILOT_EMERGENCY_OFF ?? processEnv.SLACK_DROP_PILOT_EMERGENCY_OFF)) return { enabled: false, conflict: false };
  if (on && pilotSwitchOn(env.SLACK_DROP_PILOT_NOTICE ?? processEnv.SLACK_DROP_PILOT_NOTICE)) return { enabled: false, conflict: true };
  return { enabled: on, conflict: false };
}

/** Same id on both ends for the same dropped post (Slack redelivery included). */
export function noticeId(selfUserId: string, channel: string, messageTs: string): string {
  return createHash('sha256').update(`${selfUserId}|${channel}|${messageTs}`).digest('hex').slice(0, 12);
}

const NOTICE_RE = /^<@([^>\s]+)> \[자동 · ([^\]\n]{1,64}) 브리지\] .* · nm:([0-9a-f]{12})$/s;

/**
 * A notice is trusted only when its whole text is exactly what
 * noMentionNoticeText would produce for (this bot, that bridge, the id), with
 * the poster's own Slack-verified user id in the body. The caller must only ask
 * for posts from an allowed peer bot (server.ts calls this inside the bot
 * branch, after the allowlist and the mention gate).
 */
export function parseTrustedNotice(text: string, selfUserId: string, fromUserId: string): { id: string; name: string } | null {
  const m = NOTICE_RE.exec(text);
  if (!m || m[1] !== selfUserId) return null;
  const name = m[2]!;
  const id = m[3]!;
  if (noMentionNoticeText(selfUserId, name, fromUserId, id) !== text) return null;
  return { id, name };
}

// ---- receipts -----------------------------------------------------------------

export type ReceiptKind = 'posted' | 'post-failed' | 'notice-conflict' | 'bridge-received' | 'session-reached' | 'session-none';

export interface Receipt {
  ts: string;
  kind: ReceiptKind;
  notice_id?: string;
  channel?: string;
  thread?: string;
  peer?: string;
  message_ts?: string;
  session_id?: string;
  error?: string;
}

const RECEIPT_MAX_BYTES = 2 * 1024 * 1024;

/** One JSONL line, metadata only; same file safety and rotation as logDrop. Never throws. */
export function appendReceipt(path: string, rec: Receipt, maxBytes: number = RECEIPT_MAX_BYTES): void {
  try {
    ensureOwnDir(dirname(path));
    try {
      if (existsSync(path) && statSync(path).size >= maxBytes) renameSync(path, `${path}.1`);
    } catch {
      // Best effort, like logDrop.
    }
    const row = {
      ts: rec.ts,
      kind: rec.kind,
      notice_id: rec.notice_id,
      channel: rec.channel,
      thread: rec.thread,
      peer: rec.peer,
      message_ts: rec.message_ts,
      session_id: rec.session_id,
      error: rec.error,
    };
    const fd = openOwnFile(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
    try {
      writeSync(fd, `${JSON.stringify(row)}\n`);
    } finally {
      closeSync(fd);
    }
  } catch {
    // A receipt failure never changes delivery.
  }
}

// ---- persistent ledger ----------------------------------------------------------

// Fixed values (bot 2026-10-설계 메모): one notice per thread is remembered 1 day,
// a received notice id 7 days.
export const THREAD_TTL_MS = 24 * 60 * 60 * 1000;
export const NOTICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEDGER_CAP = 2000;

interface LedgerState {
  /** `${sender}|${channel}|${threadRoot}` -> epoch ms a notice was sent for it. */
  threads: Record<string, number>;
  /** notice id -> epoch ms it was first accepted here as a trusted notice. */
  notices: Record<string, number>;
}

function numbers(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function prune(map: Record<string, number>, nowMs: number, ttl: number): Record<string, number> {
  const kept = Object.entries(map).filter(([, t]) => nowMs - t < ttl).sort((x, y) => x[1] - y[1]);
  return Object.fromEntries(kept.slice(-LEDGER_CAP));
}

/** Both dedups of one bridge, in one state file it owns (same write discipline as DropNotifier). */
export class NoticeLedger {
  private readonly path: string;
  private readonly now: () => number;
  private state: LedgerState;
  /**
   * The state file exists but could not be read as ours (corrupt JSON, a symlink,
   * another owner...). Starting fresh would forget which threads were already
   * noticed (a dedup reset), so instead the sender posts nothing and nothing is
   * written over the file; the receiver still dedups in memory. Removing the
   * file (operator) clears it on the next start.
   */
  readonly broken: boolean;

  constructor(path: string, now: () => number = Date.now) {
    this.path = path;
    this.now = now;
    const loaded = this.load();
    this.state = loaded.state;
    this.broken = loaded.broken;
  }

  private load(): { state: LedgerState; broken: boolean } {
    if (!existsSync(this.path)) return { state: { threads: {}, notices: {} }, broken: false };
    try {
      const fd = openOwnFile(this.path, constants.O_RDONLY);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(fd, 'utf8'));
      } finally {
        closeSync(fd);
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a ledger object');
      const raw = parsed as Record<string, unknown>;
      return { state: { threads: numbers(raw.threads), notices: numbers(raw.notices) }, broken: false };
    } catch {
      return { state: { threads: {}, notices: {} }, broken: true };
    }
  }

  private persist(): boolean {
    if (this.broken) return false; // never write over a file we could not read (see `broken`)
    const dir = dirname(this.path);
    const tmp = join(dir, `.${basename(this.path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    let fd: number | undefined;
    try {
      ensureOwnDir(dir);
      fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
      fchmodSync(fd, 0o600);
      writeSync(fd, JSON.stringify(this.state));
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(tmp, this.path);
      return true;
    } catch {
      if (fd !== undefined) closeSync(fd);
      try {
        unlinkSync(tmp);
      } catch {
        // Never created.
      }
      return false;
    }
  }

  hasThread(key: string): boolean {
    const t = this.state.threads[key];
    return t !== undefined && this.now() - t < THREAD_TTL_MS;
  }

  /** False when it could not be saved — the sender then posts nothing (fail closed). */
  addThread(key: string): boolean {
    const nowMs = this.now();
    this.state.threads = prune({ ...this.state.threads, [key]: nowMs }, nowMs, THREAD_TTL_MS);
    return this.persist();
  }

  hasNotice(id: string): boolean {
    const t = this.state.notices[id];
    return t !== undefined && this.now() - t < NOTICE_TTL_MS;
  }

  /** Kept in memory either way; false only means it will not survive a restart. */
  addNotice(id: string): boolean {
    const nowMs = this.now();
    this.state.notices = prune({ ...this.state.notices, [id]: nowMs }, nowMs, NOTICE_TTL_MS);
    return this.persist();
  }
}

function emergencyOff(path: string): boolean {
  try {
    lstatSync(path); // present in any form (file, link, dir) = off
    return true;
  } catch {
    return false;
  }
}

function errorKind(err: unknown): string {
  const e = err as { code?: unknown; data?: { error?: unknown }; name?: unknown } | undefined;
  for (const v of [e?.data?.error, e?.code, e?.name]) if (typeof v === 'string' && v) return v.slice(0, 64);
  return 'error';
}

// ---- sender side: the bridge that dropped the post ---------------------------

export interface NoticeEvent {
  user?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
}

export type PostNotice = (args: { channel: string; thread_ts: string; text: string }) => Promise<unknown>;

export type NotifyOutcome =
  | 'posted'
  | 'post-failed'
  | 'emergency-off'
  | 'ledger-broken'
  | 'thread-noticed'
  | 'rate-limited'
  | 'ledger-unsaved'
  | 'incomplete';

export interface NoMentionSenderOptions {
  /** Read at call time: server.ts learns its own id after start-up. */
  selfUserId: () => string;
  botName: string;
  ledger: NoticeLedger;
  /** The 10-22 pair / hourly budget (DropNotifier). */
  rate: DropNotifier;
  post: PostNotice;
  receiptPath: string;
  offPath: string;
  now?: () => number;
}

/**
 * Call only after shouldNotifyNoMention passed and the switch is on. Order:
 * emergency off -> broken ledger file -> thread already noticed -> pair/hour
 * budget check (nothing spent) -> save the thread mark (unsaved = nothing posted,
 * budget untouched) -> spend the budget -> post. The budget and the thread mark
 * are spent before the post, so a failing post is not retried into a storm.
 */
export class NoMentionSender {
  constructor(private readonly o: NoMentionSenderOptions) {}

  async notify(ev: NoticeEvent): Promise<NotifyOutcome> {
    const { user: sender, channel, ts } = ev;
    if (!sender || !channel || !ts) return 'incomplete';
    if (emergencyOff(this.o.offPath)) return 'emergency-off';
    if (this.o.ledger.broken) return 'ledger-broken';
    const root = ev.thread_ts ?? ts;
    const key = `${sender}|${channel}|${root}`;
    if (this.o.ledger.hasThread(key)) return 'thread-noticed';
    if (!this.o.rate.wouldAllow(sender, channel)) return 'rate-limited';
    if (!this.o.ledger.addThread(key)) return 'ledger-unsaved';
    // Only fails here if the rate state itself cannot be saved (DropNotifier then
    // stops all notices); the thread mark is already kept, so that thread stays quiet.
    if (!this.o.rate.allow(sender, channel)) return 'rate-limited';
    const self = this.o.selfUserId();
    const id = noticeId(self, channel, ts);
    const nowIso = () => new Date((this.o.now ?? Date.now)()).toISOString();
    const base = { notice_id: id, channel, thread: root, peer: sender };
    try {
      const res = (await this.o.post({ channel, thread_ts: root, text: noMentionNoticeText(sender, this.o.botName, self, id) })) as
        | { ok?: boolean; ts?: unknown; error?: unknown }
        | undefined;
      if (res && res.ok === false) {
        appendReceipt(this.o.receiptPath, { ts: nowIso(), kind: 'post-failed', ...base, error: typeof res.error === 'string' ? res.error.slice(0, 64) : 'not_ok' });
        return 'post-failed';
      }
      appendReceipt(this.o.receiptPath, { ts: nowIso(), kind: 'posted', ...base, message_ts: typeof res?.ts === 'string' ? res.ts : undefined });
      return 'posted';
    } catch (err) {
      appendReceipt(this.o.receiptPath, { ts: nowIso(), kind: 'post-failed', ...base, error: errorKind(err) });
      return 'post-failed';
    }
  }
}

// ---- receiving side: the bridge of the bot that forgot the mention ------------

export interface NoMentionReceiverOptions {
  selfUserId: () => string;
  ledger: NoticeLedger;
  receiptPath: string;
  now?: () => number;
}

export type AcceptResult =
  | { kind: 'none' }
  /** The same Slack post again (its app_mention twin or a redelivery): already delivered, nothing to record. */
  | { kind: 'twin'; id: string }
  | { kind: 'duplicate'; id: string }
  | { kind: 'control'; id: string; meta: Record<string, string> };

const BROADCAST_MEMORY = 200;

/**
 * Always on (no switch): it only reacts to an exact notice from an allowed peer,
 * which exists only where some bridge turned its notice on. Unlike the sender, a
 * failed save here does not block delivery — losing the notice is worse than a
 * rare duplicate after a restart, and the in-memory set still dedups this run.
 */
export class NoMentionReceiver {
  /** Accepted this run: (poster|id) -> the ts of the post that carried it. */
  private readonly seen = new Map<string, string | undefined>();
  private readonly broadcasted: string[] = [];
  private readonly reported = new Set<string>();

  constructor(private readonly o: NoMentionReceiverOptions) {}

  private nowIso(): string {
    return new Date((this.o.now ?? Date.now)()).toISOString();
  }

  accept(ev: NoticeEvent, text: string): AcceptResult {
    if (!ev.user) return { kind: 'none' };
    const parsed = parseTrustedNotice(text, this.o.selfUserId(), ev.user);
    if (!parsed) return { kind: 'none' };
    const { id } = parsed;
    // Per poster: the id is computable by anyone who saw the dropped post, so a
    // bare-id key would let another allowed bot pre-post it and block the real
    // notice. Receipts are joined on (notice_id, peer) for the same reason.
    const key = `${ev.user}|${id}`;
    // With message.channels on, one notice post arrives twice (message + app_mention,
    // same ts): the twin is passed over without a drop row. Another post with the
    // same notice (new ts), or one after a restart, is still a notice-duplicate.
    if (this.seen.has(key)) return ev.ts !== undefined && this.seen.get(key) === ev.ts ? { kind: 'twin', id } : { kind: 'duplicate', id };
    if (this.o.ledger.hasNotice(key)) return { kind: 'duplicate', id };
    if (this.seen.size >= BROADCAST_MEMORY * 10) this.seen.delete(this.seen.keys().next().value as string);
    this.seen.set(key, ev.ts);
    this.o.ledger.addNotice(key);
    appendReceipt(this.o.receiptPath, {
      ts: this.nowIso(),
      kind: 'bridge-received',
      notice_id: id,
      channel: ev.channel,
      thread: ev.thread_ts ?? ev.ts,
      peer: ev.user,
      message_ts: ev.ts,
    });
    return { kind: 'control', id, meta: { control: 'no-mention-notice', notice_id: id, notice_from: ev.user } };
  }

  /**
   * After the inbound broadcast: with no session attached nobody can report
   * receipt 3 ('session-none', and later reports for it are ignored — the
   * broadcast is one-shot). With sessions attached, a 'bridge-received' row with
   * no 'session-reached' after it means unconfirmed.
   */
  onBroadcast(id: string, clientCount: number): void {
    if (clientCount === 0) {
      appendReceipt(this.o.receiptPath, { ts: this.nowIso(), kind: 'session-none', notice_id: id });
      return;
    }
    this.broadcasted.push(id);
    if (this.broadcasted.length > BROADCAST_MEMORY) this.broadcasted.shift();
  }

  /** A session's MCP proxy says it handed the notice over: one row per (id, session), only for ids broadcast to a session. */
  onDelivered(id: string, sessionId: string | undefined): boolean {
    if (!this.broadcasted.includes(id)) return false;
    const key = `${id}|${sessionId ?? ''}`;
    if (this.reported.has(key)) return false;
    this.reported.add(key);
    if (this.reported.size > BROADCAST_MEMORY * 4) this.reported.delete(this.reported.values().next().value as string);
    appendReceipt(this.o.receiptPath, { ts: this.nowIso(), kind: 'session-reached', notice_id: id, session_id: sessionId });
    return true;
  }
}
