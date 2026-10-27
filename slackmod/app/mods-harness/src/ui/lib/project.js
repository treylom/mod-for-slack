// lane: ui · owner: 봇 — pure ◈ 프로젝트별 봇 현황 (no `$`).
// 설계 메모 (추가 지시 20:15 · 봇 전달): under the tree, one line per project — the bots in it with their sessions'
// states, what is being worked on, and the counts of the project's consult boards. Boards = the session lane's (48번 ·
// src/session/REGISTRY.md «ui 갈래가 읽을 것»: registry row project · type · parent_id → the board note → core.js
// parseBoard · boardSummary); index.js reads them and hands the counts in, read only. «/mh 프로젝트» = under each
// project its sessions with their task, and the board's last 3 lines (설계 메모 상세 펼침).
import { stateOf, overOf, overAt, LOOK } from './tree.js'
import { segWidth, strWidth, modelShown, modelColor } from './text.js'
import { botShown, sessionShown } from './display.js'
import { threadLabel, threadChannelOk } from './agents.js'
import { threadKeyOf, projectName } from '../../session/core.js'

// most telling first: who works, who waits, who rests, who is gone
const STATES = ['busy', 'waiting', 'idle', 'starting', 'stale', 'ended', 'failed']

function label(v) {
  return typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null
}

// the bot as the screen shows it (ui.bot_display · 주인 10-18 18:21); grouping keys stay real
function botOf(e) {
  const b = label(e.bot)
  return b ? botShown(b) : sessionShown(label(e.name) || e.id, null)
}

// P4 (주인 10-19 01:48 · 봇 ③ 칸 이름):
// a row's project = its `current_project` (the session lane writes it on a bot's own session's row: the project it works on
// now — 정본 이름 or null) when that is a name, else its `project` as before. null or a registry without the field = as
// before (a bot's own session with no project stays under «프로젝트 없음»). Read only — the field is the session lane's.
export function rowProject(e) {
  return label(e && e.current_project) || (e ? e.project : null)
}
// a bot's own session (not a 하위): drawn «본» + its state in the project line, apart from the 하위 counts
const isMain = (e) => e.role !== 'child'

function oneLine(s) {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''
}

// rows (flatten order) → [{ project, sessions: [{ entry, state, seen }], bots: [{ bot, n: { busy: 1, … } }], work,
// parents }] — project = the registry label read through `projectOf` (10-18 주인:
// core.js projectLabel over config session.projects — the same function spawn_child uses; the files are not
// rewritten) · null = rows without one, kept last. work = the task of the session that is busiest and seen last.
// parents = the parent ids of the project's child rows (one board each).
// 10-19 H3 (봇 · 주인 15:39): attachOf(entry) → a project label attached after
// the fact (a record kept apart from the registry, which is never rewritten — its form comes from the session lane's
// bot-NNNNNN work; index.js attachOf is the one place that reads it) wins over the row's own `project`; null = the row's.
// 10-19 I3: a row's project as every part of the screen reads it (the project line, its open lines, «오늘 끝 N») — the
// after-the-fact attach first, then the row's own, through projectOf; null = none.
// 10-19 ①b: attachOf may answer UNBOUND = an unbind line for this session (project null) → «프로젝트 없음», as the
// session lane's rowProject reads it (core.js) — not the row's own project.
export const UNBOUND = Symbol('unbound')
export function projectKeyOf(e, projectOf, attachOf) {
  const a = typeof attachOf === 'function' ? attachOf(e) : null
  if (a === UNBOUND) return null
  const attached = label(a)
  const raw = attached || rowProject(e)   // ⑥ H3 after-the-fact attach > ⑤ P4 current_project > project
  return label(typeof projectOf === 'function' ? projectOf(raw) : raw)
}

// 10-19 ①b (봇 · 주인 20:47 — the H3 attachOf the session lane's
// G log was made for): `folded` = core.js foldBindings of session.binding_file (latest line per key wins). A session line
// for this row wins (project null = UNBOUND); else a child row with no project of its own takes its thread's line
// (bind.mjs thread … — the project follows the place of the work); a row that has its own project keeps it (an explicit
// spawn project is not overruled by a thread line). null = the log says nothing about this row.
export function boundProjectOf(e, folded) {
  if (!e || !folded || typeof folded !== 'object') return null
  const s = folded.sessions && typeof e.id === 'string' ? folded.sessions[e.id] : null
  if (s) return s.project === null ? UNBOUND : label(s.project)
  if (e.role !== 'child' || label(rowProject(e))) return null
  const t = e.thread
  if (!t || typeof t.channel !== 'string' || typeof t.ts !== 'string' || !folded.threads) return null
  const b = folded.threads[threadKeyOf(t.channel, t.ts)]
  return b ? label(b.project) : null
}

