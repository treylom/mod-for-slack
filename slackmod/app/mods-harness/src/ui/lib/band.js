// lane: ui · owner: 봇 — pure 띠·칸 composition (no `$`).
// 띠(입력칸 위) — 봇 v1 ③④ · 설계 메모:
//   칸이 없거나 inline = 5줄 ▣ 시스템 → ❖ 나무 → ▸ 도구 → ◎ 기억 → ◷ 예약 · 줄이 모자라면 아래부터 뺌 (inline 칸이 열려
//   4줄이면 예약이 빠짐 — 예약은 칸에 있음).
//   칸이 오른쪽에 붙음(dock) = ▣ + (띠 폭 80칸 이상) 도구 ⋮ 기억 좌우 2단 3줄 / (79칸 이하) ▸ 도구 1줄 + ◎ 기억 1줄.
// 칸(/mh) = ❖ 나무 → ◈ 프로젝트별 봇 현황 → ─ → ◆ TeamClaude → ─ → ◷ 예약 (paneLines · 줄이 모자라면 ─ 부터 뺌).
//   ▣ 시스템·기억은 띠가 늘 보여 주므로 칸에서 뺌. inline 칸은 띠 4줄 몫을 남기는 높이로 엶 (inlineRows · v1.1 3번).
// 끝 자르기 없음 (봇 v2 5번 «크기 상관없이 잘리지 않게»): no line ends in «…» at any width. A pane line
//   longer than the pane wraps onto the next rows (text.js wrapSegments); a band line has one row, so whole items are
//   left out from its end and counted « +N» (foldSegments). The TeamClaude block fits itself (team.js).
import { foldSegments, wrapSegments, segWidth, strWidth, modelColor, modelShown } from './text.js'
import { LOOK } from './tree.js'
import { headerSegments, jobSegments, counts, problemSegments, ownRows, jobDetail, jobId, JOB_PRESS } from './jobs.js'
import { pressable, toolsBlock, toolsMin } from './calls.js'
import { botShown } from './display.js'
import { unhex } from './project.js'
import { ruleLine, ABOUT_PRESS } from './legend.js'
import { pill, pillSegments } from './skin.js'
import { MODEL_PRESS, MODEL_CHOICES, EFFORTS, pickPress, cellOf } from './modelpick.js'

export const DEFAULT_SYSTEM_NAME = 'mod-for-slack'
export const BAND_ROWS = 5

// 봇 10-17: config `ui.system_name`, 비면 «mods-harness» — 다른 이름을 지어 넣지 않음.
export function systemName(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_SYSTEM_NAME
}

// 10-19 J1: the one shape (text.js modelShown) — kept under its old name for the callers that import it
export function shortModel(m) {
  return modelShown(m)
}

// «▣ mods-harness · bot · opus·1M:max · ● 작업 중» (설계 메모 띠 1줄: ▣ 209 bold · 이름 231 bold · 봇 80 · 모델 계열색 ·
// 상태 기호+말 상태색).
export function systemSegments(s) {
  const look = LOOK[s.state] || LOOK.idle
  const segs = [{ text: '▣ ', color: 'divider', bold: true }, { text: s.name, color: 'bright', bold: true }, { text: ' · ' }, { text: botShown(s.bot) || '?', color: 'cyan' }]
  const cell = modelCell(s)
  if (cell) segs.push({ text: ' · ' }, ...cell)
  segs.push({ text: ' · ' }, { text: look.glyph + ' ' + look.word, color: look.color, dim: look.dim })
  return segs
}

// 10-20 모델 칸 (설계 메모 11줄): the ▣ line's model is a press of its own (MODEL_PRESS — the picker under ▣, modelpick.js).
// s.next = what the main loop's next request goes with while it differs from what is drawn → «opus·1M:max → 다음 요청부터
// haiku:high» · s.picked = a pick went out with the last one → «haiku:high (고름)». No model known = no cell (as before).
// 10-20 (봇): s.fb = the last request went on the engine's fallback model, the pick skipped for the rest of
// that turn → «sonnet:max (대체 중)», nothing pending shown (the turn's next requests go on the fallback too) · s.note =
// the person's /model or /effort let the pick go → « 풀림(/model)» after the cell, once (until the next request).
// `cut` marks what a narrow line gives up before the cell itself (sysLine): 'words' first, then every `cut` piece.
function modelCell(s) {
  const model = shortModel(s.model)
  if (!model) return null
  const out = [{ text: s.effort ? model + ':' + s.effort : model, color: modelColor(model), press: MODEL_PRESS }]
  const next = s.next ? cellOf(s.next) : null
  if (s.fb) out.push({ text: ' (대체 중)', color: 'amber', press: MODEL_PRESS, cut: 'tail' })
  else if (next) out.push({ text: ' → 다음 요청부터 ', color: 'sub', press: MODEL_PRESS, cut: 'words' }, { text: next, color: modelColor(next), bold: true, press: MODEL_PRESS, cut: 'tail' })
  else if (s.picked) out.push({ text: ' (고름)', color: 'sub', press: MODEL_PRESS, cut: 'tail' })
  if (s.note) out.push({ text: ' 풀림(' + s.note + ')', color: 'amber', press: MODEL_PRESS, cut: 'tail' })
  return out
}

// The ▣ line folded into `cols` (text.js foldSegments: whole items from the end). Each piece is ▣'s press but the model
// cell's own. 10-20 (measured: a pending «→ 다음 요청부터 haiku:high» is 27 cells more, and from 60 cells down the whole
// cell folded away — the picker's only way in): when the cell would go, «→ 다음 요청부터» shortens to «→», then the
// pending part goes — the cell stays wherever it stays with nothing picked.
function sysLine(system, cols) {
  const segs = (system || []).map((s) => (s.press ? s : { ...s, press: PANE_PRESS }))
  const has = (line) => line.some((s) => s.press === MODEL_PRESS)
  const line = foldSegments(segs, cols)
  if (has(line) || !has(segs)) return line
  const short = foldSegments(segs.map((s) => (s.cut === 'words' ? { ...s, text: ' → ' } : s)), cols)
  return has(short) ? short : foldSegments(segs.filter((s) => !s.cut), cols)
}

