// lane: ui · owner: 봇 — pure 세션 나무 model (no `$`).
// Inputs: session-lane registry files (src/session/REGISTRY.md, read-only here) and this lane's per-session live
// files (<live_dir>/<registry id>.json = { id, session_uuid, activity, since, last_seen, model, effort, bot }).
// Live files are keyed by the registry id, not the session uuid: /clear gives a session a new uuid but keeps its
// registry row (기둥 ③ 실측 + 봇 계약 10-17), so the join row.id ↔ live.id survives it.
// «응답 없음» (stale) = the live file's last_seen is older than N minutes (봇 10-17: display only, never delete;
// 봇 10-17: the registry has no heartbeat, so the live file is the only clock).
import { foldSegments, wrapSegments, segWidth, segText, strWidth, modelColor, modelShown, effortInk } from './text.js'
import { hhmm } from './schedule.js'
import { usageText } from './usage.js'
import { AGENT_LOOK, threadLabel } from './agents.js'
import { sessionShown, withNamePrefix } from './display.js'
import { childEndLabel } from '../../session/core.js'

export const DEFAULT_STALE_MIN = 5
// 10-19 (주인 15:02): an ended / failed session leaves the tree at once (was 60 min) —
// ui.keep_ended_min still keeps them that many minutes. Kept anyway (flatten): this session's own row, an ended row a
// shown row hangs under (its 하위 keep their place), and an ended row whose window is still open (aliveAfterEnd).
export const DEFAULT_KEEP_ENDED_MIN = 0

// 봇 10-17: idle ○ green · busy ● blue · waiting ◎ yellow · stale × red (glyph first, color second).
// 10-19: ended ✓ · failed ✕ (dim) = the legend's «✓끝 ✕실패» — × was shared with «응답 없음» while the legend said ✓끝.
export const LOOK = {
  idle: { glyph: '○', color: 'green', word: '쉼' },
  busy: { glyph: '●', color: 'blue', word: '작업 중' },
  waiting: { glyph: '◎', color: 'yellow', word: '대기' },
  stale: { glyph: '×', color: 'red', word: '응답 없음' },
  ended: { glyph: '✓', color: 'green', dim: true, word: '끝남' },
  failed: { glyph: '✕', color: 'red', dim: true, word: '실패' },
  starting: { glyph: '○', dim: true, word: '시작 중' },
}

// P3: this session's own row's cursor (paneTree lead) — the legend's «▷» takes its ink from here
export const CURSOR = { glyph: '▷', color: 'cursor', bold: true }

