// Inbound Slack file attachments: a human post that carries files reaches the
// session, with each file downloaded next to it.
//
// Slack delivers a human post that carries files as a `message` event with
// `subtype: 'file_share'` (@slack/types FileShareMessageEvent). The human
// sender gate used to drop EVERY subtype to filter edits/joins, so such posts
// vanished silently. `humanSubtypeAllowed` keeps the edit/join filter and lets
// the two subtypes that carry a human-authored body through.
//
// Files are then fetched with the bot token (Slack `url_private*` needs
// `Authorization: Bearer <bot token>` and the files:read scope) into the
// bot's state dir, and the session gets the local paths appended to the text.
// The token is only ever sent to an https: URL on a Slack file host
// (slackFileUrl). A file that lives outside Slack (external / remote file,
// e.g. a shared cloud document) is never fetched: the session gets its link.
// Redirects are followed by hand so every hop gets the same host check.
// Nothing here throws: every failure becomes a per-file error line so the text
// part of the message is always delivered.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const HUMAN_PASS_SUBTYPES = new Set(['file_share', 'thread_broadcast']);
export function humanSubtypeAllowed(subtype) {
    return !subtype || HUMAN_PASS_SUBTYPES.has(subtype);
}
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Whole download of one file (every redirect hop + the body). */
export const FETCH_TIMEOUT_MS = 120 * 1000;
export const MAX_REDIRECTS = 5;
/** Slack's own domains: files (and Slack's own file redirects) are served from these or their subdomains. */
const SLACK_FILE_DOMAINS = ['slack.com', 'slack-edge.com', 'slack-gov.com'];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/**
 * The normalized URL if `raw` may carry the bot token: https:, no non-default
 * port (`:443` is dropped by the parser), no credentials, and a host that is a
 * Slack domain or a subdomain of one
 * (matched on DNS label boundaries, one trailing dot ignored). Anything else
 * (http:, another host, an IP literal, a look-alike such as evilslack.com or
 * files.slack.com.evil.example) gets undefined.
 */
export function slackFileUrl(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        return undefined;
    }
    if (u.protocol !== 'https:')
        return undefined;
    if (u.port || u.username || u.password)
        return undefined;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (host.split('.').some((label) => !label))
        return undefined; // '.slack.com', 'a..slack.com'
    return SLACK_FILE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) ? u.href : undefined;
}
/** A file whose content lives outside Slack: never fetched, only linked. */
export function isExternalFile(file) {
    return file.mode === 'external' || Boolean(file.is_external) || file.filetype === 'remote';
}
function externalLink(file) {
    try {
        const u = new URL(file.external_url ?? '');
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
    }
    catch {
        return undefined;
    }
}
// Control characters (C0, DEL, C1), line/paragraph separators and bidi controls.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
export function safeName(name) {
    let s = (name ?? '').replace(/[\/\\]/g, '_').replace(UNSAFE_TEXT, '_').replace(/^\.+/, '');
    if (!s)
        return 'file';
    if (s.length > 120) {
        const dot = s.lastIndexOf('.');
        const ext = dot > 0 && s.length - dot <= 16 ? s.slice(dot) : '';
        s = s.slice(0, 120 - ext.length) + ext;
    }
    return s;
}
function humanSize(n) {
    if (typeof n !== 'number' || !Number.isFinite(n))
        return '크기 미상';
    if (n < 1024)
        return `${n}B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
function scrub(message, token) {
    return token ? message.split(token).join('***') : message;
}
async function discard(res) {
    try {
        await res.body?.cancel();
    }
    catch {
        // Nothing to free.
    }
}
/** The whole body, or undefined as soon as it grows past maxBytes (the stream is cancelled). */
async function readCapped(res, maxBytes) {
    if (!res.body)
        return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (!value)
            continue;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return undefined;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}
async function fetchSlackFile(url, token, fetchImpl, maxBytes, signal) {
    let current = url;
    for (let hop = 0;; hop++) {
        const res = await fetchImpl(current, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal });
        if (REDIRECT_STATUSES.has(res.status)) {
            await discard(res);
            if (hop >= MAX_REDIRECTS)
                return { error: `more than ${MAX_REDIRECTS} redirects` };
            const location = res.headers.get('location');
            let next;
            try {
                next = location ? new URL(location, current).href : undefined;
            }
            catch {
                next = undefined;
            }
            const target = next === undefined ? undefined : slackFileUrl(next);
            if (!target)
                return { error: `HTTP ${res.status} redirect outside Slack — not followed` };
            current = target;
            continue;
        }
        if (!res.ok) {
            await discard(res);
            return { error: `HTTP ${res.status}` };
        }
        const type = res.headers.get('content-type') ?? '';
        if (type.toLowerCase().startsWith('text/html')) {
            await discard(res);
            return { error: 'got HTML instead of file (bot token lacks files:read?)' };
        }
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) {
            await discard(res);
            return { error: `too large (${declared} bytes > ${maxBytes})` };
        }
        const body = await readCapped(res, maxBytes);
        if (!body)
            return { error: `too large (more than ${maxBytes} bytes)` };
        return { body };
    }
}
export async function downloadFiles(files, token, dir, fetchImpl = fetch, maxBytes = MAX_FILE_BYTES, timeoutMs = FETCH_TIMEOUT_MS) {
    const results = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i] ?? {};
        try {
            if (isExternalFile(file)) {
                results.push({ file, external: true, link: externalLink(file) });
                continue;
            }
            const raw = file.url_private_download ?? file.url_private;
            if (!raw || file.mode === 'tombstone') {
                results.push({ file, error: 'no download url' });
                continue;
            }
            const url = slackFileUrl(raw);
            if (!url) {
                results.push({ file, error: 'not a Slack file URL — not downloaded' });
                continue;
            }
            if (typeof file.size === 'number' && file.size > maxBytes) {
                results.push({ file, error: `too large (${file.size} bytes > ${maxBytes})` });
                continue;
            }
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            const signal = AbortSignal.timeout(timeoutMs);
            const got = await fetchSlackFile(url, token, fetchImpl, maxBytes, signal);
            if ('error' in got) {
                results.push({ file, error: got.error });
                continue;
            }
            const path = join(dir, `${i + 1}-${safeName(file.name ?? file.title ?? file.id)}`);
            writeFileSync(path, got.body, { mode: 0o600 });
            chmodSync(path, 0o600);
            results.push({ file, path });
        }
        catch (err) {
            const timedOut = err?.name === 'TimeoutError';
            const message = timedOut ? `timed out after ${timeoutMs} ms` : err instanceof Error ? err.message : String(err);
            results.push({ file, error: scrub(message, token) });
        }
    }
    return results;
}
function resultLine(r) {
    const name = r.file.name ?? r.file.title ?? r.file.id ?? 'file';
    if (r.external)
        return `- ${name} (외부 파일 · 링크만) → ${r.link ?? '링크 없음'}`;
    if (r.path)
        return `- ${name} (${humanSize(r.file.size)}, ${r.file.mimetype || r.file.filetype || '?'}) → ${r.path}`;
    return `- ${name} (${humanSize(r.file.size)}) → 내려받기 실패: ${r.error ?? '?'} · file id ${r.file.id ?? '?'}`;
}
export function attachmentBlock(results) {
    if (!results.length)
        return '';
    // Names, titles and types come from the event (a remote file's title is set by
    // a third-party app): one result is always exactly one line.
    const lines = results.map((r) => resultLine(r).replace(UNSAFE_TEXT, ' '));
    return `\n\n[첨부 ${results.length}개 — Slack 서버가 내려받음]\n` + lines.join('\n');
}
