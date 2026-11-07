// lane: memory · owner: 봇 · pilot 2026-10-18 (주인 · 봇 배분)
// scope v1 (봇 발주 memory-recall-newtask-1018 · 주인): recall at new-task moments (hindsight + hindsight-shared
// recall → one short prompt-context block, capped) + a «when to call» line on the memory read tools + a spawn_child nudge
// at the same moments · the recall tools pass without a permission dialog when this plugin calls them (selfAllow) ·
// write guard ($.fs.write under memory roots, non-GET $.http.fetch to memory hosts → refused).
// Off unless config.memory.recall.enabled / config.memory.guard is set (today's behaviour).
// Loader rules: one hook per event per matcher — prompt.submit is held unfiltered by the session lane and with
// {text:/[\s\S]*/} by the hooks-port prompt lane, so this lane uses {text:/[\s\S]+/}.
import { dmThreadOf, replyThreadKey, takeProjectLine, parseStore, putBinding, projectArgv, formatProjectBlock, parseProjectOut } from './lib/project.js'
import { describeTool, toolKey } from './lib/describe.js'
import { memorySettings, toolPrefix, recallToolNames, RECALL_TOOL, buildQuery, cleanQuery, newTaskMoment, markSeen, recallItems, mergeTop, convoArgv, convoItems, formatRecall, nudgeLine, hasSpawnTool, fsWriteRefusal, guardArgv, guardVerdict, fetchRefusal, fetchArgv, fetchVerdict, slackTsFromMs, feedbackArgv, feedbackNotes, childRule, threadFirst, threadTagOf, CHILD_WRITE_TOOLS, rootOf, childWriteLine, toolWritePath, childTargetVerdict, memoryBashVerdict } from './lib/recall.js'
// Same two lines in the four lane files: the validator follows $ only into same-file functions. The first call pins the verdict for this process (a later /clear changes the session id, the launcher's does not).
let optInAnchor
async function optedIn($) { if (optInAnchor === undefined) { const bot = await $.env.get('MODS_HARNESS_BOT'); const expected = await $.env.get('MODS_HARNESS_SESSION_ID'); optInAnchor = Boolean(bot) && Boolean(expected) && expected === await $.session.id() } return optInAnchor }
// Pilot pin (봇 재검 10-18 · 봇 ②): with same-name copies only the first copy's hooks run. A launcher that sets
// MODS_HARNESS_MEM_ROOT to the copy it loads makes any other copy of this lane stay off — order is not trusted.
let pinAnchor
// 하위 세션(MH_SESSION_DEPTH ≥ 1 — the session lane sets it at spawn) keeps the lane off: a child inherits the parent's
// plugin root and opt-in pair, so without this the org copy would turn recall · nudge · guards on in every 하위 at once
// (통합 담당 10-19 기본안 «하위에선 끔», 결정 = 봇). The verdict is pinned for the process like the two above.
// K2 (주인 10-21 21:43 · 봇 19:39 권고): the ONE thing that runs in a 하위 is the child write guard below (the
// model's Write/Edit/MultiEdit/NotebookEdit/Bash into the guarded memory roots) — recall, nudge, the $.fs.write and
// $.http.fetch guards stay as they were (off in a 하위, on in the bot's own session).
let depthAnchor
async function topLevel($) {                 // true = the bot's own session (depth 0 or unset) · false = a 하위
  if (depthAnchor === undefined) {
    const d = Number((await $.env.get('MH_SESSION_DEPTH')) || 0)
    depthAnchor = !(d >= 1)
    if (!depthAnchor) { try { $.ui.log('[mod-for-slack] 기억: 하위 세션(깊이 ' + d + ')이라 회상은 꺼진 채로 두고, 기억 폴더 직접 쓰기만 막습니다') } catch (err) { /* nothing */ } }
  }
  return depthAnchor
}
async function pinOn($) {
  if (pinAnchor === undefined) {
    const want = ((await $.env.get('MODS_HARNESS_MEM_ROOT')) || '').replace(/\/+$/, '')
    let here = ''
    try { here = String($.plugin.root || '').replace(/\/+$/, '') } catch (err) { here = '' }
    pinAnchor = !want || want === here
    if (!pinAnchor) { try { $.ui.log('[mod-for-slack] 기억: 이 사본(' + here + ')은 런처가 고정한 사본이 아니라 꺼진 채로 둡니다') } catch (err) { /* nothing */ } }
  }
  return pinAnchor
}
async function laneOn($) {
  if (!(await optedIn($))) return false
  if (!(await topLevel($))) return false
  return pinOn($)
}
// K2: a participating 하위 (opted in · depth ≥ 1 · this copy) — the only sessions the child write guard judges.
async function childGuardOn($) {
  if (!(await optedIn($))) return false
  if (await topLevel($)) return false
  return pinOn($)
}