// 10-19 ①b′ (봇 21:1x): the threads a bot's OWN session heard
// (sources = [{ bot, threads: [{ ts, channel, text }] }] — index.js threadSources: this window's book for itself, another
// bot's live file while fresh; a 하위's are not read) that the binding log binds to a project → Map(project → [{ bot,
// channel, ts, text }]), newest first, THREAD_LINES_MAX per project. Read only (live threads + bindings, nothing
// written) · a thread with no line = nothing · a DM only when the config names it (threadChannelOk) · the bot's own row
// stays where it was (it holds many projects at once; a row hopping per message would only confuse).
export const THREAD_LINES_MAX = 5
export function boundThreads(sources, folded, names, projectOf) {
  const out = new Map()
  if (!folded || !folded.threads) return out
  const seen = new Set()
  for (const src of sources || []) {
    if (!src || !label(src.bot) || !Array.isArray(src.threads)) continue
    for (const t of src.threads) {
      if (!t || typeof t.ts !== 'string' || !threadChannelOk(t.channel, names)) continue
      const b = folded.threads[threadKeyOf(t.channel, t.ts)]
      const raw = b ? label(b.project) : null
      const p = raw ? label(typeof projectOf === 'function' ? projectOf(raw) : raw) : null
      const k = src.bot + ' ' + threadKeyOf(t.channel, t.ts)
      if (!p || seen.has(k)) continue
      seen.add(k)
      if (!out.has(p)) out.set(p, [])
      if (out.get(p).length < THREAD_LINES_MAX) out.get(p).push({ bot: src.bot, channel: t.channel, ts: t.ts, text: oneLine(t.text) })
    }
  }
  return out
}
// a project that has bound threads but no session row yet gets its (empty) group, before «프로젝트 없음»
export function withThreadGroups(groups, threads) {
  const have = new Set((groups || []).map((g) => g.project))
  const extra = [...((threads && threads.keys()) || [])].filter((p) => !have.has(p)).sort()
    .map((p) => ({ project: p, sessions: [], bots: [], work: null, parents: [] }))
  if (!extra.length) return groups
  const named = (groups || []).filter((g) => g.project !== null)
  return [...named, ...extra, ...(groups || []).filter((g) => g.project === null)]
}

export function projectGroups(rows, liveById, nowMs, staleMs, projectOf, attachOf) {
  const by = new Map()
  for (const row of rows || []) {
    const e = row.entry
    const p = projectKeyOf(e, projectOf, attachOf)
    if (!by.has(p)) by.set(p, { project: p, sessions: [] })
    const live = liveById ? liveById.get(e.id) : null
    const seen = live && Number.isFinite(live.last_seen) ? live.last_seen : Date.parse(e.updated_at || '') || 0
    by.get(p).sessions.push({ entry: e, state: stateOf(e, live, nowMs, staleMs), seen })
  }
  const rank = (s) => STATES.indexOf(s.state)
  const out = []
  for (const g of by.values()) {
    const bots = new Map()
    for (const s of g.sessions) {
      const b = botOf(s.entry)
      if (!bots.has(b)) bots.set(b, { n: {}, main: [] })
      const t = bots.get(b)
      if (isMain(s.entry)) t.main.push(s.state)
      else t.n[s.state] = (t.n[s.state] || 0) + 1
    }
    const withTask = g.sessions.filter((s) => oneLine(s.entry.task)).sort((a, b) => rank(a) - rank(b) || b.seen - a.seen)
    const parents = [...new Set(g.sessions.filter((s) => s.entry.role === 'child' && label(s.entry.parent_id)).map((s) => s.entry.parent_id))]
    out.push({ project: g.project, sessions: g.sessions, bots: [...bots].map(([bot, t]) => ({ bot, n: t.n, main: t.main })), work: withTask.length ? oneLine(withTask[0].entry.task) : null, parents })
  }
  const live = (g) => g.sessions.filter((s) => s.state === 'busy' || s.state === 'waiting').length
  return out.sort((a, b) => (a.project === null) - (b.project === null) || live(b) - live(a) || b.sessions.length - a.sessions.length ||
    String(a.project).localeCompare(String(b.project)))
}

