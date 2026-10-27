// A Slack button click is evidence to be checked by the approval registry, not
// an approval event. This module only records the authenticated Socket Mode
// payload's minimal identity fields. It never executes a command or posts to
// Slack. The feature is opt-in for the bot bridge alone.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

export const BUTTON_ACTION_ID = 'typesafe_approval_v1';
export const BUTTON_SCHEMA = 'button-receipt-v1';
export const BUTTON_PURPOSE = 'destructive_approval';
export const DEFAULT_RECEIPT_DIR = join(homedir(), '.claude', 'state', 'typesafe', 'approval-registry', 'button-receipts');

export interface ApprovalBotConfig {
  bot_id: string;
  enabled: boolean;
  app_id: string;
  owner_id: string;
  owner_dm: string;
  bot_user_id: string;
  token_env_file: string;
  key_file: string;
}

const REQUEST_ID_RE = /^[a-f0-9]{32}$/;
const RECEIPT_ID_RE = /^[a-f0-9]{64}$/;
const SLACK_TS_RE = /^[0-9]{10}\.[0-9]{6}$/;
const MAX_RECEIPTS = 10_000;
const MAX_RECEIPT_BYTES = 2_048;

export const IDENTITY_FIELDS = [
  'action_id', 'action_ts', 'app_id', 'bot_id', 'channel_id', 'container_message_ts',
  'message_ts', 'purpose', 'request_id', 'schema', 'user_id',
] as const;
export const SIGNED_FIELDS = [...IDENTITY_FIELDS, 'received_at', 'receipt_id'] as const;

type IdentityField = typeof IDENTITY_FIELDS[number];
type SignedField = typeof SIGNED_FIELDS[number];
export type ButtonIdentity = Record<IdentityField, string>;
export type ButtonReceipt = Record<SignedField, string> & { signature: string };

export class ReceiptRejected extends Error {
  constructor(message: string) { super(message); this.name = 'ReceiptRejected'; }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function field(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x20-\x7e]+$/.test(value)) {
    throw new ReceiptRejected('missing or non-ASCII field');
  }
  return value;
}

// Values are ASCII by validation; insertion order is ASCII key order, matching
// Python json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=True).
export function canonicalJson(value: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key]!;
  return JSON.stringify(sorted);
}

function select<T extends string>(value: Record<string, string>, fields: readonly T[]): Record<T, string> {
  const selected = {} as Record<T, string>;
  for (const key of fields) selected[key] = value[key]!;
  return selected;
}

export function parseButtonIdentity(body: unknown, config: ApprovalBotConfig): ButtonIdentity | null {
  const payload = object(body);
  if (payload?.type !== 'block_actions') return null;
  if (!config.enabled || payload.api_app_id !== config.app_id) throw new ReceiptRejected('button app or bot disabled');
  const user = object(payload.user);
  const channel = object(payload.channel);
  const message = object(payload.message);
  const container = object(payload.container);
  const actions = payload.actions;
  if (!Array.isArray(actions) || actions.length !== 1) return null;
  const action = object(actions[0]);
  if (action?.action_id !== BUTTON_ACTION_ID) return null;

  const requestId = field(action.value);
  const userId = field(user?.id);
  const channelId = field(channel?.id);
  const messageTs = field(message?.ts);
  const containerTs = field(container?.message_ts);
  const containerChannel = field(container?.channel_id);
  const actionTs = field(action.action_ts);
  if (!REQUEST_ID_RE.test(requestId) || userId !== config.owner_id
      || channelId !== config.owner_dm || container?.type !== 'message'
      || containerChannel !== channelId || !SLACK_TS_RE.test(messageTs)
      || containerTs !== messageTs || !SLACK_TS_RE.test(actionTs)) {
    throw new ReceiptRejected('button identity outside approval scope');
  }
  return {
    schema: BUTTON_SCHEMA,
    app_id: config.app_id,
    bot_id: config.bot_id,
    purpose: BUTTON_PURPOSE,
    action_id: BUTTON_ACTION_ID,
    request_id: requestId,
    user_id: userId,
    channel_id: channelId,
    message_ts: messageTs,
    container_message_ts: containerTs,
    action_ts: actionTs,
  };
}