// r3b 4안 cockpit-pill: the same ▣ line as capsules «▐ ▣ mods-harness ▌▐ bot · opus-5-5[1m]:max ▌▐ ● 작업 중 ▌», and
// the account in use «▐ ◆#2 잔100% ▌» when s.acct = { p, rest } (rest = what is left of its 5h window, a whole percent;
// null = not known, the capsule left out). Each capsule's marks in its first piece's ink.
export function systemPills(s) {
  const look = LOOK[s.state] || LOOK.idle
  const who = [{ text: botShown(s.bot) || '?', color: 'cyan' }]
  const cell = modelCell(s)
  if (cell) who.push({ text: ' · ' }, ...cell)
  const groups = [[{ text: '▣ ', color: 'divider', bold: true }, { text: s.name, color: 'bright', bold: true }], who,
    [{ text: look.glyph + ' ' + look.word, color: look.color, dim: look.dim }]]
  const a = s.acct
  if (a && Number.isFinite(a.p) && Number.isFinite(a.rest)) groups.push([{ text: '◆#' + a.p + ' 잔' + Math.max(0, Math.min(100, Math.round(a.rest))) + '%', color: 'cyan' }])
  return pillSegments(groups)
}

// Rows a drawn tree takes (an estimate for other mods' part of the band — 봇 10-17: the band shrinks to the rows
// actually left). Text = 1 row · column Box = sum · row Box = tallest child · core's own drawing (engine ref) = 0.
export function rowsOf(el) {
  if (el === null || el === undefined || el === false || el === '') return 0
  if (typeof el === 'string') return 1
  if (Array.isArray(el)) return el.reduce((n, c) => n + rowsOf(c), 0)
  if (typeof el !== 'object' || el.type === 'engine') return 0
  if (el.type !== 'Box') return 1 // Text, Button, Input, Link …: one row each
  const props = el.props || {}
  const kids = el.children !== undefined ? el.children : props.children
  const list = kids === undefined || kids === null ? [] : Array.isArray(kids) ? kids : [kids]
  const dir = props.flexDirection || 'row'
  if (dir === 'column' || dir === 'column-reverse') return list.reduce((n, c) => n + rowsOf(c), 0)
  return list.reduce((m, c) => Math.max(m, rowsOf(c)), 0)
}

// Two columns in one line each: left folded into its half and padded, « ⋮ », right folded into the rest (41번 P3).
export function splitRows(left, right, cols) {
  const lw = Math.max(1, Math.floor((cols - 3) / 2))
  const rw = Math.max(1, cols - 3 - lw)
  const n = Math.max((left || []).length, (right || []).length)
  const out = []
  for (let i = 0; i < n; i++) {
    const l = foldSegments((left && left[i]) || [], lw)
    const pad = lw - segWidth(l)
    out.push([...l, ...(pad > 0 ? [{ text: ' '.repeat(pad) }] : []), { text: ' ⋮ ', dim: true }, ...foldSegments((right && right[i]) || [], rw)])
  }
  return out
}

// 설계 메모 · 봇 v1.1 3번 (91칸 캡처: 칸이 inline 일 때 띠가 ▣·나무 2줄뿐): in fullscreen the bottom slot (half
// the terminal, the prompt included) is shared, and an inline pane takes its rows first — a third of the terminal when
// no height is asked. So /mh asks for one: the band's room before the pane sat (`room`), less the frame's 2 rows and
// the band's 4 lines (▣ 나무 도구 기억); never more than that default third, at least 3. Off fullscreen (main screen:
// the band may take the terminal's height) nothing is asked (undefined). A request, not a grant: a size the person
// dragged the block to wins, and a prompt that grows to several lines takes rows again.
// v3 (봇 ③ · 봇 1): `keep` = the band's rows to leave (bandKeep: 4 while no 도구 kind is expanded, more while one
// is — «펼친 종류 머리 1 + 3줄 보장 · 칸이 먼저 양보»).
export const BAND_KEEP = 4
export function inlineRows(view, room, keep) {
  if (!view || view.isFullscreen !== true || !Number.isFinite(room)) return undefined
  const k = Number.isFinite(keep) ? keep : BAND_KEEP
  const third = Number.isFinite(view.rows) && view.rows > 0 ? Math.floor(view.rows / 3) - 2 : Infinity
  return Math.max(3, Math.floor(Math.min(third, room - 2 - k)))
}

// The band's least rows: ▣ + ❖ + ◎ + 도구's least (toolsMin) — 4 while nothing is expanded.
export function bandKeep(kinds, open) {
  return 3 + toolsMin(kinds || [], open || new Set())
}

// A pane that went inline by itself — the window narrowed under a docked pane — took the host's default height and
// left the band one line (measured 10-17 20:5x at 91 and 74 columns, after 160 → 110 → 91): the height to ask for
// then, so the band gets its 4 lines back (null = nothing to ask). Asked once per window size by the caller; a height
// the person dragged or keyed still wins (host rule).
export function reaskRows(pane, paneRows, left, keep) {
  const k = Number.isFinite(keep) ? keep : BAND_KEEP
  if (!pane || !pane.placed || pane.placement !== 'inline' || !Number.isFinite(paneRows) || !Number.isFinite(left)) return null
  if (left >= k) return null
  const rows = Math.max(3, Math.floor(paneRows - (k - left)))
  return rows < paneRows ? rows : null
}

