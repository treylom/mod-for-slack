// lane: ui · owner: 봇
// scope: 화면 v1 (봇 v1 발주 10-17 · 41번 손그림 배치 검토 ①~④) — v0 핵심 4칸 + 예약 작업 위에:
// · Main = the conversation itself (봇 10-17, G6 «대화가 흐르면 충족»): nothing is drawn for it.
// · 띠(입력칸 위, AbovePrompt): 좁은 창 = ▣ 시스템 → 나무 → 도구 → 기억 → 예약 (아래부터 접힘) · 칸이 오른쪽에 붙은
//   넓은 창 = ▣ + 도구 ⋮ 기억 좌우 2단. 칸(/mh, Pane) = 나무 표(Project : Type : 모델:추론) → team claude → 예약 묶음.
// · Reads: config (MODS_HARNESS_CONFIG, else <plugin>/config/local.config.json) · session-lane registry (read only)
//   · launchctl list · ~/Library/LaunchAgents/*.plist · crontab -l · team claude status addresses (curl GET, only
//   while the pane is up; names in the answer are swapped for random ids at once, accounts.js · team.js). Writes: only
//   its own live file <live_dir>/<registry id>.json (temp file → mv), one writer per file — keyed by registry id so
//   /clear (new uuid, same row) does not cut the tree (기둥 ③ 실측 · 봇  계약 10-17). No id known =
//   no live file. r2 B (봇  ③): a session row pressed moves the person's own tmux client (the one client
//   that can type looking at this window; two or more = refused, 봇 F1) to that session's window, after noting the
//   way back in one tmux user option per client (@mh-back-<tty>); the session gone to reads it (list-clients ·
//   show-options, while its pane is up) and its «← 돌아가기» moves the client back and drops the note (jump.js). No
//   other client moves (F2): a window that is not its session's current one is shown through a view session of ours
//   (grouped, dropped by tmux when the client leaves it); no window of any session is selected. r3a (설계 메모): with ui.team_claude_control on, a press of the selected account's action line POSTs to
//   the Claude status address's own origin ($.http.fetch — never curl, whose argv would carry the account name).
// Loader rules (claude plugin validate): `$` only as `$.noun.method(...)` literals, passed only to top-level functions
// of this file · `$.env.get` with literal names · `on('<literal>')` · no dynamic import.
import { parsePlistXml, isBinaryPlist } from './lib/plist.js'
import { noLaunchctl, parseLaunchctlList, parseCrontab, jobFromPlist, jobFromCron, jobFromSession, sessionCrons, buildGroups, cronHead, ownJobs, OWN_SHOW } from './lib/jobs.js'
import { parseEntry, parseLive, flatten, familyOf, findMe, myRegistryId, meFirst, bandTreeSegments, paneTree, splitFamilies, othersHead, subsPressOf, aliveAfterEnd, overOf, LOOK } from './lib/tree.js'
import { noteSpawn, noteEnd, syncList, shownAgents, pruneAgents, parseAgents, threadNote, noteThread, mergeThreads, threadRecord } from './lib/agents.js'
import { sigOf, matchMemory, tierOf, callOk, countMemory, memorySegments, memoryRows, knownMemory, subLoop } from './lib/memory.js'
import { callOf, emptyCalls, startCall, endCall, toolKinds } from './lib/calls.js'
import { teamModel, teamBlock, teamHead, TEAM_SECTIONS, isClaudeAnswer, accountKeyOf, accountArrow } from './lib/team.js'
import { SKIN_DEFAULT, skinOf, skinCommand, railLabel, railState } from './lib/skin.js'
import { stripNames, nameOf, teamRequest, orderPlan, priorityRequest, actWord, callNote, is2xx, ORDER_DIRS } from './lib/accounts.js'
import { systemSegments, systemPills, bandLines, paneLines, systemName, rowsOf, inlineRows, reaskRows, hintPlan, bandKeep, actionOf, backHead, PANE_PRESS } from './lib/band.js'
import { projectGroups, projectLines, endedToday, boundProjectOf, boundThreads, withThreadGroups, closePlan, shownGroups, childProjects, dispatchFailedOf } from './lib/project.js'
import { parseHidden } from '../session/core.js' // 10-20 패널 ✕: the projects taken off the list (read only — the session lane writes it)
import { paneHead, teamLegend } from './lib/legend.js'
import { labelOk, boardRoom, boardPath, parseBoard, boardSummary, projectLabel, foldBindings } from '../session/core.js'
import { uiSettings, boardSettings } from './lib/settings.js'
import { setBotDisplay } from './lib/display.js'
import { segText, segWidth, drawable, paneLook, pressRuns, PANE_BG, HOVER_BG } from './lib/text.js'
import { MODEL_PRESS, EFFORTS, withPick, tidyPick, nextOf, pickerRows, namesModel } from './lib/modelpick.js'
import { emptyUsage, seedUsage, addStep, addWall } from './lib/usage.js'
import { targetOf, rehome, parseHere, parseClients, pickClient, pickLanded, findWindow, backOption, parseBack, formatBack, splitPlace, jumpPlan, backHere, backPlan, REFUSE_TEXT, LOST, HERE_FMT, CLIENT_FMT, WINDOWS_FMT } from './lib/jump.js'
// 10-25 창 어댑터: every tmux argv is built in src/lib/window/tmux.js (pure); this file only runs them — own import line
import { sessionNameArgv, hereArgv, listWindowsArgv, listSessionsArgv, listClientsArgv, showOptionArgv, setOptionArgv, unsetOptionArgv } from '../lib/window/tmux.js'
import { pickBackend, TMUX_NAME } from '../lib/window/index.js' // which window tool this session is in (caps.jump)
// Same two lines in the four lane files: the validator follows $ only into same-file functions. The first call pins the verdict for this process (a later /clear changes the session id, the launcher's does not).
let optInAnchor
async function optedIn($) { if (optInAnchor === undefined) { const bot = await $.env.get('MODS_HARNESS_BOT'); const expected = await $.env.get('MODS_HARNESS_SESSION_ID'); optInAnchor = Boolean(bot) && Boolean(expected) && expected === await $.session.id() } return optInAnchor }

const PANE_ID = 'mh'
const BEAT_MS = 30 * 1000
const SESSIONS_MS = 5 * 1000
const LAUNCHCTL_MS = 60 * 1000
const SLOW_MS = 5 * 60 * 1000
const PLIST_MAX_AGE_MS = 10 * 60 * 1000
const TEAM_MS = 30 * 1000
const REGID_REF = { plugin: 'mods-harness', key: 'mh.registryId' }
// G7 running totals (lib/usage.js) — read by the session lane at every turn.complete into the registry row.
const USAGE_REF = { plugin: 'mods-harness', key: 'mh.usage' }
// 10-20 패널 ✕: a confirmed 닫기 press writes its order here, as the press goes through; the session lane takes it right
// after (session/index.js on ui.press · core.js panelOrderCheck) — this lane writes no registry row and closes no window.
const PANEL_ORDER_REF = { plugin: 'mods-harness', key: 'mh.panelOrder' }
// K3 (주인 10-21 21:43 · 봇 19:39 권고): the session lane's count of thread messages that fell to this session although
// a child was on that thread (session/index.js dispatchFailed) — read only, every 5 s with the registry, drawn in the head.
const DISPATCH_REF = { plugin: 'mods-harness', key: 'mh.dispatch' }

// Module state = caches only. A hot reload empties it; session.start fills it again within seconds
// (the G7 totals come back from $.state, see usageReady).
const S = {
  cfg: null,
  cfgAt: null, // 10-20 R5: { path, home, key } of the config file as last read (reloadBoard)
  now: 0,
  me: { uuid: null, bot: null, startedAt: 0, registryId: null },
  act: { state: 'idle', since: 0, model: null, effort: null },
  entries: new Map(), // registry file name → last good entry
  lives: new Map(), // live file name → last good record
  memory: {}, // label → { at, ok, n, tier } (n = calls since the session started)
  calls: emptyCalls(), // 도구: skills · MCP tools · plugins running now and the last of each kind
  pane: { placed: false, placement: null }, // the /mh pane: drawn? 'dock' (right of the transcript) or 'inline'
  view: null, // the band's last viewport { rows, isFullscreen }
  bandRoom: null, // rows the band had for its own lines at its last drawing
  openRoom: null, // bandRoom as it was when the pane was opened — kept while the pane is up (band.js inlineRows)
  paneRows: null, // body rows of the pane while it sits inline (Pane render) — for band.js reaskRows
  reasked: null, // the window size («<cols>x<rows>») a height was last re-asked for — once per size
  dispatchFailed: 0, // K3: thread messages that fell to this session although a child was on that thread (mh.dispatch)
  team: { model: null, fetchedAt: null }, // team claude, name-free (team.js teamModel)
  jobs: { plist: [], cron: [], list: new Map(), loaded: false, error: null, dirMtime: null, plistAt: 0, collectedAt: null },
  groups: [],
  expanded: null,
  cronAll: false, // «/mh 예약»: every bot's 예약, not only this bot's (jobs.js cronHead · 설계 메모 숨김 기능)
  projDetail: false, // «/mh 프로젝트»: each project's sessions and its board's last lines (project.js · 설계 메모)
  projOpen: new Set(), // 10-19 I1: the project lines pressed, one by one — open ones, or under projDetail the shut ones (project.js projKey · session only)
  boards: { files: new Map(), rooms: new Map(), byProject: new Map() }, // consult boards, read while the pane is up
  timers: [],
  busy: {},
  sig: '',
  liveDirReady: false,
  live: { busy: false, due: false }, // 봇 R3: a live write is out · a beat came while it was (beat — one writer)
  usage: null, // G7 totals of this process (kept across /clear) — seeded at session.start, see seedMeter
  // v3 (봇 B · ②): screen state of this session only — nothing written but the press count
  toolsOpen: new Set(), // 도구 kinds folded open in the band ('skill' · 'mcp' · 'plugin')
  foldOpen: false, // the pane's «▶ 외 N묶음» opened
  // v3 r2: TeamClaude sections pressed open ('claude' · 'codex' · 'grok' · 'cursor' · 'gemini') · T4 (10-18): every one
  // open to begin with — the pane scrolls now, so nothing has to be folded to fit (each section's head still folds it)
  teamOpen: new Set(TEAM_SECTIONS),
  press: null, // { n, last: { key, at } } — this session's presses of its own Buttons (live file `press`, 봇)
  // r3a (설계 메모): TeamClaude account controls — screen state of this session only, never written anywhere
  teamSel: null, // the selected account's random id (accounts.js), or null
  // 10-21 (주인): the pane's focus ring — the key it sits on (ui.focus), the
  // Button keys of the last pane drawing in order, and an account whose row the ring is to land on after the next drawing
  ring: null,
  paneKeys: [],
  ringWant: null,
  teamConfirm: null, // { id, at } while that account's delete waits for its confirm (CONFIRM_MS), else null
  // 10-20 패널 ✕: { project, kind: 'close' | 'hide', ids, keep, at } while a project's ✕ waits for its confirm (CONFIRM_MS,
  // the same rules as teamConfirm: 취소 · any other press · the pane closing let it go), else null — screen state only
  projClose: null,
  hidden: {}, // 10-20: hidden-projects.json as last read (core.js parseHidden) — {} = none or unread
  teamNote: null, // { id, text }: the last control press's short result («바꾸기 ✓» …) for that account — fixed words and a status number, no name
  teamBase: null, // origin of the configured address that answered with the Claude accounts — the only place written to
  teamEpoch: 0, // r3c: changes of teamBase so far — a read landing with another address (or none) adds 1, so A → B → A is 2
  teamVoids: 0, // r3d: cancel-class events on the person's side so far — 취소, a press of anything else, the pane closing (voidPresses)
  teamBusy: false, // a control press under way, from its first request to its re-read (teamPress)
  // status reads in the order they began: of those that finish, only the newest-begun is kept · needed = the first read
  // begun after the last write — until one of those lands, the model may be from before that write (봇 F2)
  teamRead: { begun: 0, landed: 0, needed: 0 },
  // r2 (봇 ① · ②″): this session's subagents (agents.js book: agent.spawn · turn.complete ·
  // $.agent.list) and the Slack threads it saw (threadTs → head) — both go out with the live file; «▶ 다른 봇» opened
  agents: new Map(),
  threads: new Map(),
  othersOpen: false,
  lowerOpen: true, // r2 (봇): the pane's lower part (TeamClaude) — folded by its boundary line (f)
  cronOpen: false, // r2 (owner 15:41): the pane's «◷ 예약 … ▸» line opened (r · click)
  // 10-24 (B): the 예약 lines pressed open (jobs.js jobId — stays the same across redraws and re-reads), each showing its
  // detail; apart from the whole-list fold (S.expanded · mh-own). Screen state of this session only.
  jobOpen: new Set(),
  // r2 B (봇 ①): a bot's 하위 folded open/shut by its fold mark — root id → open, as pressed; not in the map =
  // this session's family open, every other shut (screen state of this session only)
  kidsOpen: new Map(),
  // R6 (봇 ②): the sessions whose subagents are pressed open — every other one's folded into «서브 N ▸»
  subsOpen: new Set(),
  // r2 C: this session's own wake-ups as the last classic Stop gave them (jobs.js sessionCrons)
  crons: [],
  here: { at: 0, v: null }, // r2 B: this pane's tmux window id (jump.js parseHere), read again after HERE_MS
  back: null, // r2 B: { tty, gen, from, landing } while a jump landed on this window — the pane's «← 돌아가기» line (b · click)
  backAsked: null, // r2 E: the landing this pane last asked the keys for (one ask per landing)
  jumpSeq: 0, // 봇 R2: jumps planned in this process — with the time, each hop's own mark (jump.js stampOf)
  jumpTail: Promise.resolve(), // 봇 F4: the jump or way back under way — the next one waits for it (takeJumpTurn)
  stops: { seen: 0, applied: 0 }, // 봇 F7: classic Stops in the order they came · the newest whose list was kept
  // r3b (/mh 모양 · 봇 Q2·Q3: the default = the current shape, a switch lasts for this session only —
  // never written anywhere): the skin's name (skin.js SKINS) · skinOf(S.skin) = which parts it changes
  skin: SKIN_DEFAULT,
  rail: new Map(), // r3b 3안: tool_use_id → { start, end } as this mod saw the engine's tool line drawn (RAIL_KEEP newest)
  // 10-20 모델 칸 (modelpick.js): the picker under ▣ open · the pick { model?, effort? } the main loop's requests go with
  // from the next one until 원래대로 or the person's /model (null = the engine's own; the ▣ line says «(고름)» while a pick
  // is on — a /model of the person wins: the pick let go, ▣ «풀림(/model)» · personSaid · settleModel; /effort <word> lets
  // the picked effort go) · base = the main loop's last step as it came in (the engine's own values). This process's
  // memory only, written nowhere: a reload or a restart starts with no pick (session.start · startUi); a /clear keeps it
  // (no session.start then — kit «/clear (new uuid …)»), as the engine keeps its own /model, the ▣ line still saying so.
  mdl: { open: false, pick: null, base: null },
}
const RAIL_KEEP = 200
const CONFIRM_MS = 10 * 1000
const HERE_MS = 60 * 1000