export function receiptId(identity: ButtonIdentity): string {
  return createHash('sha256').update(canonicalJson(select(identity, IDENTITY_FIELDS)), 'utf8').digest('hex');
}

export function signReceipt(identity: ButtonIdentity, receivedAt: string, key: Buffer): ButtonReceipt {
  if (key.length !== 32) throw new ReceiptRejected('button key must be 32 raw bytes');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receivedAt)
      || Number.isNaN(Date.parse(receivedAt))) throw new ReceiptRejected('invalid receipt time');
  const unsigned = { ...identity, received_at: receivedAt, receipt_id: receiptId(identity) };
  const signature = createHmac('sha256', key).update(canonicalJson(select(unsigned, SIGNED_FIELDS)), 'utf8').digest('hex');
  return { ...unsigned, signature };
}

export function verifyReceipt(receipt: unknown, key: Buffer): receipt is ButtonReceipt {
  const record = object(receipt);
  if (!record || Object.keys(record).sort().join(',') !== [...SIGNED_FIELDS, 'signature'].sort().join(',')) return false;
  if (key.length !== 32 || !Object.values(record).every((value) => typeof value === 'string')) return false;
  const r = record as ButtonReceipt;
  if (!RECEIPT_ID_RE.test(r.receipt_id) || !RECEIPT_ID_RE.test(r.signature)) return false;
  try {
    const identity = select(r, IDENTITY_FIELDS);
    if (receiptId(identity) !== r.receipt_id) return false;
    const expected = signReceipt(identity, r.received_at, key).signature;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(r.signature, 'hex'));
  } catch { return false; }
}

export function loadButtonKey(path: string): Buffer {
  // O_NOFOLLOW also guards the interval between lstat and open.
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new ReceiptRejected('button key must be a regular file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino
        || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600 || info.size !== 32) {
      throw new ReceiptRejected('button key owner, mode, or length invalid');
    }
    const key = readFileSync(fd);
    if (key.length !== 32) throw new ReceiptRejected('button key must be 32 raw bytes');
    return key;
  } finally { closeSync(fd); }
}

function secureDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()
      || (info.mode & 0o777) !== 0o700) throw new ReceiptRejected('receipt directory owner or mode invalid');
}

function syncDirectory(dir: string): void {
  const fd = openSync(dir, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export interface RecordResult { receiptId: string; requestId: string; duplicate: boolean; }

// Shared O_EXCL writer for v1 and v2 receipts (format 3, 2026-10-13). The v1
// bytes and file handling are exactly what recordButtonReceipt always did;
// only the verifier used on an existing file depends on the schema.
function persistReceipt(
  encoded: string, receiptIdValue: string, requestId: string,
  verifyExisting: (existing: unknown) => boolean, dir: string, maxReceipts: number,
): RecordResult {
  if (Buffer.byteLength(encoded, 'utf8') > MAX_RECEIPT_BYTES) throw new ReceiptRejected('receipt exceeds byte limit');
  secureDirectory(dir);
  const path = join(dir, `${receiptIdValue}.json`);
  let fd: number;
  try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existingInfo = lstatSync(path);
    if (!existingInfo.isFile() || existingInfo.isSymbolicLink()
        || existingInfo.uid !== process.getuid?.()
        || (existingInfo.mode & 0o777) !== 0o600
        || existingInfo.size > MAX_RECEIPT_BYTES) {
      throw new ReceiptRejected('existing receipt owner, mode, or size invalid');
    }
    const existing = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!verifyExisting(existing) || (existing as { receipt_id?: unknown }).receipt_id !== receiptIdValue) {
      throw new ReceiptRejected('existing receipt invalid');
    }
    syncDirectory(dir);
    return { receiptId: receiptIdValue, requestId, duplicate: true };
  }
  try {
    if (readdirSync(dir).length > maxReceipts) throw new ReceiptRejected('receipt capacity reached');
    writeFileSync(fd, encoded, 'utf8');
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(path); } catch { /* fail closed; invalid file remains unconsumable */ }
    throw error;
  }
  closeSync(fd);
  syncDirectory(dir);
  return { receiptId: receiptIdValue, requestId, duplicate: false };
}