// 단축키 줄 (봇 v2 1번 «사용 가능한 단축키가 아래» · 설계 메모): the line under the prompt. Only keys that work
// (installed key table, Pane context + measured in a copy 10-17: ctrl+x ← moved the dock edge 119 → 111). Items in the
// spec's order of use; past `cols` the last ones are left out whole, never cut. The first item says how to open the
// pane, or how to close it while it is up. Our idle line takes the place of the engine's hint text («(shift+tab to
// cycle) · ← for agents», captured 10-17), so its two keys stay in it (⇧⇥ 모드 · ← 에이전트 last).
// `short` = the tail added to the engine's line while a turn runs or text is typed (its «esc to interrupt» must stay).
// r2 E (10-18 19:4x, engine 2.1.296 key table: Chat «ctrl+x tab» = abovePrompt:focus — the band, not the pane; measured
// in a copy: the chord rings ▣·s·m·p only, a click leaves the keys in the composer): the pane takes the keys from /mh
// alone ($.ui.open focus, granted over an empty composer), so the open pane's line names /mh, never the chord. The keys
// after it are the Pane context's (they work once the pane holds the keys).
export const HINT_HEAD = '▸ '
export const HINT_ITEMS = ['ctrl+x ←→ 폭 조절', 'ctrl+x ↑↓ 높이', '↑↓ PgUp/Dn 스크롤', 'ctrl+x x 칸 닫기', 'esc 돌아오기',
  '/mh 예약 타봇', '/mh 프로젝트 상세', '⇧⇥ 모드', '? 도움말', '← 에이전트']
export const HINT_SHORT = ['/mh 칸', 'ctrl+x ←→ 폭']
export function hintItems(open) {
  return open ? ['/mh off 닫기', '/mh 칸으로', ...HINT_ITEMS] : ['/mh 칸 열기', ...HINT_ITEMS]
}
export function hintText(cols, short, open) {
  const items = short ? HINT_SHORT : hintItems(open)
  const head = short ? '' : HINT_HEAD
  let out = ''
  for (const it of items) {
    const next = out ? out + ' · ' + it : head + it
    if (strWidth(next) > cols) break
    out = next
  }
  return out
}

// The engine's mode pill («⏵⏵ auto mode on», widest «⏵⏵ bypass permissions on» = 24 cells, then « · ») stays at the
// line's start whatever the hook draws, and its text is not in the props — so room for the widest is kept. Measured
// 10-17 20:5x: a line sized to the viewport alone was cut by the engine with «…» at 91 and 74 columns.
export const PILL_ROOM = 27
// What the PromptHint hook hands back: { hint } at rest (our line in the hint's place), { tail } while a turn runs or
// text is typed (the engine's line kept), null = leave the line as it is. `viewCols` = the event's viewport columns ·
// `open` = the pane is up (item 1 says how to close it).
// r3b 4안 cockpit-pill (`pills` = { look: { glyph, word } } of this session's state): the same items, each a capsule
// «▐ /mh 칸 열기 ▌», the line led by the state's «▐ ○ 쉼 ▌» — whole capsules only, within the same room.
export function hintPlan(props, viewCols, open, pills) {
  const p = props || {}
  const cols = (Number.isFinite(viewCols) && viewCols > 0 ? viewCols : 80) - 4 - PILL_ROOM
  if (p.isDraft || p.isWorking) {
    const room = cols - strWidth(typeof p.hint === 'string' ? p.hint : '') - 3
    const tail = room >= 6 ? (pills ? pillText(room, HINT_SHORT, null) : hintText(room, true)) : ''
    return tail ? { tail } : null
  }
  const hint = cols > 0 ? (pills ? pillText(cols, hintItems(Boolean(open)), pills.look) : hintText(cols, false, Boolean(open))) : ''
  return hint ? { hint } : null
}

function pillText(cols, items, look) {
  let out = look && look.word ? pill(look.glyph + ' ' + look.word) : ''
  if (strWidth(out) > cols) out = ''
  for (const it of items) {
    const next = out + pill(it)
    if (strWidth(next) > cols) break
    out = next
  }
  return out
}

