// Memory lane, pure helpers for Kumiho (the cloud memory MCP) — no $.
// 주인 10-24 14:17 = 공식 꼴로 다시 열기: the bot writes one short line itself when a decision is settled,
// and the «call it less» lines are rewritten. Official pattern (server instructions · reflect/engage tool text · the
// kumiho-plugins SKILL, saved 10-19 in agent-bot/out/kumiho-official-pattern-1019/raw):
//   engage once when earlier context could matter — near the start of work, a new task, a reference back — and skip it
//   when the visible conversation already answers · reflect as soon as a decision / preference / fact / correction is
//   settled, never on routine turns · brief typed captures in your own words, an absolute date in the title, an existing
//   space_hint, engage's source_krefs · never transcripts, never secrets.
// Here: the settings block (memory.kumiho), the write check on a write call's arguments, the one-line reminders.
// Kumiho is NOT in the automatic recall (recall.js DEFAULTS: 4.6 s + 6.1 s connect, and engage 8–17 s today) — the
// model's own engage at the same moments is the official direct-MCP pattern; the reminder line asks for it.
// Who may write: the bot's own session only. A 하위 never writes Kumiho (K2 — the config child deny lists every
// Kumiho write tool, and the lane refuses them again). The engine deny list (settings) still decides what is callable
// at all; this check only narrows.

import { redact, isTurnDump, newTaskMoment, channelMessages, isOwnerMsg } from './recall.js'

// The server's write tools (tools/list annotations readOnlyHint=false, 18 tools, 10-19 raw/server-tools.json).
export const KUMIHO_WRITE = Object.freeze(['kumiho_memory_store', 'kumiho_memory_reflect', 'kumiho_memory_consolidate',
  'kumiho_create_space', 'kumiho_deprecate_item', 'kumiho_chat_clear', 'kumiho_memory_space_profile', 'kumiho_memory_decompose'])
// Any server name (a plugin-hosted copy is mcp__plugin_<p>_<s>__…): the tool part is what counts.
export const KUMIHO_WRITE_TOOL = new RegExp('^mcp__.+?__(' + KUMIHO_WRITE.join('|') + ')$')
export function kumihoToolOf(name) { const m = /^mcp__.+?__(kumiho_[a-z_]+)$/.exec(String(name || '')); return m ? m[1] : '' }

export const KUMIHO_TYPES = Object.freeze(['decision', 'preference', 'fact', 'correction'])
// Fields a reflect from a bot turn never needs: another user / context, or the bulk-import path (봇 시험 거르기 r2).
const FIELDS_NOT_ALLOWED = ['user_id', 'context', 'idempotency_prefix']
export const KUMIHO_DEFAULTS = Object.freeze({
  maxCaptures: 3, maxTitleChars: 120, maxContentChars: 300, maxContentLines: 3, maxResponseChars: 400, maxSpaceChars: 80,
  perDay: 20,
})
// The «when to call» keys made upfront (not deferred) while memory.kumiho.enabled — the model sees the line without a
// ToolSearch first. A key only applies where the tool exists (reflect only once the engine deny lets it through).
export const KUMIHO_UPFRONT = Object.freeze(['kumiho/kumiho_memory_engage', 'kumiho/kumiho_memory_reflect'])

function int(v, d, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi ? v : d }

