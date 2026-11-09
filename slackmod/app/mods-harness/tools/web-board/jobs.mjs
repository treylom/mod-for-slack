// tools/web-board/jobs.mjs — 봇 새 화면(jobs.html)의 재료 /api/jobs · 순수 함수(파일·망 손 0) · jobs.test.mjs 가 시험함
//
// 모양 = 봇 board-data v2(봇 11-01 견본 taskgraph-fixture-owner-v2.json)와 같은 칸 이름:
//   rooms[] = 회의방 01-spec «의존 그래프»(mermaid) 파싱 — 견본을 만든 make_taskgraph_fixture.py + fill_owner.py 와 같은 규칙(글자 그대로 옮김)
//   ops     = boardModel(/api/board 와 같은 함수 · 같은 원천)의 봇·14일 숫자를 봇 칸 이름으로 옮김(새 판정 0)
//   ledger · approvals · tokens7 = 이 서버가 읽지 않는 원천 → null (화면 «연결 전» · 0 으로 바꾸지 않음)
//   usage = 11-04 usageOf(아래) — mods 패널 «Claude · usage» 줄과 같은 원천·같은 함수(server.mjs 가 30초마다 읽어 둔 값 · 없으면 null)
//   name · label_display = 견본에서 사람이 손으로 쓴 글 → 실데이터엔 없음(화면이 title·label 로 대신 그림)
// 응답 전체는 server.mjs 가 lib.mjs scrubDeep 으로 감싼다(글자 칸 전부 safeText · /api/board 와 같은 받침).
import crypto from 'node:crypto'
import { taskLine } from './lib.mjs'

