// lane: ui · owner: 봇 — pure schedule math (no `$`, no imports): cron expressions and launchd
// StartCalendarInterval → next run time, plus a short Korean description for the 예약 작업 칸.
// Times are local wall-clock (the Mac's timezone), the same clock launchd and cron use.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const DOWS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const SPECIAL = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
}
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토']
const SEARCH_DAYS = 366 * 5 // covers Feb-29-only and weekday+date combinations

function pad2(n) { return String(n).padStart(2, '0') }

// One cron field → { set: Set<number>, star: boolean } or null when malformed.
function parseField(text, min, max, names) {
  const set = new Set()
  const star = text === '*' || text === '?'
  for (const part of text.split(',')) {
    const m = /^([^/]+)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const step = m[2] === undefined ? 1 : Number(m[2])
    if (!Number.isInteger(step) || step < 1) return null
    let lo, hi
    if (m[1] === '*' || m[1] === '?') { lo = min; hi = max }
    else {
      const r = /^([a-z0-9]+)(?:-([a-z0-9]+))?$/i.exec(m[1])
      if (!r) return null
      const val = (s) => {
        const k = s.toLowerCase()
        if (names && k in names) return names[k]
        return /^\d+$/.test(s) ? Number(s) : NaN
      }
      lo = val(r[1]); hi = r[2] === undefined ? (m[2] === undefined ? lo : max) : val(r[2])
      if (Number.isNaN(lo) || Number.isNaN(hi)) return null
    }
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) set.add(v)
  }
  return { set, star }
}

// Parse a 5-field cron expression (or @special). Returns a spec or null.
export function parseCron(expr) {
  if (typeof expr !== 'string') return null
  const src = SPECIAL[expr.trim().toLowerCase()] || expr.trim()
  const f = src.split(/\s+/)
  if (f.length !== 5) return null
  const minute = parseField(f[0], 0, 59)
  const hour = parseField(f[1], 0, 23)
  const dom = parseField(f[2], 1, 31)
  const month = parseField(f[3], 1, 12, MONTHS)
  const dowRaw = parseField(f[4], 0, 7, DOWS)
  if (!minute || !hour || !dom || !month || !dowRaw) return null
  const dow = { set: new Set([...dowRaw.set].map((d) => (d === 7 ? 0 : d))), star: dowRaw.star }
  return { minute, hour, dom, month, dow }
}

function dayMatches(spec, d) {
  if (!spec.month.set.has(d.getMonth() + 1)) return false
  const domOk = spec.dom.set.has(d.getDate())
  const dowOk = spec.dow.set.has(d.getDay())
  // cron rule: when both day fields are restricted, either one may match
  if (!spec.dom.star && !spec.dow.star) return domOk || dowOk
  if (!spec.dom.star) return domOk
  if (!spec.dow.star) return dowOk
  return true
}

// Next fire strictly after `fromMs` (epoch ms) for a parsed spec, or null if none within the search window.
export function nextFromSpec(spec, fromMs) {
  const start = new Date(fromMs)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)
  const hours = [...spec.hour.set].sort((a, b) => a - b)
  const minutes = [...spec.minute.set].sort((a, b) => a - b)
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  for (let i = 0; i < SEARCH_DAYS; i++) {
    if (dayMatches(spec, day)) {
      const sameDay = i === 0
      for (const h of hours) {
        if (sameDay && h < start.getHours()) continue
        for (const m of minutes) {
          if (sameDay && h === start.getHours() && m < start.getMinutes()) continue
          return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime()
        }
      }
    }
    day.setDate(day.getDate() + 1)
  }
  return null
}

export function nextCron(expr, fromMs) {
  const spec = parseCron(expr)
  return spec ? nextFromSpec(spec, fromMs) : null
}

// launchd StartCalendarInterval: one dict or an array of dicts with Minute/Hour/Day/Weekday/Month.
// A missing key is a wildcard (launchd: "similar to crontab(5)").
export function calendarToSpec(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const field = (key, min, max) => {
    const v = entry[key]
    if (v === undefined || v === null) return { set: new Set(range(min, max)), star: true }
    if (!Number.isInteger(v) || v < min || v > max) return null
    return { set: new Set([v]), star: false }
  }
  const minute = field('Minute', 0, 59)
  const hour = field('Hour', 0, 23)
  const dom = field('Day', 1, 31)
  const month = field('Month', 1, 12)
  const dowRaw = field('Weekday', 0, 7)
  if (!minute || !hour || !dom || !month || !dowRaw) return null
  const dow = { set: new Set([...dowRaw.set].map((d) => (d === 7 ? 0 : d))), star: dowRaw.star }
  return { minute, hour, dom, month, dow }
}

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out }

export function nextCalendar(sci, fromMs) {
  const list = Array.isArray(sci) ? sci : [sci]
  let best = null
  for (const entry of list) {
    const spec = calendarToSpec(entry)
    if (!spec) continue
    const t = nextFromSpec(spec, fromMs)
    if (t !== null && (best === null || t < best)) best = t
  }
  return best
}

// Short Korean description of one calendar entry.
function describeCalendarEntry(e) {
  const has = (k) => Number.isInteger(e[k])
  const hm = has('Hour') ? pad2(e.Hour) + ':' + pad2(has('Minute') ? e.Minute : 0) : null
  if (has('Month') && has('Day') && hm) return e.Month + '월 ' + e.Day + '일 ' + hm
  if (has('Day') && hm) return '매달 ' + e.Day + '일 ' + hm
  if (has('Weekday') && hm) return DOW_KO[e.Weekday % 7] + ' ' + hm
  if (hm) return '매일 ' + hm
  if (has('Minute')) return '매시 ' + pad2(e.Minute) + '분'
  return '매분'
}

export function describeInterval(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '?'
  if (seconds % 86400 === 0) return (seconds / 86400 === 1 ? '하루' : seconds / 86400 + '일') + '마다'
  if (seconds % 3600 === 0) return seconds / 3600 + '시간마다'
  if (seconds % 60 === 0) return seconds / 60 + '분마다'
  return seconds + '초마다'
}

// Describe a launchd job's trigger, or a cron line. `job` = { calendar?, interval?, keepAlive?, runAtLoad?, cron? }
export function describeSchedule(job) {
  if (job.cron) return 'cron ' + job.cron
  if (job.calendar) {
    const list = Array.isArray(job.calendar) ? job.calendar : [job.calendar]
    if (list.length === 0) return '?'
    const first = describeCalendarEntry(list[0] || {})
    return list.length > 1 ? first + ' 외 ' + (list.length - 1) : first
  }
  if (job.interval) return describeInterval(job.interval)
  if (job.keepAlive) return '늘 켜짐'
  if (job.runAtLoad) return '켤 때 1번'
  return '수동'
}

// Next run for a launchd job: calendar → computed; anything else (interval included) → null = not known.
// 10-20 (부모 봇 ③ ㉯): an interval job's «last run» used to be its log file's mtime — a guess drawn as a real time.
// ci-fail-patrol's log is empty and was last touched 9-16 09:20, so «다음» rolled forward from it was always «within 10
// minutes», ranked first and took the memory test's line. launchd keeps no last-run time for us to read; «10분마다» says
// what is known (jobs.js jobSegments draws «다음 모름»).
export function nextRun(job, nowMs) {
  if (job.cron) return nextCron(job.cron, nowMs)
  if (job.calendar) return nextCalendar(job.calendar, nowMs)
  return null
}

export function hhmm(ms) {
  if (!Number.isFinite(ms)) return '--:--'
  const d = new Date(ms)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}
