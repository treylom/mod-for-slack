/**
 * Owner-tag DM copy (2026-10-19, OPTIONAL — off unless the bot's .env opts in).
 *
 * When this bot's `reply` posts to a NON-DM conversation and the text tags the
 * owner (`<@OWNER>`), and the original post succeeded, the bridge posts ONE
 * short copy into the owner's DM so the tag also reaches them there:
 *
 *   line 1  template (`SLACK_OWNER_TAG_DM_COPY_TEMPLATE`, `{bot}` + `{link}`)
 *   line 2  the original's first line — mention tokens stripped, cut to 120
 *           chars — dropped when it carries a "coordinate" (hash, path, ids,
 *           ledger rows, ops jargon…); the whole copy is skipped when the
 *           original text contains a secret.
 *
 * Why the checks live here: the copy goes out from inside the bridge, so a
 * PreToolUse send-gate in front of the `reply` tool never sees it. The pattern
 * set below is a port of the maintainer's own pre-send gate (the coordinate pre-send script
 * `findings()` + the secret classifier `classify_secret()`), keeping Python's
 * Unicode-aware `\w` / `\b` / `\d` meaning via explicit lookarounds.
 *
 * Failure isolation: nothing in here may change the result of the original
 * reply. The copier never throws, never retries, and logs one line.
 *
 * Pure helpers + one factory; server.ts wires them in (see handleReply).
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const OWNER_COPY_DEFAULT_TEMPLATE = '[{bot}] mentioned you in a thread — {link}';
/** Preview line budget, in code points (the ellipsis counts). */
export const OWNER_COPY_PREVIEW_MAX = 120;

export interface OwnerTagCopyConfig {
  /** U…/W… id whose tag triggers the copy (= the bridge's ALLOWED_SLACK_USER_ID unless overridden). */
  ownerId: string;
  /** D… id of this bot's DM with the owner. */
  dmChannel: string;
  /** One line, contains `{link}`; `{bot}` optional. */
  template: string;
  /** Exact secret values to refuse (this bridge's own tokens). Never logged. */
  knownSecrets: readonly string[];
}

export interface OwnerTagCopyEnv {
  ALLOWED_SLACK_USER_ID?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_APP_TOKEN?: string;
  /** Presence of a valid value is what turns the feature on. */
  SLACK_OWNER_TAG_DM_COPY_CHANNEL?: string;
  /** Optional override of the owner id; defaults to ALLOWED_SLACK_USER_ID. */
  SLACK_OWNER_TAG_DM_COPY_USER?: string;
  SLACK_OWNER_TAG_DM_COPY_TEMPLATE?: string;
}

const OWNER_ID_RE = /^[UW][A-Z0-9]{8,}$/;
const DM_ID_RE = /^D[A-Z0-9]{8,}$/;
const TEMPLATE_MAX = 300;

/**
 * Default OFF. On only when SLACK_OWNER_TAG_DM_COPY_CHANNEL is a valid D… id AND an owner id
 * (SLACK_OWNER_TAG_DM_COPY_USER, else ALLOWED_SLACK_USER_ID) is a valid U…/W… id. A malformed
 * value turns the feature off (fail closed) and leaves a note for the startup log.
 */
export function parseOwnerTagCopyConfig(env: OwnerTagCopyEnv): { config: OwnerTagCopyConfig | null; notes: string[] } {
  const notes: string[] = [];
  const channelRaw = (env.SLACK_OWNER_TAG_DM_COPY_CHANNEL ?? '').trim();
  if (!channelRaw) return { config: null, notes };
  if (!DM_ID_RE.test(channelRaw)) {
    notes.push('SLACK_OWNER_TAG_DM_COPY_CHANNEL is not a D… DM channel id — owner-tag DM copy stays OFF');
    return { config: null, notes };
  }
  const ownerId = ((env.SLACK_OWNER_TAG_DM_COPY_USER ?? '').trim() || (env.ALLOWED_SLACK_USER_ID ?? '').trim());
  if (!OWNER_ID_RE.test(ownerId)) {
    notes.push('owner id (SLACK_OWNER_TAG_DM_COPY_USER / ALLOWED_SLACK_USER_ID) is not a U…/W… id — owner-tag DM copy stays OFF');
    return { config: null, notes };
  }
  let template = (env.SLACK_OWNER_TAG_DM_COPY_TEMPLATE ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!template) {
    template = OWNER_COPY_DEFAULT_TEMPLATE;
  } else if (!template.includes('{link}') || template.length > TEMPLATE_MAX) {
    notes.push(`SLACK_OWNER_TAG_DM_COPY_TEMPLATE must contain {link} and stay within ${TEMPLATE_MAX} chars — default template used`);
    template = OWNER_COPY_DEFAULT_TEMPLATE;
  }
  const knownSecrets = [env.SLACK_BOT_TOKEN, env.SLACK_APP_TOKEN].filter((v): v is string => typeof v === 'string' && v.length >= 12);
  return { config: { ownerId, dmChannel: channelRaw, template, knownSecrets }, notes };
}