// 구미호 공식 꼴 (10-24 · lib/kumiho.js) — its own import lines here, apart from the shared import block above
import { isKumihoKey } from './lib/describe.js'
import { kumihoSettings, termList, KUMIHO_WRITE_TOOL, KUMIHO_UPFRONT, kumihoToolOf, reflectArgs, reflectVerdict, refusal, otherWriteLine, CHILD_KUMIHO_LINE, SUBAGENT_KUMIHO_LINE, KUMIHO_OFF_LINE, sessionRequired, kstDay, kumihoLine, kumihoMoment, issuedSessionIds, sessionIdVerdict, SESSION_ID_FIX } from './lib/kumiho.js'

const PLUGIN = 'mod-for-slack'
const CACHE_MS = 30000
let cached = null
let cachedAt = -1
let warnedNotConnected = false
// Last recall, for the pane («◎ 기억» button) and the debug log.
let last = { at: 0, state: 'none', conversations: 0, facts: 0, chars: 0, ms: 0, error: '' }
export function recallStats() { return { ...last } }
// Feedback auto-save: last sweep and running totals (pane / debug).
let fb = { at: 0, sinceTs: '', written: 0, skipped: 0, failed: 0, state: 'none', error: '' }
export function feedbackStats() { return { ...fb } }

// One sweep: run the read-only builder, write each note it prints with the Write tool (the gates see it; a default-mode
// window needs an Edit(//<notesDir>/**) allow rule). Rate-limited to fb.everyMs; never throws into the prompt.
async function feedbackSweep($, s) {
  const f = s.feedback
  const now = await nowMs($)
  if (fb.at && now && now - fb.at < f.everyMs) return
  fb.at = now
  if (!fb.sinceTs) fb.sinceTs = f.sinceTs || slackTsFromMs(now)
  const bot = (await $.env.get('MODS_HARNESS_BOT')) || ''
  if (!bot) return
  const script = $.plugin.root + '/src/memory/scripts/feedback_auto.py'
  const r = await $.process.run(feedbackArgv(f, bot, script, fb.sinceTs), { timeoutMs: 8000 })
  const got = feedbackNotes(r && r.stdout, f.notesDir)
  if (got.error) { fb = { ...fb, state: 'error', error: got.error.slice(0, 200) }; return }
  for (const n of got.notes) {
    try {
      await $.tool.call({ tool: 'Write', file_path: n.path, content: n.text })
      fb.written++
    } catch (err) { fb.failed++; fb.error = String((err && err.message) || err).slice(0, 200) }
  }
  fb.state = got.notes.length ? 'written' : 'idle'
}

async function loadSettings($) {
  let t = 0
  try { t = await $.clock.now() } catch (err) { t = 0 }
  if (cached && t && cachedAt >= 0 && t - cachedAt < CACHE_MS) return cached
  const home = (await $.env.get('HOME')) || ''
  let path = (await $.env.get('MODS_HARNESS_CONFIG')) || ''
  if (!path) path = $.plugin.root + '/config/local.config.json'
  let raw = null
  try { if (await $.fs.exists(path)) raw = JSON.parse(await $.fs.read(path, 'text')) } catch (err) { raw = null }
  // built whole, then published in one step: a concurrent hook never sees a settings object without its kumiho part
  // (재검 F7 · the await on the blockTermsFile read was a window)
  const built = memorySettings(raw, home)
  built.kumiho = await kumihoLoad($, raw, home)
  cached = built; cachedAt = t
  return cached
}

// memory.kumiho (lib/kumiho.js) + the words in blockTermsFile. A file that cannot be read = no extra words (the built-in
// secret and personal-data checks still run) and one debug line.
async function kumihoLoad($, raw, home) {
  const k = kumihoSettings(raw, home)
  let fileTerms = []
  if (k.blockTermsFile) {
    try { fileTerms = termList(await $.fs.read(k.blockTermsFile, 'text')) } catch (err) { debugLog($, '구미호: 막는 낱말 파일을 못 읽음 — 기본 검사만') }
  }
  return { ...k, terms: termList([...k.blockTerms, ...fileTerms]) }
}

async function nowMs($) { try { return await $.clock.now() } catch (err) { return 0 } }

// $.mcp.call with a time cap: a slow memory server must not hold the prompt.
// The timer is $.clock.after (the documented mod timer · 봇 10-18: the api lists no timer globals such as setTimeout).
async function callCapped($, server, tool, args, ms) {
  let timer = null
  const cap = new Promise((_, reject) => { timer = $.clock.after(ms, () => reject(new Error('memory recall timed out after ' + ms + 'ms'))) })
  try { return await Promise.race([$.mcp.call(server, tool, args), cap]) } finally { try { if (timer) timer.cancel() } catch (err) { /* already fired */ } }
}

// ◎ 기억 button (봇 ui lane, read-only there): the last recall, without the error text, in $.state mh.recall.
// The key belongs to the mods-harness plugin; a renamed test/pilot copy cannot write it (caught — nothing else changes).
const RECALL_REF = { plugin: 'mod-for-slack', key: 'mh.recall' }
async function publishRecall($) {
  try {
    const { at, state, conversations, facts, chars, ms, lines } = last
    await $.state.set(RECALL_REF, { at, state, conversations, facts, chars, ms, lines: Number.isInteger(lines) ? lines : 0 })
  } catch (err) { /* ui lane optional */ }
}

