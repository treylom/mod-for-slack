import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { appendPrivate } from './drop-notice.js';
// One file holds ~9.7-12 days per bot at the Codex bridges' measured raw volume (two
// bridges, 2026-09-25..28: 5.6-5.8 MB/day average, 6.9 MB/day max, compact JSON), so right
// after a rotation `.1` alone still covers more than 7 days. A consumer of a 7-day window
// must read BOTH `path` and `path.1`. The Codex bridge itself never rotates (44 MB seen).
export const RAW_LOG_MAX_BYTES = 64 * 1024 * 1024;
/** Codex parity: only `type === 'message'` events are recorded (app_mention/reactions are not). */
export function rawRecord(ev, nowMs) {
    if (!ev || ev.type !== 'message')
        return null;
    return {
        recorded_at: nowMs / 1000,
        event: 'raw',
        channel: ev.channel ?? null,
        ts: ev.ts ?? null,
        subtype: ev.subtype ?? null,
        bot: Boolean(ev.bot_id),
        user: ev.user ?? null,
        text: Boolean(ev.text),
        files: Array.isArray(ev.files) ? ev.files.length : 0,
        channel_type: ev.channel_type ?? null,
    };
}
/**
 * Appends one raw line. Never throws: a logging failure must not affect delivery.
 * Writes the fixed Codex keys only (extra fields on `rec` are ignored), mode 0600,
 * creates the parent directory if missing (a missing dir would read as «silence»),
 * and rotates `path` -> `path.1` once it reaches `maxBytes` (same scheme as logDrop).
 * A symlink, FIFO or hard link already at `path` is skipped, never followed or
 * blocked on (appendPrivate).
 */
export function logRaw(path, rec, maxBytes = RAW_LOG_MAX_BYTES) {
    try {
        try {
            if (existsSync(path) && statSync(path).size >= maxBytes) {
                renameSync(path, `${path}.1`);
            }
        }
        catch {
            // Rotation is best-effort — a failed stat/rename just grows the current file.
        }
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const line = JSON.stringify({
            recorded_at: rec.recorded_at,
            event: 'raw',
            channel: rec.channel,
            ts: rec.ts,
            subtype: rec.subtype,
            bot: rec.bot,
            user: rec.user,
            text: rec.text,
            files: rec.files,
            channel_type: rec.channel_type,
        });
        appendPrivate(path, `${line}\n`);
    }
    catch {
        // Best effort — see docstring.
    }
}