function errText(err) {
  return String((err && err.message) || err).replace(/\s+/g, ' ').slice(0, 80)
}

// 칸 and 띠: painted black by us, row by row (text.js paneLook · v2 2번 · 설계 메모 «띠도 검정»): every Text carries the
// black (or a usage cell's bar color) and an ink chosen for it — never dimColor, never a theme key, so the person's
// theme reaches neither.
function paneTextProps(s) {
  const look = paneLook(s)
  const p = { children: [s.text], wrap: 'truncate-end', color: look.color, backgroundColor: look.backgroundColor }
  if (look.bold) p.bold = true
  return p
}

// One row: the ║ (the middle divider, docked pane only — 봇 v2 2번 «색 있는 2줄» · 설계 메모: 209, a block's head row
// in its block's color), the segments, then spaces to the edge, all on black, so no cell of the row is left to the
// theme. `segs` = null → an empty black row. The band's rows are drawn the same way, without the ║.
// v3 D (봇 D · owner 23:23): each run of one `press` (text.js pressRuns) is a plain
// Button — a click, Enter under the focus ring (arrows move it), its hotkey (the engine draws «s: ») — inside a keyed Box
// of its own, the hover scope its letters light in (HOVER_BG). The padding joins a pressed last run when the whole row is
// one press, so the press reaches the row's edge; a row of several presses keeps its padding plain (r3a: the action line
// ends in «d: 지우기» — a click in its empty right half must not start a delete). `ui` = what $.ui.resolve gave · `site` =
// this drawing's pressSite; no site or no Button = plain Texts.
// P1: `fill` = a BAR name the row's padding is painted in (the title band, legend.js paneHead) — the letters carry it already.
function paneRow(ui, key, segs, cols, divider, mark, site, fill) {
  const { Box, Text, Button } = ui
  const lead = divider ? [{ text: '║', color: mark || 'divider' }, { text: ' ' }] : []
  const all = drawable([...lead, ...(segs || [])])
  const pad = cols - segWidth(all)
  if (pad > 0) {
    const last = all[all.length - 1]
    const one = new Set(all.filter((s) => s.press).map((s) => s.press)).size === 1
    // 10-20: the ▣ line holds the model cell's press too — its padding stays ▣'s, as before the cell
    all.push(last.press && (one || last.press === PANE_PRESS) ? { text: ' '.repeat(pad), press: last.press } : { text: ' '.repeat(pad), ...(fill ? { bar: fill } : {}) })
  }
  if (!site || typeof Button !== 'function') {
    return Box({ key, flexDirection: 'row', backgroundColor: PANE_BG, children: all.map((s) => Text(paneTextProps(s))) })
  }
  const kids = []
  let g = 0
  for (const run of pressRuns(all)) {
    if (!run.press) run.segs.forEach((s) => kids.push(Text(paneTextProps(s))))
    // r2 (봇 ②): the group Box is painted too — in fullscreen the engine's «s: » and the run's first
    // bold Texts came out on the theme's background (light: white cells), the row Box's color not reaching them.
    else kids.push(Box({ key: 'p' + g++, flexDirection: 'row', backgroundColor: PANE_BG, children: [Button(buttonProps(run, key, site, Text))] }))
  }
  return Box({ key, flexDirection: 'row', backgroundColor: PANE_BG, children: kids })
}

// A run's Button: its key = the press key in the band (stable, so the focus ring stays on it across redraws), the press
// key «@» the line's key in the pane (a project line and its head do the same thing but are two stops); a key drawn
// twice in one site gets «#2». The first Button of a site starts its focus ring (봇 autoFocus) — in
// the band the first after ▣: measured 10-18 00:1x in a hidden copy, ctrl+x tab put the ring on ▣ and the first Enter
// closed the pane; the ring now starts on the first 도구 head (Enter = fold it open), ▣ one arrow up. 10-20: the ▣ line's
// model cell and the picker's choices under it are passed over the same way (an Enter there would change the model).
function buttonProps(run, rowKey, site, Text) {
  let key = site.band ? run.press : run.press + '@' + rowKey
  if (site.keys.has(key)) {
    let n = 2
    while (site.keys.has(key + '#' + n)) n++
    key = key + '#' + n
  }
  site.keys.add(key)
  // label = the control's name (kit 10-18: left out, it is the children's text — the row's padding too)
  const label = segText(run.segs).replace(/\s+/g, ' ').trim() || run.press
  const p = { key, label, plain: true, children: run.segs.map((s) => Text({ ...paneTextProps(s), hover: { backgroundColor: HOVER_BG } })), onPress: () => site.act(run.press) }
  if (run.hotkey) p.hotkey = run.hotkey
  if (!site.focused && !(site.band && (run.press === PANE_PRESS || run.press === MODEL_PRESS || run.press.startsWith(MODEL_PRESS + '-')))) {
    p.autoFocus = true
    site.focused = true
  }
  return p
}

// One drawing's Buttons: which site (band or pane), the keys drawn so far, whether the first took autoFocus, and what a
// press runs (pressAction, at the bottom of the ui.press chain).
function pressSite($, band) {
  return { band, keys: new Set(), focused: false, act: (press) => pressAction($, press) }
}

function safeName(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_')
}

async function loadSettings($) {
  const home = (await $.env.get('HOME')) || ''
  let path = (await $.env.get('MODS_HARNESS_CONFIG')) || ''
  if (!path) path = $.plugin.root + '/config/local.config.json'
  let raw = null
  S.cfgAt = { path, home, key: null }
  try {
    if (await $.fs.exists(path)) {
      const st = await cfgStamp($, path)
      raw = JSON.parse(st.text !== null ? st.text : await $.fs.read(path, 'text'))
      S.cfgAt.key = st.key
    }
  } catch (err) {
    raw = null
  }
  const s = uiSettings(raw, home)
  setBotDisplay(s.botDisplay)   // ui.bot_display (주인 10-18 18:21): drawn names only
  return s
}

// ── 10-20 R5 (주인 12:27 · 봇 하위 세션): the settings were read once, at
// session.start (and /clear starts none — refreshSessions below) — so a project added or taken off the list
// (mods_project_add.py) reached spawn_child at once (the session lane reads its config again when the file moved:
// session/index.js loadCfg) but the screen's grouping only after a restart. Now the board part (session.projects ·
// board_root · project_rooms · binding_file · hidden file · end rules — settings.js boardSettings) is read again the same
// way: the file's mtime, or (no usable stat) a fingerprint of its text, moved → read; a file missing or not valid JSON
// (caught mid-write) keeps the last good settings. The rest of the settings stay as read at the start. ──
function textKey(text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  return 't' + text.length + ':' + h
}
async function cfgStamp($, path) {
  let st = null
  try { st = await $.fs.stat(path) } catch (err) { st = null }
  if (st && st.kind !== 'dir' && Number.isFinite(st.mtimeMs)) return { key: 'm' + st.mtimeMs, text: null }
  const text = String(await $.fs.read(path, 'text'))
  return { key: textKey(text), text }
}
async function reloadBoard($) {
  const at = S.cfgAt
  if (!at || !at.path || !S.cfg) return
  try {
    if (!(await $.fs.exists(at.path))) return
    const st = await cfgStamp($, at.path)
    if (st.key === at.key) return
    const raw = JSON.parse(st.text !== null ? st.text : String(await $.fs.read(at.path, 'text')))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    S.cfg.board = boardSettings(raw, at.home)
    at.key = st.key
  } catch (err) {
    /* keep the last good settings */
  }
}

async function tmuxSessionName($) {
  const pane = await $.env.get('TMUX_PANE')
  if (!pane) return null
  try {
    const r = await $.process.run(sessionNameArgv(pane), { timeoutMs: 5000 })
    const name = r.exitCode === 0 ? r.stdout.trim() : ''
    return name || null
  } catch (err) {
    return null
  }
}

// ── live file (this session's activity · 봇 10-17: last_seen 으로 «응답 없음» 판정) ──
// One write at a time, each to its end (봇 R3: an older write held up, a newer one written and moved in, then the
// older one moved in over it — the file kept the old list and an older last_seen). A beat asked while a write is out
// only marks the file stale; the write under way writes once more when it is done, from the state as it is then (the
// newest list, a fresh last_seen) — so the file's last write is always the newest state. A write that never finished
// would hold the later ones (the file then goes quiet: the others' «응답 없음» says so).
async function beat($) {
  if (!S.cfg || !S.me.registryId) return
  S.live.due = true
  if (S.live.busy) return
  S.live.busy = true
  try {
    while (S.live.due) {
      S.live.due = false
      await writeLive($)
    }
  } finally {
    S.live.busy = false
  }
}

async function writeLive($) {
  const id = S.me.registryId
  if (!S.cfg || !id) return
  try {
    if (!S.liveDirReady) {
      const m = await $.process.run(['mkdir', '-p', S.cfg.liveDir], { timeoutMs: 5000 })
      S.liveDirReady = m.exitCode === 0
    }
    const now = await $.clock.now()
    const rec = {
      version: 2, id, session_uuid: S.me.uuid, bot: S.me.bot, activity: S.act.state, since: S.act.since,
      last_seen: now, model: S.act.model, effort: S.act.effort, usage: S.usage, press: S.press,
      // r2: what other windows draw under this session — its subagents and the heads of the threads it saw
      agents: shownAgents(S.agents, now).map((a) => ({ id: a.id, type: a.type, description: a.description, model: a.model, parentId: a.parentId, status: a.status, at: a.at, endAt: a.endAt })),
      threads: threadRecord(S.threads),
      // r2 C: this session's wake-ups, for every window's 예약 칸 (jobs.js jobFromSession)
      crons: S.crons,
    }
    const path = S.cfg.liveDir + '/' + safeName(id) + '.json'
    const tmp = path + '.tmp-' + now
    await $.fs.write(tmp, JSON.stringify(rec))
    await $.process.run(['mv', '-f', tmp, path], { timeoutMs: 5000 })
  } catch (err) {
    /* next beat retries */
  }
}

// ── G7 meter (observe only: a failure here never touches the turn) ──
// Seeded once at session.start, before any turn: from $.state when it holds totals (docs: $.state survives a hot
// reload, and register + session.start run again after one), else zero. Adding is then synchronous, so requests
// that answer together (parallel subagents) cannot overwrite each other's count.
async function seedMeter($) {
  if (S.usage) return
  let seed = null
  try { seed = seedUsage((await $.state.get(USAGE_REF)).value) } catch (err) { seed = null }
  if (!S.usage) S.usage = seed || emptyUsage()
}

// No await between reading and replacing S.usage, so two answers cannot interleave there.
async function bumpUsage($, fn) {
  try {
    S.usage = fn(S.usage || emptyUsage())
    await $.state.set(USAGE_REF, S.usage)
  } catch (err) {
    /* metering is observe-only: a failure never reaches the turn; the totals stay in memory and the live file */
  }
}

async function setActivity($, state) {
  if (S.act.state === state) return
  S.act.state = state
  try { S.act.since = await $.clock.now() } catch (err) { /* keep old */ }
  await beat($)
  await redraw($)
}

// ── reading ──
// 10-19 ①b: session.binding_file folded the way the session lane folds it (core.js foldBindings) · no file = nothing
// bound · a read that fails keeps the last good fold
async function readBindings($) {
  const f = S.cfg && S.cfg.board ? S.cfg.board.binding_file : null
  if (!f) { S.bindings = null; return }
  try {
    S.bindings = (await $.fs.exists(f)) ? foldBindings(String(await $.fs.read(f, 'text'))) : null
  } catch (err) {
    /* keep the last good fold */
  }
}

// 10-20 패널 ✕: the projects taken off the list (<session.state_dir>/hidden-projects.json — the session lane writes it,
// read only here) · no file = none · a read that fails keeps the last good one
async function readHidden($) {
  const f = S.cfg && S.cfg.board ? S.cfg.board.hidden_file : null
  if (!f) { S.hidden = {}; return }
  try {
    S.hidden = (await $.fs.exists(f)) ? parseHidden(String(await $.fs.read(f, 'text'))) : {}
  } catch (err) {
    /* keep the last good record */
  }
}

async function readJsonDir($, dir, cache, parse) {
  let names = []
  try {
    const list = await $.fs.list(dir)
    names = list.map((x) => (typeof x === 'string' ? x : x && x.name)).filter((n) => typeof n === 'string' && n.endsWith('.json'))
  } catch (err) {
    names = []
  }
  const keep = new Set(names)
  for (const k of [...cache.keys()]) if (!keep.has(k)) cache.delete(k)
  for (const n of names) {
    try {
      const v = parse(await $.fs.read(dir + '/' + n, 'text'))
      if (v) cache.set(n, v)
    } catch (err) {
      /* torn or vanished file: keep the last good copy */
    }
  }
}

// r2: the engine's list of this session's agents, read into the book (statuses: running → completed/failed/killed).
// A change redraws and goes out with a beat at once (other windows read the live file).
// `noted` = the book already changed (a run end marked at once): drawn and written even when the list adds nothing.
async function syncAgents($, noted) {
  let list = null
  try { list = await $.agent.list() } catch (err) { list = null }
  const now = await $.clock.now()
  const changed = list ? syncList(S.agents, list, now) : false
  const before = S.agents.size
  pruneAgents(S.agents, now)
  if (noted || changed || S.agents.size !== before) {
    S.sig = ''
    await beat($)
    await redraw($)
  }
}

