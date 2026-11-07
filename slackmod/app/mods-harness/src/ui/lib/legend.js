// lane: ui · owner: 봇 — r2 R7b (봇 · 주인 22:14):
// the pane's title line and its legend — the marks the pane draws, in plain
// words, from this one list. tests/review-r7b-legend.test.mjs fails when a mark is drawn, or defined (tree.js LOOK ·
// agents.js AGENT_LOOK · team.js), with no entry here.
// «고정» (engine 2.1.296 · claude-code.d.ts): the pane's title is drawn only as its tab while more than one pane is open
// («with one, no title is drawn» :7407~7408) and the body scrolls as a whole in the engine's window (scroll.bodyRows ·
// :14337~14344 · band.js T4); the pane's own top row is the engine's (only its ✕ there, real capture 22:18). A mod has no
// row outside the body, so these lines lead it: the top of the first screen (scroll 0).
import { strWidth, wrapSegments, RESULT_LOOK } from './text.js'
import { pressable } from './calls.js'
import { LOOK, CURSOR } from './tree.js'
import { TIER_INK } from './memory.js'
import { UP_DOWN, CUR_MARK } from './team.js'

// P3 (주인 10-19 01:47 · 01:49):
// an item = parts [text, look]; a part with a look is drawn in that look's ink — the very constant the pane draws
// the mark from (tree.js LOOK · CURSOR · text.js RESULT_LOOK · memory.js TIER_INK · team.js UP_DOWN), never a color name
// copied here; change the constant and the legend follows. A part without one is the legend's grey. `text` = the parts
// joined: what a terminal without color shows, the words unchanged.
const ink = (color) => ({ color })
function item(kind, group, marks, ...parts) {
  return { kind, group, marks, parts, text: parts.map((p) => p[0]).join('') }
}
const state = (k) => [LOOK[k].glyph, LOOK[k]]

// marks = what the pane draws for it (a glyph, a label word, «+N», «흐림» = a row drawn dim); text = what the legend says;
// kind = its line when the legend takes two (R7c, 봇 ①: 1 = the session states · 2 = the structure and the
// numbers); group = items of one kind side by side (« » between them, « · » between groups when the line has room).
export const LEGEND = [
  item(1, 1, [CURSOR.glyph], [CURSOR.glyph, CURSOR], ['이 창']),
  item(1, 1, [LOOK.busy.glyph], state('busy'), [LOOK.busy.word]),
  item(1, 1, [LOOK.idle.glyph], state('idle'), [LOOK.idle.word]),
  item(1, 1, [LOOK.waiting.glyph], state('waiting'), [LOOK.waiting.word]),
  item(1, 1, [LOOK.stale.glyph], state('stale'), [LOOK.stale.word]),
  // 봇: an open subagent's row is dim too (tree.js faded) — «흐림» itself drawn dim
  item(1, 1, ['흐림'], ['흐림', { dim: true }], ['=서브 줄·끝난 세션']),
  // R7d (부모 R7c 덧붙임 1 ①): ✓ ✕ are drawn by 예약 (jobs.js) and 기억 (memory.js) above as well as TeamClaude below — said
  // here at the top (always on screen) in 예약's and 기억's sense; the TeamClaude part's line says them in its own (R7e)
  item(1, 5, [RESULT_LOOK.ok.glyph], [RESULT_LOOK.ok.glyph, RESULT_LOOK.ok], ['끝']),
  item(1, 5, [RESULT_LOOK.fail.glyph], [RESULT_LOOK.fail.glyph, RESULT_LOOK.fail], ['실패']),
  // P4 (주인 10-19 01:48): a project line draws a bot's own
  // session as «본●» beside its 하위 counts — said with 하위 in one item, so line 2 still fits the 69-cell dock
  item(2, 2, ['본', '하위'], ['본·하위 세션']),
  item(2, 2, ['서브'], ['서브=서브에이전트']),
  item(2, 3, ['▸', '▶'], ['▸펼침']),
  item(2, 3, ['▾', '▼'], ['▾접힘']),
  item(2, 3, ['+N'], ['+N=더있음']), // 봇 (나): «접힌» read like «▾접힘» beside it
  item(2, 4, ['공유', '개별'], ['기억 '], ['공유', ink(TIER_INK.공유)], ['·'], ['개별', ink(TIER_INK.개별)]),
]

