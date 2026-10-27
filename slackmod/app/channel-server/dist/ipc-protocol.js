// Message contract for the Unix socket between the resident Slack process
// (server.ts) and each Claude Code session's MCP stdio proxy (mcp.ts).
// Framed as one JSON object per line (see line-reader.ts).
//
// Design: the server is a stateless relay. It never tracks which client
// asked what — permission verdicts are broadcast to every connected
// client the same way inbound messages are, and it's Claude Code's own
// `request_id` bookkeeping (per the channels-reference contract) that
// decides whether a given verdict matches an open request. This keeps the
// server simple and correct even with multiple sessions attached at once.
import { z } from 'zod';
// ---- server.ts -> mcp.ts -------------------------------------------------
const InboundMessage = z.object({
    type: z.literal('inbound'),
    content: z.string(),
    meta: z.record(z.string(), z.string()).optional(),
});
const PermissionVerdict = z.object({
    type: z.literal('permission_verdict'),
    request_id: z.string(),
    behavior: z.enum(['allow', 'deny']),
});
// Acks are correlated by req_id and deliberately kept out of the
// discriminated union below (mcp.ts checks `type === 'ack'` first, before
// falling through to ServerToClient parsing) since they're a reply to a
// specific outbound request rather than a broadcast event.
export const AckMessage = z.object({
    type: z.literal('ack'),
    req_id: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
});
export const ServerToClient = z.discriminatedUnion('type', [InboundMessage, PermissionVerdict]);
// ---- mcp.ts -> server.ts -------------------------------------------------
const RegisterMessage = z.object({
    type: z.literal('register'),
    session_id: z.string(),
});
const ReplyMessage = z.object({
    type: z.literal('reply'),
    req_id: z.string(),
    thread_ts: z.string().optional(),
    channel: z.string().optional(),
    text: z.string().min(1),
    reply_broadcast: z.boolean().optional(),
});
const PermissionAskMessage = z.object({
    type: z.literal('permission_ask'),
    req_id: z.string(),
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
});
// Emoji reaction on an existing message (2026-08-06, user request). Unlike
// reply, the target message must be named explicitly — there is no sane
// "most recent" fallback for a reaction, so both fields are required.
const ReactMessage = z.object({
    type: z.literal('react'),
    req_id: z.string(),
    channel: z.string().min(1),
    ts: z.string().min(1),
    emoji: z.string().min(1),
});
// Receipt 3 of the no-mention notice (2026-10-24, no-mention-notice.ts): sent
// once the proxy has handed an inbound carrying meta.notice_id to its session.
// Fire-and-forget (no req_id, no ack); the server records it only for an id it
// broadcast itself.
const DeliveredMessage = z.object({
    type: z.literal('delivered'),
    notice_id: z.string().regex(/^[0-9a-f]{12}$/),
    session_id: z.string().max(128).optional(),
});
export const ClientToServer = z.discriminatedUnion('type', [RegisterMessage, ReplyMessage, PermissionAskMessage, ReactMessage, DeliveredMessage]);
export function encodeLine(msg) {
    return `${JSON.stringify(msg)}\n`;
}