// «bot(●1 ○2)» — the bot and how many of its 하위 sessions are in each state (glyph in its color); its own session first
// as «본●» (P4: «본» + that session's state glyph, no count) — «bot(본● ●1)».
function botSegs(b, withStates) {
  if (!withStates) return [{ text: b.bot }]
  // 10-20 R2: a bot that only heard a bound thread of this project (no session in it) — «bot(스레드 2)»
  if (Number.isFinite(b.threads)) return [{ text: b.bot + '(' }, { text: '스레드 ' + b.threads, color: 'sky' }, { text: ')' }]
  const segs = [{ text: b.bot + '(' }]
  const main = (b.main || []).slice().sort((x, y) => STATES.indexOf(x) - STATES.indexOf(y))
  main.forEach((s, i) => {
    const look = LOOK[s] || LOOK.idle
    segs.push(...(i ? [{ text: ' ' }] : []), { text: '본', color: 'bright', bold: true }, { text: look.glyph, color: look.color, dim: look.dim })
  })
  STATES.filter((s) => b.n[s]).forEach((s, i) => {
    const look = LOOK[s]
    segs.push(...(i || main.length ? [{ text: ' ' }] : []), { text: look.glyph + b.n[s], color: look.color, dim: look.dim })
  })
  segs.push({ text: ')' })
  return segs
}

// The board part: «결정 2 · 막힘 1 · 질문 3» (결정 cyan · 막힘 red bold when any · 질문 yellow while one is open), or why
// there is none — no board_root in config = «게시판 설정 없음» (no invented 0, 봇 결정) · no note yet = «게시판 없음».
// b = { status: 'unset' | 'none' | 'error' | 'ok', counts: { decisions, blocks, questions, open } }.
export function boardSegs(b) {
  if (!b || b.status === 'unset') return [{ text: '게시판 설정 없음', dim: true }]
  if (b.status === 'none') return [{ text: '게시판 없음', dim: true }]
  if (b.status === 'error') return [{ text: '게시판 읽기 실패', color: 'red' }]
  const c = b.counts || {}
  const n = (v) => (Number.isFinite(v) ? v : 0)
  return [{ text: '결정 ' + n(c.decisions), color: n(c.decisions) ? 'cyan' : 'sub' }, { text: ' · ' },
    { text: '막힘 ' + n(c.blocks), color: n(c.blocks) ? 'red' : 'sub', bold: n(c.blocks) > 0 }, { text: ' · ' },
    { text: '질문 ' + n(c.questions), color: n(c.open) ? 'yellow' : 'sub' }]
}

const SEP = () => ({ text: ' · ', dim: true })
function join(parts) {
  const out = []
  parts.filter((p) => p && p.length).forEach((p, i) => out.push(...(i ? [SEP()] : []), ...p))
  return out
}

// One project's line in `cols` cells, the spec's order kept (이름 · 봇 · 하는 일 · 게시판) and the least needed part
// given up first when it does not fit: the work, then the bots' states, then the bots' names (→ «N봇»). Never cut; a
// line that still does not fit wraps in the pane.
// 10-20 패널 ✕ (주인 DM 08:53): a named project's line ends in its own ✕ (PCLOSE_PRESS), set at the right edge — room
// for it is kept in every try, so it is never the part given up. The «프로젝트 없음» line has none (it is no project).
// 10-20 R2 (주인 12:27 · 봇 하위 세션): a project drawn only for its
// bound threads (withThreadGroups — no session in it) names the bots that heard them («bot(스레드 2)», `heard`) in the
// bots' place, so the line no longer reads as a dead name. R3(나): no board_root (board status 'unset') = no board part
// on the line — said once in the ◈ head instead («게시판 꺼짐»), not on every line.
function projectLine(g, board, cols, loose, open, heard) {
  const x = g.project === null ? null : [{ text: X_MARK, color: 'red', bold: true, press: PCLOSE_PRESS(g.project) }]
  const body = projectBody(g, board, x ? cols - segWidth(x) - 1 : cols, loose, open, heard)
  if (!x) return body
  return [...body, { text: ' '.repeat(Math.max(1, cols - segWidth(body) - segWidth(x))) }, ...x]
}
function projectBody(g, board, cols, loose, open, heard) {
  const mark = open ? '  ▾ ' : '  ▸ ' // 10-19 I1: ▾ while this project's lines are open
  const name = loose > 0 ? [{ text: mark, color: 'yellow' }, { text: '프로젝트 없는 세션 ' + loose + '개', color: 'yellow', bold: true }]
    : [{ text: mark, color: 'lavender' }, g.project === null ? { text: '프로젝트 없음', dim: true } : { text: g.project, color: 'lavender', bold: true }]
  const boardPart = g.project === null || boardOff(board) ? null : boardSegs(board)
  const list = g.bots.length ? g.bots : (heard || [])
  const bots = (states) => list.flatMap((b, i) => [...(i ? [{ text: '·', dim: true }] : []), ...botSegs(b, states)])
  const work = g.work ? [{ text: g.work, color: 'sub' }] : null
  const tries = [
    [name, bots(true), work, boardPart],
    [name, bots(true), boardPart],
    [name, bots(false), boardPart],
    [name, list.length ? [{ text: list.length + '봇' }] : null, boardPart],
    [name, boardPart],
  ]
  for (const t of tries) {
    const segs = join(t)
    if (segWidth(segs) <= cols) return segs
  }
  return join(tries[tries.length - 1])
}