// R7c (봇 ②): the TeamClaude marks are not in the top legend — they lead the TeamClaude part (teamLegend), a
// line drawn only while that part is open (index.js teamPart).
export const TC_LEGEND = [
  item(0, 1, [UP_DOWN.up.glyph], [UP_DOWN.up.glyph, UP_DOWN.up], ['켜짐']),
  item(0, 1, [], [UP_DOWN.down.glyph, UP_DOWN.down], ['꺼짐']), // ▼ is in LEGEND already (▾접힘) — on a TeamClaude row it reads 꺼짐, said here
  // R7e (부모 23:0x): ✓ ✕ are in LEGEND too («✓끝 ✕실패», 예약·기억) — on a TeamClaude row they read 정상·오류, said here,
  // the way «▼» is said twice: each part's line says what the mark means in that part
  item(0, 2, [RESULT_LOOK.ok.glyph], [RESULT_LOOK.ok.glyph, RESULT_LOOK.ok], ['정상']),
  item(0, 2, [RESULT_LOOK.fail.glyph], [RESULT_LOOK.fail.glyph, RESULT_LOOK.fail], ['오류']),
  item(0, 3, ['>>'], ['>>'], ['쓰는 계정']), // «>>» = team.js CUR_MARK, two inks — drawn below as CUR_MARK draws it (row)
]

// Marks that carry their own words on screen («❖ 나무» · «◈ 프로젝트» · «◷ 예약» · «◎ 기억» · «◆ TeamClaude» · «▣ <이름>» ·
// «← 돌아가기» · «↻ 다시 읽기» · «↳ w: 바꾸기 …»): a heading or a button's own name, not a state — not repeated here.
export const SELF_LABELED = ['❖', '◈', '◷', '◆', '▣', '←', '↻', '↳', 'ⓘ']

// every mark explained somewhere on the pane: the top legend ∪ the TeamClaude part's legend line (R7c ③)
export const legendMarks = () => new Set([...LEGEND, ...TC_LEGEND].flatMap((x) => x.marks))

// one part of an item: in its look's ink (bold too, as the pane draws it), else the legend's grey · «>>» = CUR_MARK's own
// two segments, as an account row draws it
function partSegs(text, look) {
  if (text === '>>') return CUR_MARK()
  if (!look) return [{ text, color: 'sub' }]
  return [{ text, color: look.color, ...(look.dim ? { dim: true } : {}), ...(look.bold ? { bold: true } : {}) }]
}
const width = (segs) => segs.reduce((a, s) => a + strWidth(s.text), 0)
// items in a row: « » inside a group, « · » between groups (dot = false: « » everywhere — the narrow form)
function row(items, dot) {
  const out = []
  let last = null
  for (const it of items) {
    if (out.length) out.push(dot && it.group !== last ? { text: ' · ', dim: true } : { text: ' ' })
    for (const [text, look] of it.parts) out.push(...partSegs(text, look))
    last = it.group
  }
  return out
}
// whole items in rows of `w` cells, the next row only when the next item does not fit — never an item cut in two
function wrap(items, w) {
  const lines = []
  let cur = []
  for (const it of items) {
    if (cur.length && width(row([...cur, it], false)) > w) {
      lines.push(cur)
      cur = []
    }
    cur.push(it)
  }
  if (cur.length) lines.push(cur)
  return lines.map((l) => row(l, false))
}
// the roomiest form that fits: « · » between groups, then « » only, then wrapped (a width narrower than the 69-cell dock)
const fit = (items, w) => [row(items, true), row(items, false)].find((r) => width(r) <= w) || null

// P2 (주인 10-19 01:47): a thin rule the line's width — over each part of the pane and
// above and under the legend (band.js paneLines · paneHead `rules`); a line, not a mark (the mark scans skip «─»)
export const RULE = '─'
export function ruleLine(cols) {
  return [{ text: RULE.repeat(Math.max(1, cols)), dim: true }]
}

// P1 (주인 10-19 01:47): the title is a band — every letter on the title paint (text.js BAR.title),
// bold, and the row's rest painted the same (the line's `fill`, index.js paneRow). Narrow: «▣ <이름> 현황판» → «▣ <이름>» →
// «▣ 현황판» → «▣» — the first that fits, never cut.
function titleSegs(name, w) {
  const n = name || 'mod-for-slack'
  const tries = ['▣ ' + n + ' 현황판', '▣ ' + n, '▣ 현황판', '▣']
  const t = tries.find((x) => strWidth(x) <= w) || '▣'
  return [{ text: '▣', bar: 'title', bold: true }, ...(t.length > 1 ? [{ text: t.slice(1), bar: 'title', bold: true }] : [])]
}