export function recordButtonReceipt(
  body: unknown, config: ApprovalBotConfig, key: Buffer, dir: string = DEFAULT_RECEIPT_DIR,
  receivedAt: string = new Date().toISOString(), maxReceipts = MAX_RECEIPTS,
): RecordResult | null {
  const identity = parseButtonIdentity(body, config);
  if (!identity) return null;
  const receipt = signReceipt(identity, receivedAt, key);
  const encoded = canonicalJson(receipt) + '\n';
  return persistReceipt(encoded, receipt.receipt_id, identity.request_id,
    (existing) => verifyReceipt(existing, key), dir, maxReceipts);
}

// ---- Format 3 (2026-10-13): reject / comment buttons and the comment modal ----
//
// Approve keeps the v1 path above byte for byte. Reject and comment produce a
// v2 receipt: the v1 identity plus `decision` and `comment_sha256`, signed with
// the same key and canonical form. A comment click never yields a receipt by
// itself: it only opens a modal and records the view Slack returned, and the
// later view_submission is honoured only against that recorded view.

export const REJECT_ACTION_ID = 'typesafe_reject_v1';
export const COMMENT_ACTION_ID = 'typesafe_comment_v1';
export const COMMENT_MODAL_CALLBACK_ID = 'typesafe_comment_modal_v1';
export const COMMENT_BLOCK_ID = 'typesafe_comment_block';
export const COMMENT_INPUT_ACTION_ID = 'typesafe_comment_input';
export const BUTTON_SCHEMA_V2 = 'button-receipt-v2';
export const COMMENT_MAX_CHARS = 2_000;

export const IDENTITY_FIELDS_V2 = [...IDENTITY_FIELDS, 'decision', 'comment_sha256'] as const;
export const SIGNED_FIELDS_V2 = [...IDENTITY_FIELDS_V2, 'received_at', 'receipt_id'] as const;

type IdentityFieldV2 = typeof IDENTITY_FIELDS_V2[number];
type SignedFieldV2 = typeof SIGNED_FIELDS_V2[number];
export type ButtonIdentityV2 = Record<IdentityFieldV2, string>;
export type ButtonReceiptV2 = Record<SignedFieldV2, string> & { signature: string };

const VIEW_ID_RE = /^V[A-Z0-9]{6,31}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const MAX_VIEW_FILE_BYTES = 1_024;
const MAX_TRIGGER_ID_CHARS = 255;

function receiptTime(receivedAt: string): void {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receivedAt)
      || Number.isNaN(Date.parse(receivedAt))) throw new ReceiptRejected('invalid receipt time');
}

export function receiptIdV2(identity: ButtonIdentityV2): string {
  return createHash('sha256').update(canonicalJson(select(identity, IDENTITY_FIELDS_V2)), 'utf8').digest('hex');
}

function checkV2Decision(identity: ButtonIdentityV2): void {
  const pair = identity.action_id === REJECT_ACTION_ID
    ? identity.decision === 'reject' && identity.comment_sha256 === 'none'
    : identity.action_id === COMMENT_ACTION_ID
      ? identity.decision === 'comment' && SHA256_HEX_RE.test(identity.comment_sha256)
      : false;
  if (!pair || identity.schema !== BUTTON_SCHEMA_V2 || identity.purpose !== BUTTON_PURPOSE) {
    throw new ReceiptRejected('v2 decision pair invalid');
  }
}

export function signReceiptV2(identity: ButtonIdentityV2, receivedAt: string, key: Buffer): ButtonReceiptV2 {
  if (key.length !== 32) throw new ReceiptRejected('button key must be 32 raw bytes');
  receiptTime(receivedAt);
  for (const name of IDENTITY_FIELDS_V2) field(identity[name]);
  checkV2Decision(identity);
  const unsigned = { ...select(identity, IDENTITY_FIELDS_V2), received_at: receivedAt, receipt_id: receiptIdV2(identity) };
  const signature = createHmac('sha256', key).update(canonicalJson(select(unsigned, SIGNED_FIELDS_V2)), 'utf8').digest('hex');
  return { ...unsigned, signature };
}