// 띠 줄들. parts.dock = the pane sits docked on the right: ▣ + 도구 ⋮ 기억 rows when the band is 80+ cells wide (설계 메모
// 3순위: a half under 40 cells squeezes the 한글 items), else ▣ + ▸ 도구 + ◎ 기억 one line each; not docked = ▣ ❖ ▸ ◎ ◷.
// Rows = min(lines, maxRows), the top ones kept (설계 메모 5순위: 아래 줄부터 뺌).
// v3 (봇 A·C · ③): 도구 = toolsBlock (종류마다 머리 + 주요 3, 줄이 모자라면 1+2 → 1+1 → 1+0 → 한 줄).
// Not docked: ▣ ❖ 도구 ◎ ◷ (◷ only while the pane is closed — it is in the pane). Short of rows, 도구's least
// (toolsMin) is kept before ◷, then ◎, then ❖ (an expanded kind's 3 rows outrank them). Docked, 80+ cells: ▣ + 도구 ⋮
// ◎ 기억 3줄. Docked, narrower: ▣ 도구 ◎. The ▣ line is pressable (= /mh · /mh off) but for its model cell (10-20: the
// model picker, its own press). parts = { dock, paneOpen, system, tree, memory, memoryRows, cron, tools: { kinds, open },
// picker } — picker = the model picker's rows while it is open (modelpick.js pickerRows), else null.
export const SPLIT_MIN = 80
export const PANE_PRESS = 'mh-pane'
export function bandLines(parts, maxRows, cols) {
  const R = Number.isFinite(maxRows) ? Math.max(1, Math.floor(maxRows)) : Infinity
  // 10-20 모델 칸: the picker's rows (modelpick.js pickerRows, already fitted to `cols`) go right under ▣ and outrank the
  // rest — the band below them is the band as before with what rows are left, cut from its bottom as before
  const picker = Array.isArray(parts.picker) ? parts.picker : []
  if (picker.length) {
    const rest = bandLines({ ...parts, picker: null }, Math.max(1, R - picker.length), cols)
    return [rest[0], ...picker, ...rest.slice(1)].slice(0, R)
  }
  const T = parts.tools && Array.isArray(parts.tools.kinds) ? parts.tools : { kinds: [], open: new Set() }
  const sys = sysLine(parts.system, cols)
  if (R <= 1) return [sys]
  if (parts.dock && cols >= SPLIT_MIN) {
    const lw = Math.max(1, Math.floor((cols - 3) / 2))
    const left = toolsBlock(T.kinds, T.open, R - 1, lw, T.style)
    const right = parts.memoryRows || []
    const n = Math.min(R - 1, Math.max(left.length, right.length))
    return [sys, ...splitRows(left.slice(0, n), right.slice(0, n), cols)]
  }
  const keep = { tree: !parts.dock, memory: true, cron: !parts.dock && !parts.paneOpen }
  let fixed = 1 + (keep.tree ? 1 : 0) + 1 + (keep.cron ? 1 : 0)
  const need = toolsMin(T.kinds, T.open)
  // an expanded kind's head + 3 outrank ◷, then ◎, then ❖ (봇 ③); with nothing expanded the old order holds
  if (T.kinds.some((k) => T.open.has(k.kind))) {
    for (const k of ['cron', 'memory', 'tree']) {
      if (R - fixed >= need) break
      if (keep[k]) { keep[k] = false; fixed -= 1 }
    }
  }
  const line = (segs) => foldSegments(segs || [], cols)
  const tree = keep.tree ? [line(parts.tree)] : []
  const tail = [...(keep.memory ? [line(parts.memory)] : []), ...(keep.cron ? [line(parts.cron)] : [])]
  // short of a row for 도구 itself: cut from the bottom as before (▣ ❖ 도구 ◎ ◷ · 설계 메모 5순위)
  const B = R - fixed
  const tools = B >= 1 ? toolsBlock(T.kinds, T.open, B, cols, T.style) : toolsBlock(T.kinds, T.open, 1, cols, T.style)
  return [sys, ...tree, ...tools, ...tail].slice(0, R)
}

// The action a pressed element stands for (v3 D · 봇 ①②): Button keys are the
// press key, then «@<line key>» on pane lines (and «:N» on a wrapped line's next rows). null = not ours.
export function actionOf(key) {
  const k = String(key || '').split('@')[0].replace(/:\d+$/, '')
  if (k === PANE_PRESS) return { type: 'pane' }
  // 10-20 모델 칸: the cell = the picker open/shut · a choice by its place in MODEL_CHOICES · an effort word · 원래대로 · 닫기
  if (k === MODEL_PRESS) return { type: 'model' }
  let p = /^mh-mdl-m(\d+)$/.exec(k)
  if (p) return MODEL_CHOICES[Number(p[1])] ? { type: 'mpick', model: MODEL_CHOICES[Number(p[1])].id } : null
  p = /^mh-mdl-e([a-z]+)$/.exec(k)
  if (p) return EFFORTS.includes(p[1]) ? { type: 'epick', effort: p[1] } : null
  if (k === pickPress.reset) return { type: 'mreset' }
  if (k === pickPress.close) return { type: 'mclose' }
  let m = /^mh-tool-(skill|mcp|plugin)(-more)?$/.exec(k)
  if (m) return { type: 'tool', kind: m[1] }
  if (k === 'mh-cron') return { type: 'cron' }
  if (k === ABOUT_PRESS) return { type: 'about' } // 11-08 «ⓘ 이게 뭔가» (legend.js aboutLines)
  if (k === 'mh-proj') return { type: 'proj' }
  // 10-20 패널 ✕ (project.js PCLOSE_*): a project's ✕ · its confirm's 닫기 · 취소 («ok» / «no» are not hex: never a name)
  m = /^mh-pclose-ok-((?:[0-9a-f]{2})+)$/.exec(k)
  if (m) {
    const project = unhex(m[1])
    if (project !== null) return { type: 'pcloseOk', project }
  }
  m = /^mh-pclose-((?:[0-9a-f]{2})+)$/.exec(k)
  if (m) {
    const project = unhex(m[1])
    if (project !== null) return { type: 'pclose', project }
  }
  if (k === 'mh-pclose-no') return { type: 'pcloseNo' }
  // 10-19 I1: one project line (its name in hex · «-» = the no-project line)
  m = /^mh-proj-((?:[0-9a-f]{2})+)$/.exec(k)
  if (m) {
    const project = unhex(m[1])
    if (project !== null) return { type: 'projOne', project }
  }
  if (k === 'mh-own') return { type: 'own' }
  // 10-24 (B): one 예약 line (jobs.js JOB_PRESS — its 8-hex jobId) = that job's detail open / shut
  m = /^mh-job-([0-9a-f]{8})$/.exec(k)
  if (m) return { type: 'job', id: m[1] }
  if (k === 'mh-fold') return { type: 'fold' }
  if (k === 'mh-others') return { type: 'others' }
  if (k === LOWER_PRESS) return { type: 'lower' }
  if (k === BACK_PRESS) return { type: 'back' }
  // r2 B: a bot row's fold mark · the rest of a session row (tree.js KIDS_PRESS · GO_PRESS — registry ids [a-z0-9-])
  m = /^mh-kids-([a-z0-9-]+)$/.exec(k)
  if (m) return { type: 'kids', id: m[1] }
  m = /^mh-go-([a-z0-9-]+)$/.exec(k)
  if (m) return { type: 'go', id: m[1] }
  m = /^mh-tc-(all|claude|codex|grok|cursor|gemini)$/.exec(k)
  if (m) return { type: 'team', section: m[1] }
  // r3a (57 대조표 1~7): an account row = select it · a word of its action line · ↻ 다시 읽기. Ids = [a-z0-9]+ (accounts.js),
  // so «acct-» / «act-<word>-» never read as one another or as a section above.
  m = /^mh-tc-acct-([a-z0-9]+)$/.exec(k)
  if (m) return { type: 'tcsel', id: m[1] }
  m = /^mh-tc-act-(switch|toggle|up|down|auto|del|delok|cancel)-([a-z0-9]+)$/.exec(k)
  if (m) return { type: 'tcact', act: m[1], id: m[2] }
  if (k === 'mh-tc-reload') return { type: 'tcreload' }
  m = /^mh-bot-(.+)$/.exec(k)
  if (m) return { type: 'bot', bot: m[1] }
  return null
}