const KIND_INK = { 결정: 'cyan', 막힘: 'red', 질문: 'yellow', 답: 'green', 끝: 'dim' }

// ◈ block = { head, rows: [{ key, segs, indent?, project? }] } for paneLines. boards = Map(project → board) (see
// boardSegs; `last` = its newest board lines [{ at, by, kind, text }]). detail = «/mh 프로젝트» open.
// 10-19 H1: the 하위 sessions still going (not ended / failed — ① «끝나면 바로 빼기»'s rule) that belong to no project.
// A bot's own session (role parent) is not counted: many have no project of their own (config bot_projects), and 주인's
// word was «하위 세션들이 프로젝트로 잘 안 붙음».
export function unprojected(groups) {
  const g = (groups || []).find((x) => x.project === null)
  return g ? g.sessions.filter((s) => s.entry.role === 'child' && s.state !== 'ended' && s.state !== 'failed') : []
}

// 10-20 R3(나): a board that is off = no board_root in config (index.js boardOf → { status: 'unset' }) — only that; a
// board not handed in at all keeps boardSegs' own words
export function boardOff(b) {
  return Boolean(b && b.status === 'unset')
}

// 10-20 R2: Map(project → [{ bot (as shown), threads: n }]) — the bots that heard each project's bound threads
// (threads = boundThreads: Map(project → [{ bot, channel, ts, text }])), in first-heard order
export function heardBy(threads) {
  const out = new Map()
  if (!threads || typeof threads.forEach !== 'function') return out
  threads.forEach((ts, p) => {
    const by = new Map()
    for (const t of ts || []) if (t && label(t.bot)) by.set(botShown(t.bot), (by.get(botShown(t.bot)) || 0) + 1)
    out.set(p, [...by].map(([bot, n]) => ({ bot, threads: n })))
  })
  return out
}

// ── 10-19 I (주인 16:07) ──
// I1: each project line is its own press (PROJ_PRESS — the project's name in hex, so any label is a safe key without
// «@» or «:»; the no-project line = «-»), ▸ shut · ▾ open, kept for the session only (index.js S.projOpen, as every
// other fold). «◈» head / «/mh 프로젝트» still opens or shuts them all (detail).
// I2 open = ① one line of the bots in it, each with its going sessions and the ones ended today («bot 2 · 끝 1»)
// ② one line per going session: state glyph · bot · session · 모델/추론 (text.js modelShown · none «–») · since its
// start · its task's first line · the thread's channel tag (ui.slack_channels) · «상» = persistent (only close_child
// ends it). I3: the same rows and project key (projectKeyOf) as the project line · an ended session gets no line (①
// «끝나면 바로 빼기») — only the count «끝 N» of those ended today (a project's day at a glance, no rows to read).
// I4: a line never wider than the pane — the task is cut first («…»), then the thread tag, the 모델/추론, the time go.
export const PROJ_PRESS = (project) => 'mh-proj-' + hexOf(project === null ? '-' : project)
export function hexOf(s) {
  return Array.from(new TextEncoder().encode(String(s)), (b) => b.toString(16).padStart(2, '0')).join('')
}
export function unhex(h) {
  if (typeof h !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(h)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16)))
  } catch (err) {
    return null
  }
}
// the key S.projOpen holds for a group ('-' = the no-project line)
export const projKey = (project) => (project === null ? '-' : project)

// ── 10-20 패널 ✕ (주인 DM 08:53 · 봇
// 하위 세션): a named project's ✕ (its name in hex, as PROJ_PRESS) → its confirm line under it — «하위 세션 N개를 닫을까요?»
// with 닫기 (PCLOSE_OK) and 취소 (PCLOSE_NO). What the confirm holds and what a press does = index.js (S.projClose, as
// S.teamConfirm); the closing itself = the session lane (the registry's one writer · core.js panelCloseCheck). ──
export const X_MARK = '✕'
export const PCLOSE_PRESS = (project) => 'mh-pclose-' + hexOf(project)
export const PCLOSE_OK = (project) => 'mh-pclose-ok-' + hexOf(project)
export const PCLOSE_NO = 'mh-pclose-no'

