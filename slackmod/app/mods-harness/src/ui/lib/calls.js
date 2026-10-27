// lane: ui · owner: 봇 — pure 도구 칸 model (no `$`).
// 41번 M1 (손그림 L3-L «skill / MCP / plugin») · 봇 v1 ③: the skills, MCP tools and plugins this session calls —
// the one running now (●) and the last call of each kind, with its time and ✓/✕. Read off `tool.call` (index.js
// passes every call straight on and only times it). Bash and the built-in tools are not 도구 here.
import { hhmm } from './schedule.js'
import { foldSegments, wrapSegments, strWidth, segWidth } from './text.js'
import { heatBar } from './skin.js'

export const KINDS = ['skill', 'mcp', 'plugin']
const LABEL = { skill: 'skill', mcp: 'MCP', plugin: 'plugin' }

// What one call is: { skill: 'km:search' } · { mcp: 'slack-channel·reply' } · plugin = the plugin it comes from
// (a namespaced skill «km:search» → km · an MCP server «plugin_<plugin>_<server>» → <plugin> · a tool this mod
// registered itself, «mcp__<own plugin name>__…» (tools lane: mcp__mods-harness__progress_line) → own), else null.
export function callOf(tool, input, own) {
  const t = typeof tool === 'string' ? tool : ''
  const i = input && typeof input === 'object' ? input : {}
  if (t === 'Skill' && typeof i.skill === 'string' && i.skill) {
    const k = i.skill.indexOf(':')
    return { kind: 'skill', name: i.skill, plugin: k > 0 ? i.skill.slice(0, k) : null }
  }
  if (t.startsWith('mcp__')) {
    const parts = t.split('__')
    let server = parts[1] || '?'
    const fn = parts.slice(2).join('__')
    let plugin = null
    const m = /^plugin_([^_]+)_(.+)$/.exec(server)
    if (m) { plugin = m[1]; server = m[2] } else if (typeof own === 'string' && own && server === own) plugin = own
    return { kind: 'mcp', name: fn ? server + '·' + fn : server, plugin }
  }
  return null
}

// running: token → { kind, name, plugin, at } · last: kind → { name, at, ok } · items (v3 · 봇 A):
// kind → Map(name → { name, n, at, ok, run }) = this session's calls per name (n counted when a call starts, so a running
// one counts) · total: kind → calls this session.
export function emptyCalls() {
  return { running: new Map(), last: {}, items: { skill: new Map(), mcp: new Map(), plugin: new Map() }, total: { skill: 0, mcp: 0, plugin: 0 } }
}

function bump(state, kind, name, at) {
  if (!state.items || !state.items[kind] || !name) return
  const it = state.items[kind].get(name) || { name, n: 0, at: 0, ok: null, run: 0 }
  it.n += 1
  it.run += 1
  it.at = at
  state.items[kind].set(name, it)
  state.total[kind] += 1
}

function settle(state, kind, name, at, ok) {
  const it = state.items && state.items[kind] ? state.items[kind].get(name) : null
  if (!it) return
  it.run = Math.max(0, it.run - 1)
  it.at = at
  it.ok = ok
}

// A call starts: it shows as running (●) until it answers. `token` = any unique object from the caller.
export function startCall(state, token, call, at) {
  state.running.set(token, { ...call, at })
  bump(state, call.kind, call.name, at)
  if (call.plugin) bump(state, 'plugin', call.plugin, at)
}

// It answered: the last call of its kind (and of its plugin's) is this one, with ✓ or ✕.
export function endCall(state, token, at, ok) {
  const c = state.running.get(token)
  if (!c) return
  state.running.delete(token)
  state.last[c.kind] = { name: c.name, at, ok }
  if (c.plugin) state.last.plugin = { name: c.plugin, at, ok }
  settle(state, c.kind, c.name, at, ok)
  if (c.plugin) settle(state, 'plugin', c.plugin, at, ok)
}

