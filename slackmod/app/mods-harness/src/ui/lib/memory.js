// lane: ui · owner: 봇 — pure 기억 칸 model (no `$`, no imports but time format).
// The ui lane watches `tool.call` (passing every call straight on) and keeps, per memory system, how many calls it
// made since the session started, the last call time and whether it answered without error. 41번 P4 · 봇 v1 ③
// (봇 건의 2): the line groups them by tier — 공유 (shared by every bot: Hindsight · Kumiho) and 개별 (this
// bot's own: KM search, vault-search, memory-bank …) — with each one's count, the known ones at 0 before any call
// (v1.1 1번, knownMemory). Which calls count = config `ui.memory_tools`:
//   [{ "label": "km:search", "match": "Skill:km:search", "tier": "개별" }, { "label": "hindsight", "match": "mcp__hindsight", "tier": "공유" }]
// `match` is a plain substring of the call signature (below); `tier` is 공유 or 개별 (left out = by name, below).
// Without config, a built-in name rule applies. A Bash call never counts, under either: its command text could
// mention anything (r2 B · 봇: a config rule counted «mcp__hindsight» written inside a Bash command).
import { hhmm } from './schedule.js'
import { RESULT_LOOK } from './text.js'

const DEFAULT_NAMES = /memory|recall|hindsight|kumiho|km:search|vault-search/i
const SHARED_NAMES = /hindsight|kumiho/i
export const TIERS = ['공유', '개별']
// Listed at 0 before any call when there is no config — the labels the built-in rule counts these systems under.
const DEFAULT_KNOWN = [{ label: 'hindsight', tier: '공유' }, { label: 'kumiho', tier: '공유' }, { label: 'km:search', tier: '개별' }]

// Signature of one tool call: `Skill:<skill>` · `Bash:<command head>` · otherwise the tool name.
export function sigOf(tool, input) {
  const t = typeof tool === 'string' ? tool : ''
  const i = input && typeof input === 'object' ? input : {}
  if (t === 'Skill' && typeof i.skill === 'string') return 'Skill:' + i.skill
  if (t === 'Bash' && typeof i.command === 'string') return 'Bash:' + i.command.slice(0, 300)
  return t
}

// A plugin's MCP server «plugin_<plugin>_<server>» is labelled by <server>, as a stand-alone server would be.
export function defaultLabel(sig) {
  if (sig.startsWith('Skill:')) return sig.slice(6)
  if (sig.startsWith('mcp__')) {
    const server = sig.split('__')[1] || sig
    const m = /^plugin_[^_]+_(.+)$/.exec(server)
    return m ? m[1] : server
  }
  return sig.split(':')[0]
}

// config value → [{ label, match, tier }] or null (= built-in rule). Bad items are dropped; a bad tier = by name.
export function memoryRules(raw) {
  if (!Array.isArray(raw)) return null
  return raw
    .filter((r) => r && typeof r.match === 'string' && r.match)
    .map((r) => ({ label: typeof r.label === 'string' && r.label ? r.label : null, match: r.match, tier: TIERS.includes(r.tier) ? r.tier : null }))
}

function firstRule(sig, rules) {
  for (const r of rules) if (sig.includes(r.match)) return r
  return null
}

// Label for a call, or null when it is not a memory call.
export function matchMemory(sig, rules) {
  if (!sig || sig.startsWith('Bash:')) return null
  if (rules === null) return DEFAULT_NAMES.test(sig) ? defaultLabel(sig) : null
  const r = firstRule(sig, rules)
  return r ? r.label || defaultLabel(sig) : null
}

// Tier of a memory call: the rule's own when it says, else 공유 for the shared systems' names, else 개별.
export function tierOf(sig, label, rules) {
  const r = rules && sig ? firstRule(sig, rules) : null
  if (r && r.tier) return r.tier
  return SHARED_NAMES.test(label || '') || SHARED_NAMES.test(sig || '') ? '공유' : '개별'
}

// What `next(e)` resolved to → did the call answer without error?
export function callOk(result) {
  if (!result || typeof result !== 'object') return false
  if (typeof result.deny === 'string') return false
  return result.isError !== true
}

// One more call of `label`: recent = { [label]: { at, ok, n, tier, sub? } } (n = calls since the session started; sub = how
// many of them a subagent's loop made — R7a, kept only once there is one, so a session without any reads as before).
export function countMemory(recent, label, tier, at, ok, sub) {
  const before = recent[label]
  const subs = (before && Number.isFinite(before.sub) ? before.sub : 0) + (sub === true ? 1 : 0)
  recent[label] = { at, ok, n: (before && Number.isFinite(before.n) ? before.n : 0) + 1, tier, ...(subs ? { sub: subs } : {}) }
  return recent
}

// R7a (봇 · 주인 22:14): a tool.call made inside a subagent's (or a teammate's) loop carries that
// loop's id — claude-code.d.ts 2.1.296 :12673 ToolCallInput = ToolCallEnvelope & AgentLoop & … · :186~204 AgentLoop.agentId
// «absent on the main loop» (not measured on a real engine tonight: the test engine has no login). Anything else = the main loop.
export function subLoop(e) {
  return Boolean(e && typeof e.agentId === 'string' && e.agentId)
}