// ---------------------------------------------------------------------------
// Coordinate patterns — port of the maintainer's coordinate pre-send PATTERNS (Python) (Unicode \w/\b/\d kept)
// ---------------------------------------------------------------------------

const NB = String.raw`(?<![\p{L}\p{N}_])`; // python: (?<![\w]) / \b before a word char
const NA = String.raw`(?![\p{L}\p{N}_])`; // python: (?![\w]) / \b after a word char

/**
 * Every name here makes the preview line drop. `path` and `filename` only WARN in the source
 * gate; here they drop too (the line is optional and owner-facing text carries no paths).
 *
 * Module-private on purpose: `path` and `filename` are quadratic on long runs of `agent-…` / `a.a.a…`
 * (as in the Python source), so they may only be applied through `coordinateFindings`, which bounds the
 * text to COORDINATE_SCAN_MAX characters first. Do not export this table.
 */
const COORDINATE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['hash', new RegExp(`${NB}(?:[a-fA-F0-9]{12,}|(?=[a-fA-F0-9]{7,12}${NA})(?=[a-fA-F0-9]*[a-fA-F])[a-fA-F0-9]{7,12})${NA}`, 'u')],
  ['sha', new RegExp(`${NB}sha(?:256)?${NA}`, 'iu')],
  ['path', new RegExp(String.raw`(?:/Users/|agent-[\p{L}\p{N}_-]+/out/|docs/|\.claude/)[^\s<>"']+`, 'u')],
  ['filename', new RegExp(String.raw`${NB}[^\s/<>"']+\.(?:md|py|json)${NA}`, 'iu')],
  ['slack_id', new RegExp(`${NB}[FU]0[A-Z0-9]{8,}${NA}`, 'u')],
  ['slack_ts', new RegExp(String.raw`(?<!\p{Nd})1\p{Nd}{9}(?:\.\p{Nd}{6})?(?!\p{Nd})`, 'u')],
  ['ledger', new RegExp(`${NB}L-[A-Z]-[A-Za-z0-9가-힣_-]+`, 'u')],
  [
    'jargon',
    new RegExp(
      '합집합|골드|엔진|판정기|상한|영수증|완주판정|미끼|' +
        `${NB}[Tt][Ii][Ee][Rr]${NA}|${NB}[Pp]95${NA}|` +
        String.raw`(?<![가-힣A-Za-z])팔(?=$|[\s·,./()↑↓]|[은는이가을를의로과와])`,
      'u',
    ),
  ],
];

const SLACK_ARCHIVE_URL = /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[CDG][A-Z0-9]+\/p[0-9]+(?:\?[^\s<>)]+)?/gi;