export function verifyReceiptV2(receipt: unknown, key: Buffer): receipt is ButtonReceiptV2 {
  const record = object(receipt);
  if (!record || Object.keys(record).sort().join(',') !== [...SIGNED_FIELDS_V2, 'signature'].sort().join(',')) return false;
  if (key.length !== 32 || !Object.values(record).every((value) => typeof value === 'string')) return false;
  const r = record as ButtonReceiptV2;
  if (!RECEIPT_ID_RE.test(r.receipt_id) || !RECEIPT_ID_RE.test(r.signature)) return false;
  try {
    const identity = select(r, IDENTITY_FIELDS_V2);
    if (receiptIdV2(identity) !== r.receipt_id) return false;
    const expected = signReceiptV2(identity, r.received_at, key).signature;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(r.signature, 'hex'));
  } catch { return false; }
}

// Same scope checks as parseButtonIdentity (app, owner, owner DM, container,
// ts shapes), for the two new action ids.
interface ClickScope {
  requestId: string; userId: string; channelId: string; messageTs: string; containerTs: string; actionTs: string;
}

function clickScope(payload: Record<string, unknown>, action: Record<string, unknown>, config: ApprovalBotConfig): ClickScope {
  const user = object(payload.user);
  const channel = object(payload.channel);
  const message = object(payload.message);
  const container = object(payload.container);
  const requestId = field(action.value);
  const userId = field(user?.id);
  const channelId = field(channel?.id);
  const messageTs = field(message?.ts);
  const containerTs = field(container?.message_ts);
  const containerChannel = field(container?.channel_id);
  const actionTs = field(action.action_ts);
  if (!REQUEST_ID_RE.test(requestId) || userId !== config.owner_id
      || channelId !== config.owner_dm || container?.type !== 'message'
      || containerChannel !== channelId || !SLACK_TS_RE.test(messageTs)
      || containerTs !== messageTs || !SLACK_TS_RE.test(actionTs)) {
    throw new ReceiptRejected('button identity outside approval scope');
  }
  return { requestId, userId, channelId, messageTs, containerTs, actionTs };
}

export interface CommentOpenRequest {
  triggerId: string; requestId: string; userId: string;
  messageTs: string; containerTs: string; actionTs: string;
}

export type ParsedClick =
  | { kind: 'approve'; identity: ButtonIdentity }
  | { kind: 'reject'; identity: ButtonIdentityV2 }
  | { kind: 'comment-open'; open: CommentOpenRequest };

export function parseClick(body: unknown, config: ApprovalBotConfig): ParsedClick | null {
  const payload = object(body);
  if (payload?.type !== 'block_actions') return null;
  if (!config.enabled || payload.api_app_id !== config.app_id) throw new ReceiptRejected('button app or bot disabled');
  const actions = payload.actions;
  if (!Array.isArray(actions) || actions.length !== 1) return null;
  const action = object(actions[0]);
  if (action?.action_id === BUTTON_ACTION_ID) {
    const identity = parseButtonIdentity(body, config);
    return identity ? { kind: 'approve', identity } : null;
  }
  if (action?.action_id === REJECT_ACTION_ID) {
    const s = clickScope(payload, action, config);
    return {
      kind: 'reject',
      identity: {
        schema: BUTTON_SCHEMA_V2, app_id: config.app_id, bot_id: config.bot_id, purpose: BUTTON_PURPOSE,
        action_id: REJECT_ACTION_ID, request_id: s.requestId, user_id: s.userId, channel_id: s.channelId,
        message_ts: s.messageTs, container_message_ts: s.containerTs, action_ts: s.actionTs,
        decision: 'reject', comment_sha256: 'none',
      },
    };
  }
  if (action?.action_id === COMMENT_ACTION_ID) {
    const s = clickScope(payload, action, config);
    const triggerId = field(payload.trigger_id);
    if (triggerId.length > MAX_TRIGGER_ID_CHARS) throw new ReceiptRejected('trigger id too long');
    return {
      kind: 'comment-open',
      open: {
        triggerId, requestId: s.requestId, userId: s.userId,
        messageTs: s.messageTs, containerTs: s.containerTs, actionTs: s.actionTs,
      },
    };
  }
  return null;
}

export function siblingDir(receiptDir: string, name: 'button-views' | 'button-comments'): string {
  return join(dirname(receiptDir), name);
}