// Lines each block of the pane gets inside `budget`, step by step (기둥 ③ 실측 10-17: a 14-row pane cut off the
// expanded group and the 기억 line). First one line each (team claude 3, its smallest whole form), so no block vanishes
// without its «외 N» line; then the tree up to 3 rows, team claude in full, the projects, this bot's 예약 up to 3, an
// expanded group's jobs, the rest of the tree, the folded group headers. need/give = { tree, proj, team, own, jobs,
// folded } line counts (a key left out of `need` gets nothing).
// r2 (owner 15:41 · 봇): one line a block
// first, then the tree whole, TeamClaude, the projects, and the 예약 last (folded to one line unless pressed open).
// r2 B (봇 ①): the rows kept
// longest = this session's tree, then TeamClaude, then the other bots' rows, the projects, the 예약 — so a short pane
// gives up 예약 first and this session's tree last. The same with a TeamClaude section pressed open (v3 r2 put team claude
// before the tree then; i0: the tree fell to «+ 외 3세션»): STEPS_TEAM_OPEN is kept by name and is now the same order.
// 10-24 (B · 주인 10-24): an opened 예약 line's detail ('detail') comes right after this session's
// tree whole — before TeamClaude (drawn whole and scrolled anyway), the other bots, the projects — so a short pane shows
// what was pressed open; the opened line itself is one of the 'own' lines (jobs.js ownRows keeps it).
const STEPS = [['tree', 1], ['others', 1], ['team', 1], ['proj', 1], ['own', 1], ['jobs', 1], ['folded', 1], ['tree', Infinity],
  ['detail', Infinity], ['team', Infinity], ['others', Infinity], ['proj', Infinity], ['own', 3], ['jobs', Infinity], ['own', Infinity], ['folded', Infinity]]
export const STEPS_TEAM_OPEN = STEPS
export function allot(need, budget, steps) {
  const give = Object.fromEntries(Object.keys(need).map((k) => [k, 0]))
  if (!Number.isFinite(budget)) return { ...need }
  let left = Math.max(0, Math.floor(budget))
  for (const [k, upto] of steps || STEPS) {
    if (!(k in need)) continue
    const x = Math.max(0, Math.min(Math.min(upto, need[k]) - give[k], left))
    give[k] += x
    left -= x
  }
  return give
}

// `items` in `lines` lines: all of them when they fit, else the first lines-1 and one «외 N» line for the rest.
function emit(items, lines, each, more) {
  if (lines >= items.length) return items.forEach(each)
  if (lines <= 0) return
  items.slice(0, lines - 1).forEach(each)
  more(items.slice(lines - 1))
}

function treeMore(rows) {
  const stale = rows.filter((r) => r.state === 'stale').length
  // r2: thread lines and subagent rows ride with their session — only sessions are counted, subagents after them
  const sessions = rows.filter((r) => !r.kind || r.kind === 'session').length
  // R7a (봇 (나)): a folded «서브 N ▸» line taken in counts its N (it counted 0 — the number read smaller)
  const agents = rows.reduce((n, r) => n + (r.kind === 'agent' ? 1 : r.kind === 'subs' && Number.isFinite(r.n) ? r.n : 0), 0)
  const segs = [{ text: '  + 외 ' + sessions + '세션' + (agents ? ' · 서브 ' + agents : ''), dim: true }]
  if (stale > 0) segs.push({ text: ' · ' }, { text: LOOK.stale.word + ' ' + stale, color: LOOK.stale.color })
  return segs
}

// 10-20 R6 (주인 12:27 · 봇 하위 세션): only named projects are counted — the no-project line (project «-») is
// no project, as the ◈ head's «N개» counts them (a 60-cell pane said «◈ … 6개» over «+ 외 7개 프로젝트» at 12:3x)
// (only the no-project line left out = «+ 외 1줄», never «외 0개 프로젝트»)
function projMore(items) {
  const named = items.filter((it) => it.project && it.project !== '-').length
  return [{ text: named ? '  + 외 ' + named + '개 프로젝트' : '  + 외 ' + items.filter((it) => it.project).length + '줄', dim: true }]
}

function jobsMore(jobs) {
  return [{ text: '  + 외 ' + jobs.length + '개', dim: true }, ...problemSegments(counts(jobs))]
}

// «▶ 외 3묶음 · ✕ 실패 1 · 안 실림 2 · bot·bot·bot» — counts before names, so a narrow pane keeps the counts.
// `after` = some groups were shown above it («외»); else it stands for all of them.
function groupsMore(groups, after) {
  const c = { failed: 0, notLoaded: 0, off: 0, unknown: 0 }
  for (const g of groups) for (const k of Object.keys(c)) c[k] += g[k] || 0
  return [{ text: '▶ ', color: 'amber' }, { text: (after ? '외 ' : '') + groups.length + '묶음' }, ...problemSegments(c), { text: ' · ' + groups.map((g) => botShown(g.bot)).join('·'), dim: true }]
}