// ── 01-spec 의존 그래프 → 방 하나 (make_taskgraph_fixture.py 와 같은 규칙) ──
// Python re 의 \w·\b 는 유니코드(한글도 낱말 글자)라 JS 에선 \p{L}\p{N}_ 로 맞춤 — 안 맞추면 «보고서.md» 같은 토막이 다르게 지워짐
const W = '[\\p{L}\\p{N}_]'
const B0 = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`, B1 = B0 // Python \b 그대로: 앞뒤 중 한쪽만 낱말 글자
const EMO = [['🔴', 'placeholder'], ['✅', 'done'], ['🔄', 'doing'], ['⏳', 'waiting'], ['❌', 'blocked'], ['❓', 'owner'], ['🏁', 'goal'], ['⚠️', 'warn'], ['⚠', 'warn']]
const NODE = /([A-Za-z0-9_]+)\s*(?:\[\s*"([^"]*)"\s*\]|\(\s*"([^"]*)"\s*\)|\{\s*"([^"]*)"\s*\})/g
const EDGE = /([A-Za-z0-9_]+)(?:\s*\[[^\]]*\]|\s*\([^)]*\)|\s*\{[^}]*\})?\s*-+>\s*(?:\|[^|]*\|\s*)?([A-Za-z0-9_]+)/g
// 볼트 안 좌표 흔적(파일명·하위 번호·메시지 번호·해시)은 화면에 안 보이게 지움
const SCRUB = [
  new RegExp(`${B0}[\\p{L}\\p{N}_.-]+\\.(md|html|json|py|mjs|png)${B1}`, 'gu'),
  /하위\s*[a-z]*-?\p{Nd}{5,}(-\p{Nd}+)?/gu,
  new RegExp(`${B0}1\\p{Nd}{9}(\\.\\p{Nd}+)?${B1}`, 'gu'),
  new RegExp(`${B0}[0-9a-f]{7,40}${B1}`, 'gu'),
]
// Python str.strip()·splitlines() 와 같은 글자 묶음
const PY_WS = '\\s\\x1c-\\x1f\\x85'
const pyStrip = (t) => t.replace(new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'gu'), '')
export const LINE_MAX = 4000
const PY_LINES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/
function status(label) {
  for (const [e, s] of EMO) if (label.startsWith(e)) return [s, pyStrip(label.slice(e.length))]
  return ['unknown', label]
}
export function scrub(t) {
  for (const r of SCRUB) t = t.replace(r, '')
  t = t.replace(/\(\s*[·,]?\s*\)/gu, '').replace(/\s{2,}/gu, ' ')
  return t.replace(/^[ ·]+|[ ·]+$/g, '')
}
// text = 01-spec.md 전문(줄 끝은 Python open() 처럼 \n 으로 맞춰 넣음) · room = 방 폴더 이름 → { room, title, nodes, edges } | null
export function parseRoomSpec(text, room) {
  const s = String(text || '').replace(/\r\n?/g, '\n')
  const i = s.indexOf('의존 그래프')
  if (i < 0) return null
  const m = /```mermaid\s*\n([\s\S]*?)```/.exec(s.slice(i))
  if (!m) return null
  const nodes = new Map(), edges = []
  for (const line of m[1].split(PY_LINES)) {
    if (line.length > LINE_MAX) continue // 4천자 넘는 한 줄 = 건너뜀(EDGE 정규식이 길이 제곱 · verify-1 P5) — 실제 01-spec 최장 줄보다 넉넉히
    for (const nm of line.matchAll(NODE)) {
      const lab = [nm[2], nm[3], nm[4]].find((g) => g !== undefined)
      const [st, txt] = status(pyStrip(lab))
      nodes.set(nm[1], { id: nm[1], status: st, label: scrub(txt) })
    }
    for (const em of line.matchAll(EDGE)) edges.push([em[1], em[2]])
  }
  const t = /^#\s+(.+)$/m.exec(s)
  return { room, title: t ? scrub(t[1]) : '', nodes: [...nodes.values()], edges }
}

// ── 방 스레드 링크 (11-03 주인 추가 요청 · 칸 이름 = 봇 rooms[].thread_url) ──
// 원천 = 방 기록만: 02 개설 줄 «…스레드 <채널> <ts>»(meeting-room-init 이 씀) · 00-context·01-spec 에 적힌 Slack 주소
//   ① 기록된 주소 중 개설 줄 채널·ts 와 같은 것 그대로(개설 줄 없으면 00-context 첫 주소)
//   ② 없으면 설정 slack_workspace_url + 개설 줄 채널·ts 로 만든 주소 — 워크스페이스 주소는 설정에서만(코드에 박지 않음 · 설정 없으면 ② 안 함)
//   ③ 그 밖 = null(화면이 줄을 숨김)
// 허용 꼴 = SLACK_PERMALINK_RX 전체 일치만(호스트 영소문자·숫자·- · 채널 대문자·숫자 · ts 숫자) — 경로·비밀이 실릴 글자가 없음.
//   safeText(scrubDeep)는 주소를 «https:/…/p…» 로 깎으므로 응답은 scrubDeep 뒤 relink 로 이 꼴만 다시 붙인다.
const PL = 'https://[a-z0-9][a-z0-9-]{0,62}\\.slack\\.com/archives/([CDG][A-Z0-9]{6,20})/p(\\d{16})'
export const SLACK_PERMALINK_RX = new RegExp(`^${PL}$`)
const PERMALINK_ALL = new RegExp(`${PL}(?![0-9A-Za-z])`, 'g')
export const WORKSPACE_RX = /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.slack\.com$/
const OPEN_LINE = /\|\s*개설\s*\|[^\n]*?스레드\s+([CDG][A-Z0-9]{6,20})[\s/]+(\d{10})\.(\d{6})(?!\d)/
export const linkOk = (u) => (typeof u === 'string' && SLACK_PERMALINK_RX.test(u) ? u : null)
export function threadUrlOf({ context, spec, progressHead, workspace } = {}) {
  const open = OPEN_LINE.exec(String(progressHead || ''))
  const want = open ? open[1] + '/' + open[2] + open[3] : null
  for (const t of [context, spec]) {
    for (const m of String(t || '').matchAll(PERMALINK_ALL)) if (!want || m[1] + '/' + m[2] === want) return m[0]
    if (!want) break // 개설 줄 없음 = 00-context 첫 주소만(01-spec 속 주소는 다른 스레드 인용일 수 있음)
  }
  const ws = typeof workspace === 'string' ? workspace.replace(/\/+$/, '') : ''
  return open && WORKSPACE_RX.test(ws) ? linkOk(`${ws}/archives/${open[1]}/p${open[2]}${open[3]}`) : null
}
// scrubDeep 뒤에 링크 칸만 다시 붙임(배열 차례 = jobsModel 그대로) — 허용 꼴 아니면 null
export function relink(out, model) {
  if (!out || !model || !Array.isArray(out.rooms) || !Array.isArray(model.rooms)) return out
  out.rooms.forEach((r, i) => {
    const m = model.rooms[i]
    if (!r || !m) return
    r.thread_url = linkOk(m.thread_url)
    if (Array.isArray(r.nodes) && Array.isArray(m.nodes)) r.nodes.forEach((n, j) => { if (n && m.nodes[j]) n.thread_url = linkOk(m.nodes[j].thread_url) })
  })
  return out
}

// ── 담당·언급 (fill_owner.py · 규칙 = owner-rule-1101.md) ──
// 명부(internal.yaml) 글자 → { pats: [[bot, RegExp]], sid2bot: Map } · yaml 모듈 없이 같은 줄 규칙
const EN_GENERIC = new Set(['design'])
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
export function rosterOf(yamlText) {
  const bots = new Map()
  let cur = null
  for (const line of String(yamlText || '').split('\n')) {
    let m = /^ {2}([a-z0-9_-]+):\s*$/.exec(line)
    if (m) { cur = m[1]; bots.set(cur, { aliases: [], sid: null }); continue }
    if (cur === null) continue
    m = /^ {4}slack_user_id:\s*"?(U[A-Z0-9]+)"?/.exec(line)
    if (m) bots.get(cur).sid = m[1]
    m = /^ {4}aliases:\s*\[(.*)\]/.exec(line)
    if (m) bots.get(cur).aliases = m[1].split(',').map((a) => a.trim().replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '')).filter(Boolean)
    // 11-08 은퇴·멈춤 봇 숨김 재료: status · role 첫머리(따옴표 벗김 · 주석 앞까지)
    m = /^ {4}(status|role):\s*(.*)$/.exec(line)
    if (m) bots.get(cur)[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')
  }
  const pats = []
  for (const [b, v] of bots) {
    for (const a of [...v.aliases, b]) {
      if (!a) continue
      if (/^[A-Za-z0-9_. -]+$/.test(a)) {
        if (a.length < 3 || EN_GENERIC.has(a.toLowerCase())) continue
        pats.push([b, new RegExp(`${B0}${reEsc(a)}${B1}`, 'iu')])
      } else {
        if ([...a].length < 2) continue
        pats.push([b, new RegExp(reEsc(a), 'u')])
      }
    }
  }
  const sid2bot = new Map([...bots].filter(([, v]) => v.sid).map(([b, v]) => [v.sid, b]))
  const korean = new Map([...bots].map(([b, v]) => [b, v.aliases.find((a) => /[가-힣]/.test(a)) || null]))
  const retired = new Set([...bots].filter(([, v]) => RETIRED_RX.test(v.status || '') || RETIRED_RX.test(v.role || '')).map(([b]) => b))
  return { pats, sid2bot, n: bots.size, korean, retired, aliases: new Map([...bots].map(([b, v]) => [b, v.aliases])) }
}
// 11-08 숨길 봇(주인 지적 «은퇴/멈춘 봇이 명단에 남음»): 명부 status·role 첫머리가 은퇴·멈춤 꼴 · 또는 설정 hide_bots(키 또는 별칭)
//   «creating» 처럼 아직 안 켠 봇은 명부만으로 숨기지 않음(설정으로만) — 쉬는 봇(MOD «응답 없음»)은 화면이 그대로 보여 줌
const RETIRED_RX = /^(?:retired|paused|stopped|은퇴|멈춤)/i
export function botHidden(key, roster, hideBots) {
  if (roster && roster.retired && roster.retired.has(key)) return true
  const hb = Array.isArray(hideBots) ? hideBots.filter((x) => typeof x === 'string' && x) : []
  if (!hb.length) return false
  const names = [key, ...((roster && roster.aliases && roster.aliases.get(key)) || [])]
  return names.some((n) => hb.includes(n))
}
// 노드 글 → 찾은 봇 차례(처음 나온 자리 순 · 같은 자리면 봇 이름 순 = Python 튜플 정렬)
export function mentionsOf(label, roster) {
  if (!roster) return []
  const hits = []
  for (const m of String(label || '').matchAll(/<@(U[A-Z0-9]+)>/g)) if (roster.sid2bot.has(m[1])) hits.push([m.index, roster.sid2bot.get(m[1])])
  for (const [b, p] of roster.pats) { const m = p.exec(label); if (m) hits.push([m.index, b]) }
  hits.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0))
  const order = []
  for (const [, b] of hits) if (!order.includes(b)) order.push(b)
  return order
}
export function withOwners(room, roster) {
  return { ...room, nodes: room.nodes.map((n) => { const ms = mentionsOf(n.label, roster); return { ...n, owner: ms.length ? ms[0] : null, mentions: ms } }) }
}

// ── 11-08 방 닫힘 판정 (주인 지적: 닫았다고 한 방이 «진행 중»으로 뜸 — 방을 닫을 때 그래프 칸은 그대로 두고 기록에만 «종결»을 적음) ──
// 그래프 칸만 보지 않고 방 기록으로 함께 판정. 닫힘 = 아래 셋 중 하나 · 02 에서 마지막 닫힘 줄 뒤에 상태 칸 «재개» 줄이 있으면 다시 열림.
//   ① 02 진행 기록 상태 칸이 정확히 «회의 종료»·«goal_met»(회의 감시기 term 규칙과 같은 낱말 · 감시 정지 기준)
//   ② 02 줄 글이 «…방 종결 —»(기록 꼴) 선언 — «방 종결은 …몫»·«방 종결 아님»·«종결 조건» 같은 줄은 선언이 아님
//   ③ 03 결과 문서 머리(제목 줄 · 첫 «##» · 앞 12줄 안 «상태»·«**종결» 줄)의 «종결» — 틀 문구 «회의 종결 시 기입»·«종결 조건»·«종결 전»은 아님
// 닫힌 방의 그래프 칸(진행·대기·결정)은 닫을 때 그대로 둔 것 — 화면은 방을 «끝남»으로 접고 «내 차례»·막힘 집계에서 뺌
const P_ROW = /^\[[^\]]*\]\s*[^|]*\|\s*([^|]*?)\s*\|(.*)$/
const TERM_STATUS = new Set(['회의 종료', 'goal_met'])
const REOPEN_STATUS = new Set(['재개'])
const CLOSE_DECL = /방\s*종결(?:\s*기록)?\s*—/
const CLOSE_WORD = /종결(?!\s*(?:시|전|조건|대기|예정|아님|뒤|후|여부|회고|게이트|절차))/
export function outcomeClosed(outcome) {
  const ls = String(outcome || '').replace(/\r\n?/g, '\n').split('\n')
  const head = []
  const h1 = ls.find((l) => /^#\s/.test(l)), h2 = ls.find((l) => /^##\s/.test(l))
  if (h1) head.push(h1)
  if (h2) head.push(h2)
  for (const l of ls.filter((x) => x.trim()).slice(0, 12)) if (/^(?:>\s*)?(?:\*\*)?(?:상태|종결)/.test(l.trim())) head.push(l)
  return head.some((l) => CLOSE_WORD.test(l))
}
export function closedOf({ progress, outcome } = {}) {
  let lastClose = -1, by = null, lastReopen = -1
  String(progress || '').replace(/\r\n?/g, '\n').split('\n').forEach((ln, i) => {
    const m = P_ROW.exec(ln)
    if (!m) return
    const st = m[1].trim()
    if (TERM_STATUS.has(st)) { lastClose = i; by = 'progress-status' } else if (REOPEN_STATUS.has(st)) lastReopen = i
    else if (CLOSE_DECL.test(m[2])) { lastClose = i; by = 'progress-line' }
  })
  if (lastClose >= 0 && lastReopen < lastClose) return { closed: true, by }
  if (lastReopen >= 0) return { closed: false, by: null }
  return outcomeClosed(outcome) ? { closed: true, by: 'outcome-head' } : { closed: false, by: null }
}

// ── 11-08 한글 제목 자동 (주인 지적: 11-03 뒤 방은 «01-spec — 영어 폴더 이름»으로 뜸 · 손 목록 display_text.titles 는 덮어쓰기용으로만) ──
// 원천 차례 = 00-context «## 목표» 첫 줄 → 육하원칙 표 «무엇을» 칸 → 01-spec 제목 줄(한글 · 폴더 이름 꼴 아님) → null(화면이 폴더 이름)
// 짧게: 마크다운 꾸밈·목록 표시 뺌 → « — »·«: » 앞 → 괄호 묶음 뺌 → 40자 넘으면 낱말 끝에서 자르고 «…»
const TITLE_MAX = 40
const plainMd = (s) => String(s).replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`|\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim()
const unknownCell = (s) => !s || /^(?:모름|-|—|없음|미정|\?)$/.test(s)
export function shortTitle(raw) {
  let t = plainMd(raw)
  for (const sep of [' — ', ': ', '：', ' - ']) { const i = t.indexOf(sep); if (i >= 6) t = t.slice(0, i) }
  let prev
  do { prev = t; t = t.replace(/\s*\([^()]*\)/g, '') } while (t !== prev)
  t = t.replace(/\s+/g, ' ').trim()
  if ([...t].length > TITLE_MAX) {
    const cs = [...t].slice(0, TITLE_MAX).join('')
    const cut = Math.max(cs.lastIndexOf(' '), cs.lastIndexOf('·'))
    t = (cut >= 12 ? cs.slice(0, cut) : cs).replace(/[\s·,]+$/, '') + '…'
  }
  return t || null
}
export function autoTitle({ context, spec } = {}) {
  const c = String(context || '').replace(/\r\n?/g, '\n').split('\n')
  const gi = c.findIndex((l) => /^##\s*목표\s*$/.test(l.trim()))
  if (gi >= 0) {
    const first = c.slice(gi + 1).find((l) => l.trim())
    if (first && !/^#/.test(first.trim()) && !unknownCell(plainMd(first))) return shortTitle(first)
  }
  const hi = c.findIndex((l) => /^\|\s*누가\s*\|\s*무엇을\s*\|/.test(l.trim()))
  if (hi >= 0) {
    const row = c.slice(hi + 1).find((l) => /^\|/.test(l.trim()) && !/^\|[\s|:-]+\|?$/.test(l.trim()))
    const what = row ? (row.split('|')[2] || '').trim() : ''
    if (!unknownCell(what)) return shortTitle(what)
  }
  const h = /^#\s+(.+)$/m.exec(String(spec || ''))
  if (h) {
    const t = h[1].replace(/^\s*\d{2}-spec\s*—\s*/, '').replace(/^\s*\d{4}-\d{2}-\d{2}\s+/, '')
    const s = shortTitle(t)
    if (s && /[가-힣]/.test(s) && !/[a-z0-9]+-[a-z0-9]+/.test(s)) return s
  }
  return null
}

// ── 11-08 «이게 뭔가» 칸 (주인 11-07 «CCMOD 자체에 대한 설명, 그 와중에 mod-for-slack 에 대한 설명이 별도로») ──
// 봇 화면 옆 현황판(플러그인 ui.about)과 같은 두 층 글. 원천 차례 = 플러그인 설정 ui.about(uiSettings 가 읽은 값) → web.json about → 아래 기본
// 기본 = 제품 설치기가 쓰는 글(port/lib/slackmod_config.py ABOUT)과 같은 글자 — 바꿀 때 두 곳을 같이
export const DEFAULT_ABOUT = Object.freeze({
  summary: 'Slack 글에 답하는 Claude Code 봇',
  ccmod: 'Claude Code 의 화면과 동작을 바꾸는 플러그인(줄여서 CCMOD). 대화 옆 칸, 입력창 위 띠, /명령을 더하고, 도구 호출 같은 일을 지켜보거나 바꿀 수 있음. 이 현황판과 띠도 mod 로 만듦.',
  system: 'CCMOD 위에서 도는 Slack 봇 시스템. Slack 글을 받아 봇이 답하고, 일이 길면 스레드마다 하위 세션을 따로 띄워 맡기며, 이 현황판에 세션, 프로젝트, 예약 상태를 보여 줌.',
})
const ABOUT_KEYS = ['summary', 'ccmod', 'system']
export function aboutOf(pluginAbout, confAbout, name) {
  const take = (o, k) => (o && typeof o === 'object' && !Array.isArray(o) && typeof o[k] === 'string' && o[k].trim() ? o[k].replace(/\s+/g, ' ').trim().slice(0, 400) : null)
  const out = {}
  for (const k of ABOUT_KEYS) out[k] = take(pluginAbout, k) || take(confAbout, k) || DEFAULT_ABOUT[k]
  out.system_name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'mod-for-slack'
  return out
}

// ── 11-08 노드 글 사람 말 (주인 지적 «일부는 알아보지도 못하겠는데요») ──
// 좁은 표만: 방 문서 번호(00~03 · 파일 이름 꼴) · 영어 판정어(PASS·FAIL·GATE·verifier·agenda·make-public·md) → 우리말 · 시각(02:10)·날짜(11-08)는 그대로
// 설정 glossary { 낱말: 풀이 } = 주인 낱말표(글자 그대로 · 먼저 적용) · 그래도 남은 내부 코드(M4·K18·G8 꼴) = 글은 그대로, 그 칸만 plain:false(화면이 «내부 약어 포함»)
// 제품 이름(Jump·herdr 등)은 영어여도 안 건드림 · 목표 칸 G번호는 화면이 «목표 N» 으로 풂 → 코드로 안 셈
const PLAIN = [
  [/(?<![\p{L}\p{N}])00-context(?:\.md)?(?![\p{L}\p{N}])/gu, '배경 문서'], [/(?<![\p{L}\p{N}])01-spec(?:\.md)?(?![\p{L}\p{N}])/gu, '계획 문서'],
  [/(?<![\p{L}\p{N}])02-progress(?:\.md)?(?![\p{L}\p{N}])/gu, '진행 기록'], [/(?<![\p{L}\p{N}])03-outcome(?:\.md)?(?![\p{L}\p{N}])/gu, '결과 문서'],
  [/(?<![\p{L}\p{N}.:/-])00(?=\s|$|[·,)])/gu, '배경 문서'], [/(?<![\p{L}\p{N}.:/-])01(?=\s|$|[·,)])/gu, '계획 문서'],
  [/(?<![\p{L}\p{N}.:/-])02(?=\s|$|[·,)])/gu, '진행 기록'], [/(?<![\p{L}\p{N}.:/-])03(?=\s|$|[·,)])/gu, '결과 문서'],
  [/\bGATE PASS\b/g, '관문 통과'], [/\bPASS\b/g, '통과'], [/\bFAIL\b/g, '실패'], [/\bverifier\b/gi, '검증'], [/\bagenda\b/gi, '안건'],
  [/\bmake-public\b/g, '공개판 만들기'], [/(?<=[\p{L}\p{N}]\s)md\b/gu, '문서'],
]
const CODE_RX = /(?<![A-Za-z0-9])[A-Z]{1,2}\d+(?:\.\d+)?(?![A-Za-z0-9])/
export function plainLabel(label, status, glossary) {
  let s = String(label ?? '')
  if (glossary && typeof glossary === 'object' && !Array.isArray(glossary)) {
    for (const [k, v] of Object.entries(glossary)) if (k && typeof v === 'string' && v && k !== '__proto__') s = s.split(k).join(v)
  }
  for (const [rx, to] of PLAIN) s = s.replace(rx, to)
  const plain = status === 'goal' ? true : !CODE_RX.test(s)
  return { label: s, plain }
}