async function refreshSessions($) {
  if (!S.cfg || S.busy.sessions) return
  S.busy.sessions = true
  try {
    S.now = await $.clock.now()
    // /clear hands the session a new uuid with no new session.start (2.1.296 types: session.end reason clear «the
    // process goes on under a new session id»), so the uuid is read again here. The registry id is kept across it.
    const before = { uuid: S.me.uuid, id: S.me.registryId }
    try {
      const uuid = await $.session.id()
      if (uuid) S.me.uuid = uuid
    } catch (err) {
      /* keep the old uuid */
    }
    await readJsonDir($, S.cfg.registryDir, S.entries, parseEntry)
    await readJsonDir($, S.cfg.liveDir, S.lives, parseLive)
    await reloadBoard($) // 10-20 R5: the project list and the board settings, again when the config file moved
    await readBindings($) // 10-19 ①b: the shared binding log, folded (read only)
    await readHidden($) // 10-20 패널 ✕: the projects taken off the list (read only)
    regroup() // r2 C: the other sessions' wake-ups ride in their live files
    let stateId = null
    try {
      const { value } = await $.state.get(REGID_REF)
      stateId = value
    } catch (err) {
      stateId = null
    }
    S.me.registryId = myRegistryId(S.me.registryId, stateId, [...S.entries.values()], S.me.uuid)
    try {
      const { value } = await $.state.get(DISPATCH_REF)
      S.dispatchFailed = dispatchFailedOf(value)
    } catch (err) {
      /* keep the last count */
    }
    if (S.me.uuid !== before.uuid || S.me.registryId !== before.id) await beat($)
    await syncAgents($)
    await checkPane($)
    await refreshBoards($)
    await refreshBack($)
    await redraw($)
  } catch (err) {
    /* next tick */
  } finally {
    S.busy.sessions = false
  }
}

// ── consult boards (설계 메모 · 세션 갈래 REGISTRY.md «ui 갈래가 읽을 것»): per project, the board note of each parent
// whose children work on it — <board_root>/<회의방>/boards/<parent id>--<project>.md, 회의방 = the project label when
// it is a room folder that exists, else session.project_rooms (core.js boardRoom · boardPath · parseBoard ·
// boardSummary — the session lane's own functions, read only). Only while the pane is up; a note is read again only
// when its mtime moved; a room's existence is asked at most once a minute. ──
const ROOM_CHECK_MS = 60 * 1000
async function roomExists($, root, name) {
  const hit = S.boards.rooms.get(name)
  if (hit && S.now - hit.at < ROOM_CHECK_MS) return hit.ok
  let ok = false
  try { ok = await $.fs.exists(root + '/' + name) } catch (err) { ok = false }
  S.boards.rooms.set(name, { ok, at: S.now })
  return ok
}

async function readBoardNote($, path) {
  let st = null
  try { st = await $.fs.stat(path) } catch (err) { st = null }
  if (!st) { S.boards.files.delete(path); return null }
  const had = S.boards.files.get(path)
  if (had && had.mtimeMs === st.mtimeMs) return had
  try {
    const rec = { mtimeMs: st.mtimeMs, entries: parseBoard(await $.fs.read(path, 'text')) }
    S.boards.files.set(path, rec)
    return rec
  } catch (err) {
    return had ? { ...had, error: true } : { mtimeMs: st.mtimeMs, entries: [], error: true }
  }
}

async function refreshBoards($) {
  const cfg = S.cfg ? S.cfg.board : null
  if (!cfg || !S.pane.placed || S.busy.boards) return
  S.busy.boards = true
  try {
    const byProject = new Map()
    if (!cfg.board_root) {
      S.boards.byProject = byProject // empty = every project «게시판 설정 없음»
      return
    }
    const notes = new Map() // project → [path]
    for (const e of S.entries.values()) {
      if (!e || e.role !== 'child' || typeof e.parent_id !== 'string' || !e.parent_id || !labelOk(e.project)) continue
      const project = projectLabel(cfg.projects, e.project)   // 10-18: the session lane's board path uses the listed name too
      const have = new Set()
      for (const n of [project, cfg.project_rooms[project]]) if (n && await roomExists($, cfg.board_root, n)) have.add(n)
      const room = boardRoom(project, cfg, (n) => have.has(n))
      if (!notes.has(project)) notes.set(project, new Set())
      if (room) notes.get(project).add(boardPath(cfg, room, e.parent_id, project))
    }
    for (const [project, paths] of notes) {
      const c = { decisions: 0, blocks: 0, questions: 0, open: 0 }
      let found = 0
      let error = false
      let last = []
      for (const path of paths) {
        const rec = await readBoardNote($, path)
        if (!rec) continue
        found++
        if (rec.error) error = true
        const sum = boardSummary(rec.entries, 0)
        c.decisions += sum.decisions.length
        c.blocks += sum.blocks.length
        c.questions += sum.questions
        c.open += sum.openQuestions
        last = [...last, ...rec.entries.slice(-3)]
      }
      last.sort((a, b) => String(a.at).localeCompare(String(b.at)))
      byProject.set(project, found ? { status: error && !c.decisions && !c.blocks && !c.questions ? 'error' : 'ok', counts: c, last: last.slice(-3) } : { status: 'none' })
    }
    S.boards.byProject = byProject
  } catch (err) {
    /* keep the last good counts */
  } finally {
    S.busy.boards = false
  }
}

// The board a project shows: no board_root = «설정 없음» for all; else what was read (a project with no child row has
// no board yet = «게시판 없음»).
function boardOf(project) {
  if (!S.cfg || !S.cfg.board || !S.cfg.board.board_root) return { status: 'unset' }
  return S.boards.byProject.get(project) || { status: 'none' }
}

async function readPlist($, path) {
  let text = null
  try { text = await $.fs.read(path, 'text') } catch (err) { text = null }
  if (text === null || isBinaryPlist(text)) {
    const r = await $.process.run(['plutil', '-convert', 'xml1', '-o', '-', path], { timeoutMs: 10000 })
    if (r.exitCode !== 0) return null
    text = r.stdout
  }
  try { return parsePlistXml(text) } catch (err) { return null }
}

async function refreshPlists($, force) {
  const dir = S.cfg.launchAgentsDir
  let st = null
  try { st = await $.fs.stat(dir) } catch (err) { st = null }
  const mtime = st ? st.mtimeMs : null
  if (!force && S.jobs.loaded && mtime === S.jobs.dirMtime && S.now - S.jobs.plistAt < PLIST_MAX_AGE_MS) return
  const jobs = []
  let names = []
  try {
    names = (await $.fs.list(dir)).map((x) => (typeof x === 'string' ? x : x && x.name)).filter((n) => typeof n === 'string' && n.endsWith('.plist'))
  } catch (err) {
    names = []
  }
  for (const n of names.sort()) {
    const obj = await readPlist($, dir + '/' + n)
    const job = jobFromPlist(obj, n)
    if (job) jobs.push(job)
  }
  S.jobs.plist = jobs
  S.jobs.dirMtime = mtime
  S.jobs.plistAt = S.now
}

async function refreshLaunchctl($) {
  let r
  try {
    r = await $.process.run(['launchctl', 'list'], { timeoutMs: 15000 })
  } catch (err) {
    if (!noLaunchctl(err)) throw err
    // no launchctl on this machine (Linux): nothing to read is not a failure — crontab and the sessions' wake-ups still show
    S.jobs.list = new Map()
    S.jobs.error = null
    S.jobs.collectedAt = S.now
    return
  }
  if (r.exitCode === 0) {
    S.jobs.list = parseLaunchctlList(r.stdout)
    S.jobs.error = null
    S.jobs.collectedAt = S.now
  } else {
    S.jobs.error = 'launchctl ' + r.exitCode
  }
}

async function refreshCrontab($) {
  const r = await $.process.run(['crontab', '-l'], { timeoutMs: 10000 })
  // exit 1 + "no crontab for <user>" = an empty table, not an error
  S.jobs.cron = r.exitCode === 0 ? parseCrontab(r.stdout).map((c, i) => jobFromCron(c, i)) : []
}

// r2 C: every live session's wake-ups under its bot — this session's from memory, the others' from their live files;
// a session gone quiet (last_seen older than staleMs) took its wake-ups with it (they live in its process).
function sessionJobs() {
  const out = []
  if (S.me.registryId && S.me.bot) for (const c of S.crons) out.push(jobFromSession(c, S.me.bot, S.me.registryId))
  // 봇 F5: a session the registry calls ended (or failed) has no wake-ups left, however fresh its live file still is
  // 10-24 (A): ended = the one end rule (tree.js overOf) — the registry, or the live file itself saying so
  const byId = new Map()
  for (const e of S.entries.values()) if (e && typeof e.id === 'string') byId.set(e.id, e)
  for (const r of S.lives.values()) {
    if (!r || r.id === S.me.registryId || !Array.isArray(r.crons) || !r.crons.length) continue
    if (overOf(byId.get(r.id) || null, r)) continue
    if (!Number.isFinite(r.last_seen) || S.now - r.last_seen > S.cfg.staleMs) continue
    if (typeof r.bot !== 'string' || !r.bot) continue
    for (const c of sessionCrons(r.crons)) out.push(jobFromSession(c, r.bot, r.id))
  }
  return out
}

function regroup() {
  // 10-20: no log-mtime «last run» for interval jobs any more (schedule.js nextRun — it was a guess drawn as a time)
  const jobs = [...S.jobs.plist, ...S.jobs.cron, ...sessionJobs()]
  S.groups = buildGroups(jobs, S.jobs.list, S.cfg.cronGroups, S.cfg.botNames, S.now)
}

async function refreshJobs($, level) {
  if (!S.cfg || S.busy.jobs) return
  S.busy.jobs = true
  try {
    S.now = await $.clock.now()
    if (level === 'full' || level === 'slow') {
      await refreshPlists($, level === 'full')
      await refreshCrontab($)
    }
    await refreshLaunchctl($)
    S.jobs.loaded = true
    regroup()
  } catch (err) {
    S.jobs.error = errText(err)
  } finally {
    S.busy.jobs = false
  }
  await redraw($)
}

// ── the pane's place (41번 P3: the band splits 도구 ⋮ 기억 only while the pane is docked on the right) ──
// The engine's own record says whether the pane is still up (closed by the person's mark or key, or never placed);
// where it sits comes from the Pane render props. Polled with the sessions, so a close shows within 5 seconds.
async function checkPane($) {
  try {
    const up = (await $.ui.panes()).some((x) => x && x.id === PANE_ID && x.isPlaced)
    if (!up) {
      S.pane = { placed: false, placement: null }
      S.openRoom = null
      S.paneRows = null
      S.reasked = null
      voidPresses() // a delete waiting for its confirm never outlives the pane (설계 메모), nor does a press under way (r3d)
    } else S.pane.placed = true
  } catch (err) {
    /* no pane surface: keep what we know */
  }
}

// ── team claude (봇 v1 ① · 41번 R2): status addresses read with curl (GET, no shell, 3 s cap), only while the
// pane is up. Each answer has its account names swapped for random ids at once (accounts.js stripNames — r3a, 설계 메모)
// and goes straight through teamModel, which keeps no name; the raw text is dropped. The write address (r3a, 설계 메모) =
// the origin of the configured address whose answer holds the Claude accounts — from the setting, never the answer. ──
function originOf(url) {
  try { return new URL(url).origin } catch (err) { return null }
}

// r3a: after a control press's write the model may be from before it until a read begun after the write lands
// (teamRead.needed) — so while it may be, every read starts, even with another under way: the re-read right after the
// write (a read the 30 s clock began before the request can answer from before it), and the read when the pane opens
// again (its re-read was skipped while the pane was closed — 봇 F2). Of the reads that finish, only the newest-begun
// is kept: an older answer landing late never covers a newer one.
async function fetchTeam($) {
  const urls = S.cfg ? S.cfg.teamUrls : []
  const stale = S.teamRead.landed < S.teamRead.needed
  if (!urls.length || !S.pane.placed || (S.busy.team > 0 && !stale)) return
  const seq = ++S.teamRead.begun
  S.busy.team = (S.busy.team || 0) + 1
  try {
    const results = []
    for (const url of urls) {
      const r = { url, ok: false, json: null, at: null }
      try {
        const p = await $.process.run(['curl', '-sS', '--max-time', '3', '--', url], { timeoutMs: 5000 })
        r.at = await $.clock.now()
        if (p.exitCode === 0) {
          const j = JSON.parse(p.stdout)
          if (j && typeof j === 'object' && !Array.isArray(j)) { r.ok = true; r.json = stripNames(j) }
        }
      } catch (err) {
        /* not answering = ✕ on the 중계 line */
      }
      results.push(r)
    }
    const at = await $.clock.now()
    if (seq > S.teamRead.landed) {
      S.teamRead.landed = seq
      const claude = results.find((r) => r.ok && isClaudeAnswer(r.json))
      const base = claude ? originOf(claude.url) : null
      // another server answering for the Claude accounts = other accounts, whatever their names (봇 F1): the
      // selection and a delete waiting for its confirm do not carry over, and a press under way stops (pressHolds)
      if (base !== S.teamBase) {
        S.teamEpoch += 1
        S.teamSel = null
        S.teamConfirm = null
      }
      S.teamBase = base
      S.team = { model: teamModel(results), fetchedAt: at }
    }
  } catch (err) {
    /* keep the last good model */
  } finally {
    S.busy.team -= 1
  }
  await redraw($)
}

// ── view ──
// registry id → live record; this session's own record comes from memory (fresher than its file) and is `self`.
function liveMap() {
  const m = new Map()
  for (const r of S.lives.values()) m.set(r.id, r)
  if (S.me.registryId) {
    m.set(S.me.registryId, { id: S.me.registryId, session_uuid: S.me.uuid, self: true, activity: S.act.state, since: S.act.since, last_seen: S.now, model: S.act.model, effort: S.act.effort, usage: S.usage })
  }
  return m
}