// DM thread ↔ project. One store file per bot under project.stateDir.
let proj = { at: 0, state: 'none', key: '', room: '', how: '', chars: 0, error: '' }
export function projectStats() { return { ...proj } }
// Write guard counters — the after-enable check reads «checks > 0» as «the guard hook of THIS copy really ran».
let guardRun = { at: 0, checks: 0, denied: 0, last: '' }
let childSeen = { home: '', cwd: '' }   // K2 r2 (D8): the last HOME and working folder the child write check read
export function guardStats() { return { ...guardRun } }
let stateDirReady = ''

async function storeFile($, s) {
  const bot = (await $.env.get('MODS_HARNESS_BOT')) || ''
  return bot ? s.project.stateDir + '/thread-projects-' + bot.replace(/[^A-Za-z0-9_-]/g, '_') + '.json' : ''
}
async function readStore($, path) {
  try { if (await $.fs.exists(path)) return parseStore(await $.fs.read(path, 'text')) } catch (err) { /* empty store */ }
  return {}
}
async function writeStore($, s, path, store) {
  if (stateDirReady !== s.project.stateDir) { await $.process.run(['mkdir', '-p', s.project.stateDir], { timeoutMs: 5000 }); stateDirReady = s.project.stateDir }
  await $.fs.write(path, JSON.stringify(store))
}

// The block for a DM thread: the stored binding (② line or earlier ①), else ① from the ledger (then stored).
async function projectBlock($, e, s, maxChars) {
  const thread = dmThreadOf(e.text)
  if (!thread) return ''
  const bot = (await $.env.get('MODS_HARNESS_BOT')) || ''
  const path = await storeFile($, s)
  if (!bot || !path) return ''
  const store = await readStore($, path)
  const bound = store[thread.key] && (store[thread.key].room || store[thread.key].ledgerId) ? store[thread.key] : null
  const script = $.plugin.root + '/src/memory/scripts/project_context.py'
  const r = await $.process.run(projectArgv(s.project, bot, script, thread, bound), { timeoutMs: 5000 })
  const ctx = parseProjectOut(r && r.stdout)
  if (ctx.bound && !bound && ctx.how === 'ledger') {
    const first = (Array.isArray(ctx.ledger) && ctx.ledger[0] && ctx.ledger[0].id) || ''
    const value = { how: 'ledger', at: await nowMs($) }
    if (ctx.room) value.room = ctx.room
    if (first) value.ledgerId = first
    if (value.room || value.ledgerId) await writeStore($, s, path, putBinding(store, thread.key, value))
  }
  const block = formatProjectBlock(ctx, maxChars)
  proj = { at: await nowMs($), state: block ? 'attached' : (ctx.error ? 'error' : 'unbound'), key: thread.key, room: ctx.room || '',
    how: ctx.how || '', chars: block.length, error: ctx.error ? String(ctx.error).slice(0, 200) : '' }
  return block
}

function skipLog($, why) { try { $.ui.log('[mod-for-slack] 기억 회상 건너뜀: ' + why) } catch (err) { /* nothing */ } }
// One debug-log line per decision (nothing on screen, nothing to the model) — what the isolated run measures.
function debugLog($, line) { try { $.ui.log('[mod-for-slack] ' + line, { to: 'debug' }) } catch (err) { /* nothing */ } }

// New-task moments (주인): the delivery keys this session has seen, and «no prompt yet since start or /clear».
// Reset by register() (process start · resume) and by session.end reason clear (the conversation is gone, the process
// goes on). Not by session.compact: the compacted summary keeps the work and the threads it was in.
let seenThreads = new Set()
let fresh = true
// The kumiho reminder keeps its own seen/fresh (memory.kumiho is its own switch: a bot with recall off or another recall
// mode still gets the line at new-task moments). Reset at the same points. kumihoRun = this process's write tally.
let kSeen = new Set()
let kFresh = true
let kumihoRun = { day: '', used: 0, passed: 0, denied: 0, last: '' }
// the server-issued reflect session ids of THIS conversation (reset at start and /clear) · unknown = an answer we could not read
let kSess = { issued: new Set(), unknown: false }
export function kumihoStats() { return { ...kumihoRun, sessions: kSess.issued.size, sessionsUnknown: kSess.unknown } }
// → the reminder's turn ({ moment, ownerMsg, ownerTurn }) or null; marks this prompt's threads seen for the reminder.
function kumihoTurn(text, owners) {
  const t = kumihoMoment(text, kSeen, kFresh, owners)
  markSeen(kSeen, t.keys)
  if (!String(text || '').trim().startsWith('/')) kFresh = false
  return t.moment || t.ownerTurn ? t : null
}
async function kumihoReminder($, t) {
  let names = []
  try { names = (await $.tool.list()).map(x => x.name) } catch (err) { names = [] }
  const line = kumihoLine(names, t.moment, t.ownerMsg, t.ownerTurn)
  if (line) debugLog($, `구미호 줄: ${t.moment ? t.moment.why : 'owner-turn'}${t.ownerMsg || t.ownerTurn ? ' · 주인 글' : ''}${/kumiho_memory_reflect/.test(line) ? ' · reflect 안내' : ''}`)
  return line
}
function kumihoDeny($, code, why) {
  kumihoRun.denied++; kumihoRun.last = code
  debugLog($, '구미호 쓰기: 거절 ' + code)
  return { deny: why }
}