// 다른 봇 예약 묶음 («/mh 예약» 전체 보기 · 봇 v1.1 4번 · 봇 검수: 넓은 창에서도 접어 둠): the groups with a
// failure or a job not loaded, at most FOLD_SHOW of them (most failures first, buildGroups order), one header line
// each, then one «▶ 외 N묶음» line for all the rest. Short of `lines`, the last shown ones join that line.
// v3 (봇 ②): «▶ 외 N묶음» is pressable — open = every group's head line, then one «▲ N묶음 접기» line
// (the same press folds them back). Screen state of this session only.
export const FOLD_SHOW = 3
function foldPlan(groups, open) {
  if (open && groups.length) return { shown: groups, others: [], less: true }
  const shown = groups.filter((g) => g.failed > 0 || g.notLoaded > 0).slice(0, FOLD_SHOW)
  return { shown, others: groups.filter((g) => !shown.includes(g)), less: false }
}

function foldGroups(plan, lines, push) {
  if (lines <= 0) return
  const extra = plan.less ? 1 : 0
  const room = (plan.others.length ? lines - 1 : lines) - extra
  const k = plan.shown.length <= room ? plan.shown.length : Math.max(0, lines - 1 - extra)
  plan.shown.slice(0, k).forEach((g) => push('grp-' + g.bot, headerSegments(g, false), undefined, undefined, 'mh-bot-' + g.bot))
  const rest = [...plan.shown.slice(k), ...plan.others]
  if (rest.length) push('grp:more', groupsMore(rest, k > 0), undefined, undefined, 'mh-fold')
  if (plan.less && lines > k + (rest.length ? 1 : 0)) push('grp:less', [{ text: '▲ ', color: 'amber' }, { text: plan.shown.length + '묶음 접기', dim: true }], undefined, undefined, 'mh-fold')
}


// A wrapped pane line goes on this many cells in (past a row's glyph) unless its block gives its own (tree rows: under
// the name).
export const WRAP_INDENT = 4