// The systems the 기억 line lists before any call, at 0회 (봇 10-17 19:34 3번 · v1.1 1번: the structure shows first):
// the config's labelled rules in their order (the rule's tier, else by name), or without config the built-in three.
// Only what would be counted is listed: a rule without a label has no fixed label (the call's own), so it is not.
export function knownMemory(rules) {
  if (rules === null || rules === undefined) return DEFAULT_KNOWN.map((k) => ({ ...k }))
  const out = []
  for (const r of rules) {
    if (!r || !r.label || out.some((k) => k.label === r.label)) continue
    out.push({ label: r.label, tier: r.tier || (SHARED_NAMES.test(r.label) || SHARED_NAMES.test(r.match || '') ? '공유' : '개별') })
  }
  return out
}

function tierName(t) {
  return TIERS.includes(t) ? t : '개별'
}

// Called systems, newest call first.
function called(recent) {
  return Object.entries(recent || {})
    .filter(([, v]) => v && Number.isFinite(v.at))
    .sort((a, b) => b[1].at - a[1].at)
}

// Per tier (공유, then 개별): the systems called (newest first), then the known ones not called yet (as listed, v = null).
function byTier(recent, known) {
  const done = called(recent)
  return TIERS.map((tier) => ({
    tier,
    items: [
      ...done.filter(([, v]) => tierName(v.tier) === tier),
      ...(known || []).filter((k) => k.tier === tier && !(recent && recent[k.label])).map((k) => [k.label, null]),
    ],
  }))
}

// 설계 메모: 공유 cyan · 개별 gold · a count above 0 bright bold, 0회 dim. `at` = with the call time (넓은 창 3줄).
export const TIER_INK = { 공유: 'cyan', 개별: 'gold' }
function item(label, v, at) {
  if (!v) return [{ text: label + ' ' }, { text: '0회', dim: true }]
  // R7a: the subagents' share after the count — «hindsight 3회 (서브 2)»
  const subs = Number.isFinite(v.sub) && v.sub > 0 ? [{ text: ' (서브 ' + v.sub + ')', color: 'sub' }] : []
  return [{ text: label + ' ' }, { text: (v.n || 1) + '회', color: 'bright', bold: true }, ...subs, { text: ' ' }, ...(at ? [{ text: hhmm(v.at) + ' ', color: 'sub' }] : []),
    v.ok ? { text: '✓', color: RESULT_LOOK.ok.color } : { text: '✕', color: RESULT_LOOK.fail.color }]
}

// One tier's systems in a row: «공유 hindsight 12회 18:41 ✓ · kumiho 0회» · nothing in it = «개별 0회».
function tierRow(tier, items, at) {
  const head = { text: tier, color: TIER_INK[tier] }
  if (!items.length) return [head, { text: ' ' }, { text: '0회', dim: true }]
  const segs = []
  items.forEach(([label, v], k) => segs.push(...(k === 0 ? [head, { text: ' ' }] : [{ text: ' · ' }]), ...item(label, v, at)))
  return segs
}

// 띠 1줄 (dock 없는 창 · 띠가 80칸 미만): «◎ 기억 · 공유 hindsight 12회 ✓ · kumiho 0회 · 개별 km:search 19회 ✓» — both tiers
// always, every known system with its count (설계 메모: 이 줄엔 시각 없음); before the first call it ends with «· 시작
// HH:MM» (counted since).
export function memorySegments(recent, startedAt, known) {
  const segs = [{ text: '◎ ', color: 'cyan' }, { text: '기억' }]
  for (const g of byTier(recent, known)) segs.push({ text: ' · ' }, ...tierRow(g.tier, g.items, false))
  if (!called(recent).length) segs.push({ text: ' · 시작 ' + hhmm(startedAt), dim: true })
  return segs
}

// 넓은 창 오른쪽 단 `n`줄 (v1.1 1번 · 설계 메모: 왼쪽 도구 3줄과 맞춤): each 공유 system its own row, then 개별 in one row —
// «◎ 공유 Hindsight 0회» / «  공유 Kumiho 0회» / «  개별 KM 0회» (설계 메모: ◎ on the first row, the rest under it). When
// that is more than `n` rows, the 공유 ones share one row too; a row longer than the column folds whole items into +N.
export function memoryRows(recent, n, known) {
  const [shared, own] = byTier(recent, known)
  const each = shared.items.length > 0 && shared.items.length + 1 <= n
  const rows = each ? shared.items.map((it) => tierRow(shared.tier, [it], true)) : [tierRow(shared.tier, shared.items, true)]
  rows.push(tierRow(own.tier, own.items, true))
  return rows.slice(0, Math.max(1, n)).map((r, i) => [{ text: i === 0 ? '◎ ' : '  ', color: 'cyan' }, ...r])
}