// 실데이터 방 고르기: 방 폴더 이름 = «YYYY-MM-DD-…» · 그 날짜가 오늘(KST) 앞 days 일 안 · 그래프 노드 1개+ · 이름 차례(견본과 같은 sorted glob) · 최근 max 개
export const ROOM_RX = /^(\d{4})-(\d{2})-(\d{2})-[A-Za-z0-9가-힣._-]+$/
export function pickRooms(names, nowMs, days = 31, max = 40) {
  const kst = new Date(nowMs + 9 * 3600e3)
  const cutMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - days * 86400e3
  const ok = names.filter((n) => { const m = ROOM_RX.exec(n); return m && Date.UTC(+m[1], +m[2] - 1, +m[3]) >= cutMs }).sort()
  return ok.slice(Math.max(0, ok.length - max))
}

// ms → «2026-11-01T22:30:05+09:00»(화면 hhmm 이 시간대 변환 없이 T 뒤 두 자리씩 읽음 → KST 로 보냄)
export function kstIso(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms + 9 * 3600e3).toISOString().replace(/\.\d{3}Z$/, '+09:00')
}

// 화면 글 덧 가림(파이썬 견본 규칙 «뒤»에 · 담당 찾기 «뒤»에): 지시 팀 번호(L-K-… 꼴) · 설정 hide_words(계정 이름 등 · 대소문자 무시)
//   — 해시·메시지 번호·파일 이름 = 위 SCRUB · 비밀·메일 = scrubDeep(safeText) 칸 통째 · 경로 = safeText 끝 이름 + 화면 RED 규칙
export const LEDGER_ID_RX = /(?<![A-Za-z0-9_])L-[A-Z]{1,3}-[A-Za-z0-9_-]+/g
export function hideMore(t, words) {
  let s = String(t ?? '').replace(LEDGER_ID_RX, '')
  for (const w of Array.isArray(words) ? words : []) if (typeof w === 'string' && w.length >= 3) s = s.replace(new RegExp(reEsc(w), 'giu'), '')
  return s === String(t ?? '') ? s : s.replace(/\s{2,}/gu, ' ').replace(/^[ ·]+|[ ·]+$/g, '')
}