function view() {
  const cfg = S.cfg
  const entries = [...S.entries.values()]
  const live = liveMap()
  // 10-19: an ended row leaves at once (keep_ended_min 0) — but never this session's own (/clear can leave «ended» while it
  // runs) nor one whose window is still open (its live file beats after the end · bot-NNNNNN)
  // 10-24 (A): a row leaves by the one end rule (tree.js overOf — the registry or its own live file), the rule that draws it
  // ✓/✕; an ended row a shown row hangs under stays (flatten), so does this session's own
  const rows = flatten(entries, S.now, cfg.keepEndedMs, (e) => e.id === S.me.registryId || aliveAfterEnd(e, live.get(e.id), S.now, cfg.staleMs),
    (id) => live.get(id) || null)
  const meEntry = findMe(entries, S.me.registryId, S.me.uuid)
  const bot = S.me.bot || (meEntry && meEntry.bot) || '?'
  const own = bot === '?' ? null : bot
  const st = { loaded: S.jobs.loaded, error: S.jobs.error, collectedAt: S.jobs.collectedAt, nowMs: S.now, own, all: S.cronAll }
  const mine = own ? S.groups.find((g) => g.bot === own) || null : null
  // «/mh <봇>» opens that bot's group under this bot's own lines; «/mh <이 봇>» = all of this bot's jobs
  const open = S.expanded && S.expanded !== own ? S.groups.find((g) => g.bot === S.expanded) || null : null
  const head = cronHead(S.groups, st)
  return {
    rows,
    family: meEntry ? familyOf(rows, meEntry.id) : [],
    live,
    // r3b 4안 cockpit-pill: the ▣ line as capsules (band.js systemPills), with the account in use and what is left of its 5h
    system: skinOf(S.skin).hint === 'cockpit-pill'
      ? systemPills({ name: cfg.name, bot, model: S.act.model, effort: S.act.effort, state: S.act.state, acct: acctPill(), ...modelNext() })
      : systemSegments({ name: cfg.name, bot, model: S.act.model, effort: S.act.effort, state: S.act.state, ...modelNext() }),
    cron: head,
    // v3: «▶ 외 N묶음» opened (foldOpen) · this bot's last 예약 line folds its jobs open/shut when there are more than
    // OWN_SHOW (ownToggle = the same as «/mh <이 봇>»)
    // 10-20 ㉯: ui.cron_pin (default = the daily memory test) is always one of this bot's folded lines (jobs.js ownJobs)
    // 10-24 (B): S.jobOpen = the 예약 lines pressed open (their detail under them) · full = the list open whole (« ▾ 전부 접기»)
    cronPane: { head, ...ownJobs(mine, Boolean(own) && S.expanded === own, cfg.cronPin, S.jobOpen), open, others: S.cronAll ? S.groups.filter((g) => g !== mine && g !== open) : [],
      foldOpen: S.foldOpen, ownToggle: Boolean(mine) && mine.jobs.length > OWN_SHOW, full: Boolean(own) && S.expanded === own },
    memory: memorySegments(S.memory, S.me.startedAt, knownMemory(cfg.memoryRules)),
    memoryRows: memoryRows(S.memory, 3, knownMemory(cfg.memoryRules)),
    tools: { kinds: toolKinds(S.calls), open: S.toolsOpen, style: skinOf(S.skin).tools },
    fallback: { name: bot, state: S.act.state },
    heads: threadHeads(),
    entries, // 10-19 I: the whole registry (ended rows too) for a project's «끝 N» of today
  }
}

// r3b: the TeamClaude account in use for the ▣ capsule — its #P and what is left of its 5h window, or null
function acctPill() {
  const rows = S.team.model && Array.isArray(S.team.model.claude) ? S.team.model.claude : []
  const cur = rows.find((r) => r.current)
  return cur && cur.ses && Number.isFinite(cur.ses.pct) ? { p: cur.p, rest: 100 - Math.min(100, Math.round(cur.ses.pct)) } : null
}

// 10-20 모델 칸: what the ▣ line and the picker are drawn from — a turn.step that changed it redraws at once
function modelSig() {
  return JSON.stringify([S.act.model, S.act.effort, S.mdl.base, S.mdl.pick, S.mdl.fb, S.mdl.note])
}

// 10-20 모델 칸: what the ▣ line's model cell says besides what went out last (S.act) — `next` = the values the main
// loop's next request goes with while they differ from it («→ 다음 요청부터 …»), `picked` = a pick went out with it
// and differs from the engine's own (base) — a step the engine named with the picked value itself shows no «(고름)».
// `fb` = the last request went on the engine's fallback (nothing pending shown: the turn goes on with it) · `note` =
// «풀림(/model)» once after the person's /model or /effort let the pick go (봇 1번 · 3번).
function modelNext() {
  if (S.mdl.fb) return { next: null, picked: false, fb: true, note: S.mdl.note }
  const next = nextOf(S.mdl.pick, S.mdl.base, S.act)
  const moved = next.model !== S.act.model || next.effort !== S.act.effort
  return { next: moved ? next : null, picked: !moved && Boolean(tidyPick(S.mdl.pick, S.mdl.base)), fb: false, note: S.mdl.note }
}

// 10-20 모델 칸 ① (봇 1번): what the
// person's /model or /effort did, read after the engine ran it (command.run — measured in the hidden copy 2.1.296: «/model
// <이름>» and «/model» alone, whose run ends only once the engine's picker is left). /model: the session's model moved, or
// the name typed names the model it is on now (namesModel) = the person's word → the pick let go (원래대로), the engine's
// model the next request's, «풀림(/model)» on ▣ until it goes out. Unmoved with no name for it (refused · the picker left
// with Esc or on the model it was on — the run's result carries no text to tell them apart, measured) = the pick stays.
// /effort <word> = the person's word for the effort alone: a picked effort let go, a picked model kept; any other /effort
// (auto · nothing typed) = nothing known (no session effort getter) → nothing changed.
// A /model read as unmoved is not settled yet: measured on a75161d, «/model opus» typed while a turn ran — the engine said
// «Set model to Opus 5.5» but switched ~20 ms after the run settled (the run's end read the old model). So it waits in
// S.mdl.cmd = { before, args } and is looked at again LOOK_AGAIN_MS later and at every main request until the next turn's
// first one (where it is done with either way: refused and Esc stay unmoved there); a band choice meanwhile drops it.
const LOOK_AGAIN_MS = 300

async function personSaid($, e, before) {
  const args = String(e.args || '').trim()
  const base = S.mdl.base || { model: S.act.model, effort: null }
  let said = false
  if (e.command === 'model') {
    const after = await $.session.model()
    if (typeof after !== 'string' || !after) return
    S.mdl.cmd = { before, args }
    if (!settleModel(after)) {
      $.clock.after(LOOK_AGAIN_MS, () => { lookAgain($).catch(() => {}) })
      return
    }
  } else {
    const word = args.toLowerCase()
    if (!EFFORTS.includes(word)) return
    S.mdl.base = { model: base.model, effort: word }
    said = Boolean(S.mdl.pick && S.mdl.pick.effort)
    if (said) S.mdl.pick = S.mdl.pick.model ? { model: S.mdl.pick.model } : null
    if (said) S.mdl.note = '/effort'
  }
  S.sig = ''
  await redraw($)
}

// The /model waiting in S.mdl.cmd against the session's model now: moved, or the name typed names it = the person's
// word → the pick let go, the model the engine's own for the next request, «풀림(/model)» when there was a pick. true =
// settled so.
function settleModel(now) {
  const c = S.mdl.cmd
  if (!c || typeof now !== 'string' || !now) return false
  if (now === c.before && !namesModel(c.args, now)) return false
  S.mdl.cmd = null
  const base = S.mdl.base || { model: S.act.model, effort: null }
  S.mdl.base = { model: now, effort: base.effort }
  if (S.mdl.pick) S.mdl.note = '/model'
  S.mdl.pick = null
  return true
}

async function lookAgain($) {
  if (!S.mdl.cmd) return
  if (settleModel(await $.session.model())) {
    S.sig = ''
    await redraw($)
  }
}

// r2: every window's thread heads (their live files) with this session's own on top — a root head wins over a reply's.
function threadHeads() {
  const m = new Map()
  for (const [ts, h] of S.threads) m.set(ts, { channel: h.channel, text: h.text, root: h.root })
  for (const r of S.lives.values()) if (r.id !== S.me.registryId) mergeThreads(m, r.threads, S.cfg.slackChannels)
  return m
}

// r2: the subagents drawn under a session row — this session's from its own book, another's from its live file while
// that file is fresh (a window gone quiet keeps no «실행 중» rows on anyone's tree).
function agentsOf(entry, liveById) {
  if (!entry) return []
  if (entry.id === S.me.registryId) return shownAgents(S.agents, S.now)
  const live = liveById.get(entry.id)
  if (!live || !Number.isFinite(live.last_seen) || S.now - live.last_seen > S.cfg.staleMs) return []
  return shownAgents(parseAgents(live.agents), S.now)
}

function bandOf(v, maxRows, cols) {
  const dock = S.pane.placed && S.pane.placement === 'dock'
  const tree = bandTreeSegments(v.family, v.live, S.now, S.cfg.staleMs, cols, v.fallback)
  const picker = S.mdl.open ? pickerRows({ pick: S.mdl.pick, base: S.mdl.base, act: S.act }, cols) : null
  return bandLines({ dock, paneOpen: S.pane.placed, system: v.system, tree, tools: v.tools, memory: v.memory, cron: v.cron, memoryRows: v.memoryRows, picker }, maxRows, cols)
}

// The band's least rows now (band.js bandKeep): 4, more while a 도구 kind is folded open · 10-20: + the model picker's
// 2 rows while it is open (2 from 70 cells up — narrower, its rows go before the band's lowest ones: bandLines)
function keepNow() {
  return bandKeep(toolKinds(S.calls), S.toolsOpen) + (S.mdl.open ? 2 : 0)
}

// maxRows = the rows the pane has (scroll.bodyRows); left out = all lines (the redraw signature).
// team claude = as many rows as paneLines gives it; team.js fits itself to them (설계 메모).
// r2 (봇 ②″ · owner 15:22): the tree = this session's family by depth with its subagents and thread
// lines; the other families wait behind «▶ 다른 봇 N» until it is pressed (o) open.
// r2 B (봇 ①②): the tree in the configured style (ui.tree_style), each bot's 하위 open as pressed — this
// session's family open, every other folded — and «← 돌아가기» on top while a jump landed here.
// 10-19 H3: the one place that reads a project attached after the fact (a record apart from the registry — its form
// comes from bot-NNNNNN's work, not settled yet). Until then: none (every row its own registry `project`).
function attachOf(entry) {
  return boundProjectOf(entry, S.bindings)
}

// 10-19 ①b′: the threads each bot's OWN session heard — this window's book for itself, another's live file while it is
// fresh — for boundThreads; a 하위 (registry role child) or a window with no registry row is not read
function threadSources(entries) {
  const role = new Map((entries || []).filter(Boolean).map((e) => [e.id, e.role]))
  const main = (id) => role.has(id) && role.get(id) !== 'child'
  const meId = S.me.registryId
  const out = []
  if (meId && main(meId) && S.me.bot) out.push({ bot: S.me.bot, threads: threadRecord(S.threads) })
  for (const r of S.lives.values()) {
    if (!r || r.id === meId || !main(r.id) || !Number.isFinite(r.last_seen) || S.now - r.last_seen > S.cfg.staleMs) continue
    out.push({ bot: r.bot || r.id, threads: r.threads })
  }
  return out
}

function paneOf(v, cols, maxRows) {
  const { mine, others } = splitFamilies(v.rows, v.family)
  // 10-18 (주인 17:58): project labels read through the configured list · a child row's «남은 시간 또는 끝난 이유»
  const projectOf = (p) => projectLabel(S.cfg.board.projects, p)
  const opts = { agentsOf: (e) => agentsOf(e, v.live), heads: v.heads, channels: S.cfg.slackChannels, projectOf, endCfg: S.cfg.board.childEnd,
    style: S.cfg.treeStyle, isOpen: (id) => kidsOpen(id, v.family), subsOpen: (id) => S.subsOpen.has(id) }
  const tree = paneTree(mine, v.live, S.now, S.cfg.staleMs, cols, opts)
  const oHead = othersHead(others, S.othersOpen)
  const oRows = oHead && S.othersOpen ? paneTree(others, v.live, S.now, S.cfg.staleMs, cols, opts).rows : []
  const { groups, threads, hiddenN, endedN } = projView(v)
  const boards = new Map(groups.map((g) => [g.project, boardOf(g.project)]))
  // 10-19 I: each project line opens alone (S.projOpen) with its bots, its going sessions' settings, «끝 N» of today
  // 10-20 패널 ✕: a ✕ waiting for its confirm draws its question (until CONFIRM_MS has passed by the 5 s clock — the 닫기
  // press itself checks the exact time) · the projects taken off the list are counted in the head
  const pc = S.projClose && S.now - S.projClose.at <= CONFIRM_MS ? S.projClose : null
  const proj = projectLines(groups, boards, cols, S.projDetail, { open: S.projOpen, live: v.live, nowMs: S.now, heads: v.heads,
    channels: S.cfg.slackChannels, ended: endedToday(v.entries, S.now, projectOf, attachOf, v.live), threads, confirm: pc, hiddenN, endedN,
    dispatchFailedN: S.dispatchFailed })
  const team = (rows) => teamPart(cols, rows)
  // T5: the boundary line is the one TeamClaude line (team.js teamHead) · T4: the open lower part drawn whole, scrolled
  const lowerHead = (open, w) => teamHead(S.team.model, { urls: S.cfg.teamUrls.length, cols: w, open })
  // R7b (주인 22:14): the title line and the legend lead the body (legend.js —
  // the engine scrolls the body as a whole, so they sit at its top), the rest fitted to the rows left under them
  const head = paneHead(S.cfg.name, cols)
  const rest = Number.isFinite(maxRows) ? Math.max(1, maxRows - head.length) : maxRows
  // P2 (주인 10-19): thin rules over and under the legend and over each part — one share of the body's
  // rows (band.js allot 'rules': all or none, after this session's tree); the one over the legend comes first in the body
  // (rule-head) and is drawn under the title
  const body = paneLines({ back: S.back ? backHead(S.back.from) : null, treeHead: tree.header, treeRows: tree.rows, othersHead: oHead, othersRows: oRows, projHead: proj.head, projRows: proj.rows, team,
    teamOpen: S.teamOpen.size > 0, cron: v.cronPane, lowerOpen: S.lowerOpen, cronOpen: S.cronOpen, lowerHead, teamWhole: true, rules: true, headRule: true }, cols, rest)
  return body.length && body[0].key === 'rule-head' ? [head[0], body[0], ...head.slice(1), ...body.slice(1)] : [...head, ...body]
}

// The ◈ part's groups as drawn — the one place they are made, for the drawing (paneOf) and for a ✕ press (what it would
// close is what the screen shows): rows grouped by project (projectKeyOf), the bound threads' projects, and the projects
// taken off the list left out while nothing new came (project.js shownGroups).
function projView(v) {
  const ordered = meFirst(v.rows, v.family)
  const projectOf = (p) => projectLabel(S.cfg.board.projects, p)
  const threads = boundThreads(threadSources(v.entries), S.bindings, S.cfg.slackChannels, projectOf) // ①b′
  const all = withThreadGroups(projectGroups(ordered, v.live, S.now, S.cfg.staleMs, projectOf, attachOf), threads)
  // 10-21: + the ended projects (not in the list · r2: and a 하위 row under it in the WHOLE registry — v.entries, not the drawn rows)
  const shown = shownGroups(all, S.hidden, threads, S.cfg.board.projects, childProjects(v.entries, projectOf, attachOf))
  return { groups: shown.groups, threads, hiddenN: shown.hidden, endedN: shown.ended }
}