// What ✕ on this group would do, from what the screen shows: kind 'close' = its going 하위 (role child · not ended /
// failed by registry or by state) — never a bot's own session, never the panel's own (`meId`) — ids in drawing order,
// keep = how many of them are 상주 (persistent) · 'hide' = no going session at all (any role) · 'none' = only sessions
// that are not closed from here (bots' own, the panel's own) · null = the «프로젝트 없음» group or none.
export function closePlan(g, meId) {
  if (!g || g.project === null) return null
  const live = g.sessions.filter(going)
  if (!live.length) return { kind: 'hide', ids: [], keep: 0, mains: 0 }
  const kids = live.filter((s) => s.entry.role === 'child' && !overOf(s.entry, null) && s.entry.id !== meId)
  const mains = live.filter((s) => isMain(s.entry)).length
  if (!kids.length) return { kind: 'none', ids: [], keep: 0, mains }
  return { kind: 'close', ids: kids.map((s) => s.entry.id), keep: kids.filter((s) => s.entry.persistent === true).length, mains }
}

// The groups drawn, with the projects taken off the list left out (hidden = core.js parseHidden of hidden-projects.json:
// { project: { at } }) — only while the project still has no going session and nothing newer than when it was taken
// off: no row started or updated after `at`, no bound thread (threads = boundThreads) begun after it. Anything new = drawn
// again (the way back, with nothing to undo). → { groups, hidden: how many were left out, ended }.
// 10-21 (주인 02:25): a project no longer in the configured list (taken out by
// mods_project_remove — table = the board's project list, session core.js projectName = null) with no going 하위 session is
// an ended project: left out too and counted on its own (`ended`). Only 하위 sessions count as work — a bot's own session
// stays alive and keeps the threads it heard, which is what kept these groups up. No list configured = nothing ends this
// way; a going 하위 in it = drawn; put back on the list = drawn again (the bindings and rows are left as they are).
// r2 (10-21 03:2x · the kit's 10-20 R2·R5 caught r1): «not in the list» alone is also a project NOT YET on it — a thread bound
// by hand (adhoc-research) that a bot's own session heard is the very same shape, and R2 keeps it drawn. What tells a
// removed project apart: a 하위 row under it. spawn_child and attach refuse a name off the list (core.js projectName = null →
// «not in the project list»), so a 하위 row with the project = it WAS on the list. `ever` = childProjects(every registry entry
// — not only the drawn ones, an old 하위 ages out of the tree but its row stays) · no `ever` = nothing ends (old callers).
export function childProjects(entries, projectOf, attachOf) {
  const out = new Set()
  for (const e of entries || []) {
    if (!e || e.role !== 'child') continue   // a bot's own session is no proof — it carries whatever project it last worked on
    const p = projectKeyOf(e, projectOf, attachOf)
    if (p !== null) out.add(p)
  }
  return out
}
export function endedProject(g, table, ever) {
  if (!g || g.project === null || !table || !table.names || !table.names.length) return false
  if (projectName(table, g.project) !== null) return false
  if (!ever || typeof ever.has !== 'function' || !ever.has(g.project)) return false   // never had a 하위 = never listed (R2)
  return !g.sessions.some((s) => s.entry.role === 'child' && going(s))
}
export function shownGroups(groups, hidden, threads, table, ever) {
  let e = 0
  const kept = (groups || []).filter((g) => (endedProject(g, table, ever) ? (e += 1, false) : true))
  const open = e ? kept : groups || []   // nothing ended = the same groups, untouched (callers compare by reference)
  if (!hidden || typeof hidden !== 'object') return { groups: open, hidden: 0, ended: e }
  let n = 0
  const out = open.filter((g) => {
    const rec = g.project === null ? null : hidden[g.project]
    if (!rec || !Number.isFinite(rec.at)) return true
    if (g.sessions.some(going)) return true
    const newer = (ms) => Number.isFinite(ms) && ms > rec.at
    if (g.sessions.some((s) => newer(Date.parse(s.entry.started_at || '')) || newer(Date.parse(s.entry.updated_at || '')))) return true
    const ts = threads && threads.get ? threads.get(g.project) || [] : []
    if (ts.some((t) => newer(Number(t.ts) * 1000))) return true
    n += 1
    return false
  })
  return { groups: out, hidden: n, ended: e }
}