export function recordRejectReceipt(
  identity: ButtonIdentityV2, key: Buffer, dir: string = DEFAULT_RECEIPT_DIR,
  receivedAt: string = new Date().toISOString(), maxReceipts = MAX_RECEIPTS,
): RecordResult {
  const receipt = signReceiptV2(identity, receivedAt, key);
  const encoded = canonicalJson(receipt) + '\n';
  return persistReceipt(encoded, receipt.receipt_id, identity.request_id,
    (existing) => verifyReceiptV2(existing, key), dir, maxReceipts);
}

/** The modal views.open receives. private_metadata carries the request id only. */
export function commentModalView(requestId: string): Record<string, unknown> {
  if (!REQUEST_ID_RE.test(requestId)) throw new ReceiptRejected('request id invalid');
  return {
    type: 'modal',
    callback_id: COMMENT_MODAL_CALLBACK_ID,
    title: { type: 'plain_text', text: '의견 남기기' },
    submit: { type: 'plain_text', text: '보내기' },
    close: { type: 'plain_text', text: '취소' },
    private_metadata: JSON.stringify({ request_id: requestId }),
    blocks: [{
      type: 'input',
      block_id: COMMENT_BLOCK_ID,
      label: { type: 'plain_text', text: '의견' },
      element: {
        type: 'plain_text_input', action_id: COMMENT_INPUT_ACTION_ID,
        multiline: true, min_length: 1, max_length: COMMENT_MAX_CHARS,
      },
    }],
  };
}

function writeExclusive(dir: string, name: string, data: string | Buffer): void {
  secureDirectory(dir);
  const path = join(dir, name);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(path); } catch { /* fail closed */ }
    throw error;
  }
  closeSync(fd);
  syncDirectory(dir);
}

export function recordCommentView(
  viewId: string, open: CommentOpenRequest, receiptDir: string = DEFAULT_RECEIPT_DIR,
  openedAt: string = new Date().toISOString(),
): string {
  if (!VIEW_ID_RE.test(viewId)) throw new ReceiptRejected('view id invalid');
  receiptTime(openedAt);
  const record = {
    request_id: open.requestId, message_ts: open.messageTs, container_message_ts: open.containerTs,
    action_ts: open.actionTs, user_id: open.userId, opened_at: openedAt,
  };
  for (const value of Object.values(record)) field(value);
  const dir = siblingDir(receiptDir, 'button-views');
  writeExclusive(dir, `${viewId}.json`, canonicalJson(record) + '\n');
  return join(dir, `${viewId}.json`);
}

const VIEW_FILE_FIELDS = ['action_ts', 'container_message_ts', 'message_ts', 'opened_at', 'request_id', 'user_id'];

function readViewFile(path: string): Record<string, string> {
  let before;
  try { before = lstatSync(path); }
  catch { throw new ReceiptRejected('comment view not opened by this bridge'); }
  if (!before.isFile() || before.isSymbolicLink()) throw new ReceiptRejected('view file must be a regular file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino
        || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600
        || info.size > MAX_VIEW_FILE_BYTES) throw new ReceiptRejected('view file owner, mode, or size invalid');
    const parsed = object(JSON.parse(readFileSync(fd, 'utf8')) as unknown);
    if (!parsed || Object.keys(parsed).sort().join(',') !== VIEW_FILE_FIELDS.join(',')) {
      throw new ReceiptRejected('view file fields invalid');
    }
    const out: Record<string, string> = {};
    for (const name of VIEW_FILE_FIELDS) out[name] = field(parsed[name]);
    return out;
  } finally { closeSync(fd); }
}

/** 1~2000 code points, UTF-8; control characters other than \n and \t, format (Cf) characters, and lone surrogates rejected. */
export function validateCommentText(text: unknown): string {
  if (typeof text !== 'string') throw new ReceiptRejected('comment missing');
  const length = [...text].length;
  if (length < 1 || length > COMMENT_MAX_CHARS) throw new ReceiptRejected('comment length out of range');
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text.replace(/[\n\t]/g, ''))) throw new ReceiptRejected('comment has control or format characters');
  return text;
}

export interface CommentResult extends RecordResult { commentPath: string; }

