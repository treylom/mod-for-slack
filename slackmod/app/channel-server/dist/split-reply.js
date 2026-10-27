// Long-reply splitter for the Slack bridge. Slack splits any message over
// ~4,000 chars on its own; the second half then carries no bot mention and the
// receiving bridge drops it (`bot-no-mention`). We split first, and put the
// mentions of the whole text on every chunk's header line.
export const SLACK_CHUNK_LIMIT = 3500;
const MENTION_RE = /<@[UW][A-Z0-9]+>/g;
const FENCE_RESERVE = 8; // '\n```' (4) appended + '```\n' (4) prepended
function collectMentions(text) {
    const seen = [];
    for (const m of text.matchAll(MENTION_RE)) {
        if (!seen.includes(m[0]))
            seen.push(m[0]);
    }
    return seen;
}
function forceSplit(line, budget) {
    const out = [];
    let cur = '';
    for (const ch of Array.from(line)) {
        if (cur.length + ch.length > budget) {
            out.push(cur);
            cur = '';
        }
        cur += ch;
    }
    out.push(cur);
    return out;
}
function packLines(text, budget) {
    const pieces = [];
    for (const line of text.split('\n')) {
        if (line.length <= budget)
            pieces.push(line);
        else
            pieces.push(...forceSplit(line, budget));
    }
    const bodies = [];
    let cur = [];
    let curLen = 0;
    for (const p of pieces) {
        const add = (cur.length ? 1 : 0) + p.length;
        if (cur.length && curLen + add > budget) {
            bodies.push(cur.join('\n'));
            cur = [];
            curLen = 0;
        }
        curLen += (cur.length ? 1 : 0) + p.length;
        cur.push(p);
    }
    if (cur.length)
        bodies.push(cur.join('\n'));
    return bodies;
}
function bodiesFor(text, limit, mentionsLen, mentionCount) {
    let digits = 1;
    for (;;) {
        const maxHeader = mentionsLen + ` (${'9'.repeat(digits)}/${'9'.repeat(digits)})`.length;
        const budget = limit - (maxHeader + 1) - FENCE_RESERVE;
        if (budget < 1)
            throw new Error(`splitForSlack: limit ${limit} too small for ${mentionCount} mentions`);
        const bodies = packLines(text, budget);
        if (String(bodies.length).length <= digits)
            return bodies;
        digits = String(bodies.length).length;
    }
}
export function splitForSlack(text, limit = SLACK_CHUNK_LIMIT) {
    if (text.length <= limit)
        return [text];
    const mentions = collectMentions(text);
    const mentionsLen = mentions.length ? mentions.join(' ').length + 1 : 0;
    const bodies = bodiesFor(text, limit, mentionsLen, mentions.length);
    const n = bodies.length;
    let open = false;
    return bodies.map((body, i) => {
        let b = open ? '```\n' + body : body;
        for (const line of body.split('\n'))
            if (line.startsWith('```'))
                open = !open;
        if (open)
            b += '\n```';
        const missing = mentions.filter((m) => !b.includes(m));
        if (i === 0) {
            // Chunk 1 keeps the original first line untouched (receivers may parse it): tag goes at the end.
            return `${b}\n(1/${n})${missing.length ? ' ' + missing.join(' ') : ''}`;
        }
        const head = `${missing.length ? missing.join(' ') + ' ' : ''}(${i + 1}/${n})`;
        return `${head}\n${b}`;
    });
}
export async function postChunked(web, args) {
    const chunks = splitForSlack(args.text);
    let sent = 0;
    // ts of the FIRST chunk (the one that keeps the original first line) — the owner-tag DM copy
    // (owner-tag-copy.ts) links to it. Absent when Slack's response carried none; callers must cope.
    let firstTs;
    for (const chunk of chunks) {
        // Broadcast (shown in the conversation too) applies to the first chunk only:
        // one notification and one visible line, the rest stays in the thread.
        const threadTs = args.thread_ts;
        try {
            let res;
            if (args.reply_broadcast === true && threadTs !== undefined && sent === 0) {
                res = await web.chat.postMessage({ channel: args.channel, thread_ts: threadTs, text: chunk, reply_broadcast: true });
            }
            else {
                res = await web.chat.postMessage({ channel: args.channel, thread_ts: threadTs, text: chunk });
            }
            if (sent === 0) {
                const ts = res?.ts;
                if (typeof ts === 'string' && ts)
                    firstTs = ts;
            }
        }
        catch (err) {
            return { ok: false, sent, total: chunks.length, error: err instanceof Error ? err.message : String(err) };
        }
        sent++;
    }
    return firstTs === undefined ? { ok: true, sent } : { ok: true, sent, firstTs };
}