// A root's 하위 open? As pressed; else open for this session's own family, shut for every other.
function kidsOpen(id, family) {
  if (S.kidsOpen.has(id)) return S.kidsOpen.get(id)
  return Boolean(family && family.length && family[0].entry.id === id)
}

// team claude in `rows` rows (team.js teamBlock: the original screen's sections, every line within `cols`, never more
// lines than asked — 설계 메모); «no limit» (Infinity, band.js teamWhole) = the whole block — no line cap (봇 r1).
// r3a: the selection, a delete waiting for its confirm (drawn until CONFIRM_MS has passed by the 5 s clock — the press
// itself checks the exact time), the control setting and the last result go with it — the result only under the
// account it was for (one that lands after another account was selected is not drawn under that one).
// R7c (봇 ②): the TeamClaude marks' legend line (legend.js teamLegend) leads the block — only when there is a
// block (the part is open and has rows); it takes one of the rows, so the block is fitted to the rest.
function teamPart(cols, rows) {
  const c = S.teamConfirm
  const n = S.teamNote
  const room = rows === Infinity ? Infinity : rows - 1
  const block = room > 0 ? teamBlock(S.team.model, { urls: S.cfg.teamUrls.length, fetchedAt: S.team.fetchedAt, cols, rows: room, nowMs: S.now, open: S.teamOpen, headless: true,
    sel: S.teamSel, confirm: c && S.now - c.at <= CONFIRM_MS ? c.id : null, control: S.cfg.teamControl === true, note: n && n.id === S.teamSel ? n.text : null,
    usage: skinOf(S.skin).usage }) : []
  return block.length ? [Object.assign(teamLegend(cols), { legend: true }), ...block] : block
}

// Redraw only when what would be drawn changed (judged at a wide width, independent of the real one).
async function redraw($) {
  if (!S.cfg) return
  let sig = ''
  try {
    const v = view()
    // 60 rows: an expanded 도구 kind draws more than the 5 lines of old (v3)
    sig = bandOf(v, 60, 400).map(segText).join('\n') + '\n' + paneOf(v, 400).map((l) => segText(l.segs)).join('\n')
  } catch (err) {
    sig = 'error ' + errText(err)
  }
  if (sig === S.sig) return
  S.sig = sig
  try { await $.ui.invalidate('ui.render') } catch (err) { /* nothing drawn yet */ }
}

// ── start / stop ──
function stopTimers() {
  for (const t of S.timers) {
    try { t.cancel() } catch (err) { /* already stopped */ }
  }
  S.timers = []
}

// What /mh and the auto-open pass to $.ui.open: the inline height that leaves the band its 4 lines (band.js
// inlineRows), from the band's room as it was before the pane sat — kept while the pane is up, so «/mh <봇>» on an
// open pane asks for the same height, not one measured beside it. `fullscreen` = command.run's presentation when known.
function openArgs(fullscreen) {
  if (!S.pane.placed || !Number.isFinite(S.openRoom)) S.openRoom = S.bandRoom
  const view = typeof fullscreen === 'boolean' ? { ...(S.view || {}), isFullscreen: fullscreen } : S.view
  const args = { id: PANE_ID, title: S.cfg ? S.cfg.name : systemName(null) }
  const rows = inlineRows(view, S.openRoom, keepNow())
  if (rows) args.rows = rows
  return args
}

// ── 누르기 (v3 D · E) ──
// «/mh <arg>» and the press that stands for it change the same state (봇 ①):
// 예약 = every bot's 예약 shown/hidden · 프로젝트 = project detail · <봇> = that bot's 예약 group folded open/shut.
// r2: what asks for 예약 to be seen («/mh 예약» · «/mh <봇>» · a session row pressed) opens the pane's folded «◷ 예약» line too.
function applyArg(arg) {
  if (arg === '예약') {
    S.cronAll = !S.cronAll
    S.cronOpen = true
  } else if (arg === '프로젝트') {
    // 10-19 I: all open / all shut from here starts the lines over (S.projOpen = the exceptions to it)
    S.projDetail = !S.projDetail
    S.projOpen.clear()
  }
  else if (arg) {
    S.expanded = S.expanded === arg ? null : arg
    if (S.expanded) S.cronOpen = true
  }
}

// The /mh command: «off» closes the pane; else the state change, then the pane opened (asked the keyboard when the
// person typed it — owner 23:23 (a): arrows and Enter work at once; a request the surface may refuse).
async function mhRun($, arg, fullscreen, focus) {
  if (arg === 'off') {
    voidPresses() // r3d (봇 ①): the pane closing lets go at once, before the close is answered
    await $.ui.close({ id: PANE_ID })
    S.pane = { placed: false, placement: null }
    S.openRoom = null
    S.paneRows = null
    S.reasked = null
    S.teamNote = null
    S.sig = ''
    await redraw($)
    return
  }
  // r3d (봇 r3c F4 «닫혔다 다시 열린 경우도»): a pane the person closed (mark or key) and /mh opens again before the
  // 5 s look saw it go — the engine's record is read first, so that close counts as one (checkPane → voidPresses)
  if (S.pane.placed) await checkPane($)
  applyArg(arg)
  const args = openArgs(fullscreen)
  if (focus) args.focus = true
  const r = await $.ui.open(args)
  if (r && r.isPlaced) S.pane.placed = true
  S.sig = ''
  await refreshBoards($)
  await redraw($)
  await fetchTeam($)
}

// The bot whose 예약 are «this bot's» (view's `own`), or null.
function ownBot() {
  const meEntry = findMe([...S.entries.values()], S.me.registryId, S.me.uuid)
  const bot = S.me.bot || (meEntry && meEntry.bot) || '?'
  return bot === '?' ? null : bot
}

// A 도구 kind folded open or shut (s · m · p, or its head pressed). An inline pane is asked again for the height that
// leaves the band what it needs now (봇 ③), and for its old height when the kind folds shut.
async function toggleKind($, kind) {
  if (S.toolsOpen.has(kind)) S.toolsOpen.delete(kind)
  else S.toolsOpen.add(kind)
  S.sig = ''
  if (S.pane.placed && S.pane.placement === 'inline') {
    const rows = inlineRows(S.view, S.openRoom, keepNow())
    if (rows) await reaskPane($, rows)
  }
  await redraw($)
}

// 10-20 모델 칸: the picker under ▣ opened or shut — an inline pane asked again for its height, as for a 도구 kind.
async function showPicker($, open) {
  if (S.mdl.open === open) return
  S.mdl.open = open
  S.sig = ''
  if (S.pane.placed && S.pane.placement === 'inline') {
    const rows = inlineRows(S.view, S.openRoom, keepNow())
    if (rows) await reaskPane($, rows)
  }
  await redraw($)
}

// A choice in the picker: the model or the effort into the pick, the other field kept as it is · 원래대로 = no pick. The
// field chosen is dropped when it is what the engine sends anyway (tidyPick) — that field alone (kit «a second choice
// keeps the first»); before the first request the engine's own are the session's (S.act: its model, no effort yet).
function pickModel(a) {
  if (a.type === 'mreset') {
    S.mdl.pick = null
    return
  }
  const key = a.type === 'mpick' ? 'model' : 'effort'
  const rest = { ...(S.mdl.pick || {}) }
  delete rest[key]
  const one = tidyPick({ [key]: a[key] }, S.mdl.base || { model: S.act.model, effort: S.act.effort })
  const out = { ...rest, ...(one || {}) }
  S.mdl.pick = out.model || out.effort ? out : null
}

// What a press runs (band.js actionOf), at the bottom of the ui.press chain: ▣ = /mh · /mh off · a 도구 head = its kind
// folded open/shut · a pane row = what «/mh 예약 · 프로젝트 · <봇>» changes (applyArg) · «외 N묶음» = all groups' heads.
// Screen state of this session only: nothing written but the press count, nothing sent (봇 ①②) — save
// r3a's TeamClaude account controls (teamPress → teamAction), the only presses that send anything.
async function pressAction($, press) {
  const a = actionOf(press) || subsPressOf(press) // R6: «서브 N ▸» · «서브» (tree.js — band.js left as it is)
  if (!a || !S.cfg) return
  try {
    // 10-20 패널 ✕: every press lets a project's ✕ waiting for its confirm go (TeamClaude's own words too) — its own 닫기
    // reads the one it was given (held), as 정말 지우기 reads S.teamConfirm
    const held = S.projClose
    S.projClose = null
    // 설계 메모: a press of anything but the delete pair's own words lets a delete waiting for its confirm go — r3d: a
    // cancel-class event, so d or 정말 지우기 under way sets and sends nothing either (an order change goes on)
    if (a.type !== 'tcact') voidPresses()
    if (a.type === 'pclose' || a.type === 'pcloseOk' || a.type === 'pcloseNo') {
      await projClosePress($, a, held)
      S.sig = ''
      await redraw($)
      return
    }
    if (a.type === 'pane') {
      await mhRun($, S.pane.placed ? 'off' : '', undefined, false)
      return
    }
    if (a.type === 'tool') {
      await toggleKind($, a.kind)
      return
    }
    // 10-20 모델 칸: the cell = the picker open/shut · 닫기 = shut · a choice = this session's pick (sent nowhere — the
    // main loop's next request goes with it: turn.step)
    if (a.type === 'model' || a.type === 'mclose') {
      await showPicker($, a.type === 'model' ? !S.mdl.open : false)
      return
    }
    if (a.type === 'mpick' || a.type === 'epick' || a.type === 'mreset') {
      // a choice here is the person's newer word: «풀림(/model)» said · a /model waiting to be read again dropped
      S.mdl.note = null
      S.mdl.cmd = null
      pickModel(a)
      S.sig = ''
      await redraw($)
      return
    }
    // r2 B: the rest of a session row = go and see it · «← 돌아가기» = back (nothing of this pane changes until it moves)
    if (a.type === 'go') {
      await goTo($, a.id)
      return
    }
    if (a.type === 'back') {
      await goBack($)
      S.sig = ''
      await redraw($)
      return
    }
    if (a.type === 'team') toggleTeam(a.section)
    else if (a.type === 'tcsel') {
      pickAccount(a.id)
      await takeKeys($, a.id)
    }
    else if (a.type === 'tcact') await teamPress($, a.act, a.id)
    else if (a.type === 'tcreload') await fetchTeam($)
    else if (a.type === 'fold') S.foldOpen = !S.foldOpen
    else if (a.type === 'others') S.othersOpen = !S.othersOpen
    else if (a.type === 'kids') S.kidsOpen.set(a.id, !kidsOpen(a.id, view().family))
    else if (a.type === 'subs') {
      if (!S.subsOpen.delete(a.id)) S.subsOpen.add(a.id)
    }
    else if (a.type === 'lower') S.lowerOpen = !S.lowerOpen
    else if (a.type === 'cron') S.cronOpen = !S.cronOpen
    // 10-24 (B): one 예약 line's detail open / shut — the whole-list fold (S.expanded) is not touched
    else if (a.type === 'job') {
      if (!S.jobOpen.delete(a.id)) S.jobOpen.add(a.id)
    }
    else if (a.type === 'projOne') {
      if (!S.projOpen.delete(a.project)) S.projOpen.add(a.project)
    }
    else applyArg(a.type === 'proj' ? '프로젝트' : a.type === 'own' ? ownBot() : a.bot)
    if (a.type === 'proj' || a.type === 'projOne') await refreshBoards($)
    S.sig = ''
    await redraw($)
  } catch (err) {
    try { $.ui.status('press: ' + errText(err)) } catch (e2) { /* ignore */ }
  }
}

// 10-20 패널 ✕ (주인 DM 08:53 · 봇 하위 세션): one press of a project's ✕, its 닫기 or its 취소 — screen state only,
// save the one order a confirmed 닫기 writes to $.state for the session lane (the registry's one writer) to take as the
// press goes on. ✕ = what it would do, read from the screen as drawn now (projView · project.js closePlan): going 하위 →
// «하위 세션 N개를 닫을까요?» · no going session at all → «이 프로젝트를 목록에서 닫을까요?» · only bots' own sessions (or
// this panel's own) → one status line, no confirm · the same ✕ again while its confirm waits = 취소. 닫기 = only the very
// confirm that was waiting (held · same project), within CONFIRM_MS, with no cancel-class event while the time was read
// (S.teamVoids, as r3d) — else nothing is ordered. 취소 = nothing more (the press let the confirm go).
async function projClosePress($, a, held) {
  if (a.type === 'pcloseNo') return
  if (a.type === 'pclose') {
    if (held && held.project === a.project) return
    const g = projView(view()).groups.find((x) => x.project === a.project) || null
    const plan = closePlan(g, S.me.registryId)
    if (!plan) return
    if (plan.kind === 'none') return say($, `«${a.project}» 에 닫을 하위 세션이 없어요 · 본 세션은 닫지 않아요`)
    const voids = S.teamVoids
    const at = await $.clock.now()
    if (S.teamVoids !== voids) return // the pane closed while the time was read: no confirm is born after it
    S.projClose = { project: a.project, kind: plan.kind, ids: plan.ids, keep: plan.keep, at }
    return
  }
  if (!held || held.project !== a.project) return
  const voids = S.teamVoids
  const now = await $.clock.now()
  if (S.teamVoids !== voids) return
  // both bounds (verifier 10-20 B1: a clock stepping back must not keep a confirm alive) · too late = said, nothing ordered
  if (now - held.at > CONFIRM_MS || now < held.at) return say($, '확인 시간(10초)이 지났어요 — ✕ 를 다시 눌러 주세요')
  const order = { v: 1, kind: held.kind, project: held.project, ids: held.ids, at: now, by: S.me.registryId || null }
  await $.state.set(PANEL_ORDER_REF, order)
  say($, held.kind === 'hide' ? `«${held.project}» 목록에서 내리는 중…` : `하위 세션 ${held.ids.length}개 닫는 중…`)
  // the session lane takes the order as this press goes on; the registry and the record are read again soon after —
  // and an order nobody took by then (verifier 10-20 F3: the session lane not loaded) is said, not left silent
  try { $.clock.after(1000, () => { orderTaken($, order.at) }) } catch (err) { /* the 5 s tick reads them */ }
}