/** Minimal html.unescape — Slack only emits &amp; &lt; &gt;, plus numeric/quote forms. */
export function htmlUnescape(text: string): string {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g, (whole, hex?: string, dec?: string, name?: string) => {
    if (name) return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name] ?? whole;
    const code = hex ? parseInt(hex, 16) : parseInt(dec ?? '', 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * Makes JS see the same whitespace the Python source gate sees, before any coordinate or secret check.
 * Python's `\s` also matches U+001C–U+001F and U+0085 (JS's does not); JS's `\s` also matches U+FEFF
 * (Python's does not).
 * - U+001C–U+001F, U+0085 → ASCII space: a separator Python sees through is seen through here too
 *   (without this, "계좌" + U+0085 + an account number slips past the secret check).
 * - U+FEFF → U+E000 (private use: not whitespace, letter or digit in either engine): it then reads exactly
 *   as Python reads it, an ordinary character. Mapping it to a space is a no-op (JS already takes it for
 *   one) and keeps `Key=` + U+FEFF + a lowercase word looking harmless here while Python flags it.
 */
export function normalizeSpace(text: string): string {
  return text.replace(/[\u001c-\u001f\u0085\ufeff]/gu, (c) => (c === '\ufeff' ? '\ue000' : ' '));
}

/**
 * How much text the coordinate patterns look at. The preview line shows 120 characters, so anything
 * past ~1,000 can never appear in it; the margin keeps a token that straddles the cut inside the scanned
 * part. The bound lives in `coordinateFindings` itself, so every caller — present and future — is
 * bounded, and so is the regex work (a 40,000-character single line is possible; two of the patterns
 * are quadratic on it).
 */
export const COORDINATE_SCAN_MAX = 1000;

/**
 * Names of the coordinate patterns present in the first COORDINATE_SCAN_MAX characters of `text`
 * (the Python gate's findings(), names only).
 */
export function coordinateFindings(text: string): string[] {
  let t = normalizeSpace(htmlUnescape(text.slice(0, COORDINATE_SCAN_MAX)));
  t = t.replace(/<@[UW][A-Z0-9]+>/g, '');
  t = t.replace(SLACK_ARCHIVE_URL, '');
  return COORDINATE_PATTERNS.filter(([, rx]) => rx.test(t)).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Secret patterns — port of the maintainer's Python classify_secret() (without the
// device-wide known-secret store scan: a bridge must not read other bots' .env files;
// the bridge's own tokens are checked through config.knownSecrets instead)
// ---------------------------------------------------------------------------

const KO_VAL = String.raw`[A-Za-z0-9!@#$%^&*_\-+=/.~]`;

const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['slack_token', /xox[abprs]-/u],
  ['slack_xapp', /xapp-/u],
  ['slack_webhook', /hooks\.slack\.com\/services\//u],
  ['sk_key', /(?<![A-Za-z0-9])sk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}/u],
  ['ghp_token', /ghp_/u],
  ['gho_token', /gho_/u],
  ['github_pat_token', /github_pat_/u],
  ['aws_key', /AKIA[0-9A-Z]{16}/u],
  ['pem_block', /-----BEGIN/u],
  ['jwt', /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/u],
  [
    'discord_bot_token',
    /(?<![A-Za-z0-9_.\-])[A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27,}(?![A-Za-z0-9_.\-])/u,
  ],
  ['api_key_assign', /api[_-]?key\s*[:=]\s*\S{12,}/iu],
  ['password_assign', /password\s*[:=]/iu],
  ['bearer_token', /Bearer\s+\S{16,}/u],
  ['basic_auth', /Authorization:\s*Basic\s+\S+/iu],
  ['pw_colon', new RegExp(String.raw`${NB}PW\s*[:=]\s*\S+`, 'iu')],
  [
    'labeled_secret_kv',
    new RegExp(
      String.raw`(?<![A-Za-z0-9_.\-])["'\x60]?(?:[A-Za-z0-9_.\-]{0,40}[_.\-])?(?:api[_-]?key|access[_-]?key|secret[_-]?key|key|token|secret|passwd|password|pass|pw)(?:[_.\-][A-Za-z0-9_.\-]{0,40})?["'\x60]?\s*[:=]\s*["'\x60]?[^\s"'\x60]{6,}`,
      'giu',
    ),
  ],
  ['korean_secret_label', new RegExp(String.raw`(?:비밀번호|패스워드|암호|시크릿)\s*(?:은|는|:|=)\s*["'\x60]?${KO_VAL}{8,}`, 'u')],
  [
    'korean_token_key_label',
    new RegExp(
      // Source: `(?![a-z0-9_\-./~]*[_\-/.][a-z0-9_\-./~]*(?!KO_VAL))` = "the whole run of value characters
      // is lower-case path/identifier characters with at least one separator" (an exempt value). That
      // nested-star form backtracks quadratically on `a.a.a.…`; the two lookaheads below say the same
      // thing in linear time (checked against the Python rule on exhaustive short strings).
      String.raw`(?:토큰|(?<![가-힣A-Za-z])키)\s*(?:은|는|:|=)\s*["'\x60]?` +
        String.raw`(?!(?=[a-z0-9_\-./~]+(?!${KO_VAL}))(?=[a-z0-9~]*[_\-/.]))${KO_VAL}{8,}`,
      'u',
    ),
  ],
  ['pii_phone_kr', new RegExp(String.raw`(?<!\p{Nd})01[016789][-.\s]?\p{Nd}{3,4}[-.\s]?\p{Nd}{4}(?!\p{Nd})`, 'u')],
  ['pii_rrn_kr', new RegExp(String.raw`(?<!\p{Nd})\p{Nd}{6}-[1-4]\p{Nd}{6}(?!\p{Nd})`, 'u')],
  ['pii_card_kr', new RegExp(String.raw`${NB}\p{Nd}{4}-\p{Nd}{4}-\p{Nd}{4}-\p{Nd}{4}${NA}`, 'u')],
  [
    'pii_account_kr',
    new RegExp(
      '(?:계좌(?:번호)?|국민|신한|농협|카카오뱅크|케이뱅크|토스뱅크|새마을금고|신협|우체국|씨티|우리은행|하나은행|기업은행|SC제일)' +
        // Source has `\s*[:=]?\s*`; same language, but two adjacent `\s*` backtrack quadratically on a
        // long run of spaces after the keyword — `\s*(?:[:=]\s*)?` matches exactly the same strings.
        String.raw`\s*(?:[:=]\s*)?(?=[\p{Nd}\-]{12,})\p{Nd}+-\p{Nd}+-\p{Nd}+`,
      'u',
    ),
  ],
  // Source: `^\s*NAME=…` under MULTILINE. There `\s*` also eats the newlines of the blank lines in front,
  // so a text of N newlines is rescanned from every line start (quadratic: 40,000 LF = 1.3 s). A line
  // start followed by only horizontal whitespace finds the same lines: a NAME that follows a run of blank
  // lines is itself at a line start. [^\S\r\n\u2028\u2029] = whitespace that is not a JS line bot.
  ['env_line', /^[^\S\r\n\u2028\u2029]*[A-Z][A-Z0-9_]{2,}=\S{8,}\s*$/mu],
];

const EMAIL_ALLOWLIST = new Set(['noreply@anthropic.com', 'git@github.com']);
const RESERVED_EMAIL_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|[a-z0-9-]+\.(?:example|test|invalid|localhost)|example|test|invalid|localhost)$/u;
const EMAIL_PATTERN = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/gu;
const LONG_TOKEN_PATTERN = /(?<![A-Za-z0-9])[A-Za-z0-9_\-+/=]{32,}(?![A-Za-z0-9])/gu;
const BENIGN_SLUG = /^[a-z0-9]{1,24}(?:(?:__|[-_])[a-z0-9]{1,24}){2,}(?:\.[a-z0-9]{1,6})?$/u;
const BENIGN_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;
const BENIGN_LEDGER = /^L-[A-Z]{1,2}-[A-Za-z0-9-]+$/u;
const BARE_KEY_SPLIT = /^["'\x60]?(?<label>[A-Za-z0-9_.-]+)["'\x60]?\s*[:=]\s*["'\x60]?(?<val>[^\s"'\x60]+)$/u;

function reservedEmail(addr: string): boolean {
  return RESERVED_EMAIL_DOMAIN.test((addr.split('@').pop() ?? '').toLowerCase());
}

function benignBareKey(match: string): boolean {
  const m = BARE_KEY_SPLIT.exec(match.trim());
  if (!m?.groups || m.groups.label!.toLowerCase() !== 'key') return false;
  const val = m.groups.val!.replace(/[,;)\]}]+$/u, '');
  return /^[a-z._-]{1,15}$/u.test(val);
}