// memory.kumiho: enabled (describe lines · upfront · reminder) — off unless true. The write check runs whenever the lane
// runs, enabled or not (it only refuses). blockTerms = extra words never to send (e.g. a client's people), inline or one
// per line in blockTermsFile (absolute; «#» = comment).
export function kumihoSettings(raw, home = '') {
  const m = raw && typeof raw === 'object' && raw.memory && typeof raw.memory === 'object' ? raw.memory : {}
  const k = m.kumiho && typeof m.kumiho === 'object' && !Array.isArray(m.kumiho) ? m.kumiho : {}
  const expand = p => (home && p.startsWith('~/') ? home + p.slice(1) : p)
  const file = typeof k.blockTermsFile === 'string' ? expand(k.blockTermsFile.trim()) : ''
  const D = KUMIHO_DEFAULTS
  return {
    enabled: k.enabled === true,
    upfront: k.upfront !== false,
    nudge: k.nudge !== false,
    maxCaptures: int(k.maxCaptures, D.maxCaptures, 1, 5),
    maxTitleChars: int(k.maxTitleChars, D.maxTitleChars, 40, 200),
    maxContentChars: int(k.maxContentChars, D.maxContentChars, 80, 1000),
    maxContentLines: int(k.maxContentLines, D.maxContentLines, 1, 10),
    maxResponseChars: int(k.maxResponseChars, D.maxResponseChars, 80, 1000),
    maxSpaceChars: int(k.maxSpaceChars, D.maxSpaceChars, 20, 200),
    perDay: int(k.perDay, D.perDay, 0, 200),
    blockTerms: termList(k.blockTerms),
    blockTermsFile: file.startsWith('/') ? file : '',
  }
}
export function termList(v) {
  const src = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []
  const out = []
  for (const x of src) {
    if (typeof x !== 'string') continue
    const t = x.normalize('NFKC').trim()
    if (t.length < 2 || t.startsWith('#') || out.includes(t)) continue
    out.push(t)
  }
  return out
}