// The confirm line under the project line: the question, 닫기, 취소 — fitted to cols (the explanation goes first, then
// the 상주 count; 닫기 · 취소 are never left out).
function confirmLine(c, cols) {
  const ok = [{ text: '[닫기]', color: 'red', bold: true, press: PCLOSE_OK(c.project) }, { text: ' ' }, { text: '[취소]', color: 'sub', press: PCLOSE_NO }]
  const lead = [{ text: '    ' }, { text: '↳ ', color: 'amber' }]
  const asks = c.kind === 'hide'
    ? [[{ text: '이 프로젝트를 목록에서 닫을까요?', color: 'amber', bold: true }, { text: ' 기록만 · 새 세션이 생기면 다시 보여요', color: 'sub' }],
      [{ text: '이 프로젝트를 목록에서 닫을까요?', color: 'amber', bold: true }],
      [{ text: '목록에서 닫기?', color: 'amber', bold: true }]]
    : [[{ text: `하위 세션 ${c.ids.length}개를 닫을까요?`, color: 'amber', bold: true }, ...(c.keep ? [{ text: ` 상주 ${c.keep}개 포함`, color: 'amber' }] : []), { text: ' · 본 세션은 그대로', color: 'sub' }],
      [{ text: `하위 세션 ${c.ids.length}개를 닫을까요?`, color: 'amber', bold: true }, ...(c.keep ? [{ text: ` 상주 ${c.keep}개 포함`, color: 'amber' }] : [])],
      [{ text: `하위 ${c.ids.length}개 닫기?`, color: 'amber', bold: true }, ...(c.keep ? [{ text: ` 상주 ${c.keep}`, color: 'amber' }] : [])]]
  for (const a of asks) {
    const segs = [...lead, ...a, { text: '  ' }, ...ok]
    if (segWidth(segs) <= cols) return segs
  }
  return [...lead, ...asks[asks.length - 1], { text: ' ' }, ...ok]
}

// «12분» · «3시간 5분» · «2일 4시간» since `fromMs`; null when unknown.
export function sinceText(fromMs, nowMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) return null
  const m = Math.max(0, Math.floor((nowMs - fromMs) / 60000))
  if (m < 60) return m + '분'
  const h = Math.floor(m / 60)
  if (h < 24) return h + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '')
  const d = Math.floor(h / 24)
  return d + '일' + (h % 24 ? ' ' + (h % 24) + '시간' : '')
}

// entries (the whole registry) → Map(project key → Map(bot as shown → n)) of the sessions ended or failed today (the
// local day of nowMs) — read through projectKeyOf like every other part.
// 10-24 (A): `live` (optional Map id → live record) = ended by the one end rule (tree.js overOf), so a row its live file
// ended leaves the tree and is counted here alike.
export function endedToday(entries, nowMs, projectOf, attachOf, live) {
  const out = new Map()
  const day = new Date(nowMs).toDateString()
  for (const e of entries || []) {
    const lv = e && live && typeof live.get === 'function' ? live.get(e.id) || null : null
    if (!e || !overOf(e, lv)) continue
    const at = overAt(e, lv)
    if (!Number.isFinite(at) || new Date(at).toDateString() !== day) continue
    const k = projKey(projectKeyOf(e, projectOf, attachOf))
    if (!out.has(k)) out.set(k, new Map())
    const b = botOf(e)
    out.get(k).set(b, (out.get(k).get(b) || 0) + 1)
  }
  return out
}

const going = (s) => s.state !== 'ended' && s.state !== 'failed'

// ① «    봇 · bot 2 · 끝 1 · jobs 1» — every bot with a session in the project (the helper bots too), going count, ended
// today when any; a bot with only ended sessions today = «bot 0 · 끝 2».
function botsLine(g, ended) {
  const done = ended || new Map()
  const names = [...new Set([...g.bots.map((b) => b.bot), ...done.keys()])]
  const items = names.map((b) => {
    const n = g.sessions.filter((s) => going(s) && botOf(s.entry) === b).length
    const e = done.get(b) || 0
    return [{ text: b, color: 'cyan' }, { text: ' ' + n, color: n ? 'text' : 'sub' }, ...(e ? [{ text: ' · 끝 ' + e, color: 'sub', dim: true }] : [])]
  })
  return [{ text: '    ' }, { text: '봇', color: 'sub' }, SEP(), ...items.flatMap((it, i) => [...(i ? [{ text: ' · ', color: 'dim' }] : []), ...it])]
}