// One recall per bank (in parallel, each capped), merged → one block. Every bank that fails or is slow is skipped with
// one log line; nothing throws into the prompt. mh.recall: conversations = items from the first bank (개별), facts =
// items from the others (공유) — the two numbers the ◎ button already shows.
async function recall($, query, s, budget, names, why = '', thread = '') {
  const r = { ...s.recall, maxChars: budget === undefined ? s.recall.maxChars : budget }
  if (r.maxChars < 80 || !query) return ''
  const live = r.servers.filter(x => names.includes(toolPrefix(x.server) + RECALL_TOOL))
  // the CLI (~1–3 s) runs at moments only — never on every prompt of the 'inject' comparison mode (why = '')
  const convo = r.convo && r.convo.enabled && why ? r.convo : null
  // A window can submit its first prompt before the MCP servers connect (probe 10-18): no bank → this turn is skipped
  // (state not-connected, so the caller re-arms the moment). The past-conversation axis does not change that verdict:
  // with no bank live the moment stays un-spent even when the CLI could answer (one rule, the banks decide).
  if (!live.length) {
    last = { ...last, at: await nowMs($), state: 'not-connected', conversations: 0, facts: 0, chars: 0, ms: 0, error: '', lines: 0 }
    if (!warnedNotConnected) { warnedNotConnected = true; skipLog($, 'hindsight 도구가 안 보임(연결 전 또는 거부 규칙)') }
    return ''
  }
  warnedNotConnected = false
  const t0 = await nowMs($)
  // 10-24: memory.recall.types (e.g. ["observation"] = the official shape) rides only when set — unset = the call as before
  const args = { query, max_tokens: r.maxTokens, budget: 'low', ...(r.types && r.types.length ? { types: r.types } : {}) }
  // 10-24 ⓐ: a reply-thread moment asks the bot's own bank (the first server = 개별) once more for that thread's tag.
  // Fired only when there is a thread tag and the slot count > 0 — other moments make exactly the calls they made before.
  const tag = r.thread > 0 ? threadTagOf(thread) : ''
  const own = tag && r.servers[0] ? live.find(x => x.server === r.servers[0].server) : null
  const runThread = own ? callCapped($, own.server, RECALL_TOOL, { ...args, tags: [tag], tags_match: 'any_strict' }, r.timeoutMs) : Promise.resolve(null)
  // a sync throw becomes a rejection; a run that never settles is cut at its own cap + 500 ms (the banks are not held hostage)
  const runConvo = convo ? new Promise((resolve, reject) => {
    let timer = null
    try { timer = $.clock.after(convo.timeoutMs + 500, () => reject(new Error('memory-bank timed out after ' + (convo.timeoutMs + 500) + 'ms'))) } catch (err) { timer = null }
    Promise.resolve().then(() => $.process.run(convoArgv(convo, query), { timeoutMs: convo.timeoutMs }))
      .then(resolve, reject).finally(() => { try { if (timer) timer.cancel() } catch (err) { /* fired */ } })
  }) : Promise.resolve(null)
  const [got, cv, th] = await Promise.all([
    Promise.allSettled(live.map(x => callCapped($, x.server, RECALL_TOOL, args, r.timeoutMs))),
    Promise.allSettled([runConvo]).then(x => x[0]),
    Promise.allSettled([runThread]).then(x => x[0]),
  ])
  let lists = []
  const failed = []
  got.forEach((g, i) => {
    if (g.status === 'fulfilled' && !(g.value && g.value.isError)) lists.push(recallItems(g.value, live[i].label, r.maxItemChars, tag))
    else failed.push(live[i].server + ' ' + (g.status === 'rejected' ? String((g.reason && g.reason.message) || g.reason).slice(0, 80) : 'isError'))
  })
  // the thread answer keeps only items whose own tags carry the thread tag (an older bank may answer «any» — client-side strict)
  if (own) {
    if (th.status === 'fulfilled' && th.value && !th.value.isError) lists.push(recallItems(th.value, own.label, r.maxItemChars, tag).filter(x => x.thread))
    else failed.push('thread ' + (th.status === 'rejected' ? String((th.reason && th.reason.message) || th.reason).slice(0, 80) : 'isError'))
  }
  // K1: the 하위-recorded items (tag 'child') — marked (default), dropped, or as before (memory.recall.child)
  const cr = childRule(lists, r.child)
  lists = cr.lists
  let past = []
  if (convo) {
    if (cv.status === 'fulfilled' && cv.value && !(Number.isInteger(cv.value.code) && cv.value.code !== 0 && !cv.value.stdout)) {
      past = convoItems(cv.value.stdout, convo.label, r.maxItemChars, convo.limit)
    } else failed.push('memory-bank ' + (cv.status === 'rejected' ? String((cv.reason && cv.reason.message) || cv.reason).slice(0, 80) : 'exit ' + (cv.value && cv.value.code)))
  }
  const ms = (await nowMs($)) - t0
  if (failed.length) skipLog($, failed.join(' · ') + ` (${ms}ms)`)
  const labels = [...(convo ? [convo.label] : []), ...r.servers.map(x => x.label)]
  // the axis's items join the banks' under the banks' own rule (non-turns first, then score · limit · char budget) — no
  // reserved first slot (봇 10-20 가름 ②: the raw question's CLI 1위 was the wrong research; a pin would lock it into the first line)
  const { memo, lines, used } = formatRecall(threadFirst([...lists, past], r.limit, tag ? r.thread : 0), r.maxChars, labels, why)
  const first = r.servers[0] && r.servers[0].label
  last = { at: await nowMs($), state: memo ? 'attached' : (lists.length || past.length ? 'empty' : 'error'),
    conversations: used.filter(x => !x.convo && x.label === first).length, facts: used.filter(x => !x.convo && x.label !== first).length,
    past: used.filter(x => x.convo).length, chars: memo.length, ms, error: failed.join(' · ').slice(0, 200), lines,
    child: used.filter(x => x.child).length, childDropped: cr.dropped, thread: used.filter(x => x.thread).length }
  return memo
}