export function recordCommentSubmission(
  body: unknown, config: ApprovalBotConfig, key: Buffer, dir: string = DEFAULT_RECEIPT_DIR,
  receivedAt: string = new Date().toISOString(), maxReceipts = MAX_RECEIPTS,
): CommentResult | null {
  const payload = object(body);
  if (payload?.type !== 'view_submission') return null;
  const view = object(payload.view);
  if (view?.callback_id !== COMMENT_MODAL_CALLBACK_ID) return null;
  if (!config.enabled || view.app_id !== config.app_id
      || (payload.api_app_id !== undefined && payload.api_app_id !== config.app_id)) {
    throw new ReceiptRejected('comment app or bot disabled');
  }
  const userId = field(object(payload.user)?.id);
  if (userId !== config.owner_id) throw new ReceiptRejected('comment user outside approval scope');
  const viewId = field(view.id);
  if (!VIEW_ID_RE.test(viewId)) throw new ReceiptRejected('view id invalid');
  let metadata: Record<string, unknown> | null;
  try { metadata = object(JSON.parse(field(view.private_metadata)) as unknown); }
  catch { throw new ReceiptRejected('private metadata invalid'); }
  const metaRequestId = metadata?.request_id;
  const values = object(object(object(view.state)?.values)?.[COMMENT_BLOCK_ID]);
  const text = validateCommentText(object(values?.[COMMENT_INPUT_ACTION_ID])?.value);

  const viewsDir = siblingDir(dir, 'button-views');
  const viewPath = join(viewsDir, `${viewId}.json`);
  const opened = readViewFile(viewPath);
  if (opened.request_id !== metaRequestId || !REQUEST_ID_RE.test(opened.request_id!)
      || opened.user_id !== userId || !SLACK_TS_RE.test(opened.message_ts!)
      || opened.container_message_ts !== opened.message_ts || !SLACK_TS_RE.test(opened.action_ts!)) {
    throw new ReceiptRejected('comment view binding mismatch');
  }
  const bodyBytes = Buffer.from(text, 'utf8');
  const identity: ButtonIdentityV2 = {
    schema: BUTTON_SCHEMA_V2, app_id: config.app_id, bot_id: config.bot_id, purpose: BUTTON_PURPOSE,
    action_id: COMMENT_ACTION_ID, request_id: opened.request_id!, user_id: userId,
    // The click that opened this view passed clickScope, which only admits the owner DM.
    channel_id: config.owner_dm,
    message_ts: opened.message_ts!, container_message_ts: opened.container_message_ts!, action_ts: opened.action_ts!,
    decision: 'comment', comment_sha256: createHash('sha256').update(bodyBytes).digest('hex'),
  };
  const receipt = signReceiptV2(identity, receivedAt, key);
  const encoded = canonicalJson(receipt) + '\n';
  if (Buffer.byteLength(encoded, 'utf8') > MAX_RECEIPT_BYTES) throw new ReceiptRejected('receipt exceeds byte limit');

  // Claim the view first: a redelivered or replayed submission finds no file.
  unlinkSync(viewPath);
  syncDirectory(viewsDir);
  // Body before receipt: settle never sees a comment receipt without its body.
  const commentsDir = siblingDir(dir, 'button-comments');
  writeExclusive(commentsDir, `${receipt.receipt_id}.txt`, bodyBytes);
  const result = persistReceipt(encoded, receipt.receipt_id, identity.request_id,
    (existing) => verifyReceiptV2(existing, key), dir, maxReceipts);
  return { ...result, commentPath: join(commentsDir, `${receipt.receipt_id}.txt`) };
}

// ---- settle: the registry CLI decides; the bridge only hands it a receipt id ----

export const SETTLE_TIMEOUT_MS = 20_000;

export type ExecFileLike = (
  file: string, args: readonly string[],
  options: { shell: false; timeout: number; maxBuffer: number; windowsHide: boolean },
  callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
) => unknown;

export type SettleFn = (receiptIdValue: string) => Promise<{ ok: boolean; detail: string }>;

/** Absolute path from the bridge .env first, then the process environment; anything else = no settle. */
export function resolveRegistryScript(fromEnvFile: string | undefined, fromProcess: string | undefined): string | undefined {
  const value = fromEnvFile || fromProcess;
  return value && isAbsolute(value) ? value : undefined;
}