// 봇 표시 이름: 설정 bot_names[키] → 명부 첫 한글 별칭(화면 표시 표 DISP 와 같은 규칙) → MOD botShown 이름
//   (화면은 이 이름으로 봇 키를 다시 찾음 — 영문 키 그대로 보내면 봇 화면 고리가 안 생김)
export function botLabel(key, name, roster, names) {
  if (names && typeof names[key] === 'string' && names[key]) return names[key]
  const k = roster && roster.korean ? roster.korean.get(key) : null
  return k || name || key
}

// 봇 표시 이름 칸 bots[].display_name (11-03 봇 칸 합의 · 화면 고정 이름 표를 대신함): 설정 bot_names[키] → 명부 한글 별칭 →
//   MOD 이름(botShown · 봇 키와 다를 때만 — 같으면 이름표가 없는 것) → 없으면 null(지어 쓰지 않음 · 화면이 키로 대신)
export function displayNameOf(key, modName, roster, names) {
  if (names && Object.prototype.hasOwnProperty.call(names, key) && typeof names[key] === 'string' && names[key].trim()) return names[key].trim()
  const k = roster && roster.korean ? roster.korean.get(key) : null
  if (k) return k
  return typeof modName === 'string' && modName.trim() && modName !== key ? modName.trim() : null
}
// 응답 글 전체 가림 낱말(설정 hide_words · 대소문자 무시 · 3자 이상 낱말만 · 코드에 이름 박기 0) — 글자 값만 바꿈(칸 이름·숫자·구조 그대로) ·
//   다 지워진 display_name = null · 링크 칸은 뒤에 relink 가 허용 꼴로 다시 붙임
export function hideWordsDeep(v, words, key) {
  const ws = (Array.isArray(words) ? words : []).filter((w) => typeof w === 'string' && w.length >= 3)
  if (!ws.length) return v
  const rx = ws.map((w) => new RegExp(reEsc(w), 'giu'))
  const walk = (x, k) => {
    if (typeof x === 'string') {
      let s = x
      for (const r of rx) s = s.replace(r, '')
      if (s === x) return x
      s = s.replace(/\s{2,}/gu, ' ').replace(/^[ ·]+|[ ·]+$/g, '')
      return k === 'display_name' && !s ? null : s
    }
    if (Array.isArray(x)) return x.map((y) => walk(y, k))
    if (x && typeof x === 'object') { const o = {}; for (const [kk, y] of Object.entries(x)) o[kk] = walk(y, kk); return o }
    return x
  }
  return walk(v, key)
}

// /api/jobs «display» 칸(11-03 · 화면판 쪽과 칸 합의) = 설정 web.json display_text 그대로의 꼴 { titles, labels, back } · 기본 null
//   titles = { 방 id: 제목 } · labels = { 방 id: { 노드 id: [원래 글 열쇠, 보일 글] } } · back = { 방 id: [[앞, 뒤], …] }
//   글자 칸만 받음(꼴이 틀린 칸은 버림) · 가림 낱말은 «보일 글»·제목에만(원래 글 열쇠 = 화면이 노드 글과 대조하는 값이라 손 0)
//   scrubDeep 안 거침(주인이 설정에 쓴 글 · 열쇠 꼴 h+16진이 해시 가림에 깎이지 않게)
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
export function displayOf(conf, words) {
  if (!isPlain(conf)) return null
  const hide = (t) => hideWordsDeep(t, words)
  const titles = {}, labels = {}, back = {}
  if (isPlain(conf.titles)) for (const [room, t] of Object.entries(conf.titles)) if (!PROTO_ID(room) && isStr(t)) titles[room] = hide(t)
  if (isPlain(conf.labels)) for (const [room, m] of Object.entries(conf.labels)) {
    if (PROTO_ID(room) || !isPlain(m)) continue
    const o = {}
    for (const [id, pr] of Object.entries(m)) if (!PROTO_ID(id) && Array.isArray(pr) && pr.length === 2 && isStr(pr[0]) && isStr(pr[1])) o[id] = [pr[0], hide(pr[1])]
    labels[room] = o
  }
  if (isPlain(conf.back)) for (const [room, a] of Object.entries(conf.back)) {
    if (PROTO_ID(room) || !Array.isArray(a)) continue
    back[room] = a.filter((e) => Array.isArray(e) && e.length === 2 && isStr(e[0]) && isStr(e[1])).map((e) => [e[0], e[1]])
  }
  return { titles, labels, back }
}