// ── the content checks ────────────────────────────────────────────────────────────────────────────────────────────
// Secrets: the recall masking table (recall.js SECRETS — tokens, keys, JWT, «password: …») plus what a short line
// could still carry. Personal data of a person (고객 개인정보): e-mail, phone, 주민번호, card, account. A company or
// project name is not personal data and passes (주인 10-19 시험 결정); a name
// that must not go goes in blockTerms.
const EXTRA_SECRET = [
  ['url_credential', /[a-z][a-z0-9+.-]{1,15}:\/\/[^\s/:@]*:[^\s/@]{3,}@/i],
  ['url_query_secret', /[?&](?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd|sig|signature)=[^\s&]{6,}/i],
  // a label and a value: with a separator (: = 은/는 …) any 6+ value · with none, only a value carrying a digit or a sign
  // («password manager» is a phrase, «password hunter22» is not — 재검 F4)
  ['password_label', /(?:비밀\s*번호|패스워드|비번|(?<![A-Za-z])(?:password|passwd|passphrase|pwd)(?![a-z]))\s*(?:(?:은|는|이|가|:|=|：)\s*[A-Za-z0-9!@#$%^&*_+=/.~-]{6,}|(?=[A-Za-z]*[0-9!@#$%^&*_+=/.~-])[A-Za-z0-9!@#$%^&*_+=/.~-]{6,})/i],
  // a code carries a digit («백업 코드 GitHub 에 둠» is not a code — 재검 F4)
  ['auth_code', /(?:인증|복구|백업|확인|OTP|MFA|2FA)\s*(?:코드|번호|code)\s*(?:은|는|:|=|：)?\s*(?=[A-Za-z-]*\d)[A-Za-z0-9-]{4,}/i],
]
const PII = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['phone', /(?<![\d.])(?:\+?82[- .]?1[016789]|01[016789])[- .]?\d{3,4}[- .]?\d{4}(?![\d.])/],
  ['rrn', /(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)/],
  ['account', /(?:계좌|account)[^\n\d]{0,12}\d{2,6}[- ]\d{2,6}[- ]\d{2,8}/i],
]
const CARD_RUN = /(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g
function luhn(d) { let s = 0; let alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9 } s += n; alt = !alt } return s % 10 === 0 }
function cardHit(t) {
  for (const m of t.matchAll(CARD_RUN)) { const d = m[0].replace(/[ -]/g, ''); if (d.length >= 13 && d.length <= 19 && /^[2-6]/.test(d) && luhn(d)) return true }
  return false
}

// The secret table alone — also what an id field (session_id · source_krefs · revises) is held to (재검 F3).
export function secretVerdict(text) {
  const t = String(text == null ? '' : text).normalize('NFKC')
  if (!t) return ''
  if (redact(t) !== t) return 'secret'
  for (const [code, re] of EXTRA_SECRET) if (re.test(t)) return 'secret:' + code
  return ''
}
// → '' (clean) or a reason code. Not the text itself — the code goes to the log and the refusal.
export function textVerdict(text, terms = []) {
  const t = String(text == null ? '' : text).normalize('NFKC')
  if (!t) return ''
  const sv = secretVerdict(t)
  if (sv) return sv
  // the number checks read the text with its dates taken out — «계좌 정리 2026-10-24» is a date, not an account (재검 F4)
  const nd = t.replace(ANY_DATE_G, ' ')
  for (const [code, re] of PII) if (re.test(nd)) return 'personal:' + code
  if (cardHit(nd)) return 'personal:card'
  if (isTurnDump(t) || /\[(?:답변|사용자)\]/.test(t) || /^(?:Human|User|Assistant):/m.test(t)) return 'transcript'
  const low = t.toLowerCase()
  for (const w of terms) if (low.includes(w.toLowerCase())) return 'blocked-term'
  return ''
}

// Every string inside a value, with whether it sits in an id the server handed out: the top-level session_id, anything
// under the top-level source_krefs, a capture's revises. Only those exact places are ids — a key named «session_id»
// anywhere else is ordinary text (재검 F3).
function leaves(v, path, out) {
  if (typeof v === 'string') out.push([isIdPath(path), v])
  else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, [...path, i], out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, [...path, k], out)
  return out
}
function isIdPath(p) {
  if (p[0] === 'session_id') return p.length === 1
  if (p[0] === 'source_krefs') return true
  return p[0] === 'captures' && typeof p[1] === 'number' && p[2] === 'revises' && p.length <= 4
}
// An absolute date in a title. The official examples carry «Oct 24, 2026» · «on Mar 27» as well as ISO (재검 F5):
// ISO / dotted / slashed with a 20xx year · 2026년 10월 24일 · 10월 24일 · Oct 24(, 2026) · 24 Oct(ober)( 2026).
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATE_SRC = [
  '(?<!\\d)20\\d{2}[-./](?:0?[1-9]|1[0-2])[-./](?:0?[1-9]|[12]\\d|3[01])(?!\\d)',
  '(?:20\\d{2}\\s*년\\s*)?(?:0?[1-9]|1[0-2])\\s*월\\s*(?:0?[1-9]|[12]\\d|3[01])\\s*일',
  `(?<![a-z])${MON}\\s+(?:0?[1-9]|[12]\\d|3[01])(?!\\d)(?:(?:st|nd|rd|th))?(?:,?\\s+20\\d{2})?`,
  `(?<!\\d)(?:0?[1-9]|[12]\\d|3[01])\\s+${MON}(?![a-z])(?:,?\\s+20\\d{2})?`,
].join('|')
const DATE = new RegExp(DATE_SRC, 'i')
const ANY_DATE_G = new RegExp(DATE_SRC, 'gi')
function lines(s) { return String(s).split(/\r?\n/).filter(x => x.trim()).length }

// The reflect arguments (server tools/list 10-19: 9 fields) out of a tool.call event — the engine puts a tool's input on
// the event itself (ui lane sigOf reads e.command / e.skill); an «input» object is read too in case a version nests it.
export const REFLECT_FIELDS = Object.freeze(['session_id', 'response', 'captures', 'source_krefs', 'space_path', 'discover_edges',
  'idempotency_prefix', 'user_id', 'context'])