function cutTo(text, cells) {
  if (strWidth(text) <= cells) return text
  let out = ''
  for (const ch of text) {
    if (strWidth(out + ch + '…') > cells) break
    out += ch
  }
  return out ? out + '…' : ''
}

// ② one going session's line, fitted to cols (I4).
function sessionLine(s, o, cols) {
  const e = s.entry
  const live = o.live ? o.live.get(e.id) : null
  const look = LOOK[s.state] || LOOK.idle
  const model = modelShown((live && live.model) || e.model)
  const effort = label((live && live.effort) || e.effort)
  const mText = model || effort ? (model || '–') + '/' + (effort || '–') : '–'
  const since = sinceText(Date.parse(e.started_at || ''), o.nowMs)
  const task = oneLine(String(e.task || '').split('\n')[0])
  const tl = e.role === 'child' ? threadLabel(e, o.heads, o.channels) : null
  // a bot's own session reads «● bot · 본» · a 하위 «● bot · bot-1(구현)» (its type as before) — 봇 10-19 (⑥ 통합):
  // «본» = the project line's «bot(본●)» and the legend's «본·하위 세션», in the 하위 name's place (2nd cell only)
  const bot = botOf(e)
  const who = sessionShown(label(e.name) || e.id, label(e.bot))
  const type = label(e.type)
  const tag = type ? '(' + type + ')' : ''
  const head = [{ text: '    ' }, { text: look.glyph, color: look.color, dim: look.dim }, { text: ' ' },
    { text: bot, color: 'cyan' }, SEP(), { text: (who === bot ? '본' : who) + tag }]
  const parts = {
    model: [SEP(), { text: mText, color: model ? modelColor(model) : 'sub' }],
    since: since ? [SEP(), { text: since, color: 'sub' }] : [],
    thread: tl ? [SEP(), { text: tl.name, color: 'sky' }] : [],
    keep: e.persistent === true ? [{ text: ' ' }, { text: '상', color: 'amber', bold: true }] : [],
  }
  const build = (with_, taskText) => [...head, ...(with_.model ? parts.model : []), ...(with_.since ? parts.since : []),
    ...(taskText ? [SEP(), { text: taskText, color: 'sub' }] : []), ...(with_.thread ? parts.thread : []), ...parts.keep]
  // the settings are what the open lines are for (주인): the task is cut to what is left (kept
  // while ≥ 6 cells of it fit), then the thread tag goes, then the task, and only then 모델/추론 and the time; the head
  // (glyph · bot · session) is never cut — a name wider than the pane wraps there
  const tries = [{ model: 1, since: 1, thread: 1, task: 1 }, { model: 1, since: 1, task: 1 }, { model: 1, since: 1 }, { model: 1 }, {}]
  for (const w of tries) {
    const bare = build(w, '')
    const room = cols - segWidth(bare) - 3 // « · » before the task
    if (w.task && task && room >= Math.min(6, strWidth(task))) return build(w, cutTo(task, room))
    if ((!w.task || !task) && segWidth(bare) <= cols) return bare
  }
  return build({}, '')
}

// ①b′ «    ↳ bot · 주인-DM · 머리글» — a bound thread of a bot's own session (a DM by its config name, a channel
// «#이름»), the head cut to what is left
function threadLine(t, channels, cols) {
  const nm = (channels && channels[t.channel]) || t.channel
  const head = [{ text: '    ' }, { text: '↳', color: 'sky' }, { text: ' ' }, { text: botShown(t.bot), color: 'cyan' }, SEP(),
    { text: /^D/.test(t.channel) ? nm : '#' + nm, color: 'sky' }]
  const room = cols - segWidth(head) - 3
  return t.text && room >= Math.min(6, strWidth(t.text)) ? [...head, SEP(), { text: cutTo(t.text, room), color: 'sub' }] : head
}

// K3: the session lane's mh.dispatch value (or a bare number) → a whole count 0…9999 — anything else (null · a string ·
// NaN · negative · a value with other fields only) is 0, so a bad value never reaches a line
export function dispatchFailedOf(v) {
  const n = typeof v === 'number' ? v : (v && typeof v === 'object' ? v.failed : NaN)
  return Number.isInteger(n) && n > 0 ? Math.min(n, 9999) : 0
}

