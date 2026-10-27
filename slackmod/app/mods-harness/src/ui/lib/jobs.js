// lane: ui · owner: 봇 — pure 예약 작업 model (no `$`): launchctl list + LaunchAgents plists + crontab
// → per-bot groups with 걸린 시각 · 다음 실행 · 작업 한 줄 · 마지막 결과 (설계 메모, 봇 10-17 표기).
import { describeSchedule, nextRun, hhmm } from './schedule.js'
import { botShown } from './display.js'
import { RESULT_LOOK } from './text.js'

export const OTHER = '기타'
const INTERPRETERS = new Set(['python', 'python3', 'bash', 'sh', 'zsh', 'node', 'osascript', 'ruby', 'perl', 'env', 'uv', 'deno', 'bun'])

// 10-27 (Linux VM): a machine with no launchctl at all — `$.process.run` rejects «… failed to start: ENOENT …». That is
// «no launchd jobs here», not a read failure; any other rejection (a timeout, another errno) still is one.
export function noLaunchctl(err) {
  const s = String((err && err.message) || err || '')
  return /failed to start/.test(s) && /\bENOENT\b/.test(s)
}

// `launchctl list` → Map(label → { pid, status }). Header line "PID Status Label" is skipped.
export function parseLaunchctlList(stdout) {
  const out = new Map()
  for (const line of String(stdout || '').split('\n')) {
    const parts = line.trim().split(/\t+|\s{2,}/)
    if (parts.length < 3 || parts[0] === 'PID') continue
    const [pidS, statusS, ...rest] = parts
    const label = rest.join(' ').trim()
    if (!label) continue
    const pid = /^\d+$/.test(pidS) ? Number(pidS) : null
    const status = /^-?\d+$/.test(statusS) ? Number(statusS) : null
    out.set(label, { pid, status })
  }
  return out
}

// `crontab -l` text → [{ expr, command }] (comments, blank lines and VAR=value lines skipped).
export function parseCrontab(text) {
  const out = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) continue
    if (line.startsWith('@')) {
      const m = /^(@\w+)\s+(.+)$/.exec(line)
      if (m && m[1] !== '@reboot') out.push({ expr: m[1], command: m[2] })
      continue
    }
    const f = line.split(/\s+/)
    if (f.length < 6) continue
    out.push({ expr: f.slice(0, 5).join(' '), command: f.slice(5).join(' ') })
  }
  return out
}

function basename(p) {
  const s = String(p || '')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

// A program line → the one thing a person would call this job: the script after an interpreter, else the program.
// 10-19 ③: a script with a name that says nothing («run.sh» — the memory test and memcheck both drew «run.sh») under a
// reverse-DNS label (com.<bot>.<name>) is called by the label's last part instead («memory-same-env-daily»).
const GENERIC = /^(run|main|start|launch|index|job|task)\.(sh|bash|zsh|py|js|mjs|rb)$/
export function oneLine(args, label) {
  const a = Array.isArray(args) ? args.filter((x) => typeof x === 'string') : []
  if (a.length === 0) return label ? String(label).split('.').slice(-1)[0] : '?'
  const prog = basename(a[0])
  const named = (b) => {
    const parts = String(label || '').split('.')
    return GENERIC.test(b) && parts.length >= 3 && parts[parts.length - 1] ? parts[parts.length - 1] : b
  }
  if (INTERPRETERS.has(prog.replace(/[\d.]+$/, '')) || INTERPRETERS.has(prog)) {
    const script = a.slice(1).find((x) => !x.startsWith('-') && !/^[A-Z_][A-Z0-9_]*=/.test(x))
    if (script) return named(basename(script))
  }
  return named(prog)
}

// One plist object → job record. Unknown keys are ignored.
export function jobFromPlist(obj, file) {
  if (!obj || typeof obj !== 'object' || typeof obj.Label !== 'string') return null
  const args = Array.isArray(obj.ProgramArguments) ? obj.ProgramArguments : (typeof obj.Program === 'string' ? [obj.Program] : [])
  return {
    source: 'launchd',
    label: obj.Label,
    file: file || null,
    args,
    calendar: obj.StartCalendarInterval || null,
    interval: Number.isInteger(obj.StartInterval) ? obj.StartInterval : null,
    keepAlive: obj.KeepAlive === true || (obj.KeepAlive && typeof obj.KeepAlive === 'object'),
    runAtLoad: obj.RunAtLoad === true,
    disabled: obj.Disabled === true,
    logPaths: [obj.StandardOutPath, obj.StandardErrorPath].filter((x) => typeof x === 'string'),
  }
}

export function jobFromCron(entry, i) {
  return { source: 'cron', label: 'cron#' + (i + 1), args: entry.command.split(/\s+/), cron: entry.expr, logPaths: [] }
}

// r2 C (부모 18:4x · 주인): a session's own wake-ups
// (CronCreate · ScheduleWakeup · /loop). The engine hands them only on the classic Stop input — session_crons =
// [{ id, schedule (5-field cron, local time), recurring, prompt }] — so the session keeps the last list, writes it into its
// live file («crons») and every window draws it under that session's bot beside its launchd and crontab jobs. The engine
// gives no last result for them: «-», not counted as 미확인.
export const SESSION_CRON_MAX = 20
export function sessionCrons(list) {
  const out = []
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c.id !== 'string' || !c.id || typeof c.schedule !== 'string' || !c.schedule.trim()) continue
    out.push({ id: c.id.slice(0, 64), schedule: c.schedule.trim().slice(0, 64), recurring: c.recurring !== false, prompt: typeof c.prompt === 'string' ? c.prompt.slice(0, 300) : '' })
    if (out.length >= SESSION_CRON_MAX) break
  }
  return out
}