// The engine's own keys on a tool.call event (ToolCallReserved · AgentLoop · ToolRequestMeta) — never sent to the tool.
const ENGINE_KEYS = Object.freeze(['tool', 'tool_use_id', 'consent', 'agentId', 'requestMeta'])
// Every argument the call carries, not only the known fields (재검 F1·F3: an extra «input» object or an unknown field
// went out unchecked) — the leaves check reads all of it. A nested «input» object is merged in only when the call has no
// top-level response (a version that nests the arguments); otherwise it stays one more argument whose text is checked.
export function reflectArgs(e) {
  const src = e && typeof e === 'object' ? e : {}
  const own = Object.prototype.hasOwnProperty
  const out = {}
  for (const [k, v] of Object.entries(src)) if (!ENGINE_KEYS.includes(k)) out[k] = v
  const inner = src.input
  if (!own.call(src, 'response') && inner && typeof inner === 'object' && !Array.isArray(inner)) {
    delete out.input
    for (const [k, v] of Object.entries(inner)) if (!own.call(out, k)) out[k] = v
  }
  return out
}

// The reflect check. args = reflectArgs(event).
// → { code, why } — code '' = pass. why = the refusal the model reads: what to fix, never the matched text.
export function reflectVerdict(args, k, terms = [], usedToday = 0) {
  const a = args && typeof args === 'object' ? args : {}
  const bad = (code, fix) => ({ code, why: refusal(code, fix) })
  for (const f of FIELDS_NOT_ALLOWED) if (f in a && a[f] !== undefined) return bad('field:' + f, `칸 «${f}» 는 봇 쓰기에 쓰지 않습니다 — 빼고 다시`)
  // a model that calls reflect before its schema is loaded sends captures as a JSON string (10-19 실물 2건 · replay):
  // read it as the list it encodes and check that; the call itself goes on unchanged (the server judges the shape).
  let caps = a.captures === undefined ? [] : a.captures
  if (typeof caps === 'string') { try { caps = JSON.parse(caps) } catch (err) { return bad('captures', 'captures 는 목록이어야 합니다') } }
  if (!Array.isArray(caps)) return bad('captures', 'captures 는 목록이어야 합니다')
  if (caps.length > k.maxCaptures) return bad('captures:many', `한 번에 ${k.maxCaptures}개까지 — 정해진 결정·선호·사실·교정만 고르세요`)
  if (caps.length && usedToday + caps.length > k.perDay) return bad('per-day',`오늘 이 세션 구미호 쓰기 ${usedToday}건 = 상한 ${k.perDay} — 일상 턴은 쓰지 않습니다(결과 파일·대장에 남기세요)`)
  // response is the server's one required field — missing = the arguments are not where this check reads them (or the
  // call is malformed): refused, so a shape change never turns the check into «nothing to look at = pass».
  const resp = a.response
  if (typeof resp !== 'string' || !resp.trim()) return bad('response', 'response(답의 요지 한두 문장)는 꼭 넣어야 합니다')
  if (resp.length > k.maxResponseChars || lines(resp) > 3) return bad('response:long', `response = 답의 요지 한두 문장(${k.maxResponseChars}자 안) — 답 원문을 붙이지 마세요`)
  const top = a.space_path
  if (top !== undefined && (typeof top !== 'string' || top.length > k.maxSpaceChars)) return bad('space', 'space_path 는 짧은 공간 이름 하나')
  for (const c of caps) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return bad('capture', '각 capture 는 {type, title, content, space_hint} 칸을 가진 항목')
    if (!KUMIHO_TYPES.includes(c.type)) return bad('type', `type = ${KUMIHO_TYPES.join(' | ')} 중 하나(결정·선호·사실·교정만 남깁니다)`)
    if (typeof c.title !== 'string' || !c.title.trim() || c.title.length > k.maxTitleChars) return bad('title', `제목 = 짧게(${k.maxTitleChars}자 안)`)
    if (!DATE.test(c.title)) return bad('title:date', '제목에 절대 날짜를 넣으세요(예: «주간 보고 금요일로 정함 2026-10-24»)')
    if (typeof c.content !== 'string' || !c.content.trim()) return bad('content', 'content = 자기 말로 한두 문장')
    if (c.content.length > k.maxContentChars || lines(c.content) > k.maxContentLines) return bad('content:long', `content = 자기 말로 한두 문장(${k.maxContentChars}자 · ${k.maxContentLines}줄 안) — 대화 원문·파일 통째 ❌`)
    const hint = typeof c.space_hint === 'string' && c.space_hint.trim() ? c.space_hint : top
    if (typeof hint !== 'string' || !hint.trim()) return bad('space:none', 'space_hint 를 넣으세요 — engage 결과 kref 의 공간 이름을 그대로, 맞는 게 없으면 decisions · preferences · facts · corrections')
    if (hint.length > k.maxSpaceChars) return bad('space', 'space_hint 는 짧은 공간 이름 하나')
  }
  // every string of every argument (known or not): ids are opaque, so only the secret table runs on them (a token pasted
  // as an id still goes); everything else gets the full check
  for (const [isId, text] of leaves({ ...a, captures: caps }, [], [])) {
    // an id's own hex run (a kref's item hash) is what ids are made of — taken out; a token shape (xoxb-, sk-, ghp_ …) stays
    const v = isId ? secretVerdict(String(text).replace(/[0-9a-f]{16,}/gi, '')) : textVerdict(text, terms)
    if (v) return bad(v, v.startsWith('personal') ? '사람의 연락처·주민번호·카드·계좌는 남기지 않습니다 — 빼고 다시' : v === 'transcript' ? '대화 원문은 남기지 않습니다 — 자기 말로 한 줄' : v === 'blocked-term' ? '설정의 막는 낱말이 들어 있습니다 — 빼고 다시' : '비밀·토큰·키 모양 글이 있습니다 — 빼고 다시(같은 글로 재시도 ❌)')
  }
  return { code: '', why: '', captures: caps.length }
}
export function refusal(code, fix) { return `구미호 쓰기 거절(${code}): ${fix}. 규칙 = 결정·선호·사실·교정이 정해진 순간 한 줄 · 제목에 날짜 · 자기 말로 · 비밀·토큰·고객사 사람 이름·연락처 ❌.` }