// board = boardModel 결과 · rooms =[{ room, title, nodes[{id,status,label,owner,mentions}], edges }] · okAt = 마지막 좋은 읽기(ms) · hide = 덧 가림 낱말 · roster·names = 봇 표시 이름
const PROTO_ID = (id) => id === '__proto__' || id in Object.prototype
// ── 11-09 숫자 칸 하루 1행 기록(주인 «이대로 ㄱㄱ.» ③) ──
// 머리 숫자 줄(내가 정할 것·막힘·진행·프로젝트·경고)은 화면(jobs.html prep·botRows·mergeBots·renderBoard)이 /api/jobs 몸통에서 셈 →
// 같은 몸통에서 같은 규칙으로 셈(화면 숫자 = 기록 숫자 · DOM 대조 시험 jobs.history.dom.test.mjs).
//   방 = rooms[] 중 room 이 글자·nodes 가 배열 · 마디 = id 있음 · 상태 'blocked' → 'warn' · 모르는 상태 → 'unknown' · 'placeholder' 마디 뺌
//   닫힌 방(closed) = 정할 것·막힘·진행 0(방 수·% 엔 듦) · % = 목표 뺀 마디 중 끝남 비율(반올림 · 마디 0 = 0)
//   경고 = 보고 없이 닫힌 일(봇 7일 합) + 오래 응답 없는 봇 — 봇 = ops.bots 를 화면 이름(display_name · 없으면 bot)으로 묶음(칸마다 큰 값 · 상태 = 화면 mergeBots 규칙)
//   화면은 이름 묶을 때 redact 를 한 번 더 거침 — 서버 몸통은 이미 scrubDeep 을 지난 글이라 묶음이 갈리는 경우는 시험 밖(결과 파일에 적음)
// 사용량 % = usage.accounts 의 #순번·5시간·7일(#순번 = 계정 우선순위 자리 · 순서가 바뀌면 같은 #이 다른 계정일 수 있음) · 방 % = { 방 id: % }
const KPI_SN = new Set(['done', 'doing', 'waiting', 'goal', 'owner', 'warn', 'unknown', 'caution'])
export function kpiRowOf(api) {
  const rooms = (api && Array.isArray(api.rooms) ? api.rooms : []).filter((r) => r && typeof r.room === 'string' && Array.isArray(r.nodes))
  let dec = 0, blk = 0, doing = 0
  const pct = {}
  for (const r of rooms) {
    const st = r.nodes.filter((n) => n && n.id != null).map((n) => { const s = String(n.status || ''); return s === 'blocked' ? 'warn' : s === 'placeholder' ? 'placeholder' : KPI_SN.has(s) ? s : 'unknown' }).filter((s) => s !== 'placeholder')
    const work = st.filter((s) => s !== 'goal'), done = work.filter((s) => s === 'done').length
    pct[r.room] = work.length ? Math.round(done / work.length * 100) : 0
    if (r.closed === true) continue
    dec += st.filter((s) => s === 'owner').length; blk += st.filter((s) => s === 'warn').length; doing += st.filter((s) => s === 'doing').length
  }
  const by = new Map()
  for (const b of (api && api.ops && Array.isArray(api.ops.bots) ? api.ops.bots : [])) {
    if (!b) continue
    const key = b.bot != null ? String(b.bot) : null
    const nm = typeof b.display_name === 'string' && b.display_name.trim() ? b.display_name.trim() : key
    const k = 'n:' + nm
    if (!by.has(k)) { by.set(k, { ...b }); continue }
    const m = by.get(k)
    if (b.noreport7 != null) m.noreport7 = Math.max(m.noreport7 || 0, b.noreport7)
    if (b.state === 'busy' || (m.state !== 'busy' && b.state === 'idle' && m.state !== 'idle')) m.state = b.state
  }
  const bots = [...by.values()]
  const noreport = bots.reduce((s, b) => s + (Number(b.noreport7) || 0), 0), stale = bots.filter((b) => String(b.state || '') === 'stale').length
  const accts = api && api.usage && Array.isArray(api.usage.accounts) ? api.usage.accounts : null
  const num = (v) => (Number.isFinite(v) ? v : null)
  return { dec, blk, doing, proj: rooms.length, cau: noreport + stale, noreport, stale,
    usage: accts ? accts.filter((a) => a && typeof a === 'object').map((a) => ({ label: typeof a.label === 'string' ? a.label : null, five_h_pct: num(a.five_h_pct), week_pct: num(a.week_pct) })) : null,
    rooms: pct }
}
// 기록 파일 몸통 { v: 1, start, daily: [{ day, …kpiRowOf }] } 에 그날 행을 넣음(같은 날 = 덮어씀 · 날짜 차례 · 최근 cap 행) · start = 처음 쓴 날(행이 밀려나도 그대로)
export const HISTORY_CAP = 30
const DAY_RX = /^\d{4}-\d\d-\d\d$/
export function historyPut(hist, day, row, cap = HISTORY_CAP) {
  if (!DAY_RX.test(String(day))) return historyOf(hist)
  const h = historyOf(hist)
  const daily = h.daily.filter((r) => r.day !== day).concat([{ day, ...row }]).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).slice(-cap)
  return { v: 1, start: h.start && h.start <= day ? h.start : day, daily }
}
// 읽은 파일 몸통 다듬기(꼴이 틀린 행 뺌) · 꼴이 아니면 빈 기록
export function historyOf(x) {
  const ok = x && typeof x === 'object' && !Array.isArray(x)
  const daily = ok && Array.isArray(x.daily) ? x.daily.filter((r) => r && typeof r === 'object' && !Array.isArray(r) && DAY_RX.test(String(r.day))) : []
  return { v: 1, start: ok && DAY_RX.test(String(x.start)) ? x.start : daily.length ? daily[0].day : null, daily }
}

