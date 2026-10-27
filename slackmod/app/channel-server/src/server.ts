#!/usr/bin/env node
// Resident bridge process: the ONLY thing that holds the Slack Socket Mode
// connection. Owns `~/.claude/channels/slack/primary.sock`; one or more
// `mcp.ts` proxies (one per Claude Code session) connect to it as IPC
// clients. Run this once and leave it running (see README "Running").
//
// Everything a message has to clear before it reaches a Claude Code
// session, in order:
//   1. Slack Socket Mode envelope ack (protocol requirement, not a gate)
//   2. event.channel is one of SLACK_CHANNEL_ID     (hardening a)
//   3. sender gate, split by author kind ((B) bot-interop, 2026-08-07):
//      a human post must be from ALLOWED_SLACK_USER_ID; a bot post must be
//      from ALLOWED_SLACK_BOT_USER_IDS (unset = every bot drops — the
//      pre-(B) behavior), must NOT be a DM, and must @-mention THIS bot
//   4. not an edit / join / self echo (subtype, own botUserId)
//   5. in a channel: the post must mention THIS bot (<@botUserId>) or be a
//      permission verdict — DMs are exempt (1:1, sender gate suffices)
//      (hardening c / target gate, 2026-08-06 defect 13)
//   6. not a duplicate delivery (message + app_mention can both fire)
// The IPC socket itself has its own, independent gate before any of the
// above even matters: mode 0600 + peer-uid verification (hardening b),
// see `startIpcServer` below and src/peercred.ts.

import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import net from 'node:net';
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { makeSettle, processInteractiveReceipt, resolveRegistryScript } from './approval-button-receipt.js';
import { loadActiveButtonBot } from './approval-button-bots.js';
import { ANY_MEMBER_CHANNEL, ENV_PATH, SOCKET_PATH, STATE_DIR, ensureStateDir, loadEnv, log, mentionChannelType, parseChannelIds, parsePeerRate } from './config.js';
import { DropNotifier, logDrop, noticeText, shouldNotify, shouldNotifyNoMention } from './drop-notice.js';
import { appendReceipt, NoMentionReceiver, NoMentionSender, NoticeLedger, resolveNoMentionSwitch } from './no-mention-notice.js';
import { attachmentBlock, downloadFiles, humanSubtypeAllowed, type SlackFile } from './inbound-files.js';
import { ClientToServer, encodeLine, type ClientToServerMsg, type ServerToClientMsg } from './ipc-protocol.js';
import { LineReader } from './line-reader.js';
import { postChunked } from './split-reply.js';
import { pickInboundDoneKey } from './pending-key.js';
import { dmBroadcastDefault, inboundThreadTs, resolveReplyThreading } from './dm-thread.js';
import { createOwnerTagCopier, parseOwnerTagCopyConfig } from './owner-tag-copy.js';
import { verifyPeerIsSelf } from './peercred.js';
import { logRaw, rawRecord, type RawSlackEvent } from './raw-log.js';
import { acquireSingleton } from './singleton.js';

interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  text?: string;
  ts?: string;
  event_ts?: string;
  thread_ts?: string;
  bot_id?: string;
  message?: { ts?: string; user?: string; bot_id?: string };
  files?: SlackFile[];
}

// Reference implementation for the permission-relay reply pattern, verbatim
// from the official channels-reference doc's "Add relay to a chat bridge"
// example — case-insensitive for autocorrect, `l` excluded from the id
// alphabet by Claude Code itself so it never appears here.
const VERDICT_PATTERN = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