// 1 s after a 닫기: the order still in $.state = the session lane did not take it (not loaded, or it failed before its
// first read) — one status line; the order itself is refused later by its time (core.js panelOrderCheck). Then the read.
async function orderTaken($, at) {
  try {
    const { value } = await $.state.get(PANEL_ORDER_REF)
    if (value && value.at === at) say($, '패널: 닫기 주문을 아무도 받지 않았어요 (세션 갈래 없음) — 아무것도 닫히지 않았어요')
  } catch (err) { /* no state: nothing to say */ }
  await refreshSessions($)
}

// v3 r2 (봇 ④): «t: ◆ TeamClaude» = every section open, or all shut when they all are · a section head = its own.
function toggleTeam(section) {
  if (section === 'all') {
    if (TEAM_SECTIONS.every((k) => S.teamOpen.has(k))) S.teamOpen.clear()
    else TEAM_SECTIONS.forEach((k) => S.teamOpen.add(k))
  } else if (S.teamOpen.has(section)) S.teamOpen.delete(section)
  else S.teamOpen.add(section)
}

// r3a (57 대조표 1): an account row pressed = that account selected, its action line under it; pressed again = none.
function pickAccount(id) {
  S.teamSel = S.teamSel === id ? null : id
  S.teamNote = null
}

// 10-21 (measured 2.1.296 · own tmux socket): a click on an account row selected it but left the keyboard in the composer
// — the arrows that followed never reached the pane. The press asks the keyboard for the pane (as «/mh» does: owner 23:23
// (a) «arrows and Enter work at once» · a request the surface may refuse) and puts the ring on that row once it is drawn.
async function takeKeys($, id) {
  S.ringWant = id
  try {
    await $.ui.open({ ...openArgs(), focus: true })
  } catch (err) {
    /* refused: the press itself stands */
  }
  S.sig = ''
}

// Measured (10-21, dev copy): while the pane takes the keyboard the engine raises ui.focus for its first Button (the take)
// and this move lands after it with no event of its own — so the ring is written here, from the answer.
async function ringTo($, key) {
  try {
    const out = await $.ui.focus({ requestId: PANE_ID, key })
    if (!(out && out.deny)) S.ring = key
  } catch (err) {
    /* not drawn any more, or the pane gave the keys away: the ring stays */
  }
}

// r3a: one control press at a time. The engine runs press handlers side by side (measured 10-18 on 2.1.296: two ▲
// presses both sent their request before the first was answered), so a second press would plan from the model the first
// is changing. A control press while another is under way runs nothing and says so — not saved for later: a held key
// against a slow engine (one request may take 30 s) must not turn into a burst of writes after it. The hold ends after
// the re-read, whatever happened.
// r3d (봇 ① · 봇 r3c F5): save 취소 — no write but the taking back of one, so it is never held
// back: it passes the hold and lets go at once (voidPresses), and the press under way (정말 지우기 reading its time)
// sends nothing. A request already sent is not taken back.
async function teamPress($, act, id) {
  if (act === 'cancel') {
    voidPresses()
    return
  }
  if (S.teamBusy) {
    S.teamNote = { id, text: '앞 요청 처리 중' }
    return
  }
  S.teamBusy = true
  try {
    await teamAction($, act, id)
  } finally {
    S.teamBusy = false
  }
}

// r3c (봇 ① ② · 봇 r3b F3) · r3d (봇 ② · 봇 r3c
// F4 F5): the one check a control press makes after each of its awaits — nothing moved under it. The same source still
// answers for the Claude accounts as when the press began (S.teamEpoch: any change of it counts, A → B → A too); on the
// delete path — d and 정말 지우기 — no cancel-class event on the person's side came since it began (S.teamVoids: 취소, a
// press of anything else, the pane closing — closed and opened again too; p.voids is null for every other press); and
// for 정말 지우기 the confirm it was given still waits in S (read from S, never from a copy). If not, the press sets
// nothing (d: no confirm is born after a cancel) and sends nothing more, and it ends. The selection is checked once, as
// the press begins: an account picked while an order change is out does not cut it in half, nor does the pane closing —
// picking is no cancel of an order change, and cutting it would leave an order the person did not ask for (봇
// ① ②); a source change does.
function pressHolds(p) {
  return p.epoch === S.teamEpoch && (p.voids === null || p.voids === S.teamVoids) && (!p.confirm || S.teamConfirm === p.confirm)
}

// r3d (봇 ② · 봇 r3c F4 F5): a cancel-class event on the person's side —
// 취소 (teamPress, past the hold), a press of anything else (pressAction, teamAction), the pane closing (/mh off, the 5 s
// look, the look before /mh opens it again). A delete waiting for its confirm goes (설계 메모) and S.teamVoids moves, so a
// press on the delete path under way — d or 정말 지우기 reading its time — sets and sends nothing (pressHolds). No other
// press reads the count: an order change under way goes on (r3c). The other cancel-class event, another source
// answering, is counted by S.teamEpoch (fetchTeam), which pressHolds reads for every press.
function voidPresses() {
  S.teamConfirm = null
  S.projClose = null // 10-20 패널 ✕: a project's ✕ waiting for its confirm goes the same way
  S.teamVoids += 1
}

// r3a (57 대조표 2~5 · 설계 메모 쓰기 길 문 · 설계 메모 지우기 상태기계 · 정정 A~F): one press of the selected account's action line.
// del = its delete waits for the confirm (no call) · cancel = it no longer does · delok = only while that very account's
// delete waits, within CONFIRM_MS (else nothing, no call) · switch · toggle · up · down · auto go at once. Going: nothing
// is sent while ui.team_claude_control is off or no configured address answered with the Claude accounts («엔진 주소
// 없음»), nor when an id no longer resolves to a name (accounts.js nameOf — an order change resolves every row it moves
// before its first call, 정정 F-1 «계정을 다시 찾지 못함»). A request = a POST of JSON to the Claude status address's
// origin, with no key (봇 Q1: loopback, keyless), by $.http.fetch — never curl, whose argv would carry the name. An
// order change = one request per row whose priority changes (accounts.js orderPlan over the model rows, 정정 A · F-2), in
// turn, stopping at the first that is not a 2xx. The note = fixed words and a status number (accounts.js callNote),
// never the answer's text, which can carry the name. Then the status is read again.
// r3c (봇 · 봇 r3b F3): a press is bound as it begins — to the account whose line it was on
// (still the selected one, or the press does nothing: another source answering since the line was drawn dropped the
// selection), to the source then answering for the Claude accounts (p.epoch, p.base) and, for 정말 지우기, to the very
// confirm waiting in S; r3d: on the delete path (del · delok), to the count of cancel-class events too (p.voids). After
// each of its awaits it goes on only while pressHolds — the tables in the r3c and r3d commits list every await of a press
// and the check after it. 취소 never gets here: teamPress lets go for it, past the hold.
async function teamAction($, act, id) {
  if (act !== 'delok') voidPresses() // any other press of the line lets a delete waiting for its confirm go (설계 메모)
  const del = act === 'del' || act === 'delok' // the delete path: the only presses a cancel-class event stops (r3d)
  const p = { id, epoch: S.teamEpoch, voids: del ? S.teamVoids : null, base: S.teamBase, confirm: act === 'delok' ? S.teamConfirm : null }
  if (S.teamSel !== id) return
  if (act === 'del') {
    const at = await $.clock.now()
    if (!pressHolds(p)) return // r3d (봇 r3c F4): a cancel-class event while d read its time — no confirm is born after it
    S.teamConfirm = { id, at }
    S.teamNote = null
    return
  }
  if (act === 'delok') {
    if (!p.confirm || p.confirm.id !== id) return
    const now = await $.clock.now()
    if (!pressHolds(p)) return // F3: the confirm went meanwhile (another source answered, another press, the pane closed, r3d: 취소)
    const at = p.confirm.at // the confirm in S itself — pressHolds: S.teamConfirm === p.confirm, not one cleared meanwhile
    S.teamConfirm = null
    p.confirm = null // used: from here on the press holds by its source and its cancel count
    if (now - at > CONFIRM_MS) return
  }
  // 봇 F2: a model that may be from before the last write (its re-read was skipped — the pane was closed) plans
  // nothing. The press reads again and sends nothing: what a toggle or ▲ means depends on what the person saw, so they
  // press again on the new line.
  if (S.teamRead.landed < S.teamRead.needed) {
    await fetchTeam($)
    if (pressHolds(p)) S.teamNote = { id, text: '새로 읽음 · 다시 누르기' }
    return
  }
  const rows = S.team.model && Array.isArray(S.team.model.claude) ? S.team.model.claude : []
  const row = rows.find((r) => r.id === id) || null
  const word = actWord(act, row)
  if (!word) return
  if (S.cfg.teamControl !== true || !S.teamBase) {
    S.teamNote = { id, text: '엔진 주소 없음' }
    return
  }
  // 봇 F1: every write of this press goes to the source it began on — a read landing meanwhile may move S.teamBase to
  // another configured address (the swap's second write went there); r3c: and then the rest is not sent at all
  const base = p.base
  const name = nameOf(id)
  if (!name || !row) {
    S.teamNote = { id, text: '계정을 다시 찾지 못함' }
    return
  }
  const reqs = []
  if (ORDER_DIRS.includes(act)) {
    const plan = orderPlan(rows, id, act)
    if (!plan) return // drawn dim, with no press: nothing to do
    for (const step of plan) {
      const req = priorityRequest(nameOf(step.id), step.priority)
      if (!req) {
        S.teamNote = { id, text: '계정을 다시 찾지 못함' }
        return
      }
      reqs.push(req)
    }
  } else {
    const req = teamRequest(act, name, row)
    if (!req) return
    reqs.push(req)
  }
  let note = word + ' ✕'
  for (const req of reqs) {
    let res = null
    try {
      res = await $.http.fetch(base + req.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) })
    } catch (err) {
      res = null
    }
    note = callNote(act, word, res)
    // r3c: another source answered while this write was out — the rest of an order change is not sent (left as a refused
    // write leaves it: part done, shown by the re-read below)
    if (!is2xx(res) || !pressHolds(p)) break
  }
  // a read begun before now may answer from before these writes (a refused or lost answer may still have been applied)
  S.teamRead.needed = S.teamRead.begun + 1
  S.teamNote = { id, text: note }
  await fetchTeam($)
}

// ── r2 B: jump to a session and back (jump.js — the plan; here only the tmux calls, each an argv list, no shell) ──
// stdout of a tmux call, or null when it did not answer 0 (it failed, or could not be run).
async function tmuxOut($, argv) {
  try {
    const r = await $.process.run(argv, { timeoutMs: 5000 })
    return r.exitCode === 0 ? String(r.stdout || '') : null
  } catch (err) {
    return null
  }
}

// 봇 R1: a lookup that failed is no answer — the reads below tell «none» or «gone» (an answer) from LOST (no answer).
// A session's windows (jump.js findWindow) · null = that session is not there: list-windows -t =S fails for a missing
// session (measured) but also when the call itself fails, so «gone» = a list of the server's sessions read without it
// · LOST = could not tell.
async function windowsOf($, session, window, id) {
  const listed = await tmuxOut($, listWindowsArgv(session, WINDOWS_FMT))
  if (listed !== null) return findWindow(listed, window, id) // R5: the window's id first (a renamed window), then its name
  const all = await tmuxOut($, listSessionsArgv())
  if (all === null || all.split('\n').some((n) => n.replace(/\s+$/, '') === session)) return LOST
  return null
}

// One client's way back as it stands: { stack, raw } — an option not set reads as none (show-options -q answers 0 with
// nothing) · LOST = the read failed: what it holds is not known, so it is neither written over nor dropped.
async function backOf($, tty) {
  const out = await tmuxOut($, showOptionArgv(backOption(tty)))
  return out === null ? LOST : { stack: parseBack(out), raw: out.trim() }
}

// One line in the engine's status place (a refusal, a move that did not happen) — the words alone: the engine puts the
// plugin's name before it (R4 ③: «mods-harness: mods-harness: …» on 봇's screen 21:13).
function say($, text) {
  try { $.ui.status(text) } catch (err) { /* no status surface */ }
}

// This pane's tmux window id — kept HERE_MS; `fresh` = read now. null outside tmux · LOST = the read failed (the last
// answer stays kept).
async function whereAmI($, fresh) {
  if (!fresh && S.here.v && S.now - S.here.at < HERE_MS) return S.here.v
  const pane = await $.env.get('TMUX_PANE')
  const out = pane ? await tmuxOut($, hereArgv(null, pane, HERE_FMT)) : ''
  if (out === null) return LOST
  const v = pane ? parseHere(out) : null
  S.here = { at: S.now, v }
  return v
}

// Who presses on this window: the one client that can type looking at it, of every client of the server (a client on
// a view session of ours shows the same window ids) — { tty, place } · { refuse: 'many' } · null (jump.js pickClient)
// · LOST (this window or the client list could not be read).
async function presser($, here) {
  if (here === LOST) return LOST
  if (!here) return null
  const listed = await tmuxOut($, listClientsArgv(CLIENT_FMT))
  return listed === null ? LOST : pickClient(parseClients(listed), here.window)
}

// 10-19 ②: the client a way back here is for — as presser, but when several clients look at this window (the bot's own
// tab + the one that jumped in) the one whose newest jump landed here (jump.js pickLanded · each one's note read now, at
// most 8) · LOST when any read failed (nothing guessed from half a picture).
async function lander($, here) {
  if (here === LOST) return LOST
  if (!here) return null
  const listed = await tmuxOut($, listClientsArgv(CLIENT_FMT))
  if (listed === null) return LOST
  const clients = parseClients(listed)
  const c = pickClient(clients, here.window)
  if (!c || !c.refuse) return c
  const stacks = new Map()
  for (const x of clients.filter((k) => k.window === here.window && !k.ro).slice(0, 8)) {
    const note = await backOf($, x.tty)
    if (note === LOST) return LOST
    stacks.set(x.tty, note.stack)
  }
  return pickLanded(clients, here, stacks)
}

// One jump or way back at a time in this process (봇 F4): each waits for the one before it, so the note's
// read-modify-write (show-options → set-option → the move → put back when the move fails) is never cut into by another
// press — two presses that read the same note let the failing one's put-back wipe the moved one's way back.
function takeJumpTurn() {
  const wait = S.jumpTail
  let done
  S.jumpTail = new Promise((resolve) => { done = resolve })
  return { wait, done }
}

// The rest of a session row pressed (봇 ③): the reads, the plan (jump.js
// jumpPlan), then the way back noted before the client moves — a move that fails puts the note back as it was (a view
// made for it is dropped by tmux). A refusal (no tmux place · a read that failed — 봇 R1: the note is then neither
// written over nor dropped · nobody looks at this window · two or more could have pressed · no such window · this very
// window) = one status line. One at a time (takeJumpTurn).
async function goTo($, id) {
  const turn = takeJumpTurn()
  await turn.wait
  try { await goToNow($, id) } finally { turn.done() }
}