// «프로젝트: …» in a Slack reply: record the binding for that DM thread and send the text WITHOUT the line
// (봇 ③ 조건 — owner-facing text carries no ledger ids or paths). Probe 10-18: the rewritten text is what the
// classic PreToolUse gates and the tool receive; within one plugin the hook registered FIRST runs first and sees the
// raw text — so the entry registers this before the hooks-port lane (whose tool.call runs the gates).
// A reply that was only that line is not sent.
export function registerReplyStrip(on, options) {
  on('tool.call', { tool: /^mcp__slack-channel__reply$/ }, async ($, e, next) => {
    if (!(await laneOn($))) return next(e)
    const s = await loadSettings($)
    if (!s.project.enabled || typeof e.text !== 'string') return next(e)
    const got = takeProjectLine(e.text)
    if (!got) return next(e)
    const key = replyThreadKey(e.chat_id, e.thread_ts)
    if (key && got.binding) {
      try {
        const path = await storeFile($, s)
        if (path) await writeStore($, s, path, putBinding(await readStore($, path), key, { ...got.binding, how: 'line', at: await nowMs($) }))
        proj = { ...proj, at: await nowMs($), state: 'bound-by-line', key, room: got.binding.room || '', how: 'line', error: '' }
      } catch (err) { proj = { ...proj, state: 'error', error: String((err && err.message) || err).slice(0, 200) } }
    }
    if (!got.stripped) return { deny: '프로젝트 줄만 있는 답은 보내지 않습니다(묶음만 기록) — 본문을 함께 쓰세요' }
    return next({ ...e, text: got.stripped })
  }).catch(async ($, e, next) => (next.called ? next(e) : next(e)))
}