// The other write tools: the bot's write path is reflect alone (store = the low-level path the 10-08~18 md dumps took).
export function otherWriteLine(tool) { return refusal('tool', `${tool} 는 봇이 쓰지 않습니다 — 봇의 구미호 쓰기는 kumiho_memory_reflect 하나`) }
// A 하위 never writes Kumiho (K2): the lesson goes to the result file and the parent saves it after its re-check.
export const CHILD_KUMIHO_LINE = '구미호 쓰기 거절(하위 세션): 하위는 구미호에 쓰지 않습니다 — 결과 파일 «## 교훈(부모가 기억으로 옮김)» 칸에 적으면 부모가 재검 뒤 남깁니다.'

// A reflect answered «session_required» wrote nothing (the server's first-call handshake) — not counted.
export function sessionRequired(result) {
  try { return /session_required/.test(typeof result === 'string' ? result : JSON.stringify(result)) } catch (err) { return false }
}
// session_id = the server's, never invented (reflect tool text «Never reuse an ID from another conversation or invent
// one»). Isolated run p1b 10-24: sonnet made one up from the Slack thread («slack-<channel>-<ts>») — two bots in one
// thread would then share one server buffer. The ids a session_required answer hands out are kept per conversation;
// an id the server never gave is refused. The real answer's exact shape was not seen (no live handshake on record) —
// when a session_required answer carries no readable id, this rule stands down for the conversation (never blocks the
// real retry). → the ids found (string[]).
export function issuedSessionIds(result) {
  let t = ''
  try { t = typeof result === 'string' ? result : JSON.stringify(result) } catch (err) { return [] }
  const out = []
  for (const m of String(t).matchAll(/session_id\\*"\s*:\s*\\*"([A-Za-z0-9_.:@\/+=-]{1,512}?)\\*"/g)) if (!out.includes(m[1])) out.push(m[1])
  return out
}
// → '' or the refusal code. issued = Set of server ids this conversation · unknown = a handshake answer had no readable id.
export function sessionIdVerdict(id, issued, unknown) {
  if (id === undefined || id === null || id === '') return ''
  if (typeof id !== 'string') return 'session_id'
  if (unknown || (issued && issued.has(id))) return ''
  return 'session_id'
}
export const SESSION_ID_FIX = 'session_id 는 서버가 준 값만 씁니다(지어내기 ❌) — 이 대화에서 아직 못 받았으면 session_id 를 빼고 부르세요, 서버가 새 id 를 줍니다'

// KST calendar day of a ms clock (the per-day cap resets at KST midnight).
export function kstDay(ms) { return Number.isFinite(ms) && ms > 0 ? new Date(ms + 9 * 3600000).toISOString().slice(0, 10) : '' }

// A reflect from a subagent loop (e.agentId — engine ToolCallInput AgentLoop) is not the bot's own conversation.
// memory.kumiho.enabled is the write switch too (30 s settings cache): off = no reflect, so turning it off stops the
// writes as fast as the reminder and the descriptions — the settings-file deny is the second, restart-time wall.
export const KUMIHO_OFF_LINE = '구미호 쓰기 거절(꺼짐): 이 봇의 구미호 쓰기가 설정에서 꺼져 있습니다 — 정해진 결정은 결과 파일·대장에 남기세요.'
export const SUBAGENT_KUMIHO_LINE ='구미호 쓰기 거절(서브에이전트): 구미호 쓰기는 봇 본 대화가 합니다 — 정해진 결정은 결과로 돌려주세요.'

// ── the reminder line ─────────────────────────────────────────────────────────────────────────────────────────────
// The moment for the reminder (recall.js newTaskMoment over the reminder's own seen set) + whose message it is.
// ownerMsg = the moment's message is the owner's (memory.recall.owner_ids) · ownerTurn = no moment, and the prompt is
// exactly one owner message (a reply in a seen thread — where 주인 usually settles things). Pure: the caller marks keys.
export function kumihoMoment(text, seen, fresh, owners = []) {
  const got = newTaskMoment(text, seen, fresh, owners)
  const msgs = channelMessages(text)
  let ownerMsg = false
  if (got.moment) {
    const m = msgs.filter(x => x.body === got.moment.body).pop()
    ownerMsg = Boolean(m && isOwnerMsg(m, owners))
  }
  const ownerTurn = !got.moment && msgs.length === 1 && isOwnerMsg(msgs[0], owners)
  return { moment: got.moment, keys: got.keys, ownerMsg, ownerTurn }
}
// names = this session's tool names. moment = recall.js newTaskMoment's moment (or null). ownerTurn = a single owner
// message in a seen thread. engage named only where it exists; the reflect clause only where reflect exists (the engine
// deny decides) and only for the owner's own message (official: when the USER settles something).
export function kumihoLine(names, moment, ownerMsg, ownerTurn) {
  const engage = (names || []).find(n => /^mcp__.+?__kumiho_memory_engage$/.test(String(n))) || ''
  const reflect = (names || []).find(n => /^mcp__.+?__kumiho_memory_reflect$/.test(String(n))) || ''
  const rClause = reflect ? ` 주인이 이 글로 기억해 달라고 하거나 결정·선호·사실·교정을 정하면 답 끝에 ${reflect} 로 한 줄(제목에 날짜 · 자기 말로 · 비밀·고객사 사람 이름·연락처 ❌) — 아니면 쓰지 않음.` : ''
  if (moment && engage) {
    const head = moment.why === 'owner-past-ref' ? '지난 일을 묻는 글 — 이 대화와 위 기억 블록에 답이 없으면' : '지난 결정·선호가 이 일의 답을 바꿀 수 있으면'
    return `[mods 구미호] ${head} 답 전에 ${engage} 1회(지금 글에서 뽑은 짧은 질의 · 비밀 ❌) — 이 대화나 위 기억 블록에 근거가 이미 보이면 건너뜀.${ownerMsg ? rClause : ''}`
  }
  if (!moment && ownerTurn && reflect) return `[mods 구미호]${rClause}`
  return ''
}
