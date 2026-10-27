// lane: ui · owner: 봇 — «◎ 기억» button (v3 r3a · 봇: the numbers = 봇 recallStats()).
// Input = the memory lane's last recall as it writes it to $.state 'mh.recall' after every recall (봇 ebb3d5a, the
// shape 봇 proposed 10-18: recallStats() without its error text), read through recallOf; null = recall off in the
// config, or no memory lane in this build («시범 꺼짐»). Not an import of that lane: a dynamic import fails the loader.
// Drawn fields: state · conversations · facts · chars · ms · at only; recallOf drops every other field, so an error
// text (a path or recalled text can be in one) cannot reach a line even if a later writer adds it back.
// Lines stay inside `cols`, shrink from the long form to the short one without «…», and use PANE_INK keys only.
import { strWidth } from './text.js'

export const RECALL_PRESS = 'mh-mem'

// state → [icon color, short word, detail sentence]
const STATE = {
  off: ['dim', '시범 꺼짐', '기억 불러오기 꺼짐 — 설정에서 꺼졌거나 이 판에 기억 갈래가 없음'],
  none: ['dim', '첫 물음 전', '아직 불러온 적 없음 — 첫 물음 때 채워짐'],
  attached: ['green', null, null],
  empty: ['sub', '찾은 것 없음', '찾은 대화·사실 0'],
  'not-connected': ['yellow', '연결 전', '기억 도구가 아직 안 보임(연결 전 또는 거부 규칙)'],
  error: ['red', '오류', '불러오기 실패 — 자세한 글은 디버그 기록에'],
  unknown: ['dim', '상태 모름', '알 수 없는 상태 — 기억 갈래 판을 확인'],
}

function count(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
}

function stateOf(stats) {
  if (!stats || typeof stats !== 'object') return 'off'
  const s = stats.state
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(STATE, s) && s !== 'off' && s !== 'unknown' ? s : 'unknown'
}

// 0.21초 · 1.3초 · 12초 (ms → seconds, two significant places at most)
export function secs(ms) {
  const v = count(ms)
  if (v === null) return null
  const t = v / 1000
  return (t < 1 ? t.toFixed(2) : t < 10 ? t.toFixed(1) : String(Math.round(t))) + '초'
}

// «방금» · «N분 전» · «N시간 전» — at/now in epoch ms; a time in the future or missing = null
export function ago(at, nowMs) {
  const a = count(at)
  const n = count(nowMs)
  if (a === null || n === null || a === 0 || n < a) return null
  const m = Math.floor((n - a) / 60000)
  return m < 1 ? '방금' : m < 60 ? m + '분 전' : Math.floor(m / 60) + '시간 전'
}

function fits(segs, cols) {
  return segs.reduce((w, s) => w + strWidth(s.text), 0) <= cols
}

const ICON = '◎'

// The button's forms, widest first. Every form starts with the icon so the press target keeps its place.
export function recallForms(stats) {
  const st = stateOf(stats)
  const [ink, word] = STATE[st]
  const icon = { text: ICON, color: ink }
  if (st !== 'attached') {
    return [
      [icon, { text: ' 기억', color: 'text' }, { text: ' · ' + word, color: st === 'error' ? 'red' : 'sub' }],
      [icon, { text: ' 기억', color: 'text' }],
      [icon],
    ]
  }
  const c = count(stats.conversations) ?? 0
  const f = count(stats.facts) ?? 0
  const ch = count(stats.chars)
  const sec = secs(stats.ms)
  const tail = [
    { text: ' · 대화 ' + c, color: 'text' },
    { text: ' · 사실 ' + f, color: 'text' },
    ...(ch === null ? [] : [{ text: ' · ' + ch + '자', color: 'sub' }]),
    ...(sec === null ? [] : [{ text: ' · ' + sec, color: 'sub' }]),
  ]
  const out = []
  for (let k = tail.length; k >= 2; k--) out.push([icon, { text: ' 기억', color: 'text' }, ...tail.slice(0, k)])
  out.push([icon, { text: ' 기억 ' + c + '·' + f, color: 'text' }], [icon, { text: ' ' + c + '·' + f, color: 'text' }], [icon])
  return out
}

// The first form that fits; [] when not even the icon fits.
export function recallLine(stats, cols) {
  for (const segs of recallForms(stats)) if (fits(segs, cols)) return segs
  return []
}

// The open button's detail line (drawn under it): when, how many, how long — never the error text.
export function recallDetail(stats, cols, nowMs) {
  const st = stateOf(stats)
  const lead = { text: '  ', color: 'dim' }
  const forms = []
  if (st === 'attached') {
    const when = ago(stats.at, nowMs)
    const c = count(stats.conversations) ?? 0
    const f = count(stats.facts) ?? 0
    const ch = count(stats.chars)
    const sec = secs(stats.ms)
    const parts = [
      ...(when === null ? [] : ['마지막 ' + when]),
      '대화 ' + c, '사실 ' + f,
      ...(ch === null ? [] : [ch + '자']),
      ...(sec === null ? [] : [sec]),
    ]
    for (let k = parts.length; k >= 1; k--) forms.push([lead, { text: parts.slice(0, k).join(' · '), color: 'sub' }])
  } else {
    const when = st === 'none' || st === 'off' ? null : ago(stats.at, nowMs)
    const sentence = STATE[st][2] + (when === null ? '' : ' · ' + when)
    forms.push([lead, { text: sentence, color: st === 'error' ? 'red' : 'sub' }])
    if (when !== null) forms.push([lead, { text: STATE[st][2], color: st === 'error' ? 'red' : 'sub' }])
    forms.push([lead, { text: STATE[st][1], color: st === 'error' ? 'red' : 'sub' }])
  }
  for (const segs of forms) if (fits(segs, cols)) return segs
  return []
}

// The $.state 'mh.recall' value → what the button draws. null or missing = null («시범 꺼짐»); a value that is not a
// plain object = an unknown state («상태 모름»); else only the drawn fields, each a string state or a count ≥ 0 —
// anything else in the value is dropped here, not just left undrawn.
const KEPT = ['at', 'conversations', 'facts', 'chars', 'ms', 'lines']
export function recallOf(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return { state: '?' }
  const out = { state: typeof value.state === 'string' ? value.state : '?' }
  for (const k of KEPT) if (count(value[k]) !== null) out[k] = value[k]
  return out
}
