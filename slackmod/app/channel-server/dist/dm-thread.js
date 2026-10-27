/**
 * DM threading (maintainer 2026-10-18): a reply to a DM goes into that DM
 * message's thread, and is also shown in the DM itself (`reply_broadcast`),
 * so the reply still raises a notification. This replaces 2026-09-23 «DM
 * replies are top-level», which existed only because a threaded DM reply
 * raised no notification — broadcasting fixes that.
 *
 * Pure helpers; server.ts wires them in.
 */
/** The thread an inbound belongs to, for the <channel> tag: the thread it was
 * written in, else the inbound itself becomes the root — DM or channel alike. */
export function inboundThreadTs(event, fallbackTs) {
    return event.thread_ts ?? event.ts ?? fallbackTs;
}
/** Default for broadcasting a threaded DM reply: on unless the bot's .env says
 * SLACK_DM_REPLY_BROADCAST=0 (or the process env CLAUDE_CHANNEL_DM_REPLY_BROADCAST=0). */
export function dmBroadcastDefault(envValue, processValue) {
    const v = (envValue ?? processValue ?? '').trim();
    return v !== '0';
}
/**
 * Where a reply goes and whether it is broadcast.
 * - Channel target: thread_ts passes through unchanged; never broadcast (a
 *   channel must not fill up with bot answers).
 * - DM target: a thread_ts only counts if a real DM inbound carried it (the
 *   message's own ts or the thread it was written in) — a model-invented one
 *   is dropped and the reply goes top-level. A threaded DM reply is
 *   broadcast unless the session asked otherwise or the default is off.
 */
export function resolveReplyThreading(args) {
    const { isImTarget, requestedThreadTs, knownImThreads, requestedBroadcast } = args;
    if (!isImTarget)
        return { threadTs: requestedThreadTs, broadcast: false };
    const threadTs = requestedThreadTs && knownImThreads.has(requestedThreadTs) ? requestedThreadTs : undefined;
    const broadcast = threadTs ? (requestedBroadcast ?? args.dmBroadcastDefault) : false;
    return { threadTs, broadcast };
}