// 11-08 «이게 뭔가» (owner 11-07: the pane says too little of what it is — the Claude Code mod it runs on and the system
// on top of it, each said apart): `about` = { text: settings.js aboutText (null = no line), open } → the lines right under
// the title. Folded = one row «ⓘ 이게 뭔가 ▸ · <summary>» (the summary left out when the row has no room for it — the
// title's way: shorter, never cut). Opened = «ⓘ 이게 뭔가 ▾», then «Claude Code mod · <ccmod>» and «<name> · <system>»,
// each wrapped in the pane (text.js wrapSegments — never cut). The whole of it one press (i · click) — save a line with
// nothing to open (no ccmod and no system): no arrow, no press. The mark: ⓘ («info» — the band's «m: ◇ MCP» has ◇ already).
// Each layer's text is one `atom` (text.js itemsOf): a « · » inside the prose is not a place to break the row.
export const ABOUT_PRESS = 'mh-about'
export const ABOUT_KEY = 'i'
export const MOD_LABEL = 'Claude Code mod'
export const ABOUT_MARK = 'ⓘ'
function aboutLines(name, about, w) {
  const t = about && about.text
  if (!t) return []
  const more = Boolean(t.ccmod || t.system)
  const open = more && about.open === true
  const head = [{ text: ABOUT_MARK + ' 이게 뭔가', color: 'cyan', bold: true }, ...(more ? [{ text: open ? ' ▾' : ' ▸', color: 'cyan' }] : [])]
  const sum = t.summary && !open ? [{ text: ' · ' + t.summary, color: 'sub' }] : []
  const lead = (segs) => (more ? pressable(segs, ABOUT_PRESS, ABOUT_KEY) : segs)
  const folded = [lead([...head, ...sum]), lead(head)].find((s) => strWidth(s.map((x) => x.text).join('')) <= w)
  const rows = [{ key: 'about', segs: folded || wrapSegments(lead(head), w, 2)[0] }]
  if (!open) return rows
  // the 2-cell lead is put on after wrapping: inside one atom item it opened a fresh row, and wrapSegments drops a fresh
  // row's leading spaces (real capture 11-08: the «Claude Code mod» row came out flush left once its text wrapped)
  const pad = w > 8 ? 2 : 0
  const layer = (key, label, text) => {
    if (!text) return
    wrapSegments([{ text: label, color: 'bright', bold: true }, { text: ' · ' + text, atom: true }], w - pad, 2).forEach((segs, n) =>
      rows.push({ key: 'about-' + key + (n ? ':' + n : ''), segs: [...(pad ? [{ text: ' '.repeat(pad) }] : []), ...segs].map((s) => ({ ...s, press: ABOUT_PRESS })) }))
  }
  layer('mod', MOD_LABEL, t.ccmod)
  layer('system', name || 'mod-for-slack', t.system)
  return rows
}

// Title (1 line) + legend in `cols` cells: one line when it all fits (164 cells), else one line per kind — states, then
// structure and numbers (84 · 74 · the 71-cell dock's 69: 2 lines, R7c ①); a kind wider than its line wraps by whole items.
// P2: the rules over and under the legend are the pane body's (band.js paneLines rule-head · rule-tree, index.js paneOf).
// 11-08: `about` (optional) = the «이게 뭔가» lines, between the title and the legend (aboutLines) · left out = as before.
export function paneHead(name, cols, about) {
  const w = Math.max(1, cols)
  const title = titleSegs(name, w)
  const what = aboutLines(name, about, w)
  const one = fit(LEGEND, w)
  const lines = one ? [one] : [1, 2].flatMap((k) => {
    const items = LEGEND.filter((it) => it.kind === k)
    const r = fit(items, w)
    return r ? [r] : wrap(items, w)
  })
  return [{ key: 'title', segs: title, fill: 'title' }, ...what, ...lines.map((segs, i) => ({ key: 'legend-' + i, segs }))]
}

// The TeamClaude part's legend line (R7c ②): «표지» then the marks, within `cols` — narrow: whole items off the end (never an
// item cut in two), the «표지» label only while it has room.
export function teamLegend(cols) {
  const w = Math.max(1, cols)
  const lead = [{ text: '표지 ', dim: true }]
  for (const items of TC_LEGEND.map((_, i) => TC_LEGEND.slice(0, TC_LEGEND.length - i))) {
    const r = fit(items, w)
    if (r && width(lead) + width(r) <= w) return [...lead, ...r]
    if (r) return r
  }
  return []
}