// A kind's names, most called first; the same count = the most recent first (then by name, so a draw is stable).
export function ranked(state, kind) {
  const m = state.items && state.items[kind]
  if (!m) return []
  return [...m.values()].sort((a, b) => b.n - a.n || b.at - a.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

// The three kinds as the band draws them: { kind, label, icon, ink, hotkey, total, items } (items = ranked).
export const HOTKEY = { skill: 's', mcp: 'm', plugin: 'p' }
export function toolKinds(state) {
  return KINDS.map((k) => ({ kind: k, label: LABEL[k], icon: ICON[k], ink: INK[k], hotkey: HOTKEY[k], total: (state.total && state.total[k]) || 0, items: ranked(state, k) }))
}

// Per kind: the newest running call, else the last answered one, else null.
export function latest(state, kind) {
  let run = null
  for (const c of state.running.values()) {
    const hit = kind === 'plugin' ? c.plugin : c.kind === kind
    if (hit && (!run || c.at >= run.at)) run = c
  }
  if (run) return { name: kind === 'plugin' ? run.plugin : run.name, at: run.at, running: true }
  const l = state.last[kind]
  return l ? { name: l.name, at: l.at, ok: l.ok, running: false } : null
}

function mark(x) {
  if (x.running) return { text: '●', color: 'blue' }
  return x.ok ? { text: '✓', color: 'green' } : { text: '✕', color: 'red' }
}

// 설계 메모: ✦ skill mint · ◇ MCP sky · ◈ plugin lavender (icon and label in one ink).
const ICON = { skill: '✦', mcp: '◇', plugin: '◈' }
const INK = { skill: 'mint', mcp: 'sky', plugin: 'lavender' }

// 띠 1줄 (dock 없는 창 · dock 이어도 띠가 80칸 미만): «▸ 도구 · skill km:search ✓ · MCP slack-channel·reply ● ·
// plugin km ✓» (설계 메모 · 3-3: 이 줄엔 시각 없음 — 넓은 창의 3줄엔 있음).
export function callSegments(state) {
  const segs = [{ text: '▸ ', color: 'mint' }, { text: '도구' }]
  for (const k of KINDS) {
    const x = latest(state, k)
    if (!x) continue
    segs.push({ text: ' · ' }, { text: LABEL[k], color: INK[k] }, { text: ' ' + x.name + ' ' }, mark(x))
  }
  if (segs.length === 2) segs.push({ text: ' · 아직 호출 없음', dim: true })
  return segs
}

// 넓은 창 왼쪽 단 3줄: «✦ skill  km:search 19:20 ✓» · «◇ MCP    -» … (labels padded so the names line up).
export function callRows(state) {
  return KINDS.map((k) => {
    const x = latest(state, k)
    const head = { text: ICON[k] + ' ' + (LABEL[k] + '      ').slice(0, 7), color: INK[k] }
    return x ? [head, { text: x.name + ' ' }, { text: hhmm(x.at) + ' ', color: 'sub' }, mark(x)] : [head, { text: '-', dim: true }]
  })
}

// ── 띠 도구 블록 (v3 · 봇 A·B·C · 봇) ──
// A pressable piece of a line: each of its segments carries `press` (the action key, index.js actionOf) and, with a
// hotkey, a first segment «s: » marked `hk` — the engine draws «s: » itself in front of a plain Button that has a
// hotkey (d.ts ButtonProps.plain), so index.js drops that segment and sets `hotkey`; widths here already count it.
export function pressable(segs, press, hotkey) {
  const lead = hotkey ? [{ text: hotkey + ': ', hk: hotkey, color: 'sub' }] : []
  return [...lead, ...segs].map((s) => ({ ...s, press }))
}

export const toolPress = (kind) => 'mh-tool-' + kind

// Kind head line «✦ skill · 14회 · 3종 ▸» — the kind's own icon in front, the fold arrow at the end only (▸ 접힘 · ▾ 펼침).
export function kindHead(k, open) {
  return pressable([{ text: k.icon + ' ', color: k.ink }, { text: k.label, color: k.ink, bold: true },
    { text: ' · ' + k.total + '회 · ' + k.items.length + '종', color: 'sub' }, { text: ' ' + (open ? '▾' : '▸'), color: k.ink }], toolPress(k.kind), k.hotkey)
}

function itemMark(it) {
  if (it.run > 0) return { text: '●', color: 'blue' }
  if (it.ok === true) return { text: '✓', color: 'green' }
  if (it.ok === false) return { text: '✕', color: 'red' }
  return { text: '·', dim: true }
}

// Item line «  ├─ km:search   22:51  ✓  8회» (the block's last = └─): the name, its last time, ✓/✕/●, its count. Short of
// `cols`, the time goes first, then the count, then the mark (봇 3) — the name is never cut; only a name wider than
// the whole line alone is wrapped to its first row (no «…» anywhere). nameW = the name column of the block.
// r3b 3안 pipeline-rail: `heat` = { text, color } (skin.js heatBar) — a share-of-use bar right after the name, kept
// before the time (the time goes first, then the mark): the item still takes one line.
const KEEPS = [['time', 'mark', 'count'], ['mark', 'count'], ['mark'], []]
const KEEPS_HEAT = [['heat', 'time', 'mark', 'count'], ['heat', 'mark', 'count'], ['heat', 'count'], ['mark', 'count'], ['mark'], []]
export function kindItem(it, nameW, cols, last, heat) {
  const lead = { text: '  ' + (last ? '└─ ' : '├─ '), color: 'dim' }
  const name = { text: it.name, color: 'text' }
  const parts = { time: { text: hhmm(it.at), color: 'sub' }, mark: itemMark(it), count: { text: it.n + '회', color: 'bright', bold: true }, ...(heat ? { heat } : {}) }
  const nw = strWidth(it.name)
  for (const keep of heat ? KEEPS_HEAT : KEEPS) {
    for (const w of [Math.max(nw, nameW), nw]) {
      const segs = [lead, name]
      keep.forEach((k, i) => segs.push({ text: ' '.repeat(i === 0 ? w - nw + 2 : 2) }, parts[k]))
      if (segWidth(segs) <= cols) return segs
    }
  }
  return wrapSegments([lead, name], cols, 0)[0]
}

// «  └─ 외 4개 · 접기» under an expanded kind cut short — the same press as its head (folds it back).
export function kindMore(k, hidden) {
  return pressable([{ text: '  └─ ', color: 'dim' }, { text: '외 ' + hidden + '개', color: 'sub' }, { text: ' · 접기', dim: true }], toolPress(k.kind) + '-more')
}

// One line, three pressable cells «s: ✦ skill 14 ▸ · m: ◇ MCP 3 ▸ · p: ◈ plugin 2 ▸» (Fx — only while nothing is
// expanded and the band has under 3 rows for 도구, 봇 ③).
export function toolsCompact(kinds, open) {
  const segs = []
  kinds.forEach((k, i) => {
    if (i) segs.push({ text: ' · ', dim: true })
    segs.push(...pressable([{ text: k.icon + ' ', color: k.ink }, { text: k.label, color: k.ink }, { text: ' ' + k.total, color: 'sub' },
      { text: ' ' + (open.has(k.kind) ? '▾' : '▸'), color: k.ink }], toolPress(k.kind), k.hotkey))
  })
  return segs
}

// The rows 도구 must have: one (Fx) while nothing is expanded; else the three heads and up to 3 items of every expanded
// kind (봇 ③ — the pane yields first, index.js bandKeep).
export function toolsMin(kinds, open) {
  const exp = kinds.filter((k) => open.has(k.kind))
  return exp.length ? kinds.length + exp.reduce((n, k) => n + Math.min(3, k.items.length), 0) : 1
}

// 도구 in `budget` rows, `cols` wide: under 3 rows = the one line (Fx, and an expanded kind's items under it if any row
// is left); else a head per kind and items given out in turn — expanded kinds up to 3 → the others one level at a time
// (1+1 → 1+2 → 1+3, 봇 C · 봇 3) → the rest of the expanded kinds; an expanded kind cut short ends in «외 N개».
// The name column = the longest name drawn that still leaves the time, mark and count their room.
export const ITEM_SHOW = 3
export function toolsBlock(kinds, open, budget, cols, style) {
  const B = Number.isFinite(budget) ? Math.floor(budget) : Infinity
  if (B <= 0 || !kinds.length) return []
  const exp = kinds.filter((k) => open.has(k.kind))
  // r3b: pipeline-rail = each item with its share-of-use bar against its kind's most-called (ranked: the first)
  const rail = style === 'pipeline-rail'
  const kindOf = new Map(kinds.flatMap((k) => k.items.map((it) => [it, k])))
  const heat = (it) => {
    const k = kindOf.get(it)
    return rail && k ? { text: heatBar(it.n, k.items.length ? k.items[0].n : 0), color: k.ink } : null
  }
  // under 3 rows, or an expanded kind's guarantee not met (the pane could not yield): the one line + expanded items
  if (B < kinds.length || (exp.length && B < toolsMin(kinds, open))) {
    const lines = [foldSegments(toolsCompact(kinds, open), cols)]
    for (const k of exp) for (const it of k.items) if (lines.length < B) lines.push(kindItem(it, 0, cols, false, heat(it)))
    return lines
  }
  const give = Object.fromEntries(kinds.map((k) => [k.kind, 0]))
  let left = B - kinds.length
  const take = (k, upto) => { const x = Math.max(0, Math.min(upto - give[k.kind], k.items.length - give[k.kind], left)); give[k.kind] += x; left -= x }
  for (const k of exp) take(k, ITEM_SHOW)
  for (let level = 1; level <= ITEM_SHOW; level++) for (const k of kinds) if (!open.has(k.kind)) take(k, level)
  for (const k of exp) take(k, Infinity)
  const cut = (k) => open.has(k.kind) && give[k.kind] > 0 && give[k.kind] < k.items.length
  const drawn = kinds.flatMap((k) => k.items.slice(0, cut(k) ? give[k.kind] - 1 : give[k.kind]))
  const room = cols - 5 - 2 - 5 - 2 - 1 - 2 - 5 - (rail ? 8 : 0)
  const nameW = Math.max(0, Math.min(room, Math.max(0, ...drawn.map((it) => strWidth(it.name)))))
  const lines = []
  for (const k of kinds) {
    lines.push(foldSegments(kindHead(k, open.has(k.kind)), cols))
    const items = k.items.slice(0, cut(k) ? give[k.kind] - 1 : give[k.kind])
    items.forEach((it, i) => lines.push(kindItem(it, nameW, cols, !cut(k) && i === items.length - 1, heat(it))))
    if (cut(k)) lines.push(kindMore(k, k.items.length - items.length))
  }
  return lines
}