// 11-09 14일 «막힘»: boardModel blockedSeen[i](그날 날짜 붙은 게시판 줄이 있음 · 오늘 = 늘 참)이 거짓인 칸 = null(«셈 안 됨» · 0 이 아님)
//   blockedSeen 칸이 아예 없는 입력(옛 boardModel·시험 몸통) = 배열 그대로
export function blockedKnown(arr, board) {
  if (!Array.isArray(arr)) return null
  if (!board || !('blockedSeen' in board)) return arr
  const seen = Array.isArray(board.blockedSeen) ? board.blockedSeen : []
  return arr.map((x, i) => (seen[i] === true ? x : null))
}
export function jobsModel({ board, rooms, okAt, hide, roster, names, hideBots, glossary }) {
  const bots = (Array.isArray(board && board.bots) ? board.bots : []).filter((b) => !(b && botHidden(b.bot, roster, hideBots)))
  const sessions = Array.isArray(board && board.sessions) ? board.sessions : []
  const jobOf = (bot) => {
    const mine = sessions.filter((s) => s && s.bot === bot && s.task).sort((a, b) => (b.startedMs || 0) - (a.startedMs || 0))
    return mine.length ? hideMore(scrub(taskLine(mine[0].task, 40)), hide) || null : null
  }
  const T = (board && board.total) || {}
  const at = kstIso(okAt)
  return {
    rooms: (Array.isArray(rooms) ? rooms : []).filter((r) => r && typeof r.room === 'string' && Array.isArray(r.nodes)).map((r) => ({
      room: r.room, title: hideMore(r.title || '', hide), thread_url: linkOk(r.thread_url),
      // 11-08: 방 기록 판정 닫힘(closedOf) · 표시 제목(손 목록 → 자동 한글 제목 · 화면 roomTitle 이 name 을 먼저 봄)
      closed: r.closed === true, closed_by: r.closed === true && typeof r.closed_by === 'string' ? r.closed_by : null,
      name: typeof r.name === 'string' && r.name.trim() ? hideMore(r.name.trim(), hide) || null : null,
      // 노드 thread_url·owner_action·detail = 칸만 먼저(null · 화면이 줄을 숨김) — 원천 설계 = 결과 문서 설계 메모노드 상세
      nodes: r.nodes.filter((n) => n && typeof n.id === 'string' && !PROTO_ID(n.id)).map((n) => { const pl = plainLabel(n.label || '', n.status, glossary); return { id: n.id, status: String(n.status || 'unknown'), label: hideMore(pl.label, hide), plain: pl.plain, owner: n.owner || null, mentions: Array.isArray(n.mentions) ? n.mentions : [],
        thread_url: linkOk(n.thread_url), owner_action: typeof n.owner_action === 'string' && n.owner_action ? hideMore(n.owner_action, hide) : null, detail: typeof n.detail === 'string' && n.detail ? hideMore(n.detail, hide) : null } }),
      edges: (Array.isArray(r.edges) ? r.edges : []).filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string' && !PROTO_ID(e[0]) && !PROTO_ID(e[1])).map((e) => [e[0], e[1]]),
    })),
    ops: board ? {
      bots: bots.map((b) => ({ bot: botLabel(b.bot, b.name, roster, names), display_name: displayNameOf(b.bot, b.name, roster, names), state: b.state, lastSeenMin: b.lastSeenMin, running: b.kidsRunning, done7: b.done7, noreport7: b.noreport7,
        blocked7: b.blocked7, done14: b.series ? b.series.done : null, tokensNow: b.tokensNow, job: jobOf(b.bot), tokens7: null })),
      counts: board.counts || null,
      days: Array.isArray(board.days) ? board.days : null,
      total14: { started: T.started || null, done: T.done || null, noreport: T.noreport || null, blocked: blockedKnown(T.blocked, board), tokens: T.tokens || null },
    } : null,
    usage: null, ledger: null, approvals: null,
    read_at: at, last_ok_at: at,
  }
}

// ── 11-04 /api/jobs «usage» 칸 = mods 패널 «Claude · usage» 줄(Ses · Wk · Fbl)과 같은 값 ──
// 원천 = mods 설정 ui.team_claude_urls 상태 주소(GET · 패널 index.js fetchTeam 과 같은 주소·같은 curl) → plugin ui/lib/accounts.js stripNames
//   → ui/lib/team.js teamModel(claudeOf) 의 model.claude 줄 그대로 — 새 판정 0 · 이 함수는 그 줄을 칸 이름만 옮김(파일·망 손 0)
//   label = 패널 글자 «#P» · status = 패널 그 줄 status(낱말 꼴만 · 꺼진 계정 = disabled) · five_h = Ses · week = Wk
//   models = Fbl 칸의 원천(quota.modelWeekly 칸마다 · 큰 값부터 최대 6 = 첫 칸이 패널 Fbl(가장 큰 값 · 같으면 앞 칸) · 이름 = 패널 글자 «Fbl» — 원천 열쇠 글은 패널처럼 안 실음)
//   % = 패널 글자와 같은 정수(team.js pctText = Math.round(비율 × 100) · 자르지 않음 · 화면이 0~100 막대) · 초기화 = 원천 epoch ms → ISO8601 · 숫자 아닌 칸 = null
//   Claude 계정 0 · 원천 없음·안 답함 = null · 계정 이름·id·토큰 = 응답 0
const USAGE_MODELS_MAX = 6
const pctOf = (f) => (typeof f === 'number' && Number.isFinite(f) && f >= 0 ? Math.round(f * 100) : null) // 패널 useFrac(f × 100) → pctText Math.round 와 같은 식
const rowPct = (u) => (u && typeof u.pct === 'number' && Number.isFinite(u.pct) ? Math.round(u.pct) : null)
const isoOf = (t) => (typeof t === 'number' && Number.isFinite(t) && t > 0 && t < 8.64e15 ? new Date(t).toISOString() : null)
export function usageOf(model, claudeJson) {
  const rows = model && Array.isArray(model.claude) ? model.claude : null
  if (!rows || !rows.length) return null
  const accts = isPlain(claudeJson) && Array.isArray(claudeJson.accounts) ? claudeJson.accounts.filter(isPlain) : []
  const modelsOf = (id) => {
    const a = typeof id === 'string' && id ? accts.find((x) => x.id === id) : null
    const mw = a && isPlain(a.quota) && isPlain(a.quota.modelWeekly) ? a.quota.modelWeekly : {}
    const all = Object.values(mw).filter(isPlain).map((w) => {
      const p = pctOf(w.utilization)
      return { name: 'Fbl', week_pct: p, reset_at: p === null ? null : isoOf(w.reset), raw: p === null ? -1 : w.utilization }
    })
    // 큰 값부터(같으면 원래 순서 · 숫자 아님 = 맨 뒤) — 패널 claudeOf 의 «u.pct > fbl.pct» 와 같은 첫 칸
    return all.map((x, k) => ({ x, k })).sort((a, b) => b.x.raw - a.x.raw || a.k - b.k).slice(0, USAGE_MODELS_MAX).map(({ x }) => ({ name: x.name, week_pct: x.week_pct, reset_at: x.reset_at }))
  }
  return {
    accounts: rows.filter(isPlain).map((r) => ({
      label: '#' + r.p, // 패널 team.js accountHead 와 같은 글자
      status: isStr(r.status) ? r.status : null,
      five_h_pct: rowPct(r.ses), five_h_reset_at: rowPct(r.ses) === null ? null : isoOf(r.ses.reset),
      week_pct: rowPct(r.wk), week_reset_at: rowPct(r.wk) === null ? null : isoOf(r.wk.reset),
      models: modelsOf(r.id),
    })),
  }
}

