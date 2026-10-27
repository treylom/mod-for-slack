// Silent-drop notice + record for the Slack bridge (2026-09-26): a dropped post
// leaves one metadata-only log line, and a few drop reasons may answer the
// sender in Slack. Pure functions and a small
// state class only; server.ts wires these into handleSlackEvent's existing
// drop points. No network calls live here — the caller posts the notice.
//
// Both files live in ~/.claude-state, a directory other programs may share, so
// neither is ever written through a path that is not this bridge's own. Before
// either file is touched, that directory must be a real directory (not a
// symlink) owned by this user with no write access for anyone else — it is
// tightened to owner-only when it can be, and refused otherwise — so no one else
// can add, swap or remove names in it. Inside it, the log is opened without
// following a symlink and refused unless it is a regular file with one link that
// its name still points at; the rate-limit state is written to a fresh temp file
// and renamed over.
import { randomBytes } from 'node:crypto';
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync, } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = constants.O_NONBLOCK ?? 0;
const O_DIRECTORY = constants.O_DIRECTORY ?? 0;
/**
 * Makes `dir` this user's private directory, or throws (the callers treat a
 * throw as a write failure, which also keeps the notice off). A missing one is
 * created 0700. An existing one is opened without following a symlink, must be
 * a directory owned by this user, and has its group/other bits cleared on that
 * same open directory, so nothing can be swapped in between the check and the
 * chmod (owner bits are never widened: 0755 becomes 0700, 0500 stays 0500). If
 * others can still write to it afterwards (a filesystem that ignores chmod), it
 * is refused. A symlink or another user's directory is never chmod-ed.
 */
export function ensureOwnDir(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 }); // throws if `dir` exists as a non-directory
    const fd = openSync(dir, constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); // a symlink is not opened
    try {
        const st = fstatSync(fd);
        if (typeof process.getuid === 'function' && st.uid !== process.getuid())
            throw new Error(`${dir} is not owned by this user`);
        if (st.mode & 0o077)
            fchmodSync(fd, st.mode & 0o700);
        if (fstatSync(fd).mode & 0o022)
            throw new Error(`${dir} is still writable by others`);
    }
    finally {
        closeSync(fd);
    }
}
/**
 * Checks (and tightens) the file's directory first — see ensureOwnDir — then
 * opens `path` without following a symlink and without blocking on a FIFO, and
 * refuses anything but a regular file with a single link that its name still
 * points at after the open — a symlink, hardlink or FIFO planted at the path is
 * never written to or re-permissioned. Returns the fd (mode 0600); the caller
 * closes it.
 */
export function openOwnFile(path, flags) {
    ensureOwnDir(dirname(path));
    const fd = openSync(path, flags | O_NOFOLLOW | O_NONBLOCK, 0o600);
    try {
        const st = fstatSync(fd);
        if (!st.isFile())
            throw new Error(`${path} is not a regular file`);
        if (st.nlink !== 1)
            throw new Error(`${path} has other hard links`);
        const named = lstatSync(path);
        if (named.dev !== st.dev || named.ino !== st.ino)
            throw new Error(`${path} was replaced while it was opened`);
        fchmodSync(fd, 0o600);
        return fd;
    }
    catch (err) {
        closeSync(fd);
        throw err;
    }
}
function finiteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}
/**
 * True only for the one drop worth surfacing to the channel: a peer bot,
 * NOT on the allowlist, explicitly mentioning us, in a channel we listen to
 * (or a thread of it — same `channel` field either way), not a DM, not our
 * own echo, and not itself an auto-notice (feedback-loop guard).
 */
export function shouldNotify(ev, ctx) {
    const fromBot = Boolean(ev.bot_id) || ev.subtype === 'bot_message';
    if (!fromBot)
        return false;
    if (!ev.user || ctx.allowedBotUserIds.has(ev.user))
        return false;
    const text = ev.text ?? '';
    if (!text.includes(`<@${ctx.selfUserId}>`))
        return false;
    if (!ctx.isListenedChannel(ev.channel, ev.channel_type))
        return false;
    if (ev.user === ctx.selfUserId)
        return false;
    if (ev.channel_type === 'im')
        return false;
    if (isAutoNotice(text))
        return false;
    return true;
}
/**
 * True for a bridge's own auto-notice. Every notice starts with the mention of
 * the bot it answers (`<@U…> [자동 · …`), so leading mentions are skipped
 * before the marker check — otherwise a notice from a peer bridge would itself
 * be answered with a notice, and two bridges would keep answering each other.
 * The 10-13 pilot candidate's marker `[slack-drop-notice]` counts too
 * (2026-10-24, one policy): a notice from either path is never answered.
 */