function benignLong(tok: string): boolean {
  if (BENIGN_SLUG.test(tok) || BENIGN_UUID.test(tok) || BENIGN_LEDGER.test(tok)) return true;
  if (tok.includes('/') && !tok.includes('=') && !tok.includes('+')) {
    return tok.split('/').filter(Boolean).every((p) => BENIGN_SLUG.test(p) || /^[A-Za-z0-9._-]{1,40}$/u.test(p));
  }
  return false;
}

/** Rule name when `text` looks like it carries a secret, else null (the Python classify_secret). */
export function classifySecret(input: string, knownSecrets: readonly string[] = []): string | null {
  const text = normalizeSpace(input);
  for (const v of knownSecrets) if (v && text.includes(v)) return 'known_secret';
  if (text.includes('@')) {
    for (const m of text.matchAll(EMAIL_PATTERN)) {
      if (!EMAIL_ALLOWLIST.has(m[0].toLowerCase()) && !reservedEmail(m[0])) return 'pii_email';
    }
  }
  const digest = text.trim();
  const standaloneHex = (digest.length === 40 || digest.length === 64) && /^[0-9a-fA-F]+$/u.test(digest);
  for (const [name, rx] of SECRET_PATTERNS) {
    if (name === 'pii_phone_kr' && standaloneHex) continue;
    if (name === 'labeled_secret_kv') {
      for (const m of text.matchAll(rx)) if (!benignBareKey(m[0])) return name;
      continue;
    }
    if (rx.test(text)) return name;
  }
  for (const m of text.matchAll(LONG_TOKEN_PATTERN)) {
    const tok = m[0];
    if (benignLong(tok)) continue;
    if ((tok.length === 40 || tok.length === 64) && /^[0-9a-fA-F]+$/u.test(tok)) {
      const idx = m.index ?? 0;
      const before = idx > 0 ? text.charAt(idx - 1) : '';
      const after = idx + tok.length < text.length ? text.charAt(idx + tok.length) : '';
      if ((before === '' || /\s/u.test(before)) && (after === '' || /\s/u.test(after))) continue;
    }
    return 'long_token';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Copy text
// ---------------------------------------------------------------------------

/**
 * `<@U…>` / `<@U…|name>` anywhere in the text. Same answer as
 * `new RegExp('<@' + ownerId + '(?:\\|[^>]*)?>', 'u').test(text)`, in linear time: the regex rescans to
 * the end of the text from every `<@U…|` that has no `>` after it (40,000 characters of them = 0.1–0.5 s,
 * 100,000 = 1–3 s). Once one `<@U…|` finds no `>` after it, no later opener can find one either, so the
 * scan stops there. Owner id is validated upstream; here it is only used as a literal.
 */
export function mentionsOwner(text: string, ownerId: string): boolean {
  const needle = `<@${ownerId}`;
  let i = text.indexOf(needle);
  while (i !== -1) {
    const after = i + needle.length;
    const next = text[after];
    if (next === '>') return true;
    if (next === '|') return text.indexOf('>', after + 1) !== -1;
    i = text.indexOf(needle, i + 1);
  }
  return false;
}

/**
 * Removes every `<@…>` / `<!…>` token: from a `<@` or `<!` up to the next `>`. Same output as
 * `text.replace(/<[@!][^>]*>/g, '')`, in linear time — the regex rescans to the end of the text from
 * every unclosed `<@` / `<!` (20,000 of them = 0.5 s). If the first opener has no `>` after it, no later
 * one has either, so the scan stops there.
 */
export function stripMentionTokens(text: string): string {
  const parts: string[] = [];
  let copyFrom = 0;
  let i = text.indexOf('<');
  while (i !== -1) {
    const next = text.charCodeAt(i + 1); // NaN past the end
    if (next === 0x40 /* @ */ || next === 0x21 /* ! */) {
      const close = text.indexOf('>', i + 2);
      if (close === -1) break;
      parts.push(text.slice(copyFrom, i));
      copyFrom = close + 1;
      i = text.indexOf('<', copyFrom);
    } else {
      i = text.indexOf('<', i + 1);
    }
  }
  parts.push(text.slice(copyFrom));
  return parts.join('');
}

/** First non-blank line with every mention token (`<@…>`, `<!here>`, `<!subteam^…>`) removed and whitespace collapsed. */
export function firstLineWithoutMentions(text: string): string {
  for (const raw of stripMentionTokens(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line) return line;
  }
  return '';
}

/** Cut to OWNER_COPY_PREVIEW_MAX code points (ellipsis included); never leaves a half-open `<…` token. */
export function cutPreview(line: string, max: number = OWNER_COPY_PREVIEW_MAX): string {
  const cps = Array.from(line);
  if (cps.length <= max) return line;
  let cut = cps.slice(0, max - 1).join('');
  const open = cut.lastIndexOf('<');
  if (open !== -1 && open > cut.lastIndexOf('>')) cut = cut.slice(0, open);
  return `${cut.trimEnd()}…`;
}

/** Template with `{bot}` / `{link}` filled; function replacers so `$` in values is literal. */
export function fillTemplate(template: string, botName: string, link: string): string {
  const bot = botName.replace(/[^\w.-]/gu, '');
  return template.replace(/\{bot\}/g, () => bot).replace(/\{link\}/g, () => link);
}

/**
 * The preview line for the copy, or null when it must be left out (nothing to show, or the
 * ORIGINAL first line trips a coordinate pattern — checked before the cut so a hash cut in
 * half cannot slip through; `coordinateFindings` bounds how much of it is scanned).
 */
export function previewLineFor(text: string): string | null {
  const first = firstLineWithoutMentions(text);
  if (!first) return null;
  if (coordinateFindings(first).length > 0) return null;
  return cutPreview(first);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface OwnerCopyWeb {
  chat: {
    getPermalink(args: { channel: string; message_ts: string }): Promise<unknown>;
    postMessage(args: { channel: string; text: string; unfurl_links: false; unfurl_media: false }): Promise<unknown>;
  };
}

export type OwnerCopySkip = 'disabled' | 'dm-target' | 'no-owner-tag' | 'no-ts' | 'secret' | 'duplicate';
export type OwnerCopyOutcome =
  | { status: 'sent'; withPreview: boolean }
  | { status: 'skipped'; reason: OwnerCopySkip }
  | { status: 'failed'; reason: string };

export interface OwnerCopyRequest {
  /** Conversation the original reply went to. */
  target: string;
  /** True for a DM target (known im, or a D… id). */
  isDmTarget: boolean;
  /** The reply text as the session wrote it (before chunking). */
  text: string;
  /** ts of the first posted chunk of the original, from postChunked. */
  postedTs: string | undefined;
}

const DEDUPE_MAX = 200;

/**
 * Builds the copier. The returned function resolves (never rejects) with what it did; the caller
 * fires it after the original reply has been acknowledged and ignores the result.
 */
export function createOwnerTagCopier(
  config: OwnerTagCopyConfig | null,
  deps: { web: OwnerCopyWeb; botName: string; log: (message: string) => void },
): (req: OwnerCopyRequest) => Promise<OwnerCopyOutcome> {
  const copied = new Set<string>();
  const order: string[] = [];
  return async (req) => {
    try {
      if (!config) return { status: 'skipped', reason: 'disabled' };
      if (req.isDmTarget || req.target.startsWith('D')) return { status: 'skipped', reason: 'dm-target' };
      if (!mentionsOwner(req.text, config.ownerId)) return { status: 'skipped', reason: 'no-owner-tag' };
      if (!req.postedTs) {
        deps.log('copy NOT sent — the original post returned no ts');
        return { status: 'skipped', reason: 'no-ts' };
      }
      const rule = classifySecret(htmlUnescape(req.text), config.knownSecrets);
      if (rule) {
        deps.log(`copy NOT sent — secret pattern in the original (${rule})`);
        return { status: 'skipped', reason: 'secret' };
      }
      // One copy per original post, and never a retry: remembered before the first attempt.
      const key = `${req.target}:${req.postedTs}`;
      if (copied.has(key)) return { status: 'skipped', reason: 'duplicate' };
      copied.add(key);
      order.push(key);
      if (order.length > DEDUPE_MAX) copied.delete(order.shift()!);

      const res = (await deps.web.chat.getPermalink({ channel: req.target, message_ts: req.postedTs })) as { permalink?: unknown } | null | undefined;
      const link = typeof res?.permalink === 'string' ? res.permalink : '';
      if (!link.startsWith('https://')) throw new Error('chat.getPermalink returned no permalink');
      const preview = previewLineFor(req.text);
      const head = fillTemplate(config.template, deps.botName, link);
      await deps.web.chat.postMessage({
        channel: config.dmChannel,
        text: preview ? `${head}\n${preview}` : head,
        // A message permalink would otherwise unfurl into a quote of the whole original,
        // putting back what the preview line just left out.
        unfurl_links: false,
        unfurl_media: false,
      });
      deps.log(`copy sent (${preview ? 'with preview' : 'link only'})`);
      return { status: 'sent', withPreview: preview !== null };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      try {
        deps.log(`copy NOT sent — ${reason}`);
      } catch {
        /* logging must not throw either */
      }
      return { status: 'failed', reason };
    }
  };
}