// One wake-up as a job of `bot` (known: the session's own bot) · line = the prompt's first non-empty line.
export function jobFromSession(c, bot, sessionId) {
  const first = String(c.prompt || '').split('\n').map((x) => x.trim()).find(Boolean) || '(빈 작업)'
  return { source: 'session', label: 'session#' + c.id, bot, session: sessionId || null, args: [], cron: c.schedule, recurring: c.recurring !== false, line: first,
    prompt: String(c.prompt || ''), logPaths: [] }
}

// ── 10-24 (B) 예약 한 줄 = 그 작업 상세 (주인 10-24 10:52 · 봇 11:16 봇 안) ──
// A job's id that stays the same across redraws and re-reads (FNV-1a 32 → 8 hex): launchd = its label · crontab = its
// line (expr + command — «cron#N» is its place in the table and moves when a line above it goes) · a session wake-up =
// the session and the wake-up's own id. The press of one 예약 line is JOB_PRESS(id) (band.js actionOf → { type: 'job' }).
export function jobId(job) {
  const j = job || {}
  const key = j.source === 'cron' ? 'cron:' + (j.cron || '') + ' ' + (j.args || []).join(' ')
    : j.source === 'session' ? 'session:' + (j.session || '') + ':' + (j.label || '') : String(j.source || '') + ':' + (j.label || '')
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
export const JOB_PRESS = (id) => 'mh-job-' + id

// The detail lines under an opened 예약 line: 이름 · 주기 · 다음 · 결과 · 실행 (the program line, or a wake-up's prompt) ·
// 파일 (its plist) · 기록 (log paths) · 세션. Each value is cut at DETAIL_CHARS (the pane wraps what is left).
export const DETAIL_CHARS = 160
export function jobDetail(job) {
  const j = job || {}
  const cut = (s) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    return t.length > DETAIL_CHARS ? t.slice(0, DETAIL_CHARS - 1) + '…' : t
  }
  const out = []
  const add = (k, v, ink) => { if (v) out.push([{ text: '      ' + k + ' ', color: 'sub' }, { text: cut(v), color: ink }]) }
  const r = j.result || {}
  add('이름', j.source === 'session' ? '세션 예약 ' + String(j.label || '').replace(/^session#/, '') : j.label)
  add('주기', [j.schedule, j.cron && j.source !== 'session' && !String(j.schedule || '').includes(j.cron) ? '(' + j.cron + ')' : ''].filter(Boolean).join(' '))
  add('다음', j.next !== null && Number.isFinite(j.next) ? hhmm(j.next) : (r.note || (j.interval ? '모름' : '없음')))
  add('결과', (r.glyph || '-') + (r.failed ? ' (종료 코드 ' + r.code + ')' : r.session ? ' (세션 예약은 결과 없음)' : r.note ? ' (' + r.note + ')' : '') + (r.running ? ' · 실행 중' : ''),
    r.failed ? RESULT_LOOK.fail.color : r.glyph === '✓' ? RESULT_LOOK.ok.color : undefined)
  add(j.source === 'session' ? '작업' : '실행', j.source === 'session' ? j.prompt || j.line : (j.args || []).join(' '))
  add('파일', j.file)
  add('기록', (j.logPaths || []).join(' · '))
  add('세션', j.source === 'session' ? j.session : null)
  return out
}

// 마지막 결과: ✓ = exit 0 · ✕<code> = non-zero · '-' = not loaded / disabled / unknown.
export function resultOf(job, list) {
  if (job.source === 'session') return { glyph: '-', code: null, loaded: true, failed: false, session: true }
  if (job.source === 'cron') return { glyph: '-', code: null, loaded: true, failed: false }
  if (job.disabled) return { glyph: '-', code: null, loaded: false, failed: false, note: '꺼짐' }
  const row = list ? list.get(job.label) : undefined
  if (!row) return { glyph: '-', code: null, loaded: false, failed: false, note: '안 실림' }
  if (row.status === null || row.status === 0) return { glyph: row.status === 0 ? '✓' : '-', code: row.status, loaded: true, failed: false, running: row.pid !== null }
  return { glyph: '✕' + row.status, code: row.status, loaded: true, failed: true, running: row.pid !== null }
}

// Which bot owns a job: config rules first (substring of label / program path), then a label segment equal to a known bot.
export function botOf(job, rules, botNames) {
  if (job.source === 'session' && typeof job.bot === 'string' && job.bot) return job.bot
  const hay = [job.label, ...(job.args || [])].join(' ')
  for (const r of rules || []) {
    if (!r || typeof r.bot !== 'string') continue
    const pats = Array.isArray(r.match) ? r.match : []
    if (pats.some((p) => typeof p === 'string' && p && hay.includes(p))) return r.bot
  }
  const names = new Set((botNames || []).map(String))
  for (const seg of String(job.label || '').split('.')) if (names.has(seg)) return seg
  for (const a of job.args || []) {
    const m = /\/agent-([a-z0-9_-]+)\//i.exec(String(a))
    if (m && names.has(m[1])) return m[1]
  }
  return OTHER
}

// Build groups: [{ bot, jobs:[{...job, result, next, schedule, line}], failed, nextAt }] sorted per 봇:
// most failures first, then soonest next run, 기타 last.
export function buildGroups(jobs, list, rules, botNames, nowMs) {
  const by = new Map()
  for (const job of jobs) {
    const bot = botOf(job, rules, botNames)
    const result = resultOf(job, list)
    const next = job.disabled ? null : nextRun(job, nowMs)
    const session = job.source === 'session'
    // one unit (no « · » inside: the pane folds a long row at « · », 19:1x capture split «세션» from its cron)
    const schedule = session ? (job.recurring ? '세션 cron ' + job.cron : '세션 1번') : describeSchedule(job)
    const row = { ...job, bot, result, next, schedule, line: session ? job.line : oneLine(job.args, job.label) }
    if (!by.has(bot)) by.set(bot, [])
    by.get(bot).push(row)
  }
  const groups = []
  for (const [bot, rows] of by) {
    rows.sort((a, b) => (Number(b.result.failed) - Number(a.result.failed)) || cmpNext(a.next, b.next) || a.label.localeCompare(b.label))
    groups.push({ bot, jobs: rows, ...counts(rows), nextAt: rows.reduce((m, r) => (r.next !== null && (m === null || r.next < m) ? r.next : m), null) })
  }
  groups.sort((a, b) => (Number(a.bot === OTHER) - Number(b.bot === OTHER)) || (b.failed - a.failed) ||
    (b.notLoaded - a.notLoaded) || cmpNext(a.nextAt, b.nextAt) || a.bot.localeCompare(b.bot))
  return groups
}

// 봇 10-17: problems must show while a group is folded — failed · 안 실림 (not in launchctl) · 꺼짐 (Disabled)
// · 미확인 (loaded but no known last result: cron lines, or a launchd status launchctl did not give).
export function counts(rows) {
  const c = { failed: 0, notLoaded: 0, off: 0, unknown: 0 }
  for (const r of rows) {
    if (r.result.failed) c.failed++
    else if (r.result.note === '안 실림') c.notLoaded++
    else if (r.result.note === '꺼짐') c.off++
    else if (r.result.glyph === '-' && !r.result.session) c.unknown++
  }
  return c
}

function sum(groups, key) {
  return groups.reduce((n, g) => n + (g[key] || 0), 0)
}

function cmpNext(a, b) {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

// The soonest upcoming job over all groups.
export function soonest(groups) {
  let best = null
  for (const g of groups) for (const j of g.jobs) if (j.next !== null && (best === null || j.next < best.next)) best = j
  return best
}

// 띠 1줄 segments: «예약 · ✕2 · 다음 17:30 작업» or «예약 · ✓ 164 · 다음 17:30 작업» (봇: 실패 0 / 총 N 군더더기 ❌).
// Problems that are not failures still show when non-zero (안 실림), and so does a collection that stopped:
// `when` = { collectedAt, nowMs, staleMs, always } — the time shows when older than staleMs, or always (칸 머리).
export function bandSegments(groups, when) {
  const total = groups.reduce((n, g) => n + g.jobs.length, 0)
  const failed = sum(groups, 'failed')
  const notLoaded = sum(groups, 'notLoaded')
  const s = soonest(groups)
  const tail = s ? '다음 ' + hhmm(s.next) + ' ' + s.line : '다음 없음'
  const segs = [{ text: '예약 · ' }, failed > 0 ? { text: '✕' + failed, color: RESULT_LOOK.fail.color } : { text: '✓ ' + total, color: RESULT_LOOK.ok.color }]
  if (notLoaded > 0) segs.push({ text: ' · ' }, { text: '안 실림 ' + notLoaded, color: 'yellow' })
  const w = when || {}
  if (Number.isFinite(w.collectedAt)) {
    const stale = Number.isFinite(w.nowMs) && w.nowMs - w.collectedAt > (w.staleMs || 3 * 60 * 1000)
    if (stale) segs.push({ text: ' · ' }, { text: '수집 멈춤 ' + hhmm(w.collectedAt), color: 'yellow' })
    else if (w.always) segs.push({ text: ' · 수집 ' + hhmm(w.collectedAt), dim: true })
  }
  segs.push({ text: ' · ' + tail })
  return segs
}

// 10-21 (주인 10-20 23:51): a 안 실림 count beside another job's line or time read as
// that job's — so where it sits next to one (this bot's 예약 tail, the 칸 머리줄) it names its job(s): «안 실림 1: run-bot.sh»,
// at most two names, then «외 N». `rows` = the rows counted.
export function notLoadedWords(n, rows) {
  const names = (rows || []).filter((r) => r && r.result && !r.result.failed && r.result.note === '안 실림').map((r) => r.line || r.label)
  if (!names.length) return '안 실림 ' + n
  const more = names.length > 2 ? ' 외 ' + (names.length - 2) : ''
  return '안 실림 ' + n + ': ' + names.slice(0, 2).join('·') + more
}

// « · ✕2 · 안 실림 1 · 꺼짐 1 · 미확인 3» from counts() — 0 인 수는 안 씀. Shared by 칸 머리줄 and the «외 N» lines
// that stand for rows the pane has no room for (봇 10-17: problems show even when folded). `rows` (optional) = the rows
// counted: the 안 실림 count then names them (notLoadedWords) — one piece the pane never folds.
export function problemSegments(c, rows) {
  const segs = []
  if (c.failed > 0) segs.push({ text: ' · ' }, { text: '✕' + c.failed, color: RESULT_LOOK.fail.color })
  if (c.notLoaded > 0) segs.push({ text: ' · ' }, rows ? { text: notLoadedWords(c.notLoaded, rows), color: 'yellow', atom: true } : { text: '안 실림 ' + c.notLoaded, color: 'yellow' })
  if (c.off > 0) segs.push({ text: ' · 꺼짐 ' + c.off, dim: true })
  if (c.unknown > 0) segs.push({ text: ' · 미확인 ' + c.unknown, dim: true })
  return segs
}

// 칸 머리줄: «▶ bot 12 · 다음 17:30 · ✕2 · 안 실림 1 · 미확인 3» (0 인 수는 안 씀 · 펼치면 ▼ ·
// ▶/▼ = 동아시아 너비 A, 띠 기호와 같은 분류).
export function headerSegments(group, expanded) {
  return [{ text: expanded ? '▼ ' : '▶ ', color: 'amber' }, { text: botShown(group.bot), bold: true }, { text: ' ' + group.jobs.length + ' · ' },
    { text: group.nextAt !== null ? '다음 ' + hhmm(group.nextAt) : '다음 없음', color: 'sub' }, ...problemSegments(group)]
}

// 펼친 줄: 결과를 맨 앞에, 4칸으로 채워 세로로 섬 «✕1   · 다음 17:30 · 작업 한 줄 · 매일 09:00» (설계 메모 R3: 결과 색 ·
// 다음 sub · 안 실림 yellow · 이름 text · 주기 dim).
export function jobSegments(job) {
  const g = job.result.glyph
  const res = g.length >= 4 ? g : g + ' '.repeat(4 - g.length)
  const notLoaded = job.next === null && job.result.note === '안 실림'
  // 10-20: an interval job has no known next run (schedule.js nextRun) — «다음 모름», not «다음 없음» (it does run)
  const when = job.next !== null ? '다음 ' + hhmm(job.next) : (job.result.note || (job.interval ? '다음 모름' : '다음 없음'))
  const color = job.result.failed ? RESULT_LOOK.fail.color : g === '✓' ? RESULT_LOOK.ok.color : undefined
  return [{ text: '  ' }, { text: res, color, dim: g === '-' }, { text: ' · ', dim: true }, { text: when, color: notLoaded ? 'yellow' : 'sub' },
    { text: ' · ', dim: true }, { text: job.line }, { text: ' · ', dim: true }, { text: job.schedule, dim: true }]
}

// ── 예약 구역 (설계 메모 · 봇 v2 3번 «하나의 에이전트에 걸린 것만»: 기본 = 이 봇 것만, «/mh 예약» = 전체) ──
// 머리줄: «◷ 예약(bot · 7개) · ✕1 · 안 실림 1 · 다음 20:35 · 타세션=/mh 예약» · 0개면 «… · 걸린 예약 없음 · 타세션=…» ·
// 전체면 «◷ 예약(전체 164개 · 10봇) · … · 내 것만=/mh 예약». status = { loaded, error, collectedAt, nowMs, staleMs, own, all }.
// A collection that stopped (launchctl not read for staleMs) shows «수집 멈춤 HH:MM» — the counts are that old.
export function cronHead(groups, status) {
  const st = status || {}
  // the title is one piece (atom): the band's +N fold must not cut «예약(bot · 1개)» at its inner « · »
  const head = (title) => [{ text: '◷ ', color: 'amber', bold: true }, { text: title, color: 'amber', bold: true, atom: true }]
  // what was collected wins over a later failed read (v1.1 · as the band line before 47): the data stays and, once it
  // is older than staleMs, «수집 멈춤 HH:MM» says so — «읽기 실패» only while nothing was ever collected
  const have = Array.isArray(groups) && groups.length > 0
  if (st.error && !have) return [...head('예약'), { text: ' · ' }, { text: '읽기 실패 · ' + st.error, color: 'red' }]
  if (!st.loaded && !have) return [...head('예약'), { text: ' · 읽는 중', dim: true }]
  const list = st.all ? groups || [] : (groups || []).filter((g) => g.bot === st.own)
  const jobs = list.flatMap((g) => g.jobs)
  const segs = head(st.all ? '예약(전체 ' + jobs.length + '개 · ' + list.length + '봇)' : '예약(' + (st.own || '?') + ' · ' + jobs.length + '개)')
  // r2: `hint` = the pane's folded «◷ 예약 … ▸» line leaves this one out (band.js paneLines)
  const other = { text: st.all ? ' · 내 것만=/mh 예약' : ' · 타세션=/mh 예약', dim: true, hint: true }
  const stale = Number.isFinite(st.collectedAt) && Number.isFinite(st.nowMs) && st.nowMs - st.collectedAt > (st.staleMs || 3 * 60 * 1000)
    ? [{ text: ' · ' }, { text: '수집 멈춤 ' + hhmm(st.collectedAt), color: 'yellow' }] : []
  if (!jobs.length) return [...segs, { text: ' · 걸린 예약 없음' }, ...stale, other]
  const c = counts(jobs)
  if (c.failed > 0) segs.push({ text: ' · ' }, { text: '✕' + c.failed, color: RESULT_LOOK.fail.color })
  if (c.notLoaded > 0) segs.push({ text: ' · ' }, { text: notLoadedWords(c.notLoaded, jobs), color: 'yellow', atom: true })
  const s = soonest(list)
  segs.push({ text: ' · ' }, { text: s ? '다음 ' + hhmm(s.next) : '다음 없음', color: 'sub' })
  segs.push(...stale, other)
  return segs
}

// 이 봇 예약 줄 (설계 메모 1-①): 실패(✕) → 안 실림 → 나머지 순으로 OWN_SHOW 줄까지, 나머지는 마지막 줄 끝 «(+4개 정상)»
// (문제가 섞였으면 «(+4개 · ✕1 · 안 실림 1)»). full = «/mh <이 봇>» 으로 펼침: 전부.
// 10-19 (봇 하위 세션 ③ · 매일 기억 시험 com.bot.memory-same-env-daily 21:30): three problem rows (✕ · ✕ · 안 실림)
// filled every line and folded the one job that runs next into «(+5개 정상)». When no line drawn is a healthy job with a
// next run, the soonest such job gets one line of its own after them — problems keep their places (a healthy upcoming
// line already drawn = as before).
// 10-20 (부모 봇 ③ ㉯ · 주인): `pins` = label substrings (settings ui.cron_pin ·
// default = the daily memory test). A pinned job is always one of the folded lines, after the problems, and marked
// `pinned` so a short pane keeps it (ownLines). The lines never pass OWN_CAP: a pin takes the soonest-healthy slot first,
// then the last unpinned rows give way (they ride in the «(+N개 …)» note). No pins (the default here) = as before.
export const OWN_SHOW = 3
export const OWN_CAP = OWN_SHOW + 1
// 10-24 (B): `opened` (a Set of jobId) = the 예약 lines pressed open. An opened job is marked `open` and is always one of the
// lines (taken out of the folded rest when a redraw put it there), so its detail stays where it was pressed.
export function ownJobs(group, full, pins, opened) {
  const r = ownJobsBase(group, full, pins)
  const isOpen = (j) => Boolean(opened && typeof opened.has === 'function' && opened.size && opened.has(jobId(j)))
  if (!r.shown.length || !opened || !opened.size) return r
  const pulled = r.rest.filter(isOpen)
  return { shown: [...r.shown, ...pulled].map((j) => (isOpen(j) ? { ...j, open: true } : j)), rest: r.rest.filter((j) => !isOpen(j)) }
}
function ownJobsBase(group, full, pins) {
  if (!group || !group.jobs.length) return { shown: [], rest: [] }
  const rank = (j) => (j.result.failed ? 0 : j.result.note === '안 실림' ? 1 : 2)
  const jobs = group.jobs.map((j, i) => [j, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((p) => p[0])
  const pats = Array.isArray(pins) ? pins.filter((p) => typeof p === 'string' && p) : []
  const isPin = (j) => pats.some((p) => String(j.label || '').includes(p))
  // 10-21: all rows («/mh <이 봇>») keep the pin marked in place, so a short pane still draws it (ownLines) — the live
  // bot pane 10-21 00:1x drew one row, a ✕ one, and folded the memory test into «(+11개 …)»
  if (full) return { shown: pats.length ? jobs.map((j) => (isPin(j) ? { ...j, pinned: true } : j)) : jobs, rest: [] }
  let shown = jobs.slice(0, OWN_SHOW)
  let rest = jobs.slice(OWN_SHOW)
  if (pats.length && jobs.some(isPin)) {
    const pinned = rest.filter(isPin)
    shown = [...shown, ...pinned]
    rest = rest.filter((j) => !isPin(j))
    while (shown.length > OWN_CAP) {
      const i = shown.findLastIndex((j) => !isPin(j))
      const out = i >= 0 ? shown.splice(i, 1)[0] : shown.pop()
      rest = [out, ...rest]
    }
    shown = shown.map((j) => (isPin(j) ? { ...j, pinned: true } : j))
  }
  const upcoming = (j) => rank(j) === 2 && Number.isFinite(j.next)
  const up = shown.length >= OWN_CAP || shown.some(upcoming) ? null : rest.filter(upcoming).sort((a, b) => a.next - b.next)[0] || null
  return up ? { shown: [...shown, up], rest: rest.filter((j) => j !== up) } : { shown, rest }
}

// The first `k` of `shown` as lines; every job not drawn (shown past k, then rest) rides on the last line as one note.
// 10-20: short of rows, the rows that go are the last unpinned ones — a pinned row stays (drawn order kept).
// 10-21 (주인): the tail of the hidden rows' problems («✕2 · 안 실림 1») rode on the
// last line — since the pin, the memory test's — and read as that job's. A tail with a problem never rides on a pinned row:
// it takes a line of its own (one row of the share), under the rows drawn; a share of one row keeps the pin alone and
// leaves the counts to the 칸 머리줄 (cronHead). A tail with no problem («(+N개 정상)») stays where it was.
export function ownLines(shown, rest, k) {
  return ownRows(shown, rest, k).map((r) => (r.note ? [...r.segs, ...r.note] : r.segs))
}

// 10-24 (B): the same lines as rows — { job (null on a line of the hidden rows' counts alone), segs (the job's own
// words), note (the «(+N개 …)» riding on it, or that whole line) } — so the pane gives a job line its own press
// (JOB_PRESS) and the «(+N개 …)» part the whole-list one (mh-own), apart. An opened job (`open`) is dropped last, as a
// pinned one is; it does not take the pinned row's «no problem tail rides on it» rule.
export function ownRows(shown, rest, k) {
  const n = Math.max(0, Math.min(Math.floor(k), shown.length))
  if (n === 0) return []
  const held = (j) => j.pinned || j.open
  const keepOf = (m) => {
    const keep = shown.map(() => true)
    for (let i = shown.length - 1, drop = shown.length - m; i >= 0 && drop > 0; i--) if (!held(shown[i])) { keep[i] = false; drop-- }
    for (let i = shown.length - 1, drop = keep.filter(Boolean).length - m; i >= 0 && drop > 0; i--) if (keep[i] && !shown[i].open) { keep[i] = false; drop-- }
    for (let i = shown.length - 1, drop = keep.filter(Boolean).length - m; i >= 0 && drop > 0; i--) if (keep[i]) { keep[i] = false; drop-- }
    return keep
  }
  const hiddenOf = (keep) => [...shown.filter((_, i) => !keep[i]), ...rest]
  const tail = (hidden, lead) => {
    const c = counts(hidden)
    return c.failed || c.notLoaded
      ? [{ text: lead + '(+' + hidden.length + '개', dim: true }, ...problemSegments(c, hidden), { text: ')', dim: true }]
      : null
  }
  const rowOf = (j) => ({ job: j, segs: jobSegments(j), note: null })
  let keep = keepOf(n)
  let hidden = hiddenOf(keep)
  const lastPinned = Boolean(shown[keep.lastIndexOf(true)].pinned)
  if (hidden.length && lastPinned && tail(hidden, '')) {
    if (n === 1) return shown.filter((_, i) => keep[i]).map(rowOf)
    keep = keepOf(n - 1)
    hidden = hiddenOf(keep)
    return [...shown.filter((_, i) => keep[i]).map(rowOf), { job: null, segs: [{ text: '  ' }], note: tail(hidden, '') }]
  }
  const rows = shown.filter((_, i) => keep[i]).map(rowOf)
  if (hidden.length) rows[n - 1].note = tail(hidden, ' ') || [{ text: ' (+' + hidden.length + '개 정상)', dim: true }]
  return rows
}