function main(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(`unsupported platform ${process.platform} — this bridge requires a POSIX Unix socket`);
  }

  ensureStateDir();
  acquireSingleton();
  const env = loadEnv();
  // Multi-channel (2026-08-13): the bridge may sit in several channels at
  // once. `configuredChannels` is what gate (a) below tests membership
  // against; `primaryChannelId` (the first id) is the outbound fallback for
  // messages that carry no channel of their own — permission asks. A
  // single-id .env therefore behaves identically to before this change.
  const parsedChannelIds = parseChannelIds(env.SLACK_CHANNEL_ID);
  // `*` (ANY_MEMBER_CHANNEL, config.ts): also forward from every channel the
  // bot has been invited to — the invite is the allowlist.
  const listenAnyMemberChannel = parsedChannelIds.includes(ANY_MEMBER_CHANNEL);
  const configuredChannelIds = parsedChannelIds.filter((id) => id !== ANY_MEMBER_CHANNEL);
  const primaryChannelId = configuredChannelIds[0]!;
  const configuredChannels = new Set(configuredChannelIds);
  function isListenedChannel(channel: string | undefined, channelType: string | undefined): boolean {
    if (!channel) return false;
    if (configuredChannels.has(channel)) return true;
    // Slack delivers channel/group events only for conversations the bot is a
    // member of, so with the wildcard "member" is already established.
    return listenAnyMemberChannel && (channelType === 'channel' || channelType === 'group');
  }
  // Per-bot receipt emoji (2026-09-23) — see SLACK_BOT_EMOJI in config.ts.
  const receiptEmoji = (env.SLACK_BOT_EMOJI ?? 'eyes').replace(/^:+|:+$/g, '') || 'eyes';

  // Silent-drop record + notice (2026-09-26, drop-notice.ts): every drop leaves
  // one metadata-only log line; a few reasons may also answer the sender.
  // botName = the last path segment of the state dir with a
  // 'slack-' prefix stripped (per-bot state dirs are named e.g. 'slack-mybot').
  const botName = basename(STATE_DIR).replace(/^slack-/, '');
  const dropLogPath = join(homedir(), '.claude-state', `bridge-drops-${botName}.jsonl`);
  // Silence-watch stage 0b (2026-09-29): raw receipt line, same keys as the Codex bridge (raw-log.ts).
  // OFF unless this bridge's .env says SLACK_RAW_LOG=1 (exactly "1", .env only — the process env does not count):
  // the line holds every message event's sender id, channel and timestamp, so it is opt-in.
  const rawLogPath = join(homedir(), '.claude-state', `bridge-raw-${botName}.jsonl`);
  const rawLogEnabled = env.SLACK_RAW_LOG === '1';
  const dropNoticeStatePath = join(homedir(), '.claude-state', `bridge-drop-notice-${botName}.json`);
  const dropNotifier = new DropNotifier(dropNoticeStatePath);
  const dropNoticeEnabled = (env.SLACK_DROP_NOTICE ?? process.env.CLAUDE_CHANNEL_DROP_NOTICE) === '1';
  // 2026-10-18: a threaded DM reply is also shown in the DM (notification) unless this bridge's .env sets 0.
  const dmReplyBroadcast = dmBroadcastDefault(env.SLACK_DM_REPLY_BROADCAST, process.env.CLAUDE_CHANNEL_DM_REPLY_BROADCAST);
  // 2026-10-22: notice for an allowed peer's post without a mention ('bot-no-mention') —
  // its own switch and its own rate-limit state, never sharing the allowlist notice's budget.
  const noMentionNotifier = new DropNotifier(join(homedir(), '.claude-state', `bridge-drop-notice-nomention-${botName}.json`));
  // 2026-10-24 one policy (no-mention-notice.ts): the .env key only, and refused
  // together with the 10-13 pilot key. Ledger = one notice per thread + seen notice ids.
  const noMentionSwitch = resolveNoMentionSwitch(env, process.env);
  const noMentionNoticeEnabled = noMentionSwitch.enabled;
  const noMentionLedger = new NoticeLedger(join(homedir(), '.claude-state', `bridge-nomention-ledger-${botName}.json`));
  const noticeReceiptPath = join(homedir(), '.claude-state', `bridge-notice-receipts-${botName}.jsonl`);
  const dropNoticeOffPath = join(homedir(), '.claude-state', 'slack-drop-notice.off');

  const clients = new Set<net.Socket>();
  const seenTsOrder: string[] = [];
  const seenTsSet = new Set<string>();
  // Outbound allowlist: only conversations we've received an allowed inbound
  // from can be replied to — stops a reply from being routed to any other
  // channel/DM (DM content leak) even if a chat_id says otherwise.
  // Seeded with the configured channels (2026-09-23): a session may address a configured
  // channel explicitly from the first send, instead of falling back to the home channel
  // until an inbound from it has been seen (three misdeliveries in one morning). DMs and
  // any other conversation still have to be seen first.
  const allowedChannels = new Set<string>(configuredChannelIds);
  // The allowed user's open DM is a valid reply target from the moment the
  // bridge starts, not only after their next message: the allowlist used to
  // live in memory only, so every restart made the first DM reply after it
  // fail (or, before 2026-09-23, silently land in the home channel).
  // Best-effort — a failed lookup just leaves the old "seen first" behaviour.
  async function seedAllowedDms(): Promise<void> {
    try {
      const res = await web.users.conversations({ types: 'im', limit: 200 });
      let seeded = 0;
      for (const conv of res.channels ?? []) {
        if (conv.id && conv.user === env.ALLOWED_SLACK_USER_ID) {
          allowedChannels.add(conv.id);
          channelKindByChannel.set(conv.id, 'im');
          seeded += 1;
        }
      }
      log('server', `allowed DMs seeded — ${seeded}`);
    } catch (err) {
      log('server', `DM seeding skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // The most recent conversation an allowed inbound arrived from. Reply (when
  // chat_id is omitted) and permission-ask (which carries no channel at all)
  // fall back to this so DM-derived content lands in the active conversation
  // instead of always leaking to the public channel.
  let lastInboundChannel: string | null = null;
  // This bridge's own bot user id (U…), resolved once at startup via
  // `auth.test` — the target gate below needs it to decide "was I the one
  // being mentioned". Startup fails fast if it can't be resolved: an empty
  // value would silently drop every channel message (fail closed), which is
  // safe but undiagnosable.
  let botUserId = '';
  // Threads THIS bot is already part of (root ts). Follow-ups inside such a
  // thread pass the target gate without re-mentioning the bot — but only for
  // threads this bridge itself was pulled into, so with several bridge bots
  // in one channel the no-mention chorus (defect 13) does not come back:
  // each bot only exempts its own threads. Bounded like seenTs.
  const activeThreadsOrder: string[] = [];
  const activeThreadsSet = new Set<string>();
  function rememberThread(root: string): void {
    if (activeThreadsSet.has(root)) return;
    activeThreadsSet.add(root);
    activeThreadsOrder.push(root);
    if (activeThreadsOrder.length > 200) {
      const evicted = activeThreadsOrder.shift();
      if (evicted) activeThreadsSet.delete(evicted);
    }
  }

  // Outbound DM-thread guard (겹1, 2026-08-10 — 봇 실측 2026-08-09):
  // defect 17 taught handleSlackEvent (below) to only put `thread_ts` in a
  // DM's meta when the *inbound* message actually carried one — a DM the
  // user never threaded gets none, so the model has nothing legitimate to
  // echo. That is a code-side gate on the inbound path only, though; it does
  // nothing to the outbound `reply` tool, which accepts whatever thread_ts
  // argument the model hands it. When a model supplies one anyway (echoed
  // from an unrelated event, hallucinated, or just not following the
  // instruction), handleReply used to pass it straight to
  // chat.postMessage and Slack folds the DM into a comment thread — the
  // exact defect 17 symptom, resurrected through the tool-argument layer
  // instead of the code layer. channelKindByChannel + imInboundThreadTsSet
  // let handleReply veto that itself: only a thread_ts a real DM inbound
  // actually carried may be echoed back into a DM. Channel (non-DM) replies
  // are untouched — this guard only ever engages when the target channel is
  // 'im'.
  const channelKindByChannel = new Map<string, 'im' | 'other'>();
  const imInboundThreadTsOrder: string[] = [];
  const imInboundThreadTsSet = new Set<string>();
  function rememberImInboundThreadTs(threadTs: string): void {
    if (imInboundThreadTsSet.has(threadTs)) return;
    imInboundThreadTsSet.add(threadTs);
    imInboundThreadTsOrder.push(threadTs);
    // Bounded at 2000 (FIFO): past that, the oldest tracked DM thread is evicted
    // first. That thread's next reply then falls back to the DM body outside
    // any thread instead of being echoed into it — still delivered, just no
    // longer thread-anchored. Graceful degradation, not silent loss or misdelivery.
    // 2026-10-18: every DM message is registered now (not only user-opened
    // threads), so the bound went from 200 to 2000 (a few dozen KB at most).
    if (imInboundThreadTsOrder.length > 2000) {
      const evicted = imInboundThreadTsOrder.shift();
      if (evicted) imInboundThreadTsSet.delete(evicted);
    }
  }

  // Auto progress reactions (2026-09-23): which inbound is still "being
  // worked on" per conversation thread, so the reply that closes it can swap
  // 👀 for ✅ on that exact message. Keyed `${channel}:${thread root}`; bounded
  // at 200 FIFO like the other trackers — an evicted entry just means no ✅.
  const pendingInboundByThread = new Map<string, { channel: string; ts: string }>();
  const newestPendingKeyByChannel = new Map<string, string>();
  function rememberPendingInbound(key: string, ref: { channel: string; ts: string }): void {
    pendingInboundByThread.delete(key);
    pendingInboundByThread.set(key, ref);
    newestPendingKeyByChannel.set(ref.channel, key); // a top-level DM reply closes this one
    if (pendingInboundByThread.size > 200) {
      const oldest = pendingInboundByThread.keys().next().value;
      if (oldest !== undefined) pendingInboundByThread.delete(oldest);
    }
  }
  async function markInboundDone(key: string): Promise<void> {
    const ref = pendingInboundByThread.get(key);
    if (ref && newestPendingKeyByChannel.get(ref.channel) === key) newestPendingKeyByChannel.delete(ref.channel);
    if (!ref) return;
    pendingInboundByThread.delete(key);
    // The per-bot receipt emoji stays (it is the "who read this" record); ✅ is added
    // beside it so the count of ✅ reads as "how many bots finished".
    try {
      await web.reactions.add({ channel: ref.channel, timestamp: ref.ts, name: 'white_check_mark' });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (!m.includes('already_reacted')) log('react', `check on ${ref.channel}/${ref.ts} failed: ${m}`);
    }
  }

  // (B) bot-interop (2026-08-07): which OTHER bridge bots may speak to this
  // one. U…-space on purpose — the same id axis as ALLOWED_SLACK_USER_ID and
  // as the `<@U…>` mention text, so there is exactly one id space to reason
  // about (the B…/U… split is what produced the live tag misread on
  // 2026-08-06). A bot message carries both `bot_id` (B…) and `user` (U…);
  // we key on `user` and drop authorless variants. Unset/empty = empty set =
  // every bot message drops — exactly the pre-(B) gate, so existing installs
  // regress zero.
  const allowedBotUserIds = new Set(
    (env.ALLOWED_SLACK_BOT_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  // No bot-chain counter here on purpose (2026-08-07 주인 "빼자"): the
  // Discord device this ports is mention-pass + allowlist, nothing more —
  // months of Discord operation and an 11-round human-free meeting show
  // conversations end by bot discipline, not by a code cap. A cap of 6 was
  // briefly shipped and measured cutting real work (see meeting 03-outcome
  // ⑦) — a low backstop stops being insurance and becomes the primary
  // control. Loop pressure is still bounded by ② explicit-mention + ①
  // allowlist below.
  //
  // 2026-10-25 (security round): a broken or hijacked ALLOWED peer could still post
  // forever, each post with a new ts and an explicit mention, and every one reached
  // the session. What is added is not the removed cap: that one bounded the LENGTH of
  // a conversation (6 consecutive bot turns, blind to time, so it cut real meetings);
  // this bounds the VOLUME one peer can push in a time window (default 30 per 600 s,
  // counted per sender over delivered posts only, owner and guests never counted,
  // SLACK_PEER_BOT_RATE_MAX=0 = off). A thread of any length at a human or model pace
  // never reaches it; only a runaway sender does.
  const peerRate = parsePeerRate(env);
  for (const warning of peerRate.warnings) log('config', warning);
  const peerRateMax = peerRate.max;
  const peerRateWindowMs = peerRate.windowMs;
  // Delivery times (ms) per peer, and when each peer last drew its notice. Keys are
  // allowlisted peer ids only (the cap sits below the allowlist gate), so both stay small.
  const peerRecent = new Map<string, number[]>();
  const peerRateNoticeAt = new Map<string, number>();

  function alreadySeen(ts: string): boolean {
    if (seenTsSet.has(ts)) return true;
    seenTsSet.add(ts);
    seenTsOrder.push(ts);
    if (seenTsOrder.length > 200) {
      const evicted = seenTsOrder.shift();
      if (evicted) seenTsSet.delete(evicted);
    }
    return false;
  }

  function broadcast(msg: ServerToClientMsg): void {
    const line = encodeLine(msg);
    for (const socket of clients) {
      if (!socket.destroyed) socket.write(line);
    }
  }

  function sendAck(socket: net.Socket, req_id: string, ok: boolean, error?: string): void {
    if (socket.destroyed) return;
    socket.write(encodeLine({ type: 'ack', req_id, ok, error }));
  }

  // ---- Slack Web API (outbound) -----------------------------------------

  const web = new WebClient(env.SLACK_BOT_TOKEN);

  // 2026-10-19 owner-tag DM copy (owner-tag-copy.ts) — OFF unless this bot's .env sets
  // SLACK_OWNER_TAG_DM_COPY_CHANNEL. Owner id = ALLOWED_SLACK_USER_ID unless overridden.
  const ownerCopySetup = parseOwnerTagCopyConfig(env);
  for (const note of ownerCopySetup.notes) log('owner-copy', note);
  if (ownerCopySetup.config) log('owner-copy', 'enabled — owner-tagged channel replies are also copied to the owner DM');
  const copyToOwnerDm = createOwnerTagCopier(ownerCopySetup.config, { web, botName, log: (m) => log('owner-copy', m) });
  // No-mention notice (2026-10-24): its own client — 3 s, no retry, a rate-limited
  // call fails instead of waiting (the 10-13 pilot's sending policy) — so a slow
  // Slack never holds a drop, and the post's result becomes receipt 1.
  const noMentionWeb = new WebClient(env.SLACK_BOT_TOKEN, { timeout: 3000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
  const noMentionSender = new NoMentionSender({
    selfUserId: () => botUserId,
    botName,
    ledger: noMentionLedger,
    rate: noMentionNotifier,
    post: (args) => noMentionWeb.chat.postMessage(args),
    receiptPath: noticeReceiptPath,
    offPath: dropNoticeOffPath,
  });
  const noMentionReceiver = new NoMentionReceiver({ selfUserId: () => botUserId, ledger: noMentionLedger, receiptPath: noticeReceiptPath });
  if (noMentionSwitch.conflict) {
    log('drop-notice', 'SLACK_DROP_NOTICE_NO_MENTION and SLACK_DROP_PILOT_NOTICE are both on: refused, the no-mention notice stays OFF');
    appendReceipt(noticeReceiptPath, { ts: new Date().toISOString(), kind: 'notice-conflict' });
  }

  async function handleReply(socket: net.Socket, msg: Extract<ClientToServerMsg, { type: 'reply' }>): Promise<void> {
    // Route to the conversation the session named (DM↔DM, channel↔channel).
    // A named chat_id must be one we may post to (configured, seen an allowed
    // inbound from, or — with the `*` wildcard — any non-DM channel; Slack
    // itself rejects a channel the bot is not in). A chat_id outside that set
    // is an ERROR back to the session, not a silent fallback: a reply that
    // lands in the home channel instead of the maintainer's DM looks like
    // "sent" to the model and is found hours later (2026-09-23, four such
    // misdeliveries). The fallback (last inbound, else primary) applies only
    // when the session named no chat_id at all.
    if (msg.channel && !allowedChannels.has(msg.channel) && !(listenAnyMemberChannel && !msg.channel.startsWith('D'))) {
      sendAck(socket, msg.req_id, false, `chat_id ${msg.channel} is not a conversation this bridge may post to (not configured, and no allowed inbound seen from it) — reply NOT sent`);
      return;
    }
    const target = msg.channel ?? lastInboundChannel ?? primaryChannelId;
    // 겹1: strip a model-supplied thread_ts on a DM target unless it is one a
    // real DM inbound actually carried — since 2026-10-18 that includes the
    // DM message's own ts, so a DM reply goes into that message's thread and
    // is broadcast into the DM (dm-thread.ts). Never touches non-DM targets —
    // msg.thread_ts passes through unchanged there and is never broadcast.
    const isImTarget = channelKindByChannel.get(target) === 'im';
    const { threadTs, broadcast } = resolveReplyThreading({
      isImTarget,
      requestedThreadTs: msg.thread_ts,
      knownImThreads: imInboundThreadTsSet,
      requestedBroadcast: msg.reply_broadcast,
      dmBroadcastDefault: dmReplyBroadcast,
    });
    try {
      const r = await postChunked(web, { channel: target, thread_ts: threadTs, text: msg.text, reply_broadcast: broadcast });
      if (!r.ok) {
        const note = r.sent === 0 ? `reply NOT sent (0/${r.total} chunks)` : `reply partially sent: ${r.sent}/${r.total} chunks`;
        sendAck(socket, msg.req_id, false, `${r.error} — ${note}`);
        return;
      }
      sendAck(socket, msg.req_id, true);
      // Owner-tag DM copy: after the original is posted and acknowledged; fire-and-forget, never
      // throws, never changes what the session was told (owner-tag-copy.ts).
      void copyToOwnerDm({ target, isDmTarget: isImTarget, text: msg.text, postedTs: r.firstTs });
      // ✅ beside the receipt emoji on the inbound this reply answers: the thread
      // root when threaded, the newest pending inbound of the DM when a DM reply
      // is top-level (pending-key.ts). Fire-and-forget.
      const doneKey = pickInboundDoneKey(target, threadTs, isImTarget, newestPendingKeyByChannel);
      if (doneKey) void markInboundDone(doneKey);
    } catch (err) {
      sendAck(socket, msg.req_id, false, err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReact(socket: net.Socket, msg: Extract<ClientToServerMsg, { type: 'react' }>): Promise<void> {
    // Same outbound allowlist as reply: only react in conversations we've
    // actually received an allowed inbound from — a reaction placed in an
    // unseen chat would leak presence the same way a stray reply would.
    if (!allowedChannels.has(msg.channel)) {
      sendAck(socket, msg.req_id, false, `refusing to react in unseen conversation ${msg.channel}`);
      return;
    }
    const emoji = msg.emoji.replace(/^:+|:+$/g, ''); // accept ":thumbsup:" and "thumbsup" alike
    try {
      await web.reactions.add({ channel: msg.channel, timestamp: msg.ts, name: emoji });
      sendAck(socket, msg.req_id, true);
    } catch (err) {
      // Reacting twice with the same emoji is a no-op in spirit — report ok
      // so a retry doesn't read as a failure.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already_reacted')) {
        sendAck(socket, msg.req_id, true);
        return;
      }
      sendAck(socket, msg.req_id, false, message);
    }
  }

  async function handlePermissionAsk(
    socket: net.Socket,
    msg: Extract<ClientToServerMsg, { type: 'permission_ask' }>,
  ): Promise<void> {
    const text = [
      `Claude wants to run ${msg.tool_name}: ${msg.description}`,
      msg.input_preview,
      '',
      `Reply "yes ${msg.request_id}" or "no ${msg.request_id}"`,
    ].join('\n');
    try {
      await web.chat.postMessage({ channel: lastInboundChannel ?? primaryChannelId, text });
      sendAck(socket, msg.req_id, true);
    } catch (err) {
      sendAck(socket, msg.req_id, false, err instanceof Error ? err.message : String(err));
    }
  }

  // ---- Unix socket IPC (server side) -------------------------------------

  function handleClientLine(socket: net.Socket, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log('ipc', 'dropped non-JSON line from client');
      return;
    }
    const result = ClientToServer.safeParse(parsed);
    if (!result.success) {
      log('ipc', `dropped malformed message: ${result.error.issues.map((i) => i.message).join('; ')}`);
      return;
    }
    const msg = result.data;
    switch (msg.type) {
      case 'register':
        clients.add(socket);
        log('ipc', `session ${msg.session_id} registered (${clients.size} active)`);
        break;
      case 'reply':
        void handleReply(socket, msg);
        break;
      case 'react':
        void handleReact(socket, msg);
        break;
      case 'permission_ask':
        void handlePermissionAsk(socket, msg);
        break;
      case 'delivered':
        noMentionReceiver.onDelivered(msg.notice_id, msg.session_id);
        break;
    }
  }

  function startIpcServer(): net.Server {
    if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);

    const server = net.createServer((socket) => {
      // Hardening (b): mode 0600 on the socket file already stops other
      // local users from opening() it at all — this is the second,
      // independent check: reject unless the connecting process's
      // effective uid is literally our own.
      if (!verifyPeerIsSelf(socket)) {
        log('ipc', 'rejected connection: peer uid does not match this process');
        socket.destroy();
        return;
      }

      const reader = new LineReader((line) => handleClientLine(socket, line));
      socket.on('data', (chunk) => reader.push(chunk));
      socket.on('close', () => clients.delete(socket));
      socket.on('error', (err) => log('ipc', `client socket error: ${err.message}`));
    });

    server.listen(SOCKET_PATH, () => {
      // Hardening (b): tighten immediately after bind — the socket file
      // exists the instant listen() succeeds, so we chmod before yielding
      // control back to the event loop (no `await` between listen() and
      // this callback).
      chmodSync(SOCKET_PATH, 0o600);
      log('ipc', `listening on ${SOCKET_PATH} (mode 0600)`);
    });

    server.on('error', (err) => log('ipc', `server error: ${err.message}`));
    return server;
  }

  // ---- Slack Socket Mode (inbound) ---------------------------------------

  // Records every drop point of handleSlackEvent below: one
  // JSONL line, no message body. Best-effort (logDrop itself never throws).
  function recordDrop(reason: string, event: SlackMessageEvent): void {
    logDrop(dropLogPath, {
      ts: new Date().toISOString(),
      reason,
      sender: event.user,
      channel: event.channel,
      thread: event.thread_ts,
      subtype: event.subtype,
      event_ts: event.event_ts,
      message_ts: event.message?.ts ?? event.ts,
      bot_id_present: Boolean(event.bot_id),
      nested_sender: event.message?.user,
    });
  }

  async function handleSlackEvent(event: SlackMessageEvent): Promise<void> {
    // Edits and deletes are notifications about an existing post, not new
    // instructions. Ignore them before all drop gates: these payloads may
    // keep the original author only under `message`, and recording each one
    // as a rejected human floods the drop log during Slack edits.
    if (event.subtype === 'message_changed' || event.subtype === 'message_deleted') return;

    // Hardening (a): the channel this event came from must be the one
    // configured channel, OR the event must be a DM (channel_type 'im') —
    // purujitgoyal's reference bridge never checked this (see spec's
    // gapChannelEquality), so a bot invited into any other channel would
    // forward everything from there too. DM is let through here because the
    // sender gate right below is the sole guard on that path (see 설계 메모
    // 설계 메모): a DM is inherently 1:1 with whoever sent it, so once that sender
    // is verified as ALLOWED_SLACK_USER_ID there is no other channel this
    // event could have leaked from.
    if (!isListenedChannel(event.channel, event.channel_type) && event.channel_type !== 'im') {
      recordDrop('not-listened-channel', event);
      return;
    }

    const text = (event.text ?? '').trim();
    // Set only for a trusted no-mention notice from a peer bridge (2026-10-24).
    let controlMeta: Record<string, string> = {};
    // Who wrote it, for the session (meta.sender_role): 'owner' = ALLOWED_SLACK_USER_ID, 'guest' = a person
    // listed in ALLOWED_SLACK_GUEST_IDS, null = a peer bot (those carry sender_is_bot instead).
    let senderRole: 'owner' | 'guest' | null = null;

    // Sender gate, split by author kind ((B) bot-interop, 2026-08-07). Order
    // trap, measured live by 봇 before this change shipped: the old
    // human-only check sat ABOVE the bot gate, and a bot post carries its own
    // U… in event.user — so it died at the human check and never reached the
    // bot line. "Relax the bot_id line" alone would have opened nothing while
    // building green. The two judgments therefore live in one fork now.
    const fromBot = Boolean(event.bot_id) || event.subtype === 'bot_message';
    if (!fromBot) {
      // Human path — same ALLOWED_SLACK_USER_ID check as always, for
      // messages, @mentions, and permission-verdict replies alike.
      if (event.user === env.ALLOWED_SLACK_USER_ID) {
        senderRole = 'owner'; // first, so the owner listed as a guest too is still the owner
      } else {
        // Guest seat (optional): ALLOWED_SLACK_GUEST_IDS in this bot's .env, U… ids, comma-separated. Empty or
        // absent = nobody (the judgment is then exactly the owner-only one above). A guest is limited here and
        // again below: no DM, the bot's own mention on every post (no "bot already in this thread" exemption),
        // never a permission verdict, attachments not fetched. What the session may do for a guest is the
        // session contract's business (meta.sender_role, mcp.ts instructions).
        // Parsed from env on the spot: this gate only reads names the surrounding tests already inject.
        const guestUserIds = (env.ALLOWED_SLACK_GUEST_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!event.user || !guestUserIds.includes(event.user)) {
          recordDrop('not-allowed-human', event);
          return;
        }
        // DMs stay owner-only, the same way they stay human-only for bots.
        if (event.channel_type === 'im') {
          recordDrop('guest-dm-not-allowed', event);
          return;
        }
        senderRole = 'guest';
      }
      // edits, joins, etc. — but file_share / thread_broadcast carry a human-authored body (2026-09-24:
      // a DM with a file attached was dropped here silently; see inbound-files.ts)
      if (!humanSubtypeAllowed(event.subtype)) {
        recordDrop('human-subtype-not-allowed', event);
        return;
      }
      // A guest must name THIS bot on every post. This sits above the target gate on purpose: the owner's
      // exemptions there (permission verdict, follow-up in a thread this bot already joined) never reach a guest.
      if (senderRole === 'guest' && !text.includes(`<@${botUserId}>`)) {
        recordDrop('guest-no-mention', event);
        return;
      }
    } else {
      // DMs stay human-only: the DM path's whole security argument (설계 메모
      // 설계 메모) is "1:1 with a verified human". Bot conversations belong in the
      // channel, where the mention discipline below applies.
      if (event.channel_type === 'im') {
        recordDrop('bot-dm-not-allowed', event);
        return;
      }
      if (!event.user || event.user === botUserId) {
        recordDrop('bot-self-or-authorless', event);
        return;
      }
      if (!allowedBotUserIds.has(event.user)) {
        // The drop reason most worth a Slack notice: a peer
        // bot not on our allowlist, mentioning us explicitly, in a channel
        // we listen to. logDrop always fires; the notice is best-effort and
        // gated behind CLAUDE_CHANNEL_DROP_NOTICE=1 plus DropNotifier's rate
        // limit so a misconfigured peer cannot spam the channel.
        recordDrop('bot-not-allowed', event);
        if (
          dropNoticeEnabled &&
          shouldNotify(event, { allowedBotUserIds, selfUserId: botUserId, isListenedChannel })
        ) {
          const sender = event.user;
          const channel = event.channel ?? '';
          if (dropNotifier.allow(sender, channel)) {
            void web.chat
              .postMessage({
                channel,
                thread_ts: event.thread_ts ?? event.ts,
                text: noticeText(sender, botName),
              })
              .catch((err) => log('drop-notice', `post failed: ${err instanceof Error ? err.message : String(err)}`));
          }
        }
        return;
      }
      // A bot must name THIS bot explicitly — no verdict shortcut and no
      // thread exemption for bot senders. Defense in depth: the anchored
      // VERDICT_PATTERN can never contain a mention, so an allowed bot also
      // cannot approve permission requests through this gate.
      if (!text.includes(`<@${botUserId}>`)) {
        recordDrop('bot-no-mention', event);
        // Tell the sender its post did not reach this bot (opt-in, same thread,
        // rate-limited per (sender, channel) like the allowlist notice, one per
        // thread, emergency-off file, receipt 1 — see no-mention-notice.ts).
        if (
          noMentionNoticeEnabled &&
          shouldNotifyNoMention(event, { allowedBotUserIds, selfUserId: botUserId, isListenedChannel })
        ) {
          const outcome = await noMentionSender.notify(event);
          if (outcome === 'post-failed' || outcome === 'ledger-unsaved') log('drop-notice', `no-mention notice: ${outcome}`);
          if (outcome === 'ledger-broken') log('drop-notice', 'no-mention notice: ledger file unreadable — notice stays OFF until bridge-nomention-ledger-<bot>.json is removed');
        }
        return;
      }
      // The other end (2026-10-24): an exact notice from an allowed peer bridge
      // telling THIS bot its post went nowhere. Delivered as usual, but marked as
      // control for the session (receipt 2); a second copy is not delivered again.
      const control = noMentionReceiver.accept(event, text);
      if (control.kind === 'twin') return; // the same post's other event, already delivered
      if (control.kind === 'duplicate') {
        recordDrop('notice-duplicate', event);
        return;
      }
      if (control.kind === 'control') controlMeta = control.meta;
    }

    // Hardening (c) — target gate (2026-08-06, defect 13): when the optional
    // `message.channels` subscription is on (the default manifest leaves it off
    // and channel posts arrive only as app_mention), EVERY channel post from the allowed user reaches every
    // bridge attached to that channel — N bridge bots would all answer any
    // message (live incident: three bots chorused one greeting). In a channel
    // the post must name THIS bot to proceed. Two deliberate exemptions:
    //   - DMs (`channel_type === 'im'`): 1:1 by construction, the sender gate
    //     above suffices (same argument as gate 2's DM branch, 설계 메모).
    //   - Permission verdicts ("yes abcde"): intentionally carry no mention,
    //     so they'd be silently dropped and approvals would never land —
    //     quiet breakage, the worst kind (defect 13 prescription #3).
    //   - Follow-ups in a thread this bot already participates in (defect 17
    //     interaction): channel replies are threaded, and requiring a fresh
    //     @-mention for every follow-up inside the bot's own thread would
    //     make conversations unusable. Scoped to activeThreadsSet, see above.
    //     T4 refinement (2026-08-06): the thread exemption applies only to
    //     MENTION-FREE follow-ups — the moment the user explicitly mentions
    //     someone (<@U…>/<@W…>), explicit addressing wins ("태그한 봇만
    //     답해야" applies inside threads too). So in my thread: no mention →
    //     implicitly mine, pass; mentions me → pass; mentions only another
    //     bot → I stay silent.
    const hasAnyUserMention = /<@[UW][A-Z0-9]+>/.test(text);
    if (
      event.channel_type !== 'im' &&
      !VERDICT_PATTERN.test(text) &&
      !text.includes(`<@${botUserId}>`) &&
      !(event.thread_ts && activeThreadsSet.has(event.thread_ts) && !hasAnyUserMention)
    ) {
      recordDrop('no-target-mention', event);
      return;
    }

    const ts = event.event_ts ?? event.ts;
    if (!ts || alreadySeen(ts)) return; // 'message' and 'app_mention' can both fire for one post

    // Per-peer volume cap (2026-10-25). Here, past every gate and the twin-event dedup, so only a post that
    // would be delivered uses a slot, and a dropped post gains nothing below (no receipt, no thread, no
    // reply target). Only peer bots: the owner and guests are never counted. Drops do not extend the window.
    if (fromBot && peerRateMax > 0) {
      const peer = event.user ?? '';
      const now = Date.now();
      const recent = (peerRecent.get(peer) ?? []).filter((t) => now - t < peerRateWindowMs);
      if (recent.length >= peerRateMax) {
        peerRecent.set(peer, recent);
        recordDrop('bot-rate-limited', event);
        const noticedAt = peerRateNoticeAt.get(peer);
        if (noticedAt === undefined || now - noticedAt >= peerRateWindowMs) {
          peerRateNoticeAt.set(peer, now);
          log('peer-rate', `peer bot ${peer} reached ${peerRateMax} delivered posts within ${peerRateWindowMs / 1000}s — its further posts are dropped until its oldest slot frees (one line per drop in the drop log; owner and guests are not capped; SLACK_PEER_BOT_RATE_MAX in the bridge .env)`);
        }
        return;
      }
      recent.push(now);
      peerRecent.set(peer, recent);
    }

    if (event.channel) {
      allowedChannels.add(event.channel); // this conversation is now a valid reply target
      // ...and the active one for fallback routing (permission prompts, a reply without chat_id) — the owner's
      // conversation only, never a guest's and never a peer bot's (2026-10-25): a prompt carries tool names and
      // inputs and belongs where the owner last spoke, so a peer bot mentioning this bot in a listened channel
      // while the owner works in a DM must not pull the next prompt into that channel.
      if (senderRole === 'owner') lastInboundChannel = event.channel;
      channelKindByChannel.set(event.channel, event.channel_type === 'im' ? 'im' : 'other'); // 겹1: which reply-target-guard branch applies
    }

    // 겹1: record a genuine DM thread_ts (the user actually opened a thread
    // in this DM) so handleReply's guard above can tell that apart from a
    // model-supplied one. Channels don't need this — the guard never strips
    // their thread_ts.
    // 2026-10-18 (maintainer decision: DM replies go in the DM message's own thread): the inbound's own ts
    // is registered too, so a reply echoing it lands in that message's
    // thread; the notification the 2026-09-23 top-level rule protected now
    // comes from reply_broadcast (dm-thread.ts).
    if (event.channel_type === 'im') {
      rememberImInboundThreadTs(inboundThreadTs(event, ts));
    }

    // Defect 17: in a channel this conversation now lives in a thread rooted
    // at the inbound message (or the thread it was already in) — remember the
    // root so follow-ups inside it pass the target gate without a re-mention.
    if (event.channel_type !== 'im') {
      rememberThread(event.thread_ts ?? ts);
    }

    // A permission verdict is the owner's alone. Neither a guest nor a peer bot (senderRole null) can reach here
    // with one today — the mention gates above rule it out — and this keeps it so even if a gate or the pattern
    // ever loosens: anything that is not the owner's post stays an ordinary message.
    const verdictMatch = senderRole === 'owner' ? VERDICT_PATTERN.exec(text) : null;
    if (verdictMatch) {
      const [, verb, requestId] = verdictMatch;
      broadcast({
        type: 'permission_verdict',
        request_id: (requestId ?? '').toLowerCase(),
        behavior: (verb ?? '').toLowerCase().startsWith('y') ? 'allow' : 'deny',
      });
      return;
    }

    // Auto progress reaction (2026-09-23, user request): the bot's receipt emoji
    // (SLACK_BOT_EMOJI, default 👀) the moment an inbound is accepted, plus ✅
    // once the session's reply is posted (handleReply). Best-effort — a failed
    // reaction never blocks delivery.
    if (event.channel) {
      const inboundChannel = event.channel;
      void web.reactions
        .add({ channel: inboundChannel, timestamp: ts, name: receiptEmoji })
        .catch((err) => log('react', `${receiptEmoji} on ${inboundChannel}/${ts} failed: ${err instanceof Error ? err.message : String(err)}`));
      rememberPendingInbound(`${inboundChannel}:${event.thread_ts ?? ts}`, { channel: inboundChannel, ts });
    }

    // Attached files (2026-09-24): fetched with the bot token into <state dir>/inbox/<channel>-<ts>/ and
    // listed under the text with local paths. The Socket Mode ack already went out before this handler
    // ran, so a slow download cannot trigger Slack's 1-minute redelivery. Failures become per-file lines.
    let content = text;
    if (event.files?.length && senderRole === 'guest') {
      // A guest's files are not fetched with the bot token onto this machine; the session just hears there were some.
      content = `${text}\n[${event.files.length} attached file(s) from a guest were not downloaded]`.trim();
    } else if (event.files?.length) {
      const dir = join(STATE_DIR, 'inbox', `${event.channel ?? 'x'}-${ts}`);
      const results = await downloadFiles(event.files, env.SLACK_BOT_TOKEN, dir);
      content = (text + attachmentBlock(results)).trim();
      log('files', `${event.channel}/${ts}: ${results.filter((r) => r.path).length}/${results.length} downloaded`);
    }

    broadcast({
      type: 'inbound',
      content,
      meta: {
        // Must be the real event.channel/event.user, not the env values:
        // with DM support (설계 메모) a DM's channel is D… and a
        // channel post's is C…, and primaryChannelId is only ever the
        // latter — hardcoding it here would route every DM reply back out
        // to the public channel instead of the DM it came from. The `??`
        // fallback is defensive only: both fields are guaranteed present
        // by the gate above (channel matched one of two known-non-empty
        // forms, user matched the sender gate — human or allowed bot), so
        // this never actually falls through in practice — it just keeps the
        // optional typing honest without an assertion.
        channel: event.channel ?? primaryChannelId,
        user: event.user ?? env.ALLOWED_SLACK_USER_ID,
        ts: event.ts ?? ts,
        // Lets the session tell an allowed peer bot from the human without a
        // roster lookup — meta is Record<string, string>, hence the string
        // 'true' and the conditional spread ((B) bot-interop, 2026-08-07).
        ...(fromBot ? { sender_is_bot: 'true' } : {}),
        // Who wrote it, for a human sender: 'owner' or 'guest' (a guest's post is conversation only — mcp.ts).
        ...(senderRole ? { sender_role: senderRole } : {}),
        // control / notice_id / notice_from for a trusted no-mention notice; empty otherwise.
        ...controlMeta,
        // Threading: in a CHANNEL the reply always lands under the message
        // that summoned the bot — the thread the inbound was in, else the
        // inbound itself becomes the root (defect 17, 2026-08-06: a channel
        // must not fill up with bot answers). Since 2026-10-18 a DM works the
        // same way (maintainer decision: a DM reply goes in that message's thread — one DM message = one
        // thread); the notification a threaded DM reply used to lose (the
        // 2026-09-23 reason for top-level DM replies) now comes from
        // reply_broadcast in handleReply (dm-thread.ts).
        thread_ts: inboundThreadTs(event, ts),
      },
    });
    if (controlMeta.notice_id) noMentionReceiver.onBroadcast(controlMeta.notice_id, clients.size);
  }

  const socketModeClient = new SocketModeClient({ appToken: env.SLACK_APP_TOKEN });

  socketModeClient.on('message', async ({ event, ack }) => {
    await ack();
    // Stage 0b: record receipt BEFORE any filter in handleSlackEvent (message events only — Codex parity).
    // Only when SLACK_RAW_LOG=1 (rawLogEnabled above); otherwise nothing is written, not even the directory.
    const raw = rawLogEnabled ? rawRecord(event as RawSlackEvent, Date.now()) : null;
    if (raw) logRaw(rawLogPath, raw);
    await handleSlackEvent(event as SlackMessageEvent);
  });

  socketModeClient.on('app_mention', async ({ event, ack }) => {
    await ack();
    const mention = event as SlackMessageEvent;
    // No channel_type on app_mention — tag it so the `*` wildcard gate sees a channel (config.ts mentionChannelType).
    await handleSlackEvent({ ...mention, channel_type: mentionChannelType(mention.channel_type) });
  });

  socketModeClient.on('error', (err) => log('slack', `socket mode error: ${err instanceof Error ? err.message : String(err)}`));
  // Connection timeline only — no behavior change (2026-09-24: a +60s redelivery was seen on a Codex
  // bridge; with these lines the next one can be matched against a drop/reconnect).
  socketModeClient.on('connected', () => log('slack', 'socket connected'));
  socketModeClient.on('disconnected', () => log('slack', 'socket disconnected'));
  socketModeClient.on('reconnecting', () => log('slack', 'socket reconnecting'));

  // ---- lifecycle ----------------------------------------------------------

  const ipcServer = startIpcServer();
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log('server', `received ${signal}, shutting down`);
    try {
      await socketModeClient.disconnect();
    } catch {
      /* best effort */
    }
    ipcServer.close(() => {
      if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Resolve our own bot user id BEFORE opening the event stream — the target
  // gate (hardening c) compares inbound text against `<@${botUserId}>`, and
  // starting with an empty id would fail closed on every channel message with
  // no symptom. Fail fast and loud instead.
  web.auth
    .test()
    .then((auth) => {
      botUserId = String(auth.user_id ?? '');
      if (!botUserId) throw new Error('auth.test returned no user_id — cannot arm the mention target gate');
      log('server', `bot user resolved — ${botUserId}`);
      // Interactivity is opt-in through a shared, non-secret bot table. Only
      // the row matching this authenticated bridge identity may act. Stage 1
      // enables bot; disabled/unknown rows leave other bots unchanged.
      if (env.TYPESAFE_APPROVAL_BUTTON_BOTS_FILE && env.TYPESAFE_APPROVAL_BUTTON_KEY_FILE) {
        let activeButtonBot: ReturnType<typeof loadActiveButtonBot> = null;
        try {
          activeButtonBot = loadActiveButtonBot(
            env.TYPESAFE_APPROVAL_BUTTON_BOTS_FILE, botUserId, ENV_PATH,
            env.TYPESAFE_APPROVAL_BUTTON_KEY_FILE,
          );
        }
        catch (error) {
          log('button', `receipt path disabled: ${error instanceof Error ? error.name : 'unknown error'}`);
        }
        // Format 3 (2026-10-13): after a receipt is fsynced the bridge hands its
        // id to the registry CLI (`settle`) — fixed argument array, no shell,
        // 20 s limit. Path = TYPESAFE_APPROVAL_REGISTRY_SCRIPT (bridge .env
        // first, then the process environment), absolute only; unset = no
        // settle, i.e. the session-notification-only behaviour from before.
        const registryScript = resolveRegistryScript(
          (env as unknown as { TYPESAFE_APPROVAL_REGISTRY_SCRIPT?: string }).TYPESAFE_APPROVAL_REGISTRY_SCRIPT,
          process.env.TYPESAFE_APPROVAL_REGISTRY_SCRIPT,
        );
        const settle = makeSettle(registryScript, (file, args, options, callback) =>
          execFile(file, [...args], options, callback));
        if (activeButtonBot) socketModeClient.on('interactive', async ({ body, ack }) => {
          // Existing IPC inbound notifications are delivered only after the
          // receipt has been fsynced. They explicitly mark bridge/system
          // provenance and never impersonate the owner's Slack message.
          const outcome = await processInteractiveReceipt(
            body, ack, activeButtonBot.config, activeButtonBot.key,
            (notification) => {
              if (![...clients].some((client) => !client.destroyed)) throw new Error('no session');
              broadcast(notification);
            },
            undefined,
            {
              // 「의견달기」: the click passed the same scope checks; open the
              // modal on the existing web client and return the view id Slack
              // assigned (the submission is only honoured against that id).
              openView: async (triggerId, view) => {
                const res = await web.views.open({
                  trigger_id: triggerId,
                  view: view as unknown as Parameters<typeof web.views.open>[0]['view'],
                });
                const viewId = res.view?.id;
                if (!viewId) throw new Error('views.open returned no view id');
                return viewId;
              },
              settle,
            },
          );
          if (outcome.stage === 'ack-failed' || outcome.stage === 'receipt-failed' || outcome.stage === 'view-failed') {
            log('button', outcome.stage);
          } else if (outcome.stage === 'notification-failed') {
            log('button', `receipt ${outcome.result!.receiptId} stored; session notification failed`);
          }
          if (outcome.settle && outcome.settle !== 'skipped' && !outcome.settle.ok) {
            log('button', `receipt ${outcome.result!.receiptId} settle failed (${outcome.settle.detail}); session notified as fallback`);
          }
        });
      }
      return seedAllowedDms();
    })
    .then(() => socketModeClient.start())
    .then(() =>
      log(
        'server',
        `bridge live — channels ${configuredChannelIds.join(', ')}${listenAnyMemberChannel ? ' + any channel the bot is a member of (*)' : ''}, allowed user ${env.ALLOWED_SLACK_USER_ID}, bot ${botUserId} ` +
          `(channel posts require @-mention; DMs and permission verdicts exempt; auto-react on (receipt ${receiptEmoji}); bot interop ` +
          `${allowedBotUserIds.size > 0 ? `enabled — ${allowedBotUserIds.size} peer(s)` : 'disabled'})`,
      ),
    )
    .catch((err) => {
      log('server', `failed to start Slack bridge: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

  log('server', `env loaded from ${ENV_PATH}`);
}

main();