export function projectLines(groups, boards, cols, detail, opts) {
  const o = opts || {}
  // `open` = the lines pressed; under «/mh 프로젝트» (detail = all open) a pressed line is the one shut — so a press always
  // turns that line over (verifier 10-19: with detail on a line's press changed nothing)
  const pressed = (g) => Boolean(o.open && o.open.has(projKey(g.project)))
  const isOpen = (g) => (detail ? !pressed(g) : pressed(g))
  const named = groups.filter((g) => g.project !== null).length
  // 10-20 R3(나): no board_root = one dim «게시판 꺼짐» in the head instead of «게시판 설정 없음» on every line
  const off = Boolean(boards) && groups.some((g) => g.project !== null && boardOff(boards.get(g.project)))
  const heard = heardBy(o.threads) // 10-20 R2
  // 10-20: the projects taken off the list are counted in the head, so none is gone without a word (o.hiddenN)
  const head = [{ text: '◈ ', color: 'lavender' }, { text: '프로젝트별 봇 현황', color: 'lavender', bold: true },
    { text: ' · ' + (groups.length ? named + '개' : '없음'), color: 'sub' },
    ...(o.hiddenN > 0 ? [{ text: ' · 내린 프로젝트 ' + o.hiddenN + '개', color: 'sub', dim: true }] : []),
    ...(o.endedN > 0 ? [{ text: ' · 끝난 프로젝트 ' + o.endedN + '개', color: 'sub', dim: true }] : []), // 10-21 shownGroups ended
    // K3 (주인 10-21 21:43 · 봇 19:39 권고): messages that fell to this session although a child was on the thread — only when > 0
    ...(dispatchFailedOf(o.dispatchFailedN) > 0 ? [{ text: ' · 하위로 못 간 글 ' + dispatchFailedOf(o.dispatchFailedN) + '회', color: 'yellow' }] : []),
    ...(off ? [{ text: ' · 게시판 꺼짐', dim: true }] : []),
    { text: detail ? ' · 접기=/mh 프로젝트' : ' · 상세=/mh 프로젝트', dim: true }]
  const rows = []
  // 10-19 H1 (주인 15:39 · 16:0x): while any going session has no project, the
  // «프로젝트 없음» line goes first and stands out — «▸ 프로젝트 없는 세션 N개» in yellow (N = going ones; ended not
  // counted) — no extra row; pressed (mh-proj, as every project line) it opens the detail with their bots and names. Only
  // ended ones (or none) = the dim «프로젝트 없음» line last, as before.
  const loose = unprojected(groups).length
  const order = loose ? [...groups.filter((g) => g.project === null), ...groups.filter((g) => g.project !== null)] : groups
  order.forEach((g, i) => {
    const board = boards ? boards.get(g.project) : null
    const key = 'proj-' + i
    const open = isOpen(g)
    rows.push({ key, project: g.project === null ? '-' : g.project, press: PROJ_PRESS(g.project), open,
      segs: projectLine(g, board, cols, g.project === null ? loose : 0, open, g.project === null ? null : heard.get(g.project)), indent: 6 })
    // 10-20 패널 ✕: while this project's ✕ waits for its confirm (o.confirm = index.js S.projClose), the question under it
    if (o.confirm && g.project !== null && o.confirm.project === g.project) rows.push({ key: key + '-x', indent: 8, segs: confirmLine(o.confirm, cols) })
    if (!open) return
    rows.push({ key: key + '-bots', indent: 8, segs: botsLine(g, o.ended ? o.ended.get(projKey(g.project)) : null) })
    g.sessions.filter(going).forEach((s, k) => {
      rows.push({ key: key + '-s' + k, indent: 8, segs: sessionLine(s, o, cols) })
    })
    // ①b′: the bound threads of bots' own sessions — one a going 하위 of this project already answers is not drawn twice
    const inKid = (t) => g.sessions.some((s) => going(s) && s.entry.thread && s.entry.thread.channel === t.channel && s.entry.thread.ts === t.ts)
    const tls = o.threads && g.project !== null ? (o.threads.get(g.project) || []).filter((t) => !inKid(t)) : []
    tls.forEach((t, k) => {
      rows.push({ key: key + '-t' + k, indent: 8, segs: threadLine(t, o.channels, cols) })
    })
    const last = board && Array.isArray(board.last) ? board.last.slice(-3) : []
    last.forEach((l, k) => {
      rows.push({ key: key + '-b' + k, indent: 8, segs: [{ text: '    ' }, { text: '[' + l.kind + ']', color: KIND_INK[l.kind] || 'text' },
        { text: ' ' + l.at + ' ', color: 'sub' }, { text: l.by }, SEP(), { text: oneLine(l.text) }] })
    })
  })
  return { head, rows }
}