export function isAutoNotice(text) {
    return /^(?:<@[^>\s]+>\s*)*(?:\[자동 ·|\[slack-drop-notice\])/.test(text.trim());
}
/**
 * The other silent drop (2026-10-22): a peer bot that IS on the allowlist
 * posts in a channel we listen to without mentioning us, so the bot gate drops
 * it ('bot-no-mention') and the sender never learns its hand-off went nowhere.
 * Same exclusions as shouldNotify — DM, self, another bridge's auto-notice.
 */
export function shouldNotifyNoMention(ev, ctx) {
    const fromBot = Boolean(ev.bot_id) || ev.subtype === 'bot_message';
    if (!fromBot)
        return false;
    // Posts only (2026-10-24, same 4 kinds as the 10-13 pilot): a join/leave/topic
    // event is not a hand-off and must not draw a notice.
    if (![undefined, 'bot_message', 'file_share', 'thread_broadcast'].includes(ev.subtype))
        return false;
    if (!ev.user || ev.user === ctx.selfUserId || !ctx.allowedBotUserIds.has(ev.user))
        return false;
    const text = ev.text ?? '';
    if (text.includes(`<@${ctx.selfUserId}>`))
        return false;
    if (!ctx.isListenedChannel(ev.channel, ev.channel_type))
        return false;
    if (ev.channel_type === 'im')
        return false;
    if (isAutoNotice(text))
        return false;
    return true;
}
/**
 * Notice for the no-mention drop. Names the exact mention to use and says to
 * ignore it otherwise: most peer posts in a shared channel are not meant for
 * this bot, and the sender must not re-route an unrelated reply here.
 * With `noticeId` (2026-10-24) the text ends in ` · nm:<id>`: the id joins the
 * three receipts (posted / bridge-received / session-reached) across bridges.
 */
export function noMentionNoticeText(sender, botName, selfUserId, noticeId) {
    const base = `<@${sender}> [자동 · ${botName} 브리지] 멘션 없는 봇 글이라 제게 전달되지 않았습니다 · 제게 보낸 글이었다면 <@${selfUserId}> 를 넣어 다시 보내 주세요(아니면 무시)`;
    return noticeId ? `${base} · nm:${noticeId}` : base;
}
/** Notice text posted into the same thread the dropped message was in. */
export function noticeText(sender, botName) {
    return `<@${sender}> [자동 · ${botName} 브리지] 당신 말이 제 허용 목록에 없어 전달되지 않았습니다 · 확인 = 제 .env 의 ALLOWED_SLACK_BOT_USER_IDS 에 <@${sender}> 의 U… id`;
}
// Fixed values (bot 2026-10-설계 메모): every notice path uses these 10-22 limits —
// (sender, channel) pair 1 per 30 min, all pairs 10 per hour.
export const PAIR_WINDOW_MS = 30 * 60 * 1000;
export const TOTAL_WINDOW_MS = 60 * 60 * 1000;
export const TOTAL_CAP = 10;
function emptyState() {
    return { pairs: {}, totalTimestamps: [] };
}
/**
 * Rate limit for the notice, persisted to `statePath` so a bridge restart
 * does not reset it. (sender, channel) pair: 1 notice / 30 min. All pairs
 * combined: 10 notices / 1 hour. If the state cannot be saved, the limit
 * would not survive a restart, so this notifier stops allowing notices
 * (until the bridge restarts and a save works again).
 */
export class DropNotifier {
    statePath;
    now;
    state;
    disabled = false;
    constructor(statePath, now = Date.now) {
        this.statePath = statePath;
        this.now = now;
        this.state = this.load();
    }
    load() {
        try {
            if (existsSync(this.statePath)) {
                const fd = openOwnFile(this.statePath, constants.O_RDONLY);
                let parsed;
                try {
                    parsed = JSON.parse(readFileSync(fd, 'utf8'));
                }
                finally {
                    closeSync(fd);
                }
                const raw = (parsed && typeof parsed === 'object' ? parsed : {});
                // Copied into a fresh object: a `pairs` array (or any other shape) would
                // keep no keys through JSON and reset the limit on every restart.
                const pairs = {};
                for (const [k, v] of Object.entries(raw.pairs && typeof raw.pairs === 'object' ? raw.pairs : {}))
                    if (finiteNumber(v))
                        pairs[k] = v;
                return { pairs, totalTimestamps: Array.isArray(raw.totalTimestamps) ? raw.totalTimestamps.filter(finiteNumber) : [] };
            }
        }
        catch {
            // Corrupt, unreadable or not a plain file of ours — start from a fresh
            // state rather than throw; the save below replaces the file.
        }
        return emptyState();
    }
    /** Atomic save: same-directory temp file (never an existing path), fsync, rename over. False on any failure. */
    persist() {
        const dir = dirname(this.statePath);
        const tmp = join(dir, `.${basename(this.statePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
        let fd;
        try {
            ensureOwnDir(dir); // fresh machine: no ~/.claude-state yet
            fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
            fchmodSync(fd, 0o600);
            writeSync(fd, JSON.stringify(this.state));
            fsyncSync(fd);
            closeSync(fd);
            fd = undefined;
            // rename replaces the directory entry itself: a symlink or hardlink that
            // was at statePath is swapped out, its target is never written.
            renameSync(tmp, this.statePath);
            return true;
        }
        catch {
            if (fd !== undefined)
                closeSync(fd);
            try {
                unlinkSync(tmp);
            }
            catch {
                // Never created.
            }
            return false;
        }
    }
    /** Same check as allow() without recording anything (lets a caller save its own state before spending). */
    wouldAllow(sender, channel) {
        if (this.disabled)
            return false;
        const nowMs = this.now();
        const last = this.state.pairs[`${sender}|${channel}`];
        if (last !== undefined && nowMs - last < PAIR_WINDOW_MS)
            return false;
        return this.state.totalTimestamps.filter((t) => nowMs - t < TOTAL_WINDOW_MS).length < TOTAL_CAP;
    }
    /** True if a notice for (sender, channel) may be sent right now; records it if so. */
    allow(sender, channel) {
        if (this.disabled)
            return false;
        const nowMs = this.now();
        this.state.totalTimestamps = this.state.totalTimestamps.filter((t) => nowMs - t < TOTAL_WINDOW_MS);
        const key = `${sender}|${channel}`;
        const last = this.state.pairs[key];
        if (last !== undefined && nowMs - last < PAIR_WINDOW_MS)
            return false;
        if (this.state.totalTimestamps.length >= TOTAL_CAP)
            return false;
        this.state.pairs[key] = nowMs;
        this.state.totalTimestamps.push(nowMs);
        if (!this.persist()) {
            // An unsaved limit resets on every restart (a read-only state dir plus
            // restarts allowed 10 notices per restart). No saved state, no notices.
            this.disabled = true;
            return false;
        }
        return true;
    }
}
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
/**
 * Appends `data` to a bridge-owned log file at `path` — or does nothing — without ever
 * following a symlink or blocking on a FIFO that already sits at that path. Same
 * fd-checked open as approval-button-receipt.ts (O_NOFOLLOW, then fstat the descriptor):
 *  - O_NOFOLLOW: a symlink at `path` fails the open (ELOOP) instead of redirecting the write;
 *  - O_NONBLOCK: a FIFO with no reader fails the open (ENXIO) instead of hanging the process;
 *  - fstat: only a regular file with a single link is written, so a FIFO that did open, or a
 *    hard link shared with another path, is left untouched;
 *  - fchmod: 0600 is applied to the open descriptor, never through the path.
 * Throws when the open fails; the caller (logRaw in raw-log.ts — logDrop uses the stricter
 * openOwnFile below) is a best-effort logger and swallows it. Kept in this module so it
 * imports only node: builtins.
 */
export function appendPrivate(path, data) {
    const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.nlink !== 1)
            return;
        fchmodSync(fd, 0o600);
        writeFileSync(fd, data);
    }
    finally {
        closeSync(fd);
    }
}
/**
 * Appends one JSONL line recording a drop — metadata only, never the message
 * body, files or blocks. Never throws: a logging failure must not affect delivery.
 * Single-file rotation: once `path` reaches `maxBytes`, it is renamed to
 * `path + '.1'` (overwriting any previous one) before the new line is
 * appended to a fresh `path` — every listened-channel post is a drop
 * candidate here, so this is the only cap on unbounded growth.
 * A symlink, FIFO or hard link already at `path` is skipped, never followed
 * or blocked on (openOwnFile — which also tightens the directory first and
 * refuses a name swapped after the open).
 */
export function logDrop(path, rec, maxBytes = DEFAULT_MAX_BYTES) {
    try {
        // The directory first, before the rotation renames anything in it. This also
        // creates a missing ~/.claude-state on a fresh machine; without it every
        // append below would fail inside this catch and the record would silently
        // never exist.
        ensureOwnDir(dirname(path));
        try {
            if (existsSync(path) && statSync(path).size >= maxBytes) {
                renameSync(path, `${path}.1`);
            }
        }
        catch {
            // Rotation is best-effort too — a stat/rename failure just means the
            // append below grows the existing file instead of rolling it.
        }
        const line = `${JSON.stringify({ ts: rec.ts, reason: rec.reason, sender: rec.sender, channel: rec.channel, thread: rec.thread, subtype: rec.subtype, event_ts: rec.event_ts, message_ts: rec.message_ts, bot_id_present: rec.bot_id_present, nested_sender: rec.nested_sender })}\n`;
        const fd = openOwnFile(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
        try {
            writeSync(fd, line);
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
        // Best effort — see docstring.
    }
}