export function register(on, options) {
  optInAnchor = undefined; pinAnchor = undefined; depthAnchor = undefined
  guardRun = { at: 0, checks: 0, denied: 0, last: '' }
  childSeen = { home: '', cwd: '' }
  cached = null; cachedAt = -1; warnedNotConnected = false
  fb = { at: 0, sinceTs: '', written: 0, skipped: 0, failed: 0, state: 'none', error: '' }
  proj = { at: 0, state: 'none', key: '', room: '', how: '', chars: 0, error: '' }; stateDirReady = ''
  last = { at: 0, state: 'none', conversations: 0, facts: 0, chars: 0, ms: 0, error: '' }
  seenThreads = new Set(); fresh = true
  kSeen = new Set(); kFresh = true; kumihoRun = { day: '', used: 0, passed: 0, denied: 0, last: '' }; kSess = { issued: new Set(), unknown: false }
  on('prompt.submit', { text: /[\s\S]+/ }, async ($, e, next) => {
    if (!(await laneOn($))) return next(e)
    const s = await loadSettings($)
    // 구미호 (memory.kumiho · 10-24 공식 꼴): read the moment before anything below marks this prompt's threads seen
    const kTurn = s.kumiho.enabled && s.kumiho.nudge ? kumihoTurn(e.text, s.recall.owners) : null
    if (s.feedback.enabled) {
      try { await feedbackSweep($, s) } catch (err) { fb = { ...fb, state: 'error', error: String((err && err.message) || err).slice(0, 200) } }
    }
    // One budget for both blocks (봇 ③): the project block first (the work at hand), recall gets what is left.
    const budget = s.recall.maxChars
    let block = ''
    if (s.project.enabled) {
      try { block = await projectBlock($, e, s, budget) } catch (err) { proj = { ...proj, state: 'error', error: String((err && err.message) || err).slice(0, 200) } }
    }
    let memo = ''
    let nudge = ''
    if (s.recall.enabled && s.recall.mode !== 'tools') {
      // inject = every prompt · newtask = only a new top-level post, the first post of an unseen thread, or the first
      // prompt since start or /clear. A reply in a seen thread: no search, no nudge.
      let query = ''
      let moment = null
      const ask = s.recall.query === 'clean' ? cleanQuery : buildQuery   // 10-24 memory.recall.query
      if (s.recall.mode === 'inject') query = ask(e.text)
      else {
        // owner past-ref question in a seen thread = the one exception (recall.js newTaskMoment · s.recall.owners)
        const got = newTaskMoment(e.text, seenThreads, fresh, s.recall.owners)
        markSeen(seenThreads, got.keys)
        const wasFresh = fresh
        if (!String(e.text || '').trim().startsWith('/')) fresh = false
        moment = got.moment
        // 10-24 'first': one recall per session — the first prompt since start or /clear, whatever it is; nothing after
        if (s.recall.mode === 'first') moment = wasFresh && moment ? { ...moment, why: 'session-start' } : null
        if (moment) {
          query = ask(moment.body)
          // 'first': a first prompt whose query comes out empty (only a mention, a link, a code block) does not spend
          // the session's one recall — the next prompt is still «the first» (재검 8)
          if (s.recall.mode === 'first' && !query) { fresh = wasFresh; debugLog($, '기억 회상: first — 질의 빈 글이라 다음 글로 미룸') }
        } else if (got.keys.length) debugLog($, s.recall.mode === 'first' ? '기억 회상: first — 세션 첫 글 뒤라 안 붙임' : '기억 회상: 본 스레드의 답글 — 안 붙임')
      }
      if (query) {
        let names = []
        try { names = (await $.tool.list()).map(t => t.name) } catch (err) { names = [] }
        try { memo = await recall($, query, s, block ? budget - block.length - 1 : budget, names, moment ? moment.why : '', (moment && moment.thread) || '') } catch (err) {
          last = { ...last, at: await nowMs($), state: 'error', error: String((err && err.message) || err).slice(0, 200) }
          skipLog($, String((err && err.message) || err).slice(0, 120))
          memo = ''
        }
        await publishRecall($)
        // MCP not connected yet (a window's first prompt can beat the connect): the moment is not spent — the next
        // prompt of that thread (or the next prompt after start) tries again. A bank that answered with an error is not retried.
        if (moment && last.state === 'not-connected') {
          if (moment.why === 'session-start') fresh = true
          else for (const k of moment.keys || []) seenThreads.delete(k)
        }
        // ③ the nudge: same moment, only where spawn_child exists (a grandchild has none). Not on the owner's past-ref
        // question — that is a look back inside work already going, not a new task.
        if (moment && moment.why !== 'owner-past-ref' && s.recall.nudge && hasSpawnTool(names)) nudge = nudgeLine(Boolean(memo))
        debugLog($, `기억 회상: ${moment ? moment.why : 'inject'} · ${last.state} · ${last.lines || 0}건${last.past ? `(대화 ${last.past})` : ''}${last.thread ? ` · 이 스레드 ${last.thread}` : ''}${last.child ? ` · 하위 기록 ${last.child}` : ''}${last.childDropped ? ` · 하위 기록 뺌 ${last.childDropped}` : ''} ${memo.length}자 ${last.ms}ms${nudge ? ' · 넛지' : ''}`)
      }
    }
    const kline = kTurn ? await kumihoReminder($, kTurn) : ''
    const add = [block, memo, nudge, kline].filter(Boolean)
    return add.length ? next({ ...e, context: [...(e.context || []), ...add] }) : next(e)
  }).catch(async ($, e, next) => (next.called ? next(e) : next(e)))

  // /clear: the conversation ends and the process goes on under a new id, with no session.start (engine docs) —
  // the next prompt is a fresh start and no thread counts as seen. Own matcher (the session lane holds session.end unfiltered).
  on('session.end', { reason: /^clear$/ }, async ($, e, next) => {
    seenThreads = new Set(); fresh = true
    kSeen = new Set(); kFresh = true; kSess = { issued: new Set(), unknown: false }
    return next(e)
  }).catch(async ($, e, next) => (next.called ? next(e) : next(e)))

  // 'tools' and 'newtask': the memory read tools carry a «when to call» line (the upfront ones are not deferred).
  // The kumiho lines have their own switch, memory.kumiho.enabled (10-24 공식 꼴) — with it, engage and reflect are
  // upfront too (memory.kumiho.upfront, default on); without it the kumiho tools keep the server's own text, no line.
  // Any failure keeps next's answer.
  on('tool.describe', { tool: /^mcp__/ }, async ($, e, next) => {
    const r = await next(e)
    try {
      if (!(await laneOn($))) return r
      const s = await loadSettings($)
      const key = toolKey(e.tool)
      const k = isKumihoKey(key)
      if (k ? !s.kumiho.enabled : (!s.recall.enabled || s.recall.mode === 'inject')) return r
      const original = (r && typeof r.description === 'string') ? r.description : e.description
      const up = k && s.kumiho.upfront ? [...s.recall.upfront, ...KUMIHO_UPFRONT] : s.recall.upfront
      const got = describeTool(key, original, up)
      return got ? { ...(r || {}), ...got } : r
    } catch (err) { return r }
  }).catch(async ($, e, next) => (next.called ? next(e) : next(e)))

  // The recall tools this plugin calls pass without a dialog; an engine deny (a deny rule) is never lifted,
  // and nobody else's call is touched.
  on('tool.check', { tool: /^mcp__.+__recall$/ }, async ($, e, next) => {
    const verdict = await next(e)
    try {
      if (!verdict || verdict.decision !== 'ask' || !next.origin || typeof next.origin.plugin !== 'string') return verdict
      if (!(await laneOn($))) return verdict
      // Own calls only: this plugin's name as the engine reports it (a renamed test copy has another name).
      let self = PLUGIN
      try { if (typeof $.plugin.name === 'string' && $.plugin.name) self = $.plugin.name } catch (err) { self = PLUGIN }
      if (next.origin.plugin !== self) return verdict
      const s = await loadSettings($)
      if (!s.recall.enabled || !s.recall.selfAllow || !recallToolNames(s.recall.servers).includes(e.tool)) return verdict
      return { decision: 'allow', reason: 'mod-for-slack memory recall (allow list: recall on the configured banks)' }
    } catch (err) { return verdict } // a failure here keeps the engine verdict (never widens)
  }).catch(async ($, e, next) => next(e))

  on('fs.write', async ($, e, next) => {
    if (!(await laneOn($))) return next(e)
    const s = await loadSettings($)
    if (!s.guard.writeRoots.length) return next(e)
    let cwd = ''
    try { cwd = await $.session.cwd() } catch (err) { cwd = '' }
    guardRun.checks++; guardRun.at = await nowMs($)
    // 1) the path as written (fast, no process) 2) where it really lands — a symlink, «..» after a link, a firmlink,
    // a case/Unicode variant or a hard link must not get past the string check (봇 재검 10-18). No answer = refuse.
    let why = fsWriteRefusal(e.path, s.guard.writeRoots, cwd)
    if (!why) {
      let out = ''
      try {
        const r = await $.process.run(guardArgv(s.guard, $.plugin.root + '/src/memory/scripts/write_target.py', e.path, cwd), { timeoutMs: s.guard.timeoutMs })
        out = (r && r.stdout) || ''
      } catch (err) { out = '' }
      why = guardVerdict(out)
    }
    if (why) { guardRun.denied++; guardRun.last = why.slice(0, 200); return { deny: why } }
    return next(e)
  }).catch(async ($, e, next) => (next.called ? next(e) : { deny: 'memory guard failed; $.fs.write refused' }))

  on('http.fetch', async ($, e, next) => {
    if (!(await laneOn($))) return next(e)
    const s = await loadSettings($)
    let why = fetchRefusal(e.url, e.init, s.guard.fetchHosts)
    // Step 2: the same host by another name (DNS name, alias) — resolved, no connection made. No answer = refuse.
    const argv = why ? null : fetchArgv(s.guard, $.plugin.root + '/src/memory/scripts/fetch_target.py', e.url, e.init)
    if (argv) {
      let out = ''
      try { const r = await $.process.run(argv, { timeoutMs: s.guard.timeoutMs }); out = (r && r.stdout) || '' } catch (err) { out = '' }
      why = fetchVerdict(out, String((e.init && e.init.method) || 'GET').toUpperCase())
    }
    return why ? { deny: why } : next(e)
  }).catch(async ($, e, next) => (next.called ? next(e) : { deny: 'memory guard failed; $.http.fetch refused' }))

  // K2 (주인 10-21 21:43 · 봇 19:39 권고 K2): in a 하위 session, the model's own write into a guarded
  // memory root (shared board · WD memory · Work-Feedback — memory.guard.writeRoots) is refused; the lesson goes to the
  // result file and the parent saves it after its re-check. The parent and the bot's own session never reach the check
  // (childGuardOn = opted in · depth ≥ 1 · this copy). Write family: the string check, then where it really lands
  // (write_target.py — a symlink into a root is refused; no answer = refused, as the $.fs.write guard). Bash: best effort.
  on('tool.call', { tool: CHILD_WRITE_TOOLS }, async ($, e, next) => {
    if (!(await childGuardOn($))) return next(e)
    const s = await loadSettings($)
    const roots = s.guard.writeRoots
    if (!roots.length) return next(e)
    let cwd = ''
    try { cwd = await $.session.cwd() } catch (err) { cwd = '' }
    guardRun.checks++; guardRun.at = await nowMs($)
    let why = ''
    if (e.tool === 'Bash') {
      const home = (await $.env.get('HOME')) || ''
      childSeen.home = home; childSeen.cwd = cwd       // the fallback below reads ~ / $HOME / relative paths with these (D8)
      why = memoryBashVerdict(e.command, roots, home, cwd)
    }
    else {
      const path = toolWritePath(e.tool, e)
      if (path) {
        const r = rootOf(path, roots, cwd)
        if (r.relative) why = childWriteLine(`a relative path (${String(path).slice(0, 120)}) with no working directory — refused`)
        else if (r.hit) why = childWriteLine(`${String(path).slice(0, 160)} is under ${r.hit}`)
        else {
          let out = ''
          try {
            const p = await $.process.run(guardArgv(s.guard, $.plugin.root + '/src/memory/scripts/write_target.py', path, cwd), { timeoutMs: s.guard.timeoutMs })
            out = (p && p.stdout) || ''
          } catch (err) { out = '' }
          why = childTargetVerdict(out, path)
        }
      }
    }
    if (why) { guardRun.denied++; guardRun.last = why.slice(0, 200); return { deny: why } }
    return next(e)
  }).catch(async ($, e, next) => {
    // a failed or overrun check: refused only when this is a known 하위 (pinned depth ≥ 1, opted in) AND the path string
    // names a guarded root (pure, no process) — any other write passes, so a broken check never stops a 하위's own work
    if (next.called || optInAnchor !== true || depthAnchor !== false || pinAnchor === false || !cached) return next(e)
    const roots = cached.guard.writeRoots
    const path = e && e.tool !== 'Bash' ? toolWritePath(e.tool, e) : ''
    const hit = path ? rootOf(path, roots, '').hit : (e && e.tool === 'Bash' ? memoryBashVerdict(e.command, roots, childSeen.home, childSeen.cwd) : '')
    return hit ? { deny: childWriteLine('the check failed or overran and this write names a guarded root — refused') } : next(e)
  })

  // 구미호 쓰기 (주인 10-24 공식 꼴): the bot writes Kumiho itself, in its own session, one short typed line
  // when something is settled. Order: a 하위 → refused (K2 · the config child deny already lists every Kumiho write
  // tool; this is the second wall) · a subagent loop → refused · a write tool other than reflect → refused · reflect →
  // the argument check (lib/kumiho.js reflectVerdict: type · dated title · short content · space_hint · no secret, no
  // personal data, no transcript, blockTerms · a per-day cap), then the call. The engine deny (settings) still decides
  // whether reflect is callable at all — this only narrows. memory.kumiho.enabled off → reflect refused too (the 30 s
  // switch stops writes, not only the reminder). A check that throws refuses (the write leaves the machine).
  on('tool.call', { tool: KUMIHO_WRITE_TOOL }, async ($, e, next) => {
    const child = await childGuardOn($)
    if (!child && !(await laneOn($))) return next(e)
    if (child) return kumihoDeny($, 'child', CHILD_KUMIHO_LINE)
    if (e.agentId) return kumihoDeny($, 'subagent', SUBAGENT_KUMIHO_LINE)
    const tool = kumihoToolOf(e.tool)
    if (tool !== 'kumiho_memory_reflect') return kumihoDeny($, 'tool:' + tool, otherWriteLine(tool))
    const s = await loadSettings($)
    if (!s.kumiho.enabled) return kumihoDeny($, 'off', KUMIHO_OFF_LINE)   // the switch stops writes too (within 30 s)
    const day = kstDay(await nowMs($))
    if (kumihoRun.day !== day) kumihoRun = { ...kumihoRun, day, used: 0 }
    const args = reflectArgs(e)
    const v = reflectVerdict(args, s.kumiho, s.kumiho.terms, kumihoRun.used)
    if (v.code) return kumihoDeny($, v.code, v.why)
    const sv = sessionIdVerdict(args.session_id, kSess.issued, kSess.unknown)
    if (sv) return kumihoDeny($, sv, refusal(sv, SESSION_ID_FIX))
    const r = await next(e)
    const handshake = sessionRequired(r)
    if (handshake) {
      const ids = issuedSessionIds(r)
      if (ids.length) for (const id of ids) kSess.issued.add(id)
      else kSess.unknown = true
    }
    const n = v.captures   // the parsed count — captures sent as a JSON string count too (재검 F2)
    if (n && !handshake && !(r && r.deny) && !(r && r.isError)) kumihoRun.used += n
    kumihoRun.passed++
    debugLog($, `구미호 쓰기: 통과 · capture ${n}${handshake ? ' · session_required(안 셈)' : ''} · 오늘 ${kumihoRun.used}건`)
    return r
  }).catch(async ($, e, next) => (next.called ? next(e) : { deny: refusal('check-failed', '쓰기 검사가 실패해 막았습니다 — 한 번만 다시') }))
}