// ── 11-09 «회의 결정 후속» 칸(주인 물음 «회의 결정 뒤 일이 재시작 뒤에도 진행되나?» · 읽기 전용 표시) ──
// 닫힌 회의 방(03-outcome 있음 · 최근 14일) → 그 방을 출처로 한 팀. 대장 = 설정 followups.cmd 읽기 명령의 출력 글만(find · show) — DB 직접 ❌
// 묶는 기준 = 행의 source·adopted·dispatch 칸에 방 폴더 이름 · 그 방 스레드 번호 · 부르는 이름(«N회차 X방» — 폴더 «날짜-N-x-…» 꼴일 때) 중 하나
const ROUND_RX = /^\d{4}-\d\d-\d\d-(\d+)-([a-z])(?:-|$)/
// 낱말 = 폴더 이름 · 날짜 뗀 폴더 이름(8자+ · 대장에 «7-b-memory-wiki/03-outcome.md» 꼴로 적힘) · 스레드 번호(thread_ts → 링크) · 부르는 이름
export function followTokens({ room, thread_url, thread_ts } = {}) {
  if (typeof room !== 'string' || !room) return []
  const out = [room]
  const slug = room.replace(/^\d{4}-\d\d-\d\d-/, '')
  if (slug !== room && slug.length >= 8 && slug.includes('-')) out.push(slug)
  const t = /^(\d{10})\.(\d{6})$/.exec(String(thread_ts || '')) || /\/p(\d{10})(\d{6})(?:\D|$)/.exec(String(thread_url || ''))
  if (t) out.push(t[1] + '.' + t[2])
  const r = ROUND_RX.exec(room)
  if (r) out.push(r[1] + '회차 ' + r[2].toUpperCase() + '방')
  return out
}
const ROW_ID_RX = /^L-[A-Za-z0-9가-힣_.①-⑳-]+$/
export function parseFind(text) {
  const lines = String(text || '').split('\n').map((s) => s.trim())
  if (!/^\d+$/.test(lines[0] || '')) return []
  return lines.slice(1).filter((s) => ROW_ID_RX.test(s))
}
export function parseShow(text) {
  const o = {}
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('-- history')) break
    const m = /^([a-z_]+):(?: (.*))?$/.exec(line)
    if (m) o[m[1]] = m[2] === undefined ? '' : m[2]
  }
  return typeof o.id === 'string' && ROW_ID_RX.test(o.id) ? o : null
}
export function ledgerMs(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) KST$/.exec(String(s || '').trim())
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]) : null
}
// 낱말이 칸 안에 있음 · 앞이 숫자면 아님(«17회차 B방» ≠ «7회차 B방») · 낱말 끝이 영문·숫자면 뒤도 영문·숫자·«-» 아님(«weekly-5» ≠ «weekly-50» · 번호 뒷자리)
function hasToken(text, tok) {
  const s = String(text || ''), tail = /[A-Za-z0-9]$/.test(tok)
  for (let i = s.indexOf(tok); i >= 0; i = s.indexOf(tok, i + 1)) {
    if (i > 0 && /[0-9]/.test(s[i - 1])) continue
    if (tail && /[A-Za-z0-9-]/.test(s[i + tok.length] || '')) continue
    return true
  }
  return false
}
// 방 스레드 번호(링크 주소 없이도) — 02 앞머리 «개설» 줄 → 00-context 첫 Slack 주소 · 없으면 null
export function threadTsOf({ context, progressHead } = {}) {
  const open = OPEN_LINE.exec(String(progressHead || ''))
  if (open) return open[2] + '.' + open[3]
  const m = /\/archives\/[CDG][A-Z0-9]{6,20}\/p(\d{10})(\d{6})(?!\d)/.exec(String(context || ''))
  return m ? m[1] + '.' + m[2] : null
}
export function rowMatches(row, tokens) {
  if (!row || !Array.isArray(tokens) || !tokens.length) return false
  return ['source', 'adopted', 'dispatch'].some((k) => tokens.some((t) => t && hasToken(row[k], t)))
}
const LEDGER_CLOSED = new Set(['완료', '해당없음', '기각', '흡수']) // 대장 OPEN_EXCLUDE 와 같은 낱말
const NO_OWNER = new Set(['unassigned', '미배정', '-', 'none'])
// 할 일 요약 = 채택 글 → 발주 글(«미발주 —» 꼴 아님) → 출처 글(좌표 꼴 아님) → 발주 글 → 출처 글
const COORD_RX = /^(?:slack|discord|cross-session|self):/i
function summaryOf(r) {
  const a = String(r.adopted || '').trim(), d = String(r.dispatch || '').trim(), s = String(r.source || '').trim()
  return a || (d && !/^미발주/.test(d) ? d : '') || (s && !COORD_RX.test(s) ? s : '') || d || s
}
// 화면 글에서 Slack 좌표(채널/메시지 번호)는 뗌(주인 규칙 «메시지 번호 ❌») · 비게 된 괄호도 뗌
const SLACK_COORD_RX = /(?:(?:slack|discord):)?(?:[CDG][A-Z0-9]{6,20}[/ ])?\d{10}\.\d{6}(?!\d)/g
function noCoords(t) { return String(t || '').replace(SLACK_COORD_RX, '').replace(/\(\s*[·,;]?\s*\)/g, '').replace(/\s{2,}/g, ' ').trim() }
const cutText = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return [...t].length > n ? [...t].slice(0, n - 1).join('') + '…' : t }
// ── 11-09 /api/jobs «projgraph» 칸 = «봇 · 프로젝트» 줄기(A안 · 주인 11-09 «좋아요» · 봇 시안 projgraph.js pgData 가 읽는 꼴) ──
// 입력 = server.mjs 가 MOD project.js 로 만든 것: groups(graphGroups · 차례 그대로) · outside(graphData) · rows = 등록부 id → 행(막힌 세션 → 봇)
// 이 함수가 하는 일 = 칸 이름 옮김 + 화면 이름(봇 칸과 같은 botLabel) + 숨긴 봇(botHidden) + 막힌 글 손질 — 새 판정 0
//   봇 이름 = ops.bots[].bot 과 같은 규칙(설정 bot_names → 명부 한글 별칭 → MOD 이름(board.bots 의 name) → 키)
//   숨긴 봇 = 줄기·«함께»·«프로젝트 밖» 이름에서 뺌 · 숨긴 봇 줄기 아래 마디 = 그 마디의 다음 보이는 부모 줄기로(없으면 이름 없는 줄기) · 막힌 세션 수는 그대로
//   막힌 글 = 원문 앞부분만(경로 앞에서 자름 → Slack 좌표 뗌 → 파일·하위 번호·해시 지움 → 가림 낱말 → 120자) · 말 보탬 0
//   sid = 막힌 세션 id(화면이 «새로 막힘»을 가르는 열쇠 · 화면 글자엔 안 그림 — /api/board openBlocks 의 sid 와 같은 값)
// → { groups: [{ bot, projects: [{ project, parents, sessions, loops: { exact, est, next }, openBlocks, blocks: [{ sid, who, bot, at, text }], otherBots }] }],
//     outside: { loops, byBot: { 이름: 수 }, next }, blocked: [project] } · 입력이 모양이 아니면 null
const PATH_RX = /(?:~|\.{0,2}\/)?[\w.@-]+(?:\/[\w.@-]+){2,}\/?|(?:~|\.{0,2}\/)?[\w.@-]+\/[\w.@-]+\.[A-Za-z0-9]{1,5}(?![\w])|~\/[\w.@-]+/
export function blockText(t, hide) {
  let s = String(t ?? '')
  const m = PATH_RX.exec(s)
  if (m) s = s.slice(0, m.index)
  s = s.replace(/[\s=:;,·—(-]+$/u, '')
  return hideMore(cutText(scrub(noCoords(s)), 120), hide).trim()
}
// 11-09 재검 고침(보안 검수 1건 · 낮음): 숨긴 봇은 «자료»에도 이름 0 — 화면 글자만이 아니라 /api/jobs 값 전체
//   · 숨긴 봇 세션의 sid = 불투명 열쇠 'h-' + HMAC-SHA256(hideSalt, sid) 앞 10자(hideSalt 없으면 SHA-256) — 같은 sid = 늘 같은 값(화면 newlyBlocked 비교 그대로)
//     hideSalt = 서버가 설정 파일 바이트로 만든 값(보는 사람 손에 없음 · 봇 이름×6자리 번호 대입으로 되짚기 어렵게 · 서버 다시 켜도 같음)
//     숨긴 봇 세션 = 등록부 행 bot 이 숨긴 봇 · 또는 행이 없어도 sid 머리(«<봇>-<숫자>»)가 숨긴 봇
//   · 막힌 글(보이는 봇 글 포함)에서 숨긴 봇 키·별칭·화면 이름·MOD 이름을 가림 낱말로 지움(hideMore · 3자 이상)
//   · 나머지 칸: 줄기·parents·otherBots·byBot = 이미 뺌 · loops = 숫자 · project = 프로젝트 이름(봇 이름 아님 · 손 0)
const SID_BOT_RX = /^([A-Za-z][\w.]*?)-\d/
export function opaqueSid(sid, salt) {
  const h = salt ? crypto.createHmac('sha256', salt) : crypto.createHash('sha256')
  return 'h-' + h.update(String(sid)).digest('hex').slice(0, 10)
}
export function projgraphModel({ groups, outside, rows, board, roster, names, hideBots, hide, hideSalt } = {}) {
  if (!Array.isArray(groups)) return null
  const modName = new Map()
  for (const b of Array.isArray(board && board.bots) ? board.bots : []) if (b && typeof b.bot === 'string' && typeof b.name === 'string') modName.set(b.bot, b.name)
  const key = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const hidden = (k) => botHidden(k, roster, hideBots)
  const nameOf = (k) => botLabel(k, modName.get(k) || null, roster, names)
  const rowOf = (id) => (rows instanceof Map ? rows.get(id) : null) || null
  // 숨긴 봇 낱말 = 이 자료에 나오는 봇 키 전부 중 숨긴 것의 키·별칭·화면 이름·MOD 이름 + 설정 hide_bots 낱말 그대로
  const cand = new Set([...modName.keys()])
  if (roster && roster.aliases instanceof Map) for (const k of roster.aliases.keys()) cand.add(k)
  if (rows instanceof Map) for (const r of rows.values()) if (r && key(r.bot)) cand.add(key(r.bot))
  for (const g of groups) {
    if (!g) continue
    if (key(g.bot)) cand.add(key(g.bot))
    for (const n of Array.isArray(g.projects) ? g.projects : []) for (const k of [...(Array.isArray(n && n.parents) ? n.parents : []), ...(Array.isArray(n && n.otherBots) ? n.otherBots : [])]) if (key(k)) cand.add(key(k))
  }
  if (outside && outside.byBot && typeof outside.byBot === 'object') for (const k of Object.keys(outside.byBot)) if (key(k)) cand.add(key(k))
  const hideNames = new Set((Array.isArray(hideBots) ? hideBots : []).filter((w) => typeof w === 'string' && w))
  for (const k of cand) {
    if (!hidden(k)) continue
    hideNames.add(k); hideNames.add(nameOf(k))
    if (modName.get(k)) hideNames.add(modName.get(k))
    for (const a of (roster && roster.aliases instanceof Map && roster.aliases.get(k)) || []) if (typeof a === 'string' && a) hideNames.add(a)
  }
  const hideAll = [...(Array.isArray(hide) ? hide : []), ...[...hideNames].sort((x, y) => y.length - x.length)] // 긴 낱말 먼저(«secretbot» 앞에 «secret» 이 지우면 꼬리가 남음)
  const sidHidden = (sid, bk) => !!((bk && hidden(bk)) || (() => { const m = SID_BOT_RX.exec(sid); return m && hidden(m[1]) })())
  const n0 = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
  const iso = (v) => (Number.isFinite(v) ? kstIso(v) : null)
  const outG = [], at = new Map() // 줄기 열쇠(봇 키 · null) → outG 칸
  const put = (k, node) => { if (!at.has(k)) { at.set(k, { bot: k === null ? null : nameOf(k), projects: [] }); outG.push(at.get(k)) } at.get(k).projects.push(node) }
  for (const g of groups) {
    if (!g || !Array.isArray(g.projects)) continue
    for (const n of g.projects) {
      if (!n || typeof n.project !== 'string' || !n.project) continue
      const seen = (Array.isArray(n.parents) ? n.parents : []).map(key).filter((k) => k && !hidden(k))
      const stem = key(g.bot) && !hidden(key(g.bot)) ? key(g.bot) : seen.length ? seen[0] : null
      const parents = stem ? [stem, ...seen.filter((k) => k !== stem)] : seen
      const s = n.sessions || {}, l = n.loops || {}
      const blocks = (Array.isArray(n.blocks) ? n.blocks : []).filter((b) => b && typeof b.by === 'string').map((b) => {
        const row = rowOf(b.by), bk = row ? key(row.bot) : null, show = bk && !hidden(bk)
        return { sid: sidHidden(b.by, bk) ? opaqueSid(b.by, hideSalt) : b.by, who: show ? nameOf(bk) + (row.role === 'child' ? ' 하위' : '') : '하위 세션', bot: show ? nameOf(bk) : null,
          at: typeof b.at === 'string' ? b.at : '', text: blockText(b.text, hideAll) }
      })
      put(stem, { project: n.project, parents: parents.map(nameOf), sessions: { busy: n0(s.busy), idle: n0(s.idle), stale: n0(s.stale) },
        loops: { exact: n0(l.exact), est: n0(l.est), next: iso(l.next) }, openBlocks: n0(n.openBlocks), blocks,
        otherBots: (Array.isArray(n.otherBots) ? n.otherBots : []).map(key).filter((k) => k && !hidden(k) && !parents.includes(k)).map(nameOf) })
    }
  }
  const o = outside && typeof outside === 'object' ? outside : {}
  const byBot = {}
  for (const [k, v] of Object.entries(o.byBot && typeof o.byBot === 'object' ? o.byBot : {})) {
    if (k === '-' || hidden(k) || !n0(v) || k === '__proto__') continue
    const nm = nameOf(k)
    byBot[nm] = (byBot[nm] || 0) + n0(v)
  }
  const blocked = []
  for (const g of outG) for (const n of g.projects) if (n.openBlocks > 0 && !blocked.includes(n.project)) blocked.push(n.project)
  return { groups: outG, outside: { loops: n0(o.loops), byBot, next: iso(o.next) }, blocked }
}
export function followupsModel({ rooms, rows, now, roster, names, hideBots, hide } = {}) {
  if (!Array.isArray(rooms) || !Array.isArray(rows)) return []
  const t = Number.isFinite(now) ? now : Date.now()
  const out = []
  for (const rm of rooms) {
    const tok = followTokens(rm || {})
    if (!tok.length) continue
    const items = rows.filter((r) => r && rowMatches(r, tok)).map((r) => {
      const open = !LEDGER_CLOSED.has(String(r.status || '').trim())
      const k0 = String(r.owner_norm || r.owner || '').split('+')[0].trim(), key = NO_OWNER.has(k0.toLowerCase()) ? '' : k0
      const hidden = key ? botHidden(key, roster, hideBots) : false
      const at = ledgerMs(r.updated_at)
      const quiet = at === null ? null : Math.max(0, Math.floor((t - at) / 3600e3))
      return { id: r.id, summary: hideMore(cutText(noCoords(summaryOf(r)), 90), hide).trim() || null, owner: hidden ? null : key || null,
        owner_name: hidden || !key ? null : botLabel(key, null, roster, names), owner_hidden: hidden, status: String(r.status || '').trim() || null,
        open, updated_at: at === null ? null : kstIso(at), quiet_h: quiet, stale: open && quiet !== null && quiet >= 24 }
    })
    if (!items.length) continue
    items.sort((a, b) => (b.open - a.open) || ((b.quiet_h ?? -1) - (a.quiet_h ?? -1)) || (a.id < b.id ? -1 : 1))
    out.push({ room: rm.room, name: typeof rm.name === 'string' && rm.name.trim() ? rm.name.trim() : null, thread_url: linkOk(rm.thread_url),
      open: items.filter((x) => x.open).length, stale: items.filter((x) => x.stale).length, items })
  }
  return out
}
