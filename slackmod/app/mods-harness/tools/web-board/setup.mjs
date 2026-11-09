// tools/web-board/setup.mjs — /api/jobs «setup» 칸(11-03 · 설치·가이드 화면의 단계별 «끝남» 표시)
// 꼴 = { steps: { "<단계 번호>": "done" | "todo" | "unknown" } } · 단계 번호 = 설치 가이드 내용 묶음 설계 메모(0~18 · 7a · 9-2)
// 원칙: 읽기만 · 있음/모양만 · 값·경로는 응답에 0 · 토큰 파일은 직접 열지 않음(envStatus = slackmod_config.py env-status 의 set/missing 낱말만)
//   못 읽거나 원천이 없으면 unknown(«todo» 로 바꾸지 않음) · 한 단계 판정이 던지면 그 단계만 unknown(전체 null ❌)
import fs from 'node:fs'
import path from 'node:path'

export const STEP_IDS = ['0', '1', '2', '3', '4', '5', '6', '7', '7a', '8', '9', '9-2', '10', '11', '12', '13', '14', '15', '16', '17', '18']
const MODES = ['quick', 'full', 'blank'] // setup/lib/plan.py MODES
const BOT_RX = /^[a-z0-9][a-z0-9-]{0,40}$/ // 봇 켜기 이름 꼴(경로 조각으로 쓰므로 이 꼴만)
const CHAN_RX = /^C[A-Z0-9]{6,20}$/
const USER_RX = /^U[A-Z0-9]{6,20}$/
const LOG_TAIL = 262144 // server.log 끝 256KB 만 읽음(«socket connected/disconnected» 낱말만 찾음 · 글은 응답에 0)

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
// 없음 = undefined · 깨짐 = 던짐(그 단계만 unknown)
function readJson(p) {
  if (!fs.existsSync(p)) return undefined
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
function tail(p, n) {
  const fd = fs.openSync(p, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, n)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally { fs.closeSync(fd) }
}

// root = SlackMod 설치 루트(~/.slackmod) · home = 사용자 홈(~/.claude.json 자리) · envStatus(bot) → { bot: 'set'|'missing', app: 'set'|'missing' } | null · boardOn = 이 서버가 답하고 있음
export function setupSteps({ root, home, envStatus, boardOn = true }) {
  const steps = {}
  for (const id of STEP_IDS) steps[id] = 'unknown'
  if (typeof root !== 'string' || !root) return { steps }
  const at = (...p) => path.join(root, ...p)
  const memo = new Map()
  const once = (k, fn) => { if (!memo.has(k)) { try { memo.set(k, { v: fn() }) } catch (e) { memo.set(k, { e }) } } const m = memo.get(k); if (m.e) throw m.e; return m.v }
  const sj = () => once('sj', () => readJson(at('setup.json')))
  const cfg = () => once('cfg', () => readJson(at('config.json')))
  const bots = () => once('bots', () => {
    if (!fs.existsSync(at('bots.list'))) return undefined
    return fs.readFileSync(at('bots.list'), 'utf8').split('\n').map((s) => s.trim()).filter((s) => BOT_RX.test(s))
  })
  const installed = () => once('inst', () => {
    const dir = at('state', 'installs')
    if (!fs.existsSync(at('state', 'install.fp')) || !fs.existsSync(dir)) return false
    return fs.readdirSync(dir).some((d) => !d.endsWith('.undone') && fs.existsSync(path.join(dir, d, 'record.json')))
  })
  const judge = {
    // 0·1·3·16 = 직접 신호 없음 → 11(한 번에 설치)이 끝났으면 끝남(추론) · 아니면 모름
    '0': () => (installed() ? 'done' : 'unknown'),
    '1': () => (installed() ? 'done' : 'unknown'),
    '3': () => (installed() ? 'done' : 'unknown'),
    '16': () => (installed() ? 'done' : 'unknown'),
    // 2 바탕 점검 · 12 점검 표 = 화면에만 → 늘 모름
    '2': () => 'unknown',
    '12': () => 'unknown',
    '4': () => { const s = sj(); return s === undefined ? 'unknown' : isPlain(s.history) && 'read' in s.history ? 'done' : 'todo' },
    '5': () => (sj() === undefined ? 'unknown' : 'done'), // import 칸 없음 = «안 가져옴»을 고른 것
    '6': () => { const s = sj(); return s === undefined ? 'unknown' : MODES.includes(s.mode) ? 'done' : 'todo' },
    '7': () => { const s = sj(); return s === undefined ? 'unknown' : MODES.includes(s.mode) ? 'done' : 'todo' },
    '7a': () => {
      const c = cfg()
      if (c === undefined) return 'unknown'
      const sl = isPlain(c.slack) ? c.slack : {}
      const ch = typeof sl.channel_id === 'string' ? sl.channel_id : '', ou = typeof sl.owner_user_id === 'string' ? sl.owner_user_id : ''
      return CHAN_RX.test(ch) && !/^CX+$/.test(ch) && USER_RX.test(ou) && !/^UX+$/.test(ou) ? 'done' : 'todo'
    },
    '8': () => { const b = bots(); return b === undefined ? 'unknown' : b.length ? 'done' : 'todo' },
    '9': () => {
      const s = sj()
      if (s === undefined || !isPlain(s.interview)) return 'unknown'
      return s.interview.when === 'now' || s.interview.when === 'skip' ? 'done' : s.interview.when === 'later' ? 'todo' : 'unknown'
    },
    '9-2': () => (boardOn ? 'done' : 'unknown'), // 이 응답을 주는 서버가 곧 켜진 현황판
    '10': () => (sj() === undefined ? 'unknown' : 'done'), // setup.json = «설치»를 고른 뒤 씀
    '11': () => (installed() ? 'done' : fs.existsSync(at('state', 'installs')) ? 'todo' : 'unknown'),
    '13': () => {
      // 토큰 = env-status 의 set/missing 낱말만(값·경로 0) · 봇 하나라도 못 읽으면 모름
      const b = bots()
      if (!b || !b.length || typeof envStatus !== 'function') return 'unknown'
      let all = true
      for (const n of b) {
        const r = envStatus(n)
        if (!r || !['set', 'missing'].includes(r.bot) || !['set', 'missing'].includes(r.app)) return 'unknown'
        if (r.bot !== 'set' || r.app !== 'set') all = false
      }
      return all ? 'done' : 'todo'
    },
    '14': () => {
      // 폴더 믿음 = ~/.claude.json projects[<봇 작업 폴더>].hasTrustDialogAccepted(그 키만) · 권한 건너뛰기 경고는 신호 없음
      //   → 믿음 안 한 봇이 있으면 todo · 다 믿음이어도 경고 쪽을 몰라 unknown
      const b = bots(), c = cfg()
      if (!b || !b.length || !c || !Array.isArray(c.bots) || typeof home !== 'string' || !home) return 'unknown'
      const cj = readJson(path.join(home, '.claude.json'))
      if (!isPlain(cj)) return 'unknown'
      const pj = isPlain(cj.projects) ? cj.projects : {}
      for (const n of b) {
        const bc = c.bots.find((x) => isPlain(x) && x.name === n)
        if (!bc || typeof bc.work_dir !== 'string' || !bc.work_dir) return 'unknown'
        const p = Object.prototype.hasOwnProperty.call(pj, bc.work_dir) ? pj[bc.work_dir] : null
        if (!isPlain(p) || p.hasTrustDialogAccepted !== true) return 'todo'
      }
      return 'unknown'
    },
    '15': () => { const s = sj(); return s === undefined || !Array.isArray(s.pending) ? 'unknown' : s.pending.length ? 'todo' : 'done' },
    '17': () => {
      // Slack 다리 = bots/<봇>/slack/server.log 끝의 마지막 socket 줄이 connected 면 연결됨 · 기록 없음 = 설치 뒤면 아직(todo) · 설치 전이면 모름
      const b = bots()
      if (!b || !b.length) return 'unknown'
      let all = true
      for (const n of b) {
        const lp = at('bots', n, 'slack', 'server.log')
        if (!fs.existsSync(lp)) { if (!installed()) return 'unknown'; all = false; continue }
        const t = tail(lp, LOG_TAIL)
        const c = t.lastIndexOf('socket connected'), d = t.lastIndexOf('socket disconnected')
        if (!(c >= 0 && c > d)) all = false
      }
      return all ? 'done' : 'todo'
    },
    '18': () => { // 되돌리기 = 선택 단계 → 되돌린 기록(.undone)이 있을 때만 done · 그 밖 모름(«해야 함»이 아님)
      const dir = at('state', 'installs')
      return fs.existsSync(dir) && fs.readdirSync(dir).some((d) => d.endsWith('.undone')) ? 'done' : 'unknown'
    },
  }
  for (const id of STEP_IDS) {
    try {
      const v = judge[id]()
      steps[id] = v === 'done' || v === 'todo' ? v : 'unknown'
    } catch {
      steps[id] = 'unknown'
    }
  }
  return { steps }
}

// env-status 줄 → { bot, app } | null (꼴 밖 = null · 줄 자체는 어디에도 싣지 않음)
export function parseEnvStatus(line) {
  const m = /^bot_token=(set|missing) app_token=(set|missing)\s*$/.exec(typeof line === 'string' ? line : '')
  return m ? { bot: m[1], app: m[2] } : null
}