async function goToNow($, id) {
  // 10-19 ②: a row that names a view session of ours is looked for in its bot's own session (jump.js rehome)
  const entry = rehome([...S.entries.values()].find((e) => e && e.id === id) || null, [...S.entries.values()])
  // R4 (주인 21:10 · 봇 21:13): a row the registry calls ended — its window closed with it
  // — says so at once, before any tmux call. This session's own row is never one (/clear can leave «ended» while it runs).
  // 10-19: failed too (no window ever) · not a row whose window outlived its end (its live file still beats — 603999)
  // 10-24 (A): ended = the one end rule (tree.js overOf · the registry or the row's own live file)
  const lv = entry ? liveMap().get(entry.id) || null : null
  const over = entry && overOf(entry, lv) && entry.id !== S.me.registryId
  if (over && !(S.cfg && aliveAfterEnd(entry, lv, S.now, S.cfg.staleMs))) return say($, REFUSE_TEXT.ended)
  // 10-25 창 어댑터: no jump in a herdr tab, nor to one (lib/window caps.jump false · 1판) — one line, nothing moved.
  // Outside any window tool (none) the press goes on as before (its own refusal below).
  const win = pickBackend({ TMUX: await $.env.get('TMUX'), HERDR_ENV: await $.env.get('HERDR_ENV'), ORCA_TERMINAL_HANDLE: await $.env.get('ORCA_TERMINAL_HANDLE') })
  const rowTool = entry && entry.place && !entry.tmux ? entry.place.backend : null
  if ((!win.caps.jump && win.name !== 'none') || (rowTool && rowTool !== TMUX_NAME)) return say($, REFUSE_TEXT['no-jump'])
  const t = targetOf(entry)
  let plan = { refuse: 'no-target' }
  let note = null
  if (t) {
    const here = await whereAmI($, true)
    const listed = here && here !== LOST ? await tmuxOut($, listClientsArgv(CLIENT_FMT)) : ''
    const clients = listed === null ? LOST : parseClients(listed)
    const c = here && here !== LOST && clients !== LOST ? pickClient(clients, here.window) : null
    const tty = c && !c.refuse ? c.tty : null
    const windows = tty ? await windowsOf($, t.session, t.window, t.id) : null
    note = tty ? await backOf($, tty) : null
    plan = jumpPlan({ here, entry, clients, windows, stack: note === LOST ? LOST : note ? note.stack : [], now: S.now, seq: ++S.jumpSeq })
  }
  if (plan.refuse) return say($, REFUSE_TEXT[plan.refuse] || plan.refuse)
  if ((await tmuxOut($, plan.set)) === null) return say($, '돌아올 자리를 적지 못해 옮기지 않았어요')
  if ((await tmuxOut($, plan.go)) === null) {
    // the note put back exactly as it was read (R1: it was read — a jump whose read failed was refused above)
    await tmuxOut($, note.raw ? setOptionArgv(backOption(plan.tty), note.raw) : unsetOptionArgv(backOption(plan.tty)))
    say($, plan.to + ' 로 옮기지 못했어요')
  }
}

// Is there a way back on this window? Read with the sessions while the pane is up: one list-clients a tick; the option
// only of the one client that could press here. S.back = { tty, from } when its newest jump landed on this window.
async function refreshBack($) {
  let back = null
  const here = S.pane.placed ? await whereAmI($, false) : null
  const c = await lander($, here) // 10-19 ②: the bot's own tab may look here too
  // 봇 R2: a read that failed tells nothing — the line and its one ask stay as they were (a failure is no «gone»,
  // so the same landing read again after it is not a new one)
  if (c === LOST) return
  if (c && !c.refuse) {
    const note = await backOf($, c.tty)
    if (note === LOST) return
    const stack = note.stack
    // landing = this client + its newest hop, the hop's own mark included (jump.js stampOf): the same way taken again
    // is a new landing even when no scan saw the client leave in between
    if (backHere(here, stack, c.gen)) back = { tty: c.tty, gen: c.gen, from: splitPlace(stack[stack.length - 1].from).session, landing: c.tty + ' ' + formatBack(stack.slice(-1)) }
  }
  S.back = back
  // r2 E (10-18 19:4x real-engine copy: after a jump the landed pane drew «← 돌아가기» but the composer kept the keys —
  // b typed into it): one landing = one ask for this pane's keys. A request the surface grants only over an empty
  // composer (types: PaneOpenArgs.focus), so typed text is never taken; granted, the ring starts on «← 돌아가기» (the
  // pane's first Button, autoFocus) — Enter or b goes back.
  if (!back) S.backAsked = null
  else if (S.backAsked !== back.landing) {
    S.backAsked = back.landing
    try {
      const args = openArgs()
      args.focus = true
      await $.ui.open(args)
    } catch (err) { /* a request, not a grant */ }
  }
}

// «← 돌아가기» pressed (b · click): the presser read again (the line was drawn for one client — another one now, or two
// = refused), the client back to the window it came from (that session's current window when the window is gone) the
// same way a jump goes (jump.js moveArgs — no window of anyone else's session selected), the note dropped once moved or
// once the session it came from is gone — a list of the server's sessions read without it (a move that fails keeps it
// for another try; a read that fails changes nothing — 봇 R1). One at a time (takeJumpTurn); the client must be the
// one the line was drawn for — the same tty and the same generation (F3).
async function goBack($) {
  const turn = takeJumpTurn()
  await turn.wait
  try { await goBackNow($) } finally { turn.done() }
}

async function goBackNow($) {
  const b = S.back
  if (!b) return
  S.back = null
  // R1: a read that failed changes nothing — the line stays, the note stays, the next press reads again
  const lost = () => { S.back = b; say($, REFUSE_TEXT.lost) }
  const here = await whereAmI($, true)
  const c = await lander($, here) // 10-19 ②: the same pick as the line was drawn for
  if (c === LOST) return lost()
  if (c && c.refuse) return say($, REFUSE_TEXT[c.refuse])
  if (!c || c.tty !== b.tty || c.gen !== b.gen) return say($, '돌아갈 자리가 바뀌었어요')
  const note = await backOf($, b.tty)
  if (note === LOST) return lost()
  const top = note.stack[note.stack.length - 1]
  const from = top ? splitPlace(top.from) : null
  const windows = from ? await windowsOf($, from.session, from.window) : null
  const plan = backPlan({ here, tty: b.tty, gen: b.gen, stack: note.stack, windows, now: S.now })
  if (!plan) return say($, '돌아갈 자리가 바뀌었어요')
  if (plan.lost) return lost()
  if (!plan.go) {
    await tmuxOut($, plan.after)
    return say($, plan.from + ' 로 돌아가지 못했어요 — 그 세션이 없어요')
  }
  if ((await tmuxOut($, plan.go)) === null) return say($, plan.from + ' 로 돌아가지 못했어요')
  await tmuxOut($, plan.after)
}