function parseObject(text) {
  let v
  try { v = JSON.parse(text) } catch (err) { return null }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

// One registry file → entry, or null when broken / not an entry (the caller keeps the last good copy).
export function parseEntry(text) {
  const v = parseObject(text)
  return v && typeof v.id === 'string' && v.id ? v : null
}

export function parseLive(text) {
  const v = parseObject(text)
  return v && typeof v.id === 'string' && v.id ? v : null
}

export function isoMs(s) {
  if (typeof s !== 'string' || !s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

// 10-24 (A · 주인 10-24 · 봇 11:16 봇 안): the one end rule every part reads — the row's state
// (stateOf), its leaving the tree (flatten), the 예약 of a session (index.js sessionJobs), Enter on it (goToNow) and the
// projects' counts (project.js). Registry status first (ended / failed), then the session's own live file saying so
// (activity ended / failed). Before 10-24 the drawn state read both while the tree's removal read the registry alone, so a
// row its live file called ended stayed drawn as ✓ for good. This session's own record (`self`) never ends a row (/clear
// can leave «ended» while it runs — stateOf below). → 'ended' | 'failed' | null.
export function overOf(entry, live) {
  const st = entry ? entry.status : null
  if (st === 'failed' || st === 'ended') return st
  if (live && !live.self && (live.activity === 'ended' || live.activity === 'failed')) return live.activity
  return null
}

// When the end was written: the registry's ended_at (else updated_at), else the live file's since (else last_seen).
export function overAt(entry, live) {
  if (overOf(entry, null)) return isoMs(entry.ended_at) ?? isoMs(entry.updated_at)
  if (overOf(null, live)) return Number.isFinite(live.since) ? live.since : Number.isFinite(live.last_seen) ? live.last_seen : null
  return null
}

export function stateOf(entry, live, nowMs, staleMs) {
  // This session's own row (`self` = the record the drawing session made of itself): it is drawing, so it is alive
  // whatever the registry says — 기둥 ③ 실측: /clear left the registry at «ended» while the session went on.
  if (live && live.self) return LOOK[live.activity] && !['stale', 'starting', 'ended', 'failed'].includes(live.activity) ? live.activity : 'idle'
  const over = overOf(entry, live)
  if (over) return over
  const st = entry ? entry.status : null
  if (live && Number.isFinite(live.last_seen)) {
    if (nowMs - live.last_seen > staleMs) return 'stale'
    return LOOK[live.activity] && !['stale', 'starting', 'failed'].includes(live.activity) ? live.activity : 'idle'
  }
  if (st === 'starting') return 'starting'
  const upd = isoMs(entry && entry.updated_at)
  if (upd !== null && nowMs - upd > staleMs) return 'stale'
  return 'idle'
}

function isGone(e, live, nowMs, keepEndedMs) {
  if (!overOf(e, live)) return false
  return nowMs - (overAt(e, live) ?? 0) > keepEndedMs
}

// 10-19 (bot-NNNNNN 재현): the registry says ended but the session's own live file still beats — its window did not
// close (the close aimed at a view session that was gone). Beating = seen within staleMs AND more than END_GRACE_MS after
// the end was written (the last beat of a window being closed lands within seconds of it).
export const END_GRACE_MS = 90 * 1000
// A live file that itself says ended / failed (overOf) is no open window, however fresh its last_seen.
export function aliveAfterEnd(entry, live, nowMs, staleMs) {
  if (!overOf(entry, null) || !live || live.self || overOf(null, live) || !Number.isFinite(live.last_seen)) return false
  const end = overAt(entry, null)
  return end !== null && live.last_seen - end > END_GRACE_MS && nowMs - live.last_seen <= staleMs
}

function startOrder(a, b) {
  return ((isoMs(a.started_at) ?? 0) - (isoMs(b.started_at) ?? 0)) || a.id.localeCompare(b.id)
}

// Entries → display rows [{ entry, depth, orphan?, cycle? }] in tree order.
// A child whose parent is missing (or ended and hidden) = top-level «부모 없음»; a cycle is cut and marked.
// keep(entry) → true = shown however long ago it ended (index.js: this session's own row · aliveAfterEnd). An ended row
// is shown too while a shown row hangs under it (10-19: a grandchild still running under an ended child would else pop
// out as a «부모 없음» root and leave this bot's family).
// 10-24 (A): liveOf(id) → that row's live record (optional) — a row leaves by the one end rule (overOf: the registry or
// its own live file), the same that draws it ✓/✕; without liveOf only the registry is read (as before).
export function flatten(entries, nowMs, keepEndedMs, keep, liveOf) {
  const all = new Map()
  for (const e of entries || []) {
    if (!e || typeof e.id !== 'string' || !e.id || all.has(e.id)) continue
    all.set(e.id, e)
  }
  const kept = typeof keep === 'function' ? keep : () => false
  const lv = typeof liveOf === 'function' ? liveOf : () => null
  const show = new Set()
  for (const e of all.values()) if (!isGone(e, lv(e.id) || null, nowMs, keepEndedMs) || kept(e)) show.add(e.id)
  for (const id of [...show]) {
    const up = new Set([id])
    let p = all.get(id).parent_id
    while (typeof p === 'string' && p && all.has(p) && !up.has(p)) {
      up.add(p)
      show.add(p)
      p = all.get(p).parent_id
    }
  }
  const byId = new Map()
  for (const e of all.values()) if (show.has(e.id)) byId.set(e.id, e)
  const kids = new Map()
  const roots = []
  for (const e of byId.values()) {
    const p = typeof e.parent_id === 'string' && e.parent_id ? e.parent_id : null
    if (p && p !== e.id && byId.has(p)) {
      if (!kids.has(p)) kids.set(p, [])
      kids.get(p).push(e)
    } else roots.push(e)
  }
  const rows = []
  const seen = new Set()
  const walk = (e, depth, flags) => {
    if (seen.has(e.id)) return
    seen.add(e.id)
    rows.push({ entry: e, depth, ...flags })
    for (const c of (kids.get(e.id) || []).slice().sort(startOrder)) walk(c, depth + 1, {})
  }
  for (const r of roots.slice().sort(startOrder)) {
    const p = typeof r.parent_id === 'string' && r.parent_id ? r.parent_id : null
    walk(r, 0, p && p !== r.id ? { orphan: true } : {})
  }
  for (const e of [...byId.values()].sort(startOrder)) if (!seen.has(e.id)) walk(e, 0, { cycle: true })
  return rows
}

// Rows of the one family (root + all its descendants) that holds `id`; [] when `id` is not shown.
export function familyOf(rows, id) {
  const i = rows.findIndex((r) => r.entry.id === id)
  if (i < 0) return []
  let start = i
  while (start > 0 && rows[start].depth > 0) start--
  let end = start + 1
  while (end < rows.length && rows[end].depth > 0) end++
  return rows.slice(start, end)
}

// This session's registry id (봇 계약 ③ 10-17: rows are found by id, never by uuid).
// The id the session lane put in $.state wins; else the id already held (a /clear changes the uuid, not the row, and
// $.state came back empty after /clear in 기둥 ③); else, the first time, the row whose session_uuid is this session.
// Once known it is never dropped.
export function myRegistryId(held, stateId, entries, uuid) {
  if (typeof stateId === 'string' && stateId) return stateId
  if (typeof held === 'string' && held) return held
  const m = uuid ? (entries || []).find((e) => e && e.session_uuid === uuid) : null
  return m ? m.id : null
}

// Which registry entry is this session: by registry id first, then (before the id is known) by session uuid.
export function findMe(entries, registryId, uuid) {
  const list = entries || []
  return (registryId && list.find((e) => e && e.id === registryId)) ||
    (uuid && list.find((e) => e && e.session_uuid === uuid)) || null
}

// Pane order: this session's family first (it is what the person is looking at), then everyone else as flattened.
export function meFirst(rows, family) {
  if (!family || !family.length) return rows
  const mine = new Set(family.map((r) => r.entry.id))
  return [...family, ...rows.filter((r) => !mine.has(r.entry.id))]
}

// r2 (owner 10-18 15:22 · 봇 ②″):
// the pane's tree = this session's family alone (root → 하위 → 하위의 하위, flatten order, depth kept); every other
// family goes behind one «▶ 다른 봇 N» line. Not registered (no family) = nothing of its own, every row an «other».
export function splitFamilies(rows, family) {
  const mine = new Set((family || []).map((r) => r.entry.id))
  return { mine: family || [], others: (rows || []).filter((r) => !mine.has(r.entry.id)) }
}

// The «▶ 다른 봇 N» line (shut) or «▼ 다른 봇 N» (open): N = the other families' root rows (one per bot as the registry
// holds them), with their 하위 counted after. null = no other session at all (the line is not drawn).
export function othersHead(others, open) {
  const list = others || []
  if (!list.length) return null
  const roots = list.filter((r) => r.depth === 0).length
  const kids = list.length - roots
  const segs = [{ text: open ? '▼ ' : '▶ ', color: 'cyan', bold: true }, { text: '다른 봇 ' + roots, color: 'cyan', bold: true }]
  if (kids > 0) segs.push({ text: ' · 하위 ' + kids, color: 'sub' })
  return segs
}

// r2 B (주인 16:35 · 봇 ①② ·
// ②): how the tree shows its levels = config ui.tree_style, one letter (settings.js; any other value = B):
//   A 꺾쇠 ▸▾ + 2칸 들여쓰기 · B 나무 선 ├ └ │ (마지막이 아닌 줄 = ├) · C 들여쓰기 + 상태 점 색만 — 봇 줄의 점이 접기 단추,
//   하위 이름은 흐리게 · D 개수 배지 — 접힌 봇 줄 끝의 «하위 n ▸» 가 단추, 펼치면 A · E 점 요약 — 하위 있는 봇 줄 이름 뒤에
//   하위 세션마다 상태 점 하나(접힌 채로도 누가 작업 중·대기·응답 없음인지), 선은 B.
// Every style folds per bot (a root row with 하위): this session's family open, every other folded, until pressed.
export const TREE_STYLES = ['A', 'B', 'C', 'D', 'E']
export const DEFAULT_TREE_STYLE = 'B'
const LINES = { A: false, B: true, C: false, D: false, E: true } // ├ └ │ drawn
export const DOTS_MAX = 8 // E: dots on a bot row, then «+N»

// r2 B (봇 ① · 봇 가정 1): a bot row's fold mark = that bot's 하위 open/shut · the rest
// of a session row = go and see that session (index.js jump · jump.js). Registry ids are [a-z0-9-]: neither key reads as
// the other, nor as any other press (band.js actionOf).
export const KIDS_PRESS = (id) => 'mh-kids-' + id
export const GO_PRESS = (id) => 'mh-go-' + id
// R6 (봇 ②): a session's «서브 N ▸» line and, open, each subagent row's «서브» = that session's subagents
// folded open/shut. Read here, not in band.js actionOf (index.js pressAction asks this after it) — the same key form:
// «<press>@<row>», a «:n» of a press twice in one row dropped.
export const SUBS_PRESS = (id) => 'mh-subs-' + id
export function subsPressOf(key) {
  const m = /^mh-subs-([a-z0-9-]+)$/.exec(String(key || '').split('@')[0].replace(/:\d+$/, ''))
  return m ? { type: 'subs', id: m[1] } : null
}

// A family's rows (flatten order) as nodes: a session's kids = its subagents, then its child sessions in their order.
function nodesOf(rows, agentsOf) {
  const roots = []
  const at = []
  for (const row of rows || []) {
    const node = { kind: 'session', row, kids: [] }
    for (const agent of agentsOf(row.entry, row) || []) node.kids.push({ kind: 'agent', row, agent, kids: [] })
    const d = Number.isFinite(row.depth) && row.depth > 0 ? Math.floor(row.depth) : 0
    at.length = d
    if (d > 0 && at[d - 1]) at[d - 1].kids.push(node)
    else roots.push(node)
    at[d] = node
  }
  return roots
}

function sessionsUnder(node) {
  return node.kids.reduce((n, k) => n + (k.kind === 'session' ? 1 + sessionsUnder(k) : 0), 0)
}
function agentsUnder(node) {
  return node.kids.reduce((n, k) => n + (k.kind === 'agent' ? 1 : agentsUnder(k)), 0)
}
function sessionNodesUnder(node, acc = []) {
  for (const k of node.kids) if (k.kind === 'session') { acc.push(k); sessionNodesUnder(k, acc) }
  return acc
}

// The cells in front of a level-`level` row's glyph after the fold-mark column: one 2-cell column per level above it
// («│ » where that level's line goes on down — B/E — else blank) and its own «├ »/«└ » (blank in A/C/D).
function connector(lines, cont, level, last) {
  if (level < 1) return ''
  const up = cont.map((c) => (lines && c ? '│ ' : '  ')).join('')
  return up + (lines ? (last ? '└ ' : '├ ') : '  ')
}

// Under a level-`level` session row (its thread line): the lines above go on, then its own kids' line if any follow.
function underRow(lines, cont, level, last, kidsBelow) {
  const up = cont.map((c) => (lines && c ? '│ ' : '  ')).join('')
  const own = level >= 1 ? (lines && !last ? '│ ' : '  ') : ''
  return up + own + (lines && kidsBelow ? '│ ' : '  ')
}

// the name drawn for a session — its bot part under ui.bot_display (display.js · 주인 10-18 18:21); ids stay real.
// 10-22: a 하위 with name_prefix (its project's slug) reads «<prefix>-<name>» — the name its window shows. The ◈ project
// view keeps the plain name (its rows already sit under their project).
function nameOf(e) {
  const base = sessionShown(typeof e.name === 'string' && e.name ? e.name : e.id, e.bot)
  return e.role === 'child' ? withNamePrefix(base, e.name_prefix) : base
}

// 10-18 (주인 17:58): a child row's end text (core.js childEndLabel) → one tail item
const END_TONE = { sub: { color: 'sub' }, yellow: { color: 'yellow' }, red: { color: 'red' }, dim: { color: 'sub', dim: true } }
export function endTail(entry, live, nowMs, endCfg) {
  if (!endCfg) return null
  const l = childEndLabel(entry, live || null, nowMs, endCfg)
  return l ? [{ text: l.text, ...(END_TONE[l.tone] || END_TONE.sub) }] : null
}

function lookOf(row, liveById, nowMs, staleMs) {
  const live = liveById.get(row.entry.id)
  const state = stateOf(row.entry, live, nowMs, staleMs)
  return { state, live, look: LOOK[state] }
}

// The first row of `segs` wrapped at `cols` — for a band line whose first item alone is wider than the band (a width
// no terminal here has: the band spans the window). Never a «…» (봇 v2 5번).
function firstRow(segs, cols) {
  return segWidth(segs) <= cols ? segs : wrapSegments(segs, cols, 0)[0]
}

// 띠 한 줄: «❖ 나무 · ● bot └ ○ bot-NNNNNN ● bot-NNNNNN +2» in `cols` (children past the edge → +N, never cut).
// liveById = Map(registry id → live record).
export function bandTreeSegments(family, liveById, nowMs, staleMs, cols, fallback) {
  const head = [{ text: '❖ ', color: 'cyan', bold: true }, { text: '나무', color: 'cyan', bold: true }, { text: ' · ' }]
  if (!family.length) {
    const f = fallback || {}
    const look = LOOK[f.state] || LOOK.idle
    return foldSegments([...head, { text: look.glyph, color: look.color, dim: look.dim }, { text: ' ' + (f.name || '?') }, { text: ' · 등록부 없음' }], cols)
  }
  const items = family.map((row) => {
    const { look } = lookOf(row, liveById, nowMs, staleMs)
    return [{ text: look.glyph, color: look.color, dim: look.dim }, { text: ' ' + nameOf(row.entry) }]
  })
  let line = [...head, ...items[0]]
  if (items.length > 1) line.push({ text: ' └' })
  for (let k = 1; k < items.length; k++) {
    const rest = items.length - k - 1
    const trial = [...line, { text: ' ' }, ...items[k]]
    const tail = rest > 0 ? [{ text: ' +' + rest }] : []
    if (segWidth([...trial, ...tail]) <= cols) { line = trial; continue }
    line = [...line, { text: ' +' + (items.length - k) }]
    return firstRow(line, cols)
  }
  return firstRow(line, cols)
}

// 10-19 J1: the one shape (text.js modelShown) · none = «–» (부모 J1 «null = –»; it was «?»)
function shortModel(m) {
  return modelShown(m) || '–'
}

// The thread as «#186579» (설계 메모: the last 6 digits of its ts, dim).
function threadTag(t) {
  const ts = t && typeof t.ts === 'string' ? t.ts : ''
  return ts ? '#' + ts.slice(-6) : ''
}

// 설계 메모: the pane's width tier — W 62+ (4 columns, time, #ts6) · M 48–61 (no #ts6) · S 36–47 (Project goes to the ◈
// lines, no tail) · XS 35 and under (모델 · 추론 only).
// r2 (주인 16:44 · 봇): 추론 is a column of its own, painted by
// its step (text.js effortInk).
export function treeTier(cols) {
  return cols >= 62 ? 'W' : cols >= 48 ? 'M' : cols >= 36 ? 'S' : 'XS'
}
const TIER_COLUMNS = { W: ['project', 'type', 'model', 'effort'], M: ['project', 'type', 'model', 'effort'], S: ['type', 'model', 'effort'], XS: ['model', 'effort'] }
const COLUMNS = ['project', 'type', 'model', 'effort']

// 설계 메모: medium → med everywhere, high → hi and xhigh → xhi in the narrow tiers (low · max as they are).
function effortText(e, tier) {
  if (typeof e !== 'string' || !e) return e
  if (e === 'medium') return 'med'
  if (tier === 'S' || tier === 'XS') return e === 'high' ? 'hi' : e === 'xhigh' ? 'xhi' : e
  return e
}

// A registry label (session lane 611f1a1: project · type = one line of 1-64 characters, or null) → cell text.
function label(v) {
  return typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : '-'
}

// r2 (167칸 캡처 16:20 · «general-purpose» 한 줄이 Type 칸을 15칸으로 넓혀 모든 줄의 시간 꼬리를 «+N» 으로 밀어냄): a
// subagent's type is the engine's agent name, not a registry label — its cell is a short form: the plugin's namespace
// dropped («km:knowledge-manager» → «knowledge-manager»), «general-purpose» → «general», at most AGENT_TYPE_CELLS cells.
export const AGENT_TYPE_CELLS = 12
export function agentType(v) {
  const t = label(v)
  if (t === '-') return t
  const base = t.slice(t.lastIndexOf(':') + 1) || t
  const short = base === 'general-purpose' ? 'general' : base
  let out = ''
  for (const ch of short) {
    if (strWidth(out + ch) > AGENT_TYPE_CELLS) break
    out += ch
  }
  return out
}

// `s` padded with spaces to `w` cells — a column is as wide as its widest value, so nothing is cut.
function cell(s, w) {
  return s + ' '.repeat(Math.max(0, w - strWidth(s)))
}

const SEP = { text: ' : ', dim: true }
const HEAD = { project: 'Project', type: 'Type', model: '모델', effort: '추론' }
const COLUMN_INK = { project: () => 'lavender', type: () => 'sky', model: (it) => it.modelInk, effort: (it) => it.effortInk.color }

// Column widths for `cols` cells. v2 (봇 v2 5번 «크기 상관없이 잘리지 않게»): a value is never cut — each
// column is as wide as its widest value (or its title). `allowed` = the columns the width tier keeps (설계 메모); when
// those still do not fit, whole columns fold away, Project first, then Type, then 추론, then 모델 (0 = not shown; the
// title row shows which are there). A row still wider than the pane — a name wider than the pane — goes on below it
// (paneLines wraps).
export function treeColumns(cells, cols, headLabel, allowed) {
  const keep = allowed || COLUMNS
  const max = (k, floor) => cells.reduce((m, c) => Math.max(m, strWidth(c[k])), floor)
  const w = { lead: max('lead', strWidth(headLabel)) }
  for (const k of COLUMNS) w[k] = keep.includes(k) ? max(k, strWidth(HEAD[k])) : 0
  const fixed = () => w.lead + COLUMNS.reduce((n, k) => n + (w[k] ? w[k] + 3 : 0), 0)
  for (const k of ['project', 'type', 'effort', 'model']) if (fixed() > cols) w[k] = 0
  return w
}

// The tail items that fit `room` cells, each after « · »; the ones left out are counted « +N» (never cut · 봇 G7
// 결정: 사용량은 줄 끝에 남고 자리가 없으면 +N).
function fitTail(items, room) {
  const seg = (it) => [{ text: ' · ', dim: true }, ...it]
  for (let k = items.length; k >= 0; k--) {
    const segs = items.slice(0, k).flatMap(seg)
    if (k < items.length) segs.push({ text: ' +' + (items.length - k), dim: true })
    if (segWidth(segs) <= room) return segs
  }
  return []
}

// 칸 나무 = 머리줄 + 세션마다 1줄, 열 맞춤 (봇 v1 ② · 41번 M4 · 인터뷰 11번 61줄 «프로젝트 · 작업 타입 · 모델과
// 추론» · 설계 메모 · 손그림: 커서 ▷ 와 상태 동그라미):
// «▷ ▾ ● bot        : mods-rebuild : 총괄 : opus-5-5 : max · 20:25 · #123456 · 호출 3 · 캐시 1.2M/85k».
// ▷ (cursor 81) = this session's own row · 뿌리 이름 bright bold, 하위 text · Project lavender · Type sky · 모델 계열색.
// r2 (owner 15:22): a row sits under its parent by its depth; under a child with a Slack
// thread one line «#채널 · 스레드 머리글» (봇 ①); under each session its subagents («● 설명 : - : 종류 :
// 모델 : - · 실행 N분», opts.agentsOf), then its child sessions. r2 B: how the levels look = opts.style (TREE_STYLES);
// a root row with 하위 has its fold mark and is drawn open only when opts.isOpen(root id) — folded, its 하위 are left
// out and the row says how many (A·B «· 하위 n» · C «+n» · D the badge at its end · E the dots). The tail (W: 시각 · 상태
// · #ts6 · 사용량 · M: no #ts6 · S/XS: none) keeps what fits and counts the rest « +N»; the task sentence is not on the row
// (설계 메모 — on the ◈ lines). The session's own row says so when the registry calls it ended. Rows come back whole
// ({ key, segs, state, indent, bot, kind, id }); a row wider than the pane wraps in the pane (indent = where a wrapped
// part starts). Segments carry their press: the fold mark KIDS_PRESS(root) · the rest of a session row GO_PRESS(id).
// opts = { agentsOf(entry) → [agent], heads: Map threadTs → head, channels: { id: name }, label: '나무', style: 'A'…'E',
// isOpen(rootId) → bool (default: all open), subsOpen(sessionId) → bool (R6: that session's subagents drawn open —
// default: all open; the screen passes its own, every one folded until pressed) }.
export function paneTree(rows, liveById, nowMs, staleMs, cols, opts) {
  const o = opts || {}
  const style = TREE_STYLES.includes(o.style) ? o.style : DEFAULT_TREE_STYLE
  const lines = LINES[style]
  const isOpen = typeof o.isOpen === 'function' ? o.isOpen : () => true
  const agentsOf = typeof o.agentsOf === 'function' ? o.agentsOf : () => []
  const subsOpen = typeof o.subsOpen === 'function' ? o.subsOpen : () => true
  const roots = nodesOf(rows, agentsOf)
  // the fold mark's column — only when some root here has 하위 to fold (C: the root's own dot is the mark)
  const chevW = style !== 'C' && roots.some((r) => r.kids.length > 0) ? 2 : 0
  const tier = treeTier(cols)
  const items = []
  const sessionItem = (node, level, conn, fold) => {
    const row = node.row
    const { state, live, look } = lookOf(row, liveById, nowMs, staleMs)
    const e = row.entry
    const model = shortModel((live && live.model) || e.model)
    const effortWord = (live && live.effort) || e.effort
    const effort = effortText(effortWord, tier)
    const seen = live && Number.isFinite(live.last_seen) ? live.last_seen : isoMs(e.updated_at)
    let flags = row.orphan ? ' (부모 없음)' : row.cycle ? ' (순환)' : ''
    if (live && live.self && overOf(e, null)) flags += ' (등록부: 끝남)'
    else if (aliveAfterEnd(e, live, nowMs, staleMs)) flags += ' (창 열림)'
    const tail = []
    if (tier === 'W' || tier === 'M') {
      // «응답 없음 N분» already says when it was last seen, so it takes the time's place.
      if (state === 'stale' && Number.isFinite(seen)) tail.push([{ text: look.word + ' ' + Math.floor((nowMs - seen) / 60000) + '분', color: look.color }])
      else {
        tail.push([{ text: seen !== null ? hhmm(seen) : '--:--', color: 'sub' }])
        if (state !== 'idle' && state !== 'busy') tail.push([{ text: look.word, color: look.color, dim: look.dim }])
      }
      // r2: a child's thread has its own line below the row, so the #ts6 tag is for a row without one
      const tag = tier === 'W' && !(e.role === 'child' && e.thread && e.thread.channel) ? threadTag(e.thread) : ''
      if (tag) tail.push([{ text: tag, dim: true }])
      // 10-18: a child's «남은 시간 또는 끝난 이유» after its time/state (and the #ts6 tag a child with a thread line never
      // has) — before the usage parts, so it is the first thing kept after them
      const end = e.role === 'child' ? endTail(e, live, nowMs, o.endCfg) : null
      if (end) tail.push(end)
      // G7: the own row's totals from memory (fresher), every other row's from its registry `usage` (session lane copy).
      const used = usageText((live && live.self && live.usage) || e.usage)
      for (const part of used ? used.split(' · ') : []) tail.push([{ text: part, color: 'sub' }])
    }
    const self = Boolean(live && live.self)
    const root = level === 0
    // r2 B: the fold mark and what a folded root says about its 하위
    let mark = root && chevW ? '  ' : ''
    let suffix = []
    let badge = null
    if (fold) {
      const n = fold.sessions
      const more = fold.agents ? ' · 서브 ' + fold.agents : ''
      if (style === 'A' || style === 'B') {
        mark = fold.open ? '▾ ' : '▸ '
        if (!fold.open) suffix = [{ text: (n ? ' · 하위 ' + n : '') + more, color: 'sub' }]
      } else if (style === 'C') {
        if (!fold.open) suffix = [{ text: ' +' + (n + fold.agents), dim: true }]
      } else if (style === 'D') {
        if (fold.open) mark = '▾ '
        else {
          // the badge's forms, longest first — the row takes the first that fits (below)
          const k = n || fold.agents
          badge = [(n ? '하위 ' : '서브 ') + k + ' ▸', k + ' ▸', '▸']
        }
      } else {
        mark = fold.open ? '▾ ' : '▸ '
        const dots = fold.dots.slice(0, DOTS_MAX).map((l) => ({ text: l.glyph, color: l.color, dim: l.dim }))
        suffix = [{ text: ' ' }, ...dots]
        if (fold.dots.length > DOTS_MAX) suffix.push({ text: '+' + (fold.dots.length - DOTS_MAX), dim: true })
        if (!fold.dots.length && fold.agents) suffix = [{ text: ' 서브 ' + fold.agents, color: 'sub' }]
      }
    }
    const name = nameOf(e) + flags
    const pre = root ? mark : ' '.repeat(chevW) + conn
    // R6 ①: a session under a bot says «하위» before its name (the top bot row none)
    const tag = root ? null : '하위'
    items.push({ kind: 'session', row, state, look, self, root, level, name, tail, pre, mark: Boolean(fold) && mark.trim() !== '', dotMark: Boolean(fold) && style === 'C',
      suffix, badge, tag, lead: '▷ ' + pre + look.glyph + ' ' + (tag ? tag + ' ' : '') + name + segText(suffix), project: label(typeof o.projectOf === 'function' ? o.projectOf(e.project) : e.project), type: label(e.type), model, modelInk: modelColor(model),
      effort: typeof effort === 'string' && effort ? effort : '-', effortInk: effortInk(effortWord) })
  }
  const agentItem = (node, conn) => {
    const a = node.agent
    const al = AGENT_LOOK[a.status] || AGENT_LOOK.running
    const name = a.description || a.type
    const atail = []
    if (tier === 'W' || tier === 'M') {
      const ended = Number.isFinite(a.endAt)
      const since = ended ? a.endAt : a.at
      const mins = Number.isFinite(since) ? Math.max(0, Math.floor((nowMs - since) / 60000)) : null
      atail.push([{ text: ended ? al.word + ' ' + hhmm(a.endAt) : al.word + (mins !== null ? ' ' + mins + '분' : ''), color: al.color || 'sub', dim: al.dim }])
    }
    const am = a.model ? shortModel(a.model) : '-'
    const pre = ' '.repeat(chevW) + conn
    // a subagent has no effort of its own in what the engine tells a mod (agent.spawn · $.agent.list) — «-»
    // R6 ②: «서브» before its name, the row drawn dim (below) — the lead's «▷ » is the cursor column's width, as on every row
    items.push({ kind: 'agent', row: node.row, agent: a, look: al, self: false, root: false, name, tail: atail, pre, suffix: [], badge: null, tag: '서브', lead: '▷ ' + pre + al.glyph + ' 서브 ' + name,
      project: '-', type: agentType(a.type), model: am, modelInk: a.model ? modelColor(am) : 'sub', effort: '-', effortInk: effortInk(null) })
  }
  // R6 ②: a session's subagents folded = one «서브 N ▸» line in their place (N = the ones drawn: not ended)
  const subsItem = (node, conn) => {
    const pre = ' '.repeat(chevW) + conn
    items.push({ kind: 'subs', row: node.row, n: node.n, pre, lead: '▷ ' + pre + '서브 ' + node.n + ' ▸' })
  }
  const kidsShown = (node) => {
    const subs = node.kids.filter((k) => k.kind === 'agent')
    if (!subs.length || subsOpen(node.row.entry.id) === true) return node.kids
    return [{ kind: 'subs', row: node.row, n: subs.length, kids: [] }, ...node.kids.filter((k) => k.kind !== 'agent')]
  }
  // depth first: a node, its thread line, then (a root only when open) its kids; `cont` = per level above, a line goes on
  const walk = (node, level, cont, last) => {
    const conn = connector(lines, cont, level, last)
    if (node.kind === 'agent') return agentItem(node, conn)
    if (node.kind === 'subs') return subsItem(node, conn)
    const root = level === 0
    const has = node.kids.length > 0
    const open = !root || !has || isOpen(node.row.entry.id) === true
    const fold = root && has ? { open, sessions: sessionsUnder(node), agents: agentsUnder(node), dots: sessionNodesUnder(node).map((k) => lookOf(k.row, liveById, nowMs, staleMs).look) } : null
    sessionItem(node, level, conn, fold)
    const shown = open ? kidsShown(node) : []
    const e = node.row.entry
    const tl = e.role === 'child' ? threadLabel(e, o.heads, o.channels) : null
    if (tl) items.push({ kind: 'thread', row: node.row, ind: ' '.repeat(chevW) + underRow(lines, cont, level, last, shown.length > 0), label: tl })
    const below = root ? [] : [...cont, !last]
    shown.forEach((k, i) => walk(k, level + 1, below, i === shown.length - 1))
  }
  for (const r of roots) walk(r, 0, [], true)
  const table = items.filter((it) => it.kind !== 'thread' && it.kind !== 'subs')
  const sessions = (rows || []).length
  const agents = (rows || []).reduce((n, r) => n + (agentsOf(r.entry, r) || []).length, 0)
  const word = o.label || '나무'
  // r2: « · 서브 N» rides in the head's label only when it fits the name column the rows take anyway — never widening
  // every row (167칸 캡처: the longer head pushed the subagent's own «실행 N분» off the dock); else at the head's end
  const plain = ' · ' + sessions + '세션'
  const rowLead = table.reduce((m, it) => Math.max(m, strWidth(it.lead)), 0)
  const withSub = agents ? plain + ' · 서브 ' + agents : plain
  const count = strWidth('❖ ' + word + withSub) <= Math.max(rowLead, strWidth('❖ ' + word + plain)) ? withSub : plain
  const headLabel = '❖ ' + word + count
  // 봇 F6 ③: D's badge has its room before the columns — its shortest form « ▸» (2 cells) is kept out of the width
  // the columns may take, so they fold first (52 cols drew 54 when the columns took it all)
  const badgeRoom = table.some((it) => it.badge) ? 2 : 0
  const w = treeColumns(table, cols - badgeRoom, headLabel, TIER_COLUMNS[tier])
  const shownCols = COLUMNS.filter((k) => w[k])
  // Rows pad every shown cell, so the tail starts in one column; the name is padded only when its column fits the
  // pane. The title row pads all but its last title (nothing follows it there).
  const headPad = shownCols.length && w.lead <= cols ? ' '.repeat(Math.max(0, w.lead - strWidth(headLabel))) : ''
  const header = [{ text: '❖ ', color: 'cyan', bold: true }, { text: word, color: 'cyan', bold: true }, { text: count + headPad, color: 'sub' }]
  shownCols.forEach((k, i) => header.push(SEP, { text: i < shownCols.length - 1 ? cell(HEAD[k], w[k]) : HEAD[k], color: 'sub' }))
  if (agents && count === plain && segWidth(header) + strWidth(' · 서브 ' + agents) <= cols) header.push({ text: ' · 서브 ' + agents, color: 'sub' })
  const out = items.map((it) => {
    const id = it.row.entry.id
    const bot = typeof it.row.entry.bot === 'string' && it.row.entry.bot ? it.row.entry.bot : null
    if (it.kind === 'thread') {
      const segs = [{ text: '  ' + it.ind, color: 'sub' }, { text: it.label.name, color: 'sky' }]
      if (it.label.text) segs.push({ text: ' · ', dim: true }, { text: it.label.text, color: it.label.from === 'task' ? 'sub' : 'text' })
      return { key: 'thread-' + id, segs, state: null, indent: 2 + strWidth(it.ind), bot, kind: 'thread', id }
    }
    if (it.kind === 'subs') {
      const press = SUBS_PRESS(id)
      const segs = [{ text: ' ' }, { text: ' ' }, { text: it.pre, color: 'sub' }, { text: '서브 ' + it.n, color: 'sub', press }, { text: ' ▸', color: 'cyan', bold: true, press }]
      return { key: 'subs-' + id, segs, state: null, indent: 2 + strWidth(it.pre), bot, kind: 'subs', id, n: it.n }
    }
    const go = it.kind === 'session' ? GO_PRESS(id) : null
    const kids = KIDS_PRESS(id)
    const at = 2 + strWidth(it.pre) + 2 // ▷ and its space, the fold mark or the levels, the glyph and its space
    const lead = [{ text: it.self ? CURSOR.glyph : ' ', color: CURSOR.color, bold: CURSOR.bold }, { text: ' ' }]
    if (it.pre) lead.push(it.mark ? { text: it.pre, color: 'cyan', bold: true, press: kids } : { text: it.pre, color: 'sub' })
    // C 들여쓰기 + 상태 점 색만: under a root only the dots carry a color
    const ink = it.root ? 'bright' : it.kind === 'agent' || style === 'C' ? 'sub' : 'text'
    // R6: «하위» (a session under a bot · the 하위 tail's ink, not dim) or «서브» (a subagent · its press folds them back)
    const tag = it.tag ? [{ text: ' ' }, { text: it.tag, color: 'sub', ...(it.kind === 'agent' ? { press: SUBS_PRESS(id) } : {}) }] : []
    const body = [{ text: it.look.glyph, color: it.look.color, dim: it.look.dim, ...(it.dotMark ? { press: kids } : {}) }, ...tag, { text: ' ' + it.name, color: ink, bold: it.root }, ...it.suffix]
    const leadW = segWidth([...lead, ...body])
    if (w.lead <= cols && leadW < w.lead) body.push({ text: ' '.repeat(w.lead - leadW) })
    // the last cell is padded only when a tail follows it (the tail then starts in one column)
    shownCols.forEach((k, i) => {
      const seg = { text: i === shownCols.length - 1 && !it.tail.length ? it[k] : cell(it[k], w[k]), color: COLUMN_INK[k](it) }
      if (k === 'effort' && it.effortInk.bold) seg.bold = true
      body.push(SEP, seg)
    })
    // D: the badge = the folded root's own press, at the row's end — room kept for it before the tail. Short of room
    // (18:39 capture, 74×35 dock: one bot open widened the name column and «하위 n ▸» ran past the pane) it says only
    // the count, then only ▸, and the tail goes first: a badge row is never pushed past the pane by its badge or tail.
    // No room even for « ▸» (the name alone fills the pane) = no badge (봇 F6: it was put past the pane).
    const baseW = segWidth([...lead, ...body])
    const badgeText = it.badge ? it.badge.find((t) => baseW + 1 + strWidth(t) <= cols) || null : null
    const badge = badgeText ? [{ text: ' ' }, { text: badgeText, color: 'cyan', bold: true, press: kids }] : []
    const fixedW = baseW + segWidth(badge)
    // R6: a row exactly as wide as the pane before its tail has no room for it (« +N» does not fit either) — only a row
    // already wider than the pane (a name wider than it) takes its whole tail and goes on below (the «하위 » label made
    // 64 cols exact: the whole tail went past the pane)
    const tail = fixedW <= cols ? fitTail(it.tail, cols - fixedW) : badge.length ? [] : it.tail.flatMap((x) => [{ text: ' · ', dim: true }, ...x])
    // R4 ①: a row the registry calls ended (not this session's own — /clear can leave «ended» while it runs) is drawn
    // dim from its glyph on — the dim its × already has (text.js PANE_INK.dim «끝난 것») · Enter on it says why it does not go
    // R6 ②: an open subagent row is drawn dim the same way, from its glyph on
    // 10-24 (A): «ended» = the one end rule (stateOf → overOf), so a row its live file calls ended fades as well
    const faded = (it.kind === 'session' && (it.state === 'ended' || it.state === 'failed') && !it.self) || it.kind === 'agent'
    const fade = (s) => (faded ? { ...s, dim: true } : s)
    const segs = [...lead, ...[...body, ...tail].map((s) => fade(go && !s.press ? { ...s, press: go } : s)), ...badge.map(fade)]
    if (it.kind === 'agent') return { key: 'agent-' + it.agent.id, segs, state: it.agent.status, indent: at, bot, kind: 'agent', id: it.agent.id }
    return { key: 'tree-' + id, segs, state: it.state, indent: at, bot, kind: 'session', id, self: it.self, root: it.root }
  })
  return { header, rows: out }
}