// 칸 줄들 [{ key, segs, mark? }] in the order ❖ 나무 머리줄 → 나무 → ◈ 프로젝트 머리 → 프로젝트 줄(펼침 = 그 밑 상세) →
// ─ → ◆ TeamClaude → ─ → ◷ 예약 머리 → 이 봇 예약 ≤3 → «/mh <봇>» 으로 펼친 묶음 → («/mh 예약») 다른 봇 묶음 머리 ≤3 →
// «▶ 외 N묶음» (설계 메모 · 봇 v1 ① · v1.1 4번). `mark` = the color of the ║ in front of a block's head line (설계 메모).
// parts = { treeHead, treeRows, projHead, projRows: [{ key, segs, indent?, project? }], team: (rows) => lines (fits
// itself: every line ≤ cols, at most `rows` lines), cron: { head, shown, rest, open, others } } · `maxRows` = rows the
// pane has (Pane props scroll.bodyRows; not given = no limit). A line wider than `cols` wraps onto the rows under it
// (keys «<key>:1», «:2» …), never cut. Short of rows, the two rules go first (they say nothing — a 9-row inline pane,
// 91칸 v1.1 3번), then blocks shrink per allot() and hidden lines become one «외 N» line each. allot counts lines while
// a wrapped one takes more rows, so the share is tried from the largest down, one line at a time, and the first that
// fits is drawn (a share cut by the whole overflow at once skipped from «all 4 sessions» to «none» — measured 10-17).
// «…:more» / «…:N» keys cannot clash with registry ids ([a-z0-9-]) or bot names behind «grp-».
// P2 (주인 10-19 01:47): parts.rules = a thin rule over each part —
// rule-tree (under the legend) · rule-others · rule-proj · rule-cron · rule-lower — and, with parts.headRule, «rule-head»
// first (index.js puts it between the title and the legend). They take no share of the rows: the pane is fitted as before
// and the rules are put into that very drawing (withRules) — no line of it is given up for them. They cost the spare rows
// between the two parts, then the open TeamClaude part's tail (drawn whole, it scrolls — T4); a block head the first screen
// showed must stay on it, and a pane with no scrolling part must stay one screen — else no rule at all, the pane as before
// (a short pane keeps every head). All or none.
export const isHead = (key) => key === 'back' || /-head$/.test(key)
export function paneLines(parts, cols, maxRows) {
  const ruleKeys = parts.rules === true ? [...(parts.headRule ? ['head'] : []), 'tree', ...(parts.othersHead ? ['others'] : []),
    ...(parts.projHead ? ['proj'] : []), 'cron', 'lower'] : []
  let ruleOn = false
  const rule = (push, key) => { if (ruleOn && ruleKeys.includes(key)) push('rule-' + key, ruleLine(cols)) }
  const treeRows = parts.treeRows || []
  // r2 (봇 ②″): «▶ 다른 봇 N» (othersHead, null = no other session) and, pressed open, their rows
  const othersRows = parts.othersHead ? parts.othersRows || [] : []
  const projRows = parts.projRows || []
  const team = typeof parts.team === 'function' ? parts.team : (n) => (parts.team || []).slice(0, n)
  const cron = parts.cron || {}
  // r2 (owner 15:32 · 15:41): the pane = an upper part (세션 나무 · 다른 봇 ·
  // 프로젝트 · 예약 — the 예약 one folded line «◷ 예약 … ▸» until pressed open) and a lower part, TeamClaude alone, at the
  // pane's bottom under one boundary line that folds it (f · click).
  const lowerOpen = parts.lowerOpen !== false
  const cronOpen = parts.cronOpen === true
  const shown = cronOpen ? cron.shown || [] : []
  const open = cronOpen ? cron.open || null : null
  const jobs = open ? open.jobs : []
  const plan = foldPlan(cronOpen ? cron.others || [] : [], Boolean(cron.foldOpen))
  const limit = Number.isFinite(maxRows) ? Math.max(1, Math.floor(maxRows)) : Infinity
  const need = {
    tree: treeRows.length,
    others: othersRows.length,
    proj: parts.projHead ? projRows.length : 0,
    team: lowerOpen ? team(Infinity).length : 0,
    own: cronOpen ? shown.length + (cron.rest || []).length : 0,
    // 10-24 (B): the detail lines of the 예약 lines pressed open (jobs.js ownJobs marks them `open`)
    detail: shown.filter((j) => j.open).reduce((n, j) => n + jobDetail(j).length, 0),
    jobs: jobs.length,
    folded: plan.shown.length + (plan.others.length ? 1 : 0) + (plan.less ? 1 : 0),
  }
  // T5 (주인 10-18 21:03): parts.lowerHead(open, cols) = the boundary line's own words (team.js
  // teamHead: «▼ TeamClaude · 라우팅 … Port 3456 ▲») — then it is the one TeamClaude line, and the block under it is
  // headless. Fitted to cols less the «f: » the engine draws.
  // T4 (주인): parts.teamWhole = the open lower part is drawn whole, never folded
  // to fit — the engine scrolls a Pane body taller than scroll.bodyRows (types: Pane.scroll «the body's window over the
  // tree: engine-owned, moved by the person's keys» · ui.scroll «the person's wheel or scroll keys on a Pane body»). The
  // upper part is fitted as before (its share computed with the lower part's fitted size, so the first screen keeps
  // what it showed); when the whole does not fit, the lower part follows the upper one directly (no gap) and the rest
  // is one scroll down.
  const headOf = (open) => {
    const own = typeof parts.lowerHead === 'function' ? parts.lowerHead(open, Math.max(1, cols - 3)) : null
    return own || lowerHead(open)
  }
  const build = (give, whole) => {
    const top = []
    const low = []
    // v3 D: `press` = the action key (actionOf) every row of the line carries — wrapped rows too, so the whole line is
    // one press; `hotkey` = its key while the pane holds the keyboard (the engine draws «r: » — counted in the width).
    const into = (out) => (key, segs, indent, mark, press, hotkey) => {
      const all = press ? pressable(segs || [], press, hotkey) : segs || []
      wrapSegments(all, cols, Number.isFinite(indent) ? indent : WRAP_INDENT).forEach((line, n) => {
        let row = press ? line.map((s) => (s.press ? s : { ...s, press })) : line
        // r2 B: a line whose segments carry their own presses (tree rows) — a wrapped part's indent takes the press of
        // what follows it, so the part is one press to its edge as before
        const first = !press && n > 0 && row.length > 1 && !row[0].press ? row.find((s) => s.press) : null
        if (first) row = [{ ...row[0], press: first.press }, ...row.slice(1)]
        out.push(n === 0 && mark ? { key, segs: row, mark } : { key: n ? key + ':' + n : key, segs: row })
      })
    }
    const push = into(top)
    rule(push, 'head')
    rule(push, 'tree')
    // r2 B: «← 돌아가기» over everything while a jump landed here (index.js refreshBack) — b · click
    if (parts.back) push('back', parts.back, undefined, 'cyan', BACK_PRESS, 'b')
    push('tree-head', parts.treeHead || [{ text: '❖ 나무 · ' + treeRows.length + '세션' }], undefined, 'cyan')
    // r2 B: a tree row's segments carry their own presses (tree.js: the fold mark · the rest = go and see that session)
    emit(treeRows, give.tree, (r) => push(r.key, r.segs, r.indent), (rest) => push('tree:more', treeMore(rest)))
    if (parts.othersHead) {
      rule(push, 'others')
      push('others-head', parts.othersHead, undefined, 'cyan', 'mh-others', 'o')
      emit(othersRows, give.others, (r) => push(r.key, r.segs, r.indent), (rest) => push('others:more', treeMore(rest)))
    }
    if (parts.projHead) {
      rule(push, 'proj')
      push('proj-head', parts.projHead, undefined, 'lavender', 'mh-proj', 'j')
      // 10-19 I1: a project line carries its own press (project.js PROJ_PRESS — that project alone); a row without one
      // = «/mh 프로젝트» as before
      // 10-20 패널 ✕: a part of the line with a press of its own (its ✕) keeps it — the line's press goes on the rest only,
      // as a tree row's (the wrapped part's indent takes the press of what follows it)
      const projPush = (r) => {
        const press = r.project !== undefined ? r.press || 'mh-proj' : undefined
        if (!press || !(r.segs || []).some((s) => s.press)) return push(r.key, r.segs, r.indent, undefined, press)
        return push(r.key, r.segs.map((s) => (s.press ? s : { ...s, press })), r.indent)
      }
      emit(projRows, give.proj, projPush, (rest) => push('proj:more', projMore(rest)))
    }
    // r2 (봇): folded = the counts alone (the «/mh 예약» hint waits for the open section)
    const cronHeadSegs = (cron.head || [{ text: '◷ 예약' }]).filter((s) => cronOpen || !s.hint)
    rule(push, 'cron')
    push('cron-head', [...cronHeadSegs, { text: cronOpen ? ' ▾' : ' ▸', color: 'amber' }], undefined, 'amber', 'mh-cron', 'r')
    if (cronOpen) {
      // 10-24 (B · 주인 10-24 · 봇 11:16): each 예약 line is its own press (JOB_PRESS — that job's detail open/shut,
      // ▸ shut · ▾ open), apart from the whole-list one (mh-own · «/mh <이 봇>»), which is the «(+N개 …)» part alone — or,
      // with nothing folded (the list open whole), one « ▾ 전부 접기» at the end. Detail lines go right under their line, their
      // count = give.detail (a short pane keeps them before TeamClaude · STEPS).
      const own = ownRows(shown, cron.rest || [], give.own)
      const toggle = cron.ownToggle ? 'mh-own' : null
      const noted = own.some((r) => r.note)
      let left = give.detail || 0
      own.forEach((r, i) => {
        const note = (r.note || []).map((s) => (toggle ? { ...s, press: toggle } : s))
        const jp = r.job ? JOB_PRESS(jobId(r.job)) : null
        const segs = r.job
          ? [{ ...r.segs[0], text: r.job.open ? '▾ ' : '▸ ', color: 'amber', press: jp }, ...r.segs.slice(1).map((s) => ({ ...s, press: jp }))]
          : r.segs.map((s) => (toggle ? { ...s, press: toggle } : s))
        if (toggle && !noted && i === own.length - 1) note.push({ text: cron.full ? ' ▾ 전부 접기' : ' ▸ 전부', color: 'amber', press: toggle })
        // short of rows the detail is never cut silently (검증 1024 결함 2): what fits, its last row «+N줄 더»; no row
        // at all = « · 상세 +N줄» on the job's own line
        const all = r.job && r.job.open ? jobDetail(r.job) : []
        const fit = Math.min(all.length, Math.max(0, left))
        left -= fit
        const cut = all.length - fit
        if (cut && !fit) segs.push({ text: ' · 상세 +' + all.length + '줄', color: 'sub', press: jp })
        push('own-' + i, [...segs, ...note])
        if (!fit) return
        const id = jobId(r.job)
        const drawn = cut ? [...all.slice(0, fit - 1), [{ text: '      +' + (cut + 1) + '줄 더 (칸을 키우면 보임)', dim: true }]] : all
        drawn.forEach((d, n) => push('own-d-' + id + '-' + n, d.map((s) => ({ ...s, press: jp })), 8))
      })
      if (open) {
        push('grp-' + open.bot, headerSegments(open, true), undefined, undefined, 'mh-bot-' + open.bot)
        emit(jobs, give.jobs, (j, i) => push('job-' + open.bot + '-' + i, jobSegments(j)), (rest) => push('job:more', jobsMore(rest)))
      }
      foldGroups(plan, give.folded, push)
    }
    const lpush = into(low)
    rule(lpush, 'lower')
    lpush('lower-head', headOf(lowerOpen), undefined, 'cyan', LOWER_PRESS, 'f')
    const own = typeof parts.lowerHead === 'function'
    // R7c: a line marked `legend` (index.js teamPart) is keyed apart — the block's own rows keep team-0 …
    let k = 0
    if (lowerOpen) for (const segs of team(whole ? Infinity : give.team)) {
      if (segs.legend) lpush('team-legend', segs)
      else lpush('team-' + k, segs, undefined, k++ === 0 && !own ? 'cyan' : undefined)
    }
    return { top, low }
  }
  const whole = parts.teamWhole === true && lowerOpen
  // the drawing for a share: the upper part as fitted, the lower part whole when it scrolls (T4)
  const draw = (give, b) => (whole ? build(give, true) : b)
  // spare rows go between the two parts, so the lower part sits at the pane's bottom (owner)
  const join = ({ top, low }) => {
    const gap = Number.isFinite(limit) ? limit - top.length - low.length : 0
    return gap > 0 ? [...top, ...Array.from({ length: gap }, (_, i) => ({ key: 'gap-' + i, segs: [] })), ...low] : [...top, ...low]
  }
  const fits = (b) => b.top.length + b.low.length <= limit
  // P2: the drawing for `give` with the rules put in, when they cost no line of `lines` (the same share without them)
  const withRules = (give, lines) => {
    if (!ruleKeys.length) return lines
    ruleOn = true
    const ruled = join(whole ? build(give, true) : build(give))
    ruleOn = false
    if (!Number.isFinite(limit)) return ruled
    const heads = (ls) => ls.slice(0, limit).filter((l) => isHead(l.key)).map((l) => l.key)
    const shown = heads(ruled)
    const ok = heads(lines).every((k) => shown.includes(k)) && (whole || ruled.length <= limit)
    return ok ? ruled : lines
  }
  const all = build(need)
  if (fits(all)) return withRules(need, join(all))
  // the heads and an expanded group's header stay; what they take (wrapped) is off the top
  const zero = Object.fromEntries(Object.keys(need).map((k) => [k, 0]))
  const fixed = build(zero)
  const most = Object.values(need).reduce((a, b) => a + b, 0)
  for (let budget = Math.min(limit - fixed.top.length - fixed.low.length, most); budget > 0; budget--) {
    const give = allot(need, budget, parts.teamOpen ? STEPS_TEAM_OPEN : STEPS)
    const b = build(give)
    if (fits(b)) return withRules(give, join(draw(give, b)))
  }
  // not even the heads fit: the tree's head first, then the boundary line (so the lower part can still be folded), then
  // the other heads top to bottom (T4: the whole lower part after them, one scroll away)
  const top = fixed.top.slice(0, limit === 1 ? 1 : Math.min(fixed.top.length, Math.max(1, limit - Math.min(fixed.low.length, 1))))
  return join({ top, low: whole ? build(zero, true).low : fixed.low.slice(0, Math.max(0, limit - top.length)) })
}

// r2: the boundary line over the lower part — «▼ TeamClaude · 접기» open, «▶ TeamClaude · 펴기» folded.
export const LOWER_PRESS = 'mh-lower'
// r2 B: the «← 돌아가기» line (index.js refreshBack · goBack · jump.js backPlan): «← 돌아가기 · bot» — where it goes.
export const BACK_PRESS = 'mh-back'
export function backHead(from) {
  return [{ text: '← ', color: 'cyan', bold: true }, { text: '돌아가기', color: 'cyan', bold: true }, { text: ' · ' + (from || '?'), color: 'sub' }]
}
function lowerHead(open) {
  return [{ text: open ? '▼ ' : '▶ ', color: 'cyan', bold: true }, { text: 'TeamClaude', color: 'cyan', bold: true }, { text: open ? ' · 접기' : ' · 펴기', color: 'sub' }]
}