// A press of one of this plugin's Buttons, counted: the action key (no line key, no text) and the time (봇
// «key · count · time only»). Written with the next beat — the live file's one writer.
function notePress(element, at) {
  const key = String(element || '').split('@')[0].replace(/#\d+$/, '')
  S.press = { n: ((S.press && S.press.n) || 0) + 1, last: { key, at } }
}

// band.js reaskRows: the inline height asked again after the window narrowed a docked pane into an inline one.
async function reaskPane($, rows) {
  try {
    await $.ui.open({ id: PANE_ID, title: S.cfg ? S.cfg.name : systemName(null), rows })
  } catch (err) {
    /* no pane surface */
  }
}

async function firstLoad($) {
  await refreshSessions($)
  await refreshJobs($, 'full')
  if (!S.cfg.autoOpen) return
  // 20번 실측: 묻지 않은 칸은 144칸부터 자리를 받음. 못 받으면 닫아 두어 기다리는 칸을 남기지 않음.
  try {
    const r = await $.ui.open(openArgs())
    if (r && r.isPlaced === false) await $.ui.close({ id: PANE_ID })
    else if (r && r.isPlaced) {
      S.pane.placed = true
      await fetchTeam($)
    }
  } catch (err) {
    /* no pane surface */
  }
}

async function startUi($) {
  stopTimers()
  await seedMeter($)
  S.cfg = await loadSettings($)
  if (S.cfg.treeStyleWarn) say($, S.cfg.treeStyleWarn) // r2 B: an unknown ui.tree_style = B, said once
  S.now = await $.clock.now()
  S.me.startedAt = S.now
  S.act = { state: 'idle', since: S.now, model: null, effort: null }
  // 10-20: a reload starts with the engine's own model (a /clear does not come here) · turn = { id, model } of the main
  // loop's turn under way (its first step's model) · fb = its last step went on the engine's fallback · note = «풀림(/…)»
  // · cmd = a /model read as unmoved, looked at again (personSaid)
  S.mdl = { open: false, pick: null, base: null, turn: null, fb: false, note: null, cmd: null }
  try { S.me.uuid = await $.session.id() } catch (err) { S.me.uuid = null }
  try { S.act.model = await $.session.model() } catch (err) { S.act.model = null }
  S.me.bot = (await $.env.get('MODS_HARNESS_BOT')) || (await tmuxSessionName($))
  // docs: a register that throws (name taken) skips the rest of the hook — the band must still run without /mh.
  try {
    await $.command.register({
      name: 'mh',
      description: 'mods-harness 칸 열기: 세션 나무 + 프로젝트별 봇 현황 + TeamClaude + 이 봇 예약. «/mh 예약» = 다른 봇 예약도 · «/mh 프로젝트» = 프로젝트 상세 · «/mh <봇>» = 그 봇 예약 펼치기 · «/mh 모양 <이름>» = 화면 모양 바꾸기 · «/mh off» = 닫기',
      argumentHint: '[예약 | 프로젝트 | 봇 | 모양 <이름> | off]',
      immediate: true,
    })
  } catch (err) {
    try { $.ui.status('/mh not registered: ' + errText(err)) } catch (e2) { /* ignore */ }
  }
  S.timers.push($.clock.every(SESSIONS_MS, () => { refreshSessions($) }))
  S.timers.push($.clock.every(BEAT_MS, () => { beat($) }))
  S.timers.push($.clock.every(LAUNCHCTL_MS, () => { refreshJobs($, 'fast') }))
  S.timers.push($.clock.every(SLOW_MS, () => { refreshJobs($, 'slow') }))
  S.timers.push($.clock.every(TEAM_MS, () => { fetchTeam($) }))
  S.timers.push($.clock.after(300, () => { firstLoad($) }))
  await beat($)
}

// One hooks module per plugin, and an event may be hooked once per matcher (validate: «registered twice without a
// matcher»). The session lane holds session.start · turn.complete · tool.call · session.end without a matcher, so every
// hook here that shares an event carries its own matcher. session.end is left to the session lane: its registry
// status «ended» outranks the live file for every row but this session's own (tree.js stateOf `self`).
export function register(on, options) {
  optInAnchor = undefined
  // The screen exists only where a person is at the prompt (a -p run draws nowhere).
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    try {
      await startUi($)
    } catch (err) {
      try { $.ui.status(errText(err)) } catch (e2) { /* ignore */ }
    }
    return next(e)
  })

  // A -p run (a child session) draws nothing but is metered all the same (G7 «하위 세션 포함»).
  on('session.start', { isInteractive: false }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    await seedMeter($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    try { await setActivity($, 'busy') } catch (err) { /* observe only */ }
    return next(e)
  })

  // Every way a turn ends (TurnCompleteReason); a subagent's run end carries agentId and is skipped.
  // G7: the main turn's wall time is added BEFORE next(e), so the session lane — which reads mh.usage after its own
  // next(e) at turn.complete — sees this turn whichever of the two hooks runs first.
  on('turn.complete', { reason: ['answer', 'aborted', 'refusal', 'error'] }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    if (!e.agentId) await bumpUsage($, (t) => addWall(t, e.durationMs))
    const out = await next(e)
    if (!e.agentId) {
      // 10-20 모델 칸 ③: a fallback lasts the turn — once it is over the ▣ line says what the next request goes with
      if (S.mdl && S.mdl.fb) {
        S.mdl.fb = false
        S.sig = ''
      }
      try { await setActivity($, 'idle') } catch (err) { /* observe only */ }
    } else {
      // r2: a subagent's run ended — marked at once, then the engine's list says how (completed · failed · killed)
      try {
        if (noteEnd(S.agents, e.agentId, await $.clock.now())) $.clock.after(0, () => { syncAgents($, true) })
      } catch (err) { /* observe only */ }
    }
    return out
  })

  // Model and effort of the main loop's requests, for the ▣ line (subagent steps carry agentId and are skipped).
  // G7: every request with a response (main loop and subagents alike) adds its usage and one model call.
  // 10-20 모델 칸 (D4′ 실측 · modelpick.js): a main-loop step goes down with this session's pick (model · effort), every
  // step again — each comes in with the engine's own values (kept as base, for 원래대로 and to drop a pick equal to them);
  // a subagent's step goes as it came. The ▣ line and the live file say what went out.
  // 봇 3번: a turn's first main step names the engine's own model (it
  // re-tries its primary at the start of each of the person's messages — --fallback-model); a later step of that turn
  // naming another = the engine's fallback (the picked model refused or overloaded — measured on 89ed697: the pick put
  // back on it, a second 404 ended the turn) → it goes down as it came, the engine's own kept for 원래대로 unmoved,
  // «(대체 중)» on ▣ — every such step to the turn's end; the next turn goes with the pick again.
  on('turn.step', async function* ($, e, next) {
    if (!(await optedIn($))) return yield* next(e)
    let pass = e
    if (!e.agentId) {
      const was = modelSig()
      const model = typeof e.model === 'string' && e.model ? e.model : null
      const first = !S.mdl.turn || S.mdl.turn.id !== e.turnId
      // a /model waiting to be read again: settled before this request goes, done with at the next turn's first
      let fresh = false
      if (S.mdl.cmd) {
        try { fresh = settleModel(await $.session.model()) } catch (err) { /* left as it was */ }
        if (first) S.mdl.cmd = null
      }
      if (first) S.mdl.turn = { id: e.turnId, model }
      S.mdl.fb = !first && model !== S.mdl.turn.model
      if (!fresh) S.mdl.note = null // «풀림(/model)» is said until a request goes out
      if (!S.mdl.fb) {
        // the pick is kept as picked: a turn the engine starts on the picked value itself must not drop it — only
        // 원래대로 and the person's /model do (kit «a pick stays while the engine's own moves between turns»)
        S.mdl.base = { model, effort: e.effort === undefined || e.effort === null ? null : e.effort }
        pass = withPick(e, S.mdl.pick)
      }
      if (typeof pass.model === 'string' && pass.model) S.act.model = pass.model
      if (pass.effort !== undefined && pass.effort !== null) S.act.effort = pass.effort
      // «→ 다음 요청부터 …» becomes what went out at once — not awaited: the request is not held for a drawing
      if (modelSig() !== was) redraw($).catch(() => {})
    }
    const r = yield* next(pass)
    if (r && r.usage) await bumpUsage($, (t) => addStep(t, r.usage))
    return r
  })

  // Not a guard: every call passes straight to next(e). 도구 (skills · MCP tools · plugins) show as running (●) until
  // they answer, then ✓/✕ with the time; memory calls are counted per system and tier; AskUserQuestion from the main
  // loop marks the session «대기» while the person is asked. Subagents' calls count too (this session's work).
  // Matcher = the tools memory systems and questions come through (skills, MCP servers, Bash CLIs, AskUserQuestion).
  on('tool.call', { tool: /^(Skill|AskUserQuestion|Bash|mcp__)/ }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    const sig = sigOf(e.tool, e)
    const label = S.cfg ? matchMemory(sig, S.cfg.memoryRules) : null
    const call = callOf(e.tool, e, $.plugin.name)
    const token = {}
    const asks = e.tool === 'AskUserQuestion' && !e.agentId
    if (asks) {
      try { await setActivity($, 'waiting') } catch (err) { /* observe only */ }
    }
    if (call) {
      try {
        startCall(S.calls, token, call, await $.clock.now())
        await redraw($)
      } catch (err) {
        /* observe only */
      }
    }
    let out
    try {
      out = await next(e)
    } finally {
      if (asks) {
        try { await setActivity($, 'busy') } catch (err) { /* observe only */ }
      }
      if (call) {
        try { endCall(S.calls, token, await $.clock.now(), callOk(out)) } catch (err) { /* observe only */ }
      }
    }
    if (label) {
      try {
        countMemory(S.memory, label, tierOf(sig, label, S.cfg.memoryRules), await $.clock.now(), callOk(out), subLoop(e)) // R7a: 서브 몫
      } catch (err) {
        /* observe only */
      }
    }
    if (call || label) {
      try { await redraw($) } catch (err) { /* observe only */ }
    }
    return out
  }).catch(($, e, next) => next(e))

  // r2 (실측 10-18 15:11 · 봇 ① 승인): a subagent the model or a plugin starts — noted when next answers
  // with its agentId (a deny or a failed start notes nothing). Observe only: the answer goes back as it came, the
  // drawing and the live file follow on the clock, never in the spawn's way.
  on('agent.spawn', async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    const out = await next(e)
    try {
      if (noteSpawn(S.agents, e, out, await $.clock.now())) $.clock.after(0, () => { S.sig = ''; beat($); redraw($) })
    } catch (err) { /* observe only */ }
    return out
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // r2 C (부모 18:4x · 주인): the engine names this session's wake-ups (CronCreate · ScheduleWakeup · /loop)
  // only on the classic Stop input — keep the list, put it in the live file, redraw the 예약 칸. Observe only.
  // 봇 F7: the Stops are numbered as they come — one that finishes after a newer one does not put its older list
  // over the newer one's (whether the engine ever overlaps two Stops is not measured; the order is kept either way).
  on('classic.Stop', async ($, e, next) => {
    const seq = ++S.stops.seen
    if (!(await optedIn($))) return next(e)
    const out = await next(e)
    try {
      if (seq > S.stops.applied) {
        S.stops.applied = seq
        const list = sessionCrons(e && e.session_crons)
        if (JSON.stringify(list) !== JSON.stringify(S.crons)) {
          S.crons = list
          $.clock.after(0, () => { regroup(); S.sig = ''; beat($); redraw($) })
        }
      }
    } catch (err) { /* observe only */ }
    return out
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // r2 (봇 ② 승인): the head of each public Slack thread this session hears from — the parent's channel
  // message, or what a child got from its parent («[thread message]») — for the «#채널 · 첫 몇 자» line under a child.
  // Runs after the session lane: a message that lane hands to a child never reaches the parent's book (the child's has it).
  on('prompt.submit', { text: /<channel / }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    try {
      if (noteThread(S.threads, threadNote(e.text, S.cfg && S.cfg.slackChannels), await $.clock.now())) $.clock.after(0, () => { beat($) })
    } catch (err) { /* observe only */ }
    return next(e)
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // «/mh 예약» = 다른 봇 예약도 보기/숨기기 (v2 3번 «다른 세션 보는 기능은 일단 추가만» · 기본 숨김) · the body is mhRun,
  // the same the band's ▣ press runs; typed by the person, the pane asks for the keyboard (v3 owner 23:23 (a)).
  on('command.run', { command: 'mh' }, async ($, e) => {
    const arg = String(e.args || '').trim()
    // r3b «/mh 모양 [이름]»: before mhRun (whose applyArg would take «모양 x» for a bot's name) — no name = the skin in
    // use and the names · a built name = that skin, the screen redrawn and the pane opened as «/mh» opens it · a name
    // for later or an unknown word = refused with the list, nothing changed
    const sk = /^모양(?:\s+([\s\S]*))?$/.exec(arg)
    if (sk) {
      const r = skinCommand(S.skin, sk[1] || '')
      if (r.skin !== S.skin) {
        S.skin = r.skin
        S.sig = ''
      }
      if (r.set) await mhRun($, '', e.presentation ? e.presentation.isFullscreen : undefined, true)
      return { text: r.text }
    }
    await mhRun($, arg, e.presentation ? e.presentation.isFullscreen : undefined, true)
    return {}
  }).catch(() => ({ text: 'mods-harness ui: /mh failed' }))

  // 10-20 모델 칸 ① (봇 1번): the engine's own /model and /effort run as they always do — this hook only
  // reads the session's model before and after (personSaid) and answers with the engine's own result object as it came
  // (d.ts CommandRunResult.ref: the object returned as got = the engine's run used verbatim). Not the classic
  // PostModelSwitch: measured, the engine fires it but the built-in cc-plugin-sec-default answers it above a user-tier
  // module («bypassed … beneath runs», hidden copy debug log) — command.run reached the module either way.
  on('command.run', { command: ['model', 'effort'] }, async ($, e, next) => {
    if (!(await optedIn($)) || !S.cfg) return next(e)
    let before = null
    if (e.command === 'model') {
      try { before = await $.session.model() } catch (err) { before = null }
    }
    const out = await next(e)
    try { await personSaid($, e, before) } catch (err) { /* observe only: the command's own run stands */ }
    return out
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // v3 E (봇): a press of one of this plugin's Buttons is counted (notePress), then goes on to the
  // Button's own onPress at the bottom of the chain; the count reaches the live file with a beat after it. Another
  // plugin's press passes at once. A failure after next(e) leaves the press as it settled.
  on('ui.press', { element: /^mh-/ }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    if (e.plugin !== $.plugin.name) return next(e)
    try { notePress(e.element, await $.clock.now()) } catch (err) { /* observe only */ }
    const out = await next(e)
    await beat($)
    return out
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // 10-21 (주인 · measured 2.1.296): where the pane's focus ring sits —
  // the person's Tab, arrows or click, a plugin's $.ui.focus — read after the move went through.
  on('ui.focus', { component: 'Pane' }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    const out = await next(e)
    if (e.requestId === PANE_ID && !(out && out.deny)) S.ring = e.element || null
    return out
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // 10-21: a pane taller than its window gives ↑ ↓ to the engine's scroll (the whole pane moves a row, the ring stays).
  // While the ring is on a TeamClaude account row, the person's arrow (a row, no pointer) steps the ring to the next or
  // previous account row instead; everything else (a wheel tick, a page key, the ring elsewhere, past the last row)
  // scrolls as before (team.js accountArrow).
  on('ui.scroll', { component: 'Pane' }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    if (e.requestId !== PANE_ID) return next(e)
    const to = accountArrow(S.paneKeys, S.ring, e)
    if (!to) return next(e)
    const out = await $.ui.focus({ requestId: PANE_ID, key: to })
    if (out && out.deny) return next(e)
    S.ring = to
    return {}
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    const theirs = await next(e)
    const p = e.props || {}
    if (p.hasSurvey || !S.cfg) return theirs
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const site = pressSite($, true)
    // 설계 메모: the band is black too — each row painted and padded to the band's width (the width the lines were
    // folded to, so the padding never pushes a row past its edge)
    const cols = Math.max(20, p.bodyColumns || 80)
    const row = (key, segs) => paneRow(ui, key, segs, cols, false, undefined, site)
    // 봇 10-17: take only the rows other mods' drawing leaves (core's own drawing counts 0).
    const left = Number.isFinite(p.maxRows) ? p.maxRows - rowsOf(theirs) : undefined
    // Kept for /mh: the room an inline pane must leave the band (band.js inlineRows).
    if (e.viewport) S.view = { rows: e.viewport.rows, isFullscreen: e.viewport.isFullscreen }
    if (Number.isFinite(left)) S.bandRoom = left
    // the window narrowed a docked pane into an inline one with the host's default height: ask once per window size
    // for one that gives the band its 4 lines back (band.js reaskRows)
    // v3 (봇 ③): the band's least rows grow while a 도구 kind is folded open — asked again once per size and need
    const keep = keepNow()
    const rows = reaskRows(S.pane, S.paneRows, left, keep)
    const size = e.viewport ? e.viewport.columns + 'x' + e.viewport.rows + '/' + keep : null
    if (rows && size && S.reasked !== size) {
      S.reasked = size
      try { $.clock.after(0, () => { reaskPane($, rows) }) } catch (err) { /* the next draw asks */ }
    }
    const lines = bandOf(view(), left, cols)
    const mine = Box({ key: 'mh-band', flexDirection: 'column', backgroundColor: PANE_BG, children: lines.map((segs, i) => row('mh-band-' + i, segs)) })
    return Box({ flexDirection: 'column', children: theirs ? [theirs, mine] : [mine] })
  })

  // 단축키 줄 (v2 1번 · 봇 20:23 승인 방식): idle = our line in the hint's place; a turn running or text typed =
  // the engine's own line kept («esc to interrupt», its pills) with ours added at its end as `tail`.
  // The engine's mode pill keeps its place at the line's start, so room for it is kept (band.js hintPlan · PILL_ROOM).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    const p = e.props || {}
    if (!S.cfg || typeof p.hint !== 'string') return next(e)
    const pills = skinOf(S.skin).hint === 'cockpit-pill' ? { look: LOOK[S.act.state] || LOOK.idle } : null
    const plan = hintPlan(p, e.viewport && e.viewport.columns, S.pane.placed, pills)
    return next(plan ? { ...e, props: { ...p, ...plan } } : e)
  })

  // r3b 3안 pipeline-rail (DESIGNS 안 3): the engine's tool line drawn as a rail — only its name's place (props.tool, which
  // the engine draws as the line's label, the input after it): «─▶ [✦ skill] km:search ━━━━━● ✓ 0.6s». The props carry
  // no time (engine 2.1.296), so the time is what this mod saw: first drawn running → first drawn settled; a line first
  // drawn settled (an old one redrawn) gets none. Any other skin, or anything unexpected = the engine's line untouched.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    const p = e.props || {}
    if (skinOf(S.skin).tools !== 'pipeline-rail' || typeof p.tool !== 'string' || !p.tool) return next(e)
    let label = null
    try {
      const state = railState(p)
      const id = typeof p.tool_use_id === 'string' && p.tool_use_id ? p.tool_use_id : null
      const now = await $.clock.now()
      let ms = null
      if (id) {
        let t = S.rail.get(id)
        if (!t) {
          t = { start: now, end: state === 'running' ? null : now }
          S.rail.set(id, t)
          if (S.rail.size > RAIL_KEEP) S.rail.delete(S.rail.keys().next().value)
        }
        if (state !== 'running' && t.end === null) t.end = now
        ms = t.end === t.start ? null : (t.end ?? now) - t.start
      }
      const call = callOf(p.tool, p.input, $.plugin.name)
      label = railLabel(call ? call.kind : 'tool', call ? call.name : p.tool, state, ms)
    } catch (err) {
      label = null
    }
    return next(label ? { ...e, props: { ...p, tool: label } } : e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    if (e.requestId !== PANE_ID || !S.cfg) return next(e)
    const p = e.props || {}
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const site = pressSite($, false)
    // docs: inline pane = a third of the space unless asked (bodyRows = that limit) · dock = the sidebar's rows.
    // A taller tree only scrolls as a whole, so the lines are chosen to fit (기둥 ③: 14 rows hid 펼친 묶음·기억).
    const bodyRows = p.scroll && Number.isFinite(p.scroll.bodyRows) ? p.scroll.bodyRows : undefined
    const cols = Math.max(20, p.bodyColumns || 80)
    const divider = p.placement === 'dock'
    // Where the pane sits decides the band's shape: a change is drawn into the band right after this frame.
    const placement = p.placement === 'dock' || p.placement === 'inline' ? p.placement : null
    if (!S.pane.placed || S.pane.placement !== placement) {
      S.pane = { placed: true, placement }
      try { $.clock.after(0, () => { S.sig = ''; redraw($) }) } catch (err) { /* the 5 s tick redraws */ }
    }
    S.paneRows = placement === 'inline' && Number.isFinite(bodyRows) ? bodyRows : null
    const lines = paneOf(view(), divider ? cols - 2 : cols, bodyRows)
    const rows = lines.map((l) => paneRow(ui, l.key, l.segs, cols, divider, l.mark, site, l.fill))
    // 10-21: the Buttons as drawn (the arrows' account steps read them) · an account press waiting for its row: the ring
    // goes there once this drawing is up (a hook cannot wait on its own drawing — after(0))
    S.paneKeys = [...site.keys]
    if (S.ringWant) {
      const key = accountKeyOf(S.paneKeys, S.ringWant)
      S.ringWant = null
      if (key) try { $.clock.after(0, () => { ringTo($, key) }) } catch (err) { /* the ring stays where it is */ }
    }
    // empty rows down to the body's floor are painted too (v2 2번 «빈 행까지») — inline as well: its height was asked
    for (let i = rows.length; Number.isFinite(bodyRows) && i < bodyRows; i++) rows.push(paneRow(ui, 'fill-' + i, null, cols, divider, undefined, site))
    return Box({ flexDirection: 'column', backgroundColor: PANE_BG, children: rows })
  })
}