export function makeSettle(registryScript: string | undefined, execFileImpl: ExecFileLike): SettleFn | undefined {
  if (!registryScript || !isAbsolute(registryScript)) return undefined;
  return (receiptIdValue) => new Promise((resolve) => {
    if (!RECEIPT_ID_RE.test(receiptIdValue)) { resolve({ ok: false, detail: 'receipt id invalid' }); return; }
    try {
      execFileImpl('python3', [registryScript, 'settle', '--receipt-id', receiptIdValue],
        { shell: false, timeout: SETTLE_TIMEOUT_MS, maxBuffer: 65_536, windowsHide: true },
        (error) => resolve(error ? { ok: false, detail: error.name } : { ok: true, detail: 'settled' }));
    } catch (error) {
      resolve({ ok: false, detail: error instanceof Error ? error.name : 'spawn failed' });
    }
  });
}

export function receiptNotification(result: RecordResult): { type: 'inbound'; content: string; meta: Record<string, string> } {
  if (!RECEIPT_ID_RE.test(result.receiptId) || !REQUEST_ID_RE.test(result.requestId)) {
    throw new ReceiptRejected('notification ids invalid');
  }
  return {
    type: 'inbound',
    content: `[Bridge system receipt; not an approval] button receipt ${result.receiptId} request ${result.requestId}`,
    meta: { source: 'bridge-button-receipt', receipt_id: result.receiptId, request_id: result.requestId },
  };
}

export type ReceiptStage = 'ack-failed' | 'receipt-failed' | 'notification-failed' | 'notified' | 'ignored'
  | 'view-opened' | 'view-failed';

export interface InteractiveHooks {
  /** views.open with the given trigger and view; resolves to the returned view id. */
  openView?: (triggerId: string, view: Record<string, unknown>) => Promise<string>;
  settle?: SettleFn;
}

export async function processInteractiveReceipt(
  body: unknown,
  ack: () => Promise<unknown>,
  config: ApprovalBotConfig,
  key: Buffer,
  notify: (notification: ReturnType<typeof receiptNotification>) => void,
  dir: string = DEFAULT_RECEIPT_DIR,
  hooks: InteractiveHooks = {},
): Promise<{ stage: ReceiptStage; result?: RecordResult; settle?: { ok: boolean; detail: string } | 'skipped' }> {
  try { await ack(); }
  catch { return { stage: 'ack-failed' }; }
  let result: RecordResult | null;
  try {
    const kind = object(body)?.type;
    if (kind === 'view_submission') {
      result = recordCommentSubmission(body, config, key, dir);
    } else {
      const click = parseClick(body, config);
      if (!click) return { stage: 'ignored' };
      if (click.kind === 'approve') result = recordButtonReceipt(body, config, key, dir);
      else if (click.kind === 'reject') result = recordRejectReceipt(click.identity, key, dir);
      else {
        // trigger_id lives about 3 seconds: open first, then record the view.
        if (!hooks.openView) return { stage: 'view-failed' };
        try {
          const viewId = await hooks.openView(click.open.triggerId, commentModalView(click.open.requestId));
          recordCommentView(viewId, click.open, dir);
        } catch { return { stage: 'view-failed' }; }
        return { stage: 'view-opened' };
      }
    }
  }
  catch { return { stage: 'receipt-failed' }; }
  if (!result) return { stage: 'ignored' };
  // The receipt is fsynced. Settle right away; whatever it returns, the
  // session notification below goes out exactly as before (fallback path).
  let settle: { ok: boolean; detail: string } | 'skipped' = 'skipped';
  if (hooks.settle) {
    try { settle = await hooks.settle(result.receiptId); }
    catch (error) { settle = { ok: false, detail: error instanceof Error ? error.name : 'settle failed' }; }
  }
  const plain: RecordResult = { receiptId: result.receiptId, requestId: result.requestId, duplicate: result.duplicate };
  try { notify(receiptNotification(plain)); }
  catch { return { stage: 'notification-failed', result: plain, settle }; }
  return { stage: 'notified', result: plain, settle };
}
