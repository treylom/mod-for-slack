// tools/web-board/lib.mjs — 서버의 순수 함수(파일·망 손 0) · lib.test.mjs 가 시험함
import path from 'node:path'
import net from 'node:net'

// 여는 곳 검사: 이 맥 안(127/8 · ::1) 또는 host(100.64.0.0/10)만. 모든 주소(0.0.0.0 · ::)·사무실 망 = 거절.
// 앞자리 0 꼴(«100.064.0.1» — 8진으로 읽는 곳이 있음)·공백·짧은 꼴은 net.isIPv4 와 정규식 둘 다 통과해야.
export function hostAllowed(h) {
  if (typeof h !== 'string') return false
  if (h === '::1') return true
  if (net.isIPv4(h) !== true) return false
  const m = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 127) return true
  return a === 100 && b >= 64 && b <= 127
}

// 서브 돌면 작업 중 — 가지 5c61061 agents.js workingState 와 같은 규칙(idle + 서브 pending·running·waiting, teammate 제외 → busy)
export const WORKING = new Set(['pending', 'running', 'waiting'])
export function busyFallback(live) {
  if (!live || live.activity !== 'idle' || !Array.isArray(live.agents)) return live
  return live.agents.some((a) => a && !a.teammate && WORKING.has(a.status)) ? { ...live, activity: 'busy', webBusy: true } : live
}

const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }
// 글 속 경로는 끝 이름만(«$HOME/b/c.txt» → «…/c.txt»)
export const hidePaths = (s) => String(s || '').replace(/(?:~|\.{0,2})?\/(?:[^\s/'"`]+\/)+([^\s/'"`]*)/g, (_, last) => '…/' + last)

// ── 응답 가림(10-31 봇 THREAT 해제 조건 1) — 새 정규식 발명 0: 저장소 발신 검사 꼴을 그대로 옮김 ──
// 비밀·개인정보 = notes .claude/scripts/hindsight_import.py classify_secret(:339) 순서·꼴:
//   SECRET_PATTERNS(:75-138) · 이메일 허용 목록·예약 도메인(:142-152) · 32자+ 토막(:156) + 면제(:162-195 slug·UUID·대장 id·맨몸 40/64 hex · 맨 key)
//   ① «알려진 값»(이 기기 비밀 저장소 파일을 읽는 층)은 옮기지 않음 — 이 서버는 비밀 파일을 읽지 않는다(계약).
// 경로·Slack id = owner_presend.py PATTERNS path(:30) · slack_id(:32). presend 의 hash·sha·filename·jargon·slack_ts·ledger 와
//   slack_dashboard LEAK_RE(\d{10,})는 주인 글의 «읽기 쉬움» 규칙이지 token·PII·경로가 아니어서 안 옮김(커밋 7자·스레드 번호가 다 가려짐).
// 정책 = slack_dashboard.clean 꼴: 비밀·개인정보가 하나라도 걸린 칸은 통째로 MASK · 경로는 끝 이름만 · Slack id 는 그 자리만 MASK.
// JS 차이: Python 의 \b 는 한글을 낱말 글자로 보고 JS 는 아니라서 «…PW:»·«…1234-…» 류가 JS 쪽에서 더 걸림(더 가리는 쪽 = 닫힌 쪽).
export const MASK = '[가림]'
const KO_VAL = "[A-Za-z0-9!@#$%^&*_\\-+=/.~]"
const SECRET_RX = [
  ['slack_token', /xox[abprs]-/],
  ['slack_xapp', /xapp-/],
  ['slack_webhook', /hooks\.slack\.com\/services\//],
  ['sk_key', /(?<![A-Za-z0-9])sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ['ghp_token', /ghp_/],
  ['gho_token', /gho_/],
  ['github_pat_token', /github_pat_/],
  ['aws_key', /AKIA[0-9A-Z]{16}/],
  ['pem_block', /-----BEGIN/],
  ['jwt', /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/],
  ['discord_bot_token', /(?<![A-Za-z0-9_.-])[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}(?![A-Za-z0-9_.-])/],
  ['api_key_assign', /api[_-]?key\s*[:=]\s*\S{12,}/i],
  ['password_assign', /password\s*[:=]/i],
  ['bearer_token', /Bearer\s+\S{16,}/],
  ['basic_auth', /Authorization:\s*Basic\s+\S+/i],
  ['pw_colon', /\bPW\s*[:=]\s*\S+/i],
  ['labeled_secret_kv', /(?<![A-Za-z0-9_.-])["'`]?(?:[A-Za-z0-9_.-]{0,40}[_.-])?(?:api[_-]?key|access[_-]?key|secret[_-]?key|key|token|secret|passwd|password|pass|pw)(?:[_.-][A-Za-z0-9_.-]{0,40})?["'`]?\s*[:=]\s*["'`]?[^\s"'`]{6,}/gi],
  ['korean_secret_label', new RegExp('(?:비밀번호|패스워드|암호|시크릿)\\s*(?:은|는|:|=)\\s*["\'`]?' + KO_VAL + '{8,}')],
  ['korean_token_key_label', new RegExp('(?:토큰|(?<![가-힣A-Za-z])키)\\s*(?:은|는|:|=)\\s*["\'`]?' +
    '(?![a-z0-9_\\-./~]*[_\\-/.][a-z0-9_\\-./~]*(?!' + KO_VAL + '))' + KO_VAL + '{8,}')],
  ['pii_phone_kr', /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/],
  ['pii_rrn_kr', /(?<!\d)\d{6}-[1-4]\d{6}(?!\d)/],
  ['pii_card_kr', /\b\d{4}-\d{4}-\d{4}-\d{4}\b/],
  ['pii_account_kr', /(?:계좌(?:번호)?|국민|신한|농협|카카오뱅크|케이뱅크|토스뱅크|새마을금고|신협|우체국|씨티|우리은행|하나은행|기업은행|SC제일)\s*[:=]?\s*(?=[\d-]{12,})\d+-\d+-\d+/],
  ['env_line', /^\s*[A-Z][A-Z0-9_]{2,}=\S{8,}\s*$/m],
]
const EMAIL_ALLOW = new Set(['noreply@anthropic.com', 'git@github.com'])
const RESERVED_EMAIL_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|[a-z0-9-]+\.(?:example|test|invalid|localhost)|example|test|invalid|localhost)$/
const EMAIL_RX = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g
const LONG_TOKEN_RX = /(?<![A-Za-z0-9])[A-Za-z0-9_\-+/=]{32,}(?![A-Za-z0-9])/g
const BENIGN_SLUG = /^(?:[a-z0-9]{1,24}(?:(?:__|[-_])[a-z0-9]{1,24}){2,}(?:\.[a-z0-9]{1,6})?)$/
const BENIGN_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const BENIGN_LEDGER = /^L-[A-Z]{1,2}-[A-Za-z0-9-]+$/
const BARE_HEX_LENS = [40, 64]
const BARE_KEY_SPLIT = /^["'`]?([A-Za-z0-9_.-]+)["'`]?\s*[:=]\s*["'`]?([^\s"'`]+)$/
const benignBareKey = (m) => {
  const mt = BARE_KEY_SPLIT.exec(m.trim())
  if (!mt || mt[1].toLowerCase() !== 'key') return false
  return /^[a-z._-]{1,15}$/.test(mt[2].replace(/[,;)\]}]+$/, ''))
}
const benignLong = (tok) => {
  if (BENIGN_SLUG.test(tok) || BENIGN_UUID.test(tok) || BENIGN_LEDGER.test(tok)) return true
  if (tok.includes('/') && !tok.includes('=') && !tok.includes('+')) return tok.split('/').filter(Boolean).every((p) => BENIGN_SLUG.test(p) || /^[A-Za-z0-9._-]{1,40}$/.test(p))
  return false
}
const isHex = (s) => /^[0-9a-fA-F]+$/.test(s)
// Python str.isspace 와 같은 빈칸(맨몸 hex 판정용 — JS \s 는 BOM 을 빈칸으로 보고 \x1c-\x1f·\x85 는 안 봄)
const PY_SPACE = /[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/
// Python re 는 \d 가 모든 십진 숫자(전각·아라비아 등)를 잡고 IGNORECASE 가 «ſ»·«K»(켈빈)을 s·k 로 접는다 → JS 에선 맞춘 사본도 한 번 더 봄
//   십진 숫자 = 유니코드가 0~9 를 10자씩 붙여 둔다(안정성 보장) → 줄 시작부터 %10 이 값.  (독립 재검 #3 · 11-01)
const ND_VAL = new Map()
for (let cp = 0x80, run = -1; cp < 0x20000; cp++) {
  if (/\p{Nd}/u.test(String.fromCodePoint(cp))) { if (run < 0) run = cp; ND_VAL.set(cp, (cp - run) % 10) } else run = -1
}
const pyLike = (s) => s.normalize('NFKC').replace(/[\x1c-\x1f\x85]/g, ' ').replace(/\p{Nd}/gu, (c) => (ND_VAL.has(c.codePointAt(0)) ? String(ND_VAL.get(c.codePointAt(0))) : c))
// 걸린 규칙 이름(없으면 null) — classify_secret 과 같은 차례: 이메일 → 꼴 목록 → 32자+ 토막 · 날 글이 안 걸리면 맞춘 사본도(둘 중 하나 = 걸림)
export function secretRule(text) {
  const raw = String(text ?? '')
  const r = ruleOf(raw)
  if (r) return r
  const n = pyLike(raw)
  return n === raw ? null : ruleOf(n)
}
function ruleOf(s) {
  if (s.includes('@')) for (const m of s.matchAll(EMAIL_RX)) {
    const a = m[0].toLowerCase()
    if (!EMAIL_ALLOW.has(a) && !RESERVED_EMAIL_DOMAIN.test(a.slice(a.lastIndexOf('@') + 1))) return 'pii_email'
  }
  const digest = s.trim()
  const standaloneHex = BARE_HEX_LENS.includes(digest.length) && isHex(digest)
  for (const [name, rx] of SECRET_RX) {
    if (name === 'pii_phone_kr' && standaloneHex) continue
    if (name === 'labeled_secret_kv') { if ([...s.matchAll(rx)].some((m) => !benignBareKey(m[0]))) return name; continue }
    if (rx.test(s)) return name
  }
  for (const m of s.matchAll(LONG_TOKEN_RX)) {
    const tok = m[0]
    if (benignLong(tok)) continue
    if (BARE_HEX_LENS.includes(tok.length) && isHex(tok)) {
      const before = m.index > 0 ? s[m.index - 1] : ''
      const after = m.index + tok.length < s.length ? s[m.index + tok.length] : ''
      if ((before === '' || PY_SPACE.test(before)) && (after === '' || PY_SPACE.test(after))) continue
    }
    return 'long_token'
  }
  return null
}
const PRESEND_PATH_RX = /(?:\/Users\/|agent-[\w-]+\/out\/|docs\/|\.claude\/)[^\s<>"']+/g
const SLACK_ID_RX = /\b[FU]0[A-Z0-9]{8,}\b/g
// 칸 하나 가림: 비밀·개인정보 = 칸 통째 MASK · 경로 = 끝 이름만(hidePaths 가 못 잡는 «docs/…»·«.claude/…» 도) · Slack id = 그 자리 MASK
export function safeText(text) {
  const s = String(text ?? '')
  if (secretRule(s)) return MASK
  // presend 경로 꼴을 먼저(hidePaths 가 먼저면 «docs…/x»·«.claude…/x» 처럼 앞 폴더 이름이 남고 presend 꼴이 더는 안 맞음 — 변이 R5 로 찾음)
  return hidePaths(s.replace(PRESEND_PATH_RX, (m) => '…/' + (m.replace(/\/+$/, '').split('/').pop() || ''))).replace(SLACK_ID_RX, MASK)
}
// 응답 전체 받침: 모든 글자 값 + 객체 키(봇·모델 칸에 객체가 들어오면 키로 샘 — 독립 재검 #4)를 safeText 로
// 구조 비밀(봇 r2 조건 1): 키가 비밀 낱말이면 값·하위를 통째 MASK(값이 짧은 글·숫자·객체여도) — 낱말 단위 대조라 화면 칸 key·tokens·tokensNow·tokens_out·sessions 는 안 걸림
const CRED_PARTS = new Set(['password', 'passwd', 'pass', 'pw', 'secret', 'token', 'auth', 'authorization', 'bearer', 'credential', 'credentials', 'cookie', 'apikey', '비밀번호', '패스워드', '암호', '시크릿', '토큰'])
const CRED_PAIRS = new Set(['api_key', 'access_key', 'secret_key', 'private_key', 'session_key', 'client_secret', 'refresh_token', 'access_token', 'id_token', 'auth_token', 'api_token'])
// 이어 붙인 낱말 안의 강한 비밀 낱말(봇 r4 뒤 한 번에): dbpassword·mysecret·접속비밀번호 처럼 구분자 없는 키 · 약한 낱말(pass·auth·token·key)은 여기 넣지 않음(passage·author·tokens·monkey 오탐)
const CRED_SUB = ['password', 'passwd', 'secret', 'credential', 'apikey', 'privatekey', 'accesskey', 'secretkey', 'sessionkey', 'accesstoken', 'refreshtoken', 'authorization', 'bearer', 'cookie', '비밀번호', '패스워드', '암호', '시크릿', '토큰']
// 복수 꼴(봇 r3): passwords·secrets·cookies·비밀번호들 · 짝의 뒤 낱말 apiKeys·accessTokens·clientSecrets 도 같은 뜻 — 단 홀로 선 «tokens» 는 화면 칸(토큰 수)이라 복수 풀기에서 뺌
const singulars = (w) => [w, w.endsWith('s') ? w.slice(0, -1) : null, w.endsWith('들') ? w.slice(0, -1) : null].filter(Boolean) // «-es» 는 안 풂(passes 같은 흔한 낱말이 걸림)
// 키 펴기(봇 r4): 자유 글자와 같은 pyLike(NFKC — 전각·ſ·혼합 폭 → 보통 글자) 뒤에 낱말로 쪼갬 · 글자↔숫자 사이도 끊음(token1·pw2)
export function credKeyParts(k) {
  return pyLike(String(k ?? '')).replace(/(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean)
}
export function isCredKey(k) {
  const parts = credKeyParts(k)
  // 구분자를 뺀 이은 꼴: 보이지 않는 글자·제어 글자로 쪼갠 «to‍ken»·«pass​word» 와 구분자 없는 «dbpassword» 를 같은 대조로
  const joined = parts.join('')
  if (CRED_PARTS.has(joined) || CRED_SUB.some((w) => joined.includes(w))) return true
  for (let i = 0; i < parts.length; i++) {
    if (CRED_PARTS.has(parts[i])) return true
    if (singulars(parts[i]).some((w) => w !== parts[i] && w !== 'token' && CRED_PARTS.has(w))) return true
    if (i + 1 < parts.length && singulars(parts[i + 1]).some((w) => CRED_PAIRS.has(parts[i] + '_' + w))) return true
  }
  return false
}
const REC_NAME = new Set(['name', 'key', 'k', 'field', 'header', 'label'])
const REC_VALUE = new Set(['value', 'val', 'v', 'data', 'content'])
export function scrubDeep(v) {
  if (typeof v === 'string') return safeText(v)
  if (Array.isArray(v)) return v.map(scrubDeep)
  if (v && typeof v === 'object') {
    // 이름·값 꼴 기록: [{ name: 'password', value: 'x' }] · { key: 'Authorization', v: '…' } — 키 이름은 무해해도 이름 칸 글자가 비밀 낱말이면 값 칸을 통째 MASK
    const named = Object.entries(v).some(([k, x]) => REC_NAME.has(k) && typeof x === 'string' && isCredKey(x))
    const o = {}; for (const [k, x] of Object.entries(v)) o[safeText(k)] = isCredKey(k) || (named && REC_VALUE.has(k)) ? MASK : scrubDeep(x); return o
  }
  return v
}
// MOD 글자 판(/api/state) 조각: 비밀·개인정보 꼴이면 조각 통째 MASK · 경로는 그대로(MOD 화면과 줄 단위 대조를 지키려고) — 독립 재검 #1
export const maskSecret = (s) => (typeof s === 'string' && secretRule(s) ? MASK : s)
// /api/state 원천 사본: 등록부 일 설명 · live 의 Slack 스레드 머리 글(text) — 비밀·개인정보 꼴이면 통째 MASK(원본 손 0 · 사본만)
export const maskEntry = (e) => (e && typeof e.task === 'string' && secretRule(e.task) ? { ...e, task: MASK } : e)
const maskField = (arr, k) => (Array.isArray(arr) && arr.some((x) => x && secretRule(x[k])) ? arr.map((x) => (x && secretRule(x[k]) ? { ...x, [k]: MASK } : x)) : arr)
//   live 사본: Slack 스레드 머리(threads[].text) · 서브에이전트 설명(agents[].description)
export function maskLive(lv) {
  if (!lv || typeof lv !== 'object') return lv
  const threads = maskField(lv.threads, 'text')
  const agents = maskField(lv.agents, 'description')
  return threads === lv.threads && agents === lv.agents ? lv : { ...lv, threads, agents }
}
//   게시판 요약 사본: 마지막 줄들(last[].text)
export const maskBoard = (b) => { const last = b && maskField(b.last, 'text'); return b && last !== b.last ? { ...b, last } : b }

// «지금» 한 칸: 기록에 이미 있는 짧은 설명(description 40자 · 경로는 끝 이름만) · 없으면 «도구 이름 + 대상»
//   Read/Edit/Write = 파일 이름 · Grep/Glob = 패턴 20자 · WebFetch = 도메인 · Bash = 명령 이름만(따옴표 속·«이름=값» 건너뜀) · MCP = 짧은 이름
export function nowText(tool) {
  const name = String(tool && tool.name || '')
  const inp = (tool && tool.input) || {}
  if (typeof inp.description === 'string' && inp.description.trim()) return secretRule(inp.description) ? MASK : cut(hidePaths(inp.description), 40) // 자르기 전 검사
  if (/^(Read|Edit|Write|NotebookEdit|MultiEdit)$/.test(name)) return name + ' ' + path.basename(String(inp.file_path || inp.notebook_path || ''))
  if (/^(Grep|Glob)$/.test(name)) return name + ' ' + (secretRule(String(inp.pattern || '')) ? MASK : cut(hidePaths(inp.pattern), 20))
  if (name === 'WebFetch') { try { return 'WebFetch ' + new URL(String(inp.url)).hostname } catch { return 'WebFetch' } }
  if (name === 'Bash') {
    const bare = String(inp.command || '').replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""').trim()
    const word = bare.split(/\s+/).find((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) || ''
    const base = path.basename(word).replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 20)
    return 'Bash' + (base ? ' ' + base : '')
  }
  if (name.startsWith('mcp__')) return name.split('__').slice(2).join('__') || name
  return name || '?'
}

// 대화 기록 꼬리 → 마지막 assistant 도구 호출(없으면 글) · 시각
export function lastTool(text) {
  const lines = String(text || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    let d
    try { d = JSON.parse(lines[i]) } catch { continue }
    if (!d || d.type !== 'assistant' || !d.message || !Array.isArray(d.message.content)) continue
    const at = Date.parse(d.timestamp || '')
    const tu = d.message.content.filter((c) => c && c.type === 'tool_use')
    if (tu.length) return { text: nowText(tu[tu.length - 1]), at }
    if (d.message.content.some((c) => c && c.type === 'text' && String(c.text || '').trim())) return { text: '글 씀', at }
  }
  return null
}

// ?key= 를 뺀 뒤 넘길 곳 — 같은 서버 안 길만(«//다른곳» 꼴 ❌)
export function cleanLocation(u) {
  const p = '/' + String(u.pathname || '/').replace(/^\/+/, '')
  return p + (u.search || '')
}

// 길 → 이름(그 밖 = null → 404) · 응답 갈래: 열쇠 없음 = 401(길보다 먼저 — 없는 길도 401) · 없는 길 = 404 ·
// 데이터 길 + 같은 ETag = 304 · 나머지 200. 주소창 ?key= 의 302/401 은 이 앞(server.mjs)에서.
export function routeOf(pathname) {
  return pathname === '/' ? 'page' : pathname === '/classic' ? 'classic' : pathname === '/api/state' ? 'state' : pathname === '/api/board' ? 'board' : pathname === '/api/jobs' ? 'jobs' : null
}
export function replyStatus({ authed, route, inm, etag }) {
  if (authed !== true) return 401
  if (!route) return 404
  if (route !== 'page' && route !== 'classic' && typeof etag === 'string' && etag && inm === etag) return 304
  return 200
}

// ── 10-31 UX 판(시안 r1 → 실물): /api/board 의 화면 재료 · 순수 함수(파일·망 손 0) ──
// 보는 사람 순서 = ① 주인 차례 → ② 봇 → ③ 프로젝트 지도 → ④ 14일 추이 → ⑤ 사용량 → ⑥ 대장 → ⑦ 설치·세팅.
// 판정은 다시 만들지 않는다: 세션 상태 = MOD stateOf · 프로젝트 = MOD projectKeyOf · 봇 이름 = MOD botShown (서버가 주입).
// 원천이 이 서버에 없는 칸(사용량 한도 · 대장 · 승인 대기)은 null = 화면 «모름» — 0·«꺼짐»으로 바꾸지 않는다.

const KST_MS = 9 * 3600e3
const DAY_MS = 86400e3
export const kstDay = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10)
export function dayKeys(nowMs, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(kstDay(nowMs - i * DAY_MS))
  return out
}
const msOf = (s) => { const t = Date.parse(typeof s === 'string' ? s : ''); return Number.isFinite(t) ? t : null }

// 게시판 줄은 «HH:MM:SS»뿐(날짜 없음) → «추정»: 위쪽 닻(그 세션이 끝난 때 · 마지막 갱신 · 지금) 이전의 가장 늦은 같은 시각.
// 한 노트 안 같은 세션 줄은 쓴 차례대로라, 뒤에서부터 닻을 그 줄 시각으로 내리며 거꾸로 짚는다(boardModel).
// 오래 도는 본 세션도 최근 줄은 맞고, 하루 넘게 빈 틈이 있는 옛 줄만 어긋날 수 있다(화면 «추정»).
export function boardLineMs(at, upperMs) {
  if (typeof at !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(at) || !Number.isFinite(upperMs)) return null
  let t = Date.parse(kstDay(upperMs) + 'T' + at + '+09:00')
  if (!Number.isFinite(t)) return null
  if (t > upperMs + 60000) t -= DAY_MS
  return t
}

// 하위 종류 → 단계(방 단계 그래프는 이 서버가 읽지 않음 → 화면엔 «추정»)
const STAGE = { research: '조사', scout: '조사', build: '만들기', design: '만들기', plan: '만들기', project: '만들기', capture: '만들기',
  review: '검토', verify: '검토', verification: '검토', 'security-review': '검토', grader: '검토', test: '검토', '시험': '검토' }
export const stageOf = (type) => STAGE[type] || '기타'
const typeLine = (t) => (typeof t === 'string' && t.trim() ? cut(safeText(t), 30) : null)

// 하는 일 한 줄: 일 설명 첫 줄 · 비밀·개인정보 꼴이면 통째 MASK(자르기 «전»에 검사 — 32자+ 토막이 잘려 검사를 빠져나가지 않게) · 경로는 끝 이름만 · 60자 · 자른 자리에 닫히지 않은 괄호가 남으면 그 괄호 앞에서 자름
//   («…(라이브 교체는 하지 않음 · 새 브랜치…» 처럼 열린 괄호로 끝나면 읽기 어렵고, 그 뒤 줄 전부가 «괄호 안» 줄바꿈이 됨)
const OPEN = '([{「『《〈【«“‘', CLOSE = ')]}」』》〉】»”’'
export function taskLine(s, n = 60) {
  let t = cut(safeText(String(s || '').split('\n')[0]), n).replace(/\s+…$/, '…')
  if (!t.endsWith('…')) return t
  // 낱말 가운데서 잘렸으면 마지막 빈칸(12자 안)까지 물림 — «❌라…» 같은 토막이 줄 첫머리에 홀로 서지 않게
  const sp = t.lastIndexOf(' ')
  if (sp > 0 && t.length - 1 - sp <= 12) t = t.slice(0, sp).trimEnd() + '…'
  const stack = []
  for (let i = 0; i < t.length; i++) {
    if (OPEN.includes(t[i])) stack.push(i)
    else if (CLOSE.includes(t[i]) && stack.length && OPEN.indexOf(t[stack[stack.length - 1]]) === CLOSE.indexOf(t[i])) stack.pop()
  }
  if (!stack.length) return t
  const head = t.slice(0, stack[0]).trimEnd()
  return head.length >= 8 ? head + '…' : t
}

// web.json 세 칸(시안 설계 메모 · 주인 답 전 기본값) — 모르는 값은 기본값으로
export const UX_DEFAULT = Object.freeze({ owner_turn_quota: 'line', project_graph_scope: 'running', settings_layers: Object.freeze(['a']) })
export function uxOf(conf) {
  const c = conf && typeof conf === 'object' ? conf : {}
  const q = ['line', 'card', 'none'].includes(c.owner_turn_quota) ? c.owner_turn_quota : UX_DEFAULT.owner_turn_quota
  const g = ['running', 'all'].includes(c.project_graph_scope) ? c.project_graph_scope : UX_DEFAULT.project_graph_scope
  const l = Array.isArray(c.settings_layers) ? [...new Set(c.settings_layers.filter((x) => ['a', 'b', 'c'].includes(x)))] : []
  return { owner_turn_quota: q, project_graph_scope: g, settings_layers: l.length ? l.sort() : [...UX_DEFAULT.settings_layers] }
}

// 서버가 이미 읽어 둔 것(ST) + MOD 함수(M) → boardModel 입력. 서버 /api/board 와 미리보기가 같은 이 함수를 지난다.
//   판정은 전부 M 의 것: stateOf(+ 플러그인에 workingState 없을 때만 busyFallback) · projectKeyOf(projectLabel·boundProjectOf) · botShown
export function boardInputOf({ cfg, entries, lives, notePaths, boardFiles, bindings, M, hasWorking, hosts, ux, now, boards }) {
  const notes = []
  const seen = new Set() // 같은 노트가 두 프로젝트에 걸려도 한 번만(막힘 두 번 셈 ❌)
  for (const [project, paths] of notePaths || []) {
    for (const p of paths) {
      if (seen.has(p)) continue
      seen.add(p)
      const rec = boardFiles ? boardFiles.get(p) : null
      if (rec && Array.isArray(rec.entries)) notes.push({ project, entries: rec.entries })
    }
  }
  const projectOf = (p) => M.projectLabel(cfg.board.projects, p)
  const attachOf = (e) => M.boundProjectOf(e, bindings)
  const hs = Array.isArray(hosts) ? hosts : []
  const ts = hs.some((h) => typeof h === 'string' && h.startsWith('100.'))
  return {
    now, staleMs: cfg.staleMs, days: 14, entries, lives, notes,
    stateOf: (e, lv) => M.stateOf(e, lv && !hasWorking ? busyFallback(lv) : lv, now, cfg.staleMs),
    aliveAfterEnd: (e, lv) => M.aliveAfterEnd(e, lv || null, now, cfg.staleMs),
    projectKeyOf: (e) => M.projectKeyOf(e, projectOf, attachOf),
    botName: (b) => M.botShown(b),
    ux,
    settings: {
      staleMin: Math.round(cfg.staleMs / 60000),
      projectsN: cfg.board.projects && Array.isArray(cfg.board.projects.names) ? cfg.board.projects.names.length : null,
      displayN: cfg.botDisplay && typeof cfg.botDisplay === 'object' ? Object.keys(cfg.botDisplay).length : null,
      childEnd: cfg.board.childEnd,
      hosts: hs.length ? '이 맥' + (ts ? ' + 사설망(host)' : '') + ' · 열쇠 필요' : null,
    },
    quota: null, // 사용량 서버는 이 서버가 읽지 않음 — 라이브 교체 때 원천 추가 후보
    // 11-09 재검 고침 2: 열린 막힘 = 그림과 같은 목록(server refreshBoards 의 프로젝트별 openList = MOD blockedAcross · sessionLive · auto 게시판 포함)
    blocked: boards instanceof Map ? [...boards].filter(([, b]) => b && Array.isArray(b.openList)).map(([project, b]) => ({ project, list: b.openList })) : undefined,
  }
}

// 11-09 재검 고침 2: 한 게시판 파일의 막힌 세션 = MOD project.js blockedSessions(82a1425) 와 같은 규칙(형식 검증 ViewsAgree 가 두 쪽을 대조)
//   쓴 세션(by)마다 마지막 상태 글(결정·막힘·끝)이 막힘 + isLive(by) → [{ by, at, text, i }] (i = 그 줄 자리 · 파일 차례)
const BLOCK_STATUS = new Set(['결정', '막힘', '끝'])
export function blockedInFile(entries, isLive) {
  const last = new Map()
  const list = Array.isArray(entries) ? entries : []
  list.forEach((e, i) => {
    if (!e || typeof e.by !== 'string' || !e.by || !BLOCK_STATUS.has(e.kind)) return
    last.set(e.by, { e, i })
  })
  return [...last.values()].filter(({ e }) => e.kind === '막힘' && isLive(e.by)).sort((a, b) => a.i - b.i).map(({ e, i }) => ({ by: e.by, at: e.at, text: e.text, i }))
}

export const QUOTA_HOT = 0.9 // 주간 한도 쓴 비율 문턱(시안과 같은 값)
const OVER = new Set(['ended', 'failed'])

// in = { now, staleMs, days, entries, lives: Map(id → live), notes: [{ project, entries }], stateOf(e, live), projectKeyOf(e),
//        botName(bot), ux, settings: { staleMin, projectsN, displayN, childEnd, hosts }, quota: null | [{ family, used, resetMs }] }
export function boardModel(inp) {
  const now = inp.now
  const nDays = inp.days || 14
  const days = dayKeys(now, nDays)
  const dayIx = new Map(days.map((d, i) => [d, i]))
  const ixOf = (ms) => (Number.isFinite(ms) && dayIx.has(kstDay(ms)) ? dayIx.get(kstDay(ms)) : -1)
  const zeros = () => new Array(nDays).fill(0)
  const ux = uxOf(inp.ux)
  const lives = inp.lives instanceof Map ? inp.lives : new Map()
  const entries = (inp.entries || []).filter((e) => e && typeof e.id === 'string')
  const byId = new Map(entries.map((e) => [e.id, e]))
  const name = (b) => { try { return inp.botName ? inp.botName(b) : b } catch { return b } }
  const proj = (e) => { try { return inp.projectKeyOf ? inp.projectKeyOf(e) : null } catch { return null } }
  const minAgo = (ms) => (Number.isFinite(ms) ? Math.max(0, (now - ms) / 60000) : null)
  const tokOut = (u) => (u && Number.isFinite(u.tokens_out) ? u.tokens_out : null)
  const week = now - 7 * DAY_MS

  const total = { started: zeros(), done: zeros(), noreport: zeros(), blocked: zeros(), tokens: zeros() }
  const botSet = new Set()
  for (const e of entries) if (typeof e.bot === 'string' && e.bot) botSet.add(e.bot)
  for (const lv of lives.values()) if (lv && typeof lv.bot === 'string' && lv.bot) botSet.add(lv.bot)
  const B = new Map([...botSet].sort().map((b) => [b, { bot: b, name: name(b), state: 'unseen', lastSeenMin: null, model: null, kidsRunning: 0,
    kidsStates: {}, done7: 0, noreport7: 0, blocked7: 0, tokensNow: null, boardLines: 0, series: { done: zeros(), noreport: zeros(), blocked: zeros() } }]))

  // 본 세션: role 이 child 아닌 행 중 id = 봇 이름, 없으면 가장 최근 것 · 둘 다 없으면 state = unseen(«모름» — «꺼짐» 아님)
  for (const b of B.values()) {
    const mains = entries.filter((e) => e.bot === b.bot && e.role !== 'child')
    const main = mains.find((e) => e.id === b.bot) || mains.sort((x, y) => (msOf(y.updated_at) || 0) - (msOf(x.updated_at) || 0))[0] || null
    const lv = main ? lives.get(main.id) || null : null
    if (main) b.state = inp.stateOf(main, lv)
    b.mainId = main ? main.id : null
    b.lastSeenMin = lv && Number.isFinite(lv.last_seen) ? minAgo(lv.last_seen) : null
    b.model = (lv && lv.model) || (main && main.model) || null
    const t = lv ? tokOut(lv.usage) : null
    if (t !== null) b.tokensNow = t
  }

  // 하위
  const sessions = []
  const P = new Map()
  const projOf = (key) => {
    if (!P.has(key)) P.set(key, { key, name: key === null ? '프로젝트 없음' : key, running: 0, ended7: 0, stages: { 조사: 0, 만들기: 0, 검토: 0, 기타: 0 }, last: null, recent: [] })
    return P.get(key)
  }
  for (const e of entries) {
    if (e.role !== 'child') continue
    const lv = lives.get(e.id) || null
    let st = inp.stateOf(e, lv)
    // MOD 와 같은 규칙: 등록부는 끝났는데 그 창이 아직 박동 = 살아 있는 하위(나무에서도 안 지움 · tree.js aliveAfterEnd)
    if (OVER.has(st) && typeof inp.aliveAfterEnd === 'function' && inp.aliveAfterEnd(e, lv)) st = inp.stateOf({ ...e, status: 'running' }, lv)
    const b = B.get(e.bot)
    const started = msOf(e.started_at)
    const pk = proj(e)
    const p = projOf(pk)
    const si = ixOf(started)
    if (si >= 0) total.started[si]++
    if (Number.isFinite(started) && started >= week) p.stages[stageOf(e.type)]++
    if (OVER.has(st)) {
      const ended = msOf(e.ended_at) ?? msOf(e.updated_at)
      const ix = ixOf(ended)
      const reported = Boolean(msOf(e.last_report_at))
      if (ix >= 0) {
        total[reported ? 'done' : 'noreport'][ix]++
        const t = tokOut(e.usage)
        if (t !== null) total.tokens[ix] += t
        if (b) b.series[reported ? 'done' : 'noreport'][ix]++
      }
      if (Number.isFinite(ended) && ended >= week) {
        p.ended7++
        if (b) b[reported ? 'done7' : 'noreport7']++
        p.recent.push({ sid: e.id, bot: e.bot, project: pk, type: typeLine(e.type), task: taskLine(e.task), state: st, startedMs: started, endedMs: ended })
      }
      continue
    }
    p.running++
    if (b) {
      b.kidsRunning++
      b.kidsStates[st] = (b.kidsStates[st] || 0) + 1
      const t = lv ? tokOut(lv.usage) : null
      if (t !== null) b.tokensNow = (b.tokensNow || 0) + t
    }
    sessions.push({ sid: e.id, bot: e.bot, project: pk, type: typeLine(e.type), task: taskLine(e.task), state: st, startedMs: started,
      lastSeenMin: lv && Number.isFinite(lv.last_seen) ? minAgo(lv.last_seen) : null, tokens: lv ? tokOut(lv.usage) : null })
  }

  // 게시판: 막힘 줄(날짜 추정 · 14일·봇 7일 = 줄 수 그대로) · 프로젝트 마지막 줄
  // 열린 막힘(11-09 재검 고침 2 · 봇 형식 검증 ViewsAgree break): 그림(MOD project.js blockedSessions + sessionLive · 세션 단위)과 같은 규칙 —
  //   한 게시판 파일 안에서 그 세션의 마지막 상태 글(결정·막힘·끝)이 막힘이고 세션이 안 끝났으면 막힌 세션 1 · 알림·질문·답 = 상태 아님 ·
  //   남의 끝은 안 닫음 · 프로젝트의 파일들 = 합집합(먼저 나온 파일의 줄). (옛 규칙 = 줄 단위 «뒤에 같은 세션 끝 없음» → 막힘→결정이 옛 칸에만 남음)
  //   서버는 그림과 같은 목록(inp.blocked = [{ project, list: MOD blockedAcross 결과 }])을 넘김 → 한 화면에서 옛 칸·그림 = 같은 세션 집합.
  //   넘긴 게 없으면(시험·형식 검증) 아래 blockedInFile(같은 규칙)로 inp.notes 에서 셈 · 살아 있음 = inp.isLive 또는 등록부 행 + stateOf 가 끝 아님.
  const openBlocks = []
  const upOf = (e) => {
    const lv = lives.get(e.id)
    return Math.min(now, msOf(e.ended_at) ?? (Math.max(msOf(e.updated_at) ?? 0, lv && Number.isFinite(lv.last_seen) ? lv.last_seen : 0, msOf(e.started_at) ?? 0) || now))
  }
  const isLive = typeof inp.isLive === 'function'
    ? (by) => { try { return Boolean(inp.isLive(by)) } catch { return false } }
    : (by) => { // 위 세션 칸과 같은 «끝» 판정(stateOf 끝 + aliveAfterEnd 면 안 끝남)
      const e = byId.get(by); if (!e) return false
      try { const lv = lives.get(e.id) || null; return !OVER.has(inp.stateOf(e, lv)) || (typeof inp.aliveAfterEnd === 'function' && Boolean(inp.aliveAfterEnd(e, lv))) } catch { return false }
    }
  const openSeen = new Map() // project → Set(sid) · 합집합
  const pushOpen = (project, x, atMs) => {
    if (!openSeen.has(project)) openSeen.set(project, new Set())
    if (openSeen.get(project).has(x.by)) return
    openSeen.get(project).add(x.by)
    const e = byId.get(x.by), lv = lives.get(x.by)
    openBlocks.push({ sid: x.by, bot: e ? e.bot : (lv && typeof lv.bot === 'string' ? lv.bot : null), project, atMs, text: taskLine(x.text), task: e ? taskLine(e.task) : '' })
  }
  const given = Array.isArray(inp.blocked)
  if (given) {
    for (const g of inp.blocked) {
      if (!g || !Array.isArray(g.list)) continue
      for (const x of g.list) if (x && typeof x.by === 'string' && x.by) { const e = byId.get(x.by); pushOpen(g.project, x, e ? boardLineMs(x.at, upOf(e)) : null) }
    }
  }
  for (const n of inp.notes || []) {
    const list = Array.isArray(n.entries) ? n.entries : []
    const atOf = new Array(list.length).fill(null)
    const anchor = new Map()
    for (let i = list.length - 1; i >= 0; i--) {
      const e = byId.get(list[i].by)
      if (!e) continue
      if (!anchor.has(e.id)) anchor.set(e.id, upOf(e))
      const t = boardLineMs(list[i].at, anchor.get(e.id))
      if (Number.isFinite(t)) { atOf[i] = t; anchor.set(e.id, t) }
    }
    list.forEach((ln, i) => {
      const e = byId.get(ln.by)
      const b = e ? B.get(e.bot) : null
      if (b) b.boardLines++
      const at = atOf[i]
      const p = P.get(n.project) || null
      if (p && Number.isFinite(at) && (!p.last || at >= p.last.atMs)) p.last = { atMs: at, who: e ? name(e.bot) : ln.by, kind: ln.kind, text: taskLine(ln.text) }
      if (ln.kind !== '막힘') return
      const ix = ixOf(at)
      if (ix >= 0) { total.blocked[ix]++; if (b) b.series.blocked[ix]++ }
      if (b && Number.isFinite(at) && at >= week) b.blocked7++
    })
    if (!given) for (const x of blockedInFile(list, isLive)) pushOpen(n.project, x, atOf[x.i])
  }

  // ① 주인 차례 — 기본 = 답·승인·막힘 · 한도 = ux.owner_turn_quota(line = 문턱 넘을 때만 맨 아래 한 줄 · card · none)
  const items = []
  for (const b of B.values()) if (b.state === 'waiting') items.push({ kind: 'waiting', bot: b.bot, who: b.name, sid: b.mainId, text: '본 세션이 주인 답을 기다립니다', project: null })
  for (const s of sessions) if (s.state === 'waiting') items.push({ kind: 'waiting', bot: s.bot, who: name(s.bot), sid: s.sid, text: s.task, project: s.project })
  items.push({ kind: 'approval', known: false, text: '열린 승인 카드 — 이 서버가 읽을 곳 없음(모름)' })
  for (const o of openBlocks) items.push({ kind: 'block', bot: o.bot, who: name(o.bot), sid: o.sid, text: o.text, task: o.task, project: o.project, sinceMin: minAgo(o.atMs) })
  const quota = Array.isArray(inp.quota) ? inp.quota : null
  let quotaLine = null
  if (quota) {
    const known = quota.filter((q) => q && Number.isFinite(q.used))
    const hot = known.filter((q) => q.used >= QUOTA_HOT)
    if (hot.length) {
      const text = '값이 보이는 계정 ' + known.length + '개 중 ' + hot.length + '개가 주간 한도 ' + Math.round(QUOTA_HOT * 100) + '% 넘게 씀'
      if (ux.owner_turn_quota === 'line') quotaLine = text
      else if (ux.owner_turn_quota === 'card') items.push({ kind: 'quota', text })
    }
  }
  const need = items.filter((x) => x.kind === 'waiting' || x.kind === 'block' || x.kind === 'quota').length

  // ③ 그래프: 기본 = 지금 하위가 도는 프로젝트만 · all = 7일 안 끝난 것도(프로젝트마다 최근 3개)
  const projects = [...P.values()].filter((p) => p.running > 0 || p.ended7 > 0)
  for (const p of projects) {
    p.inGraph = p.running > 0 || (ux.project_graph_scope === 'all' && p.ended7 > 0)
    p.recent.sort((a, b) => b.endedMs - a.endedMs)
    p.recent = ux.project_graph_scope === 'all' ? p.recent.slice(0, 3) : []
  }
  projects.sort((a, b) => b.running - a.running || b.ended7 - a.ended7 || String(a.name).localeCompare(String(b.name)))
  const graphSessions = [...sessions, ...projects.flatMap((p) => (p.inGraph ? p.recent : []))]

  // ⑦ 설치·세팅 — 웹 쓰기 0(이 서버엔 쓰기 길이 없음 · 켜려면 코드 + 주인 승인) · 보이는 층 = ux.settings_layers
  const S = inp.settings || {}
  const ce = S.childEnd || {}
  const minTxt = (v) => (Number.isFinite(v) ? v + '분' : null)
  const ends = [ce.child_close_after_report_min, ce.child_idle_alert_min, ce.child_idle_end_min]
  const allRows = [
    { layer: 'a', name: '멈춤으로 볼 시간', value: minTxt(S.staleMin), risk: '화면 판정만 바뀜' },
    { layer: 'a', name: '프로젝트 별칭', value: Number.isFinite(S.projectsN) ? S.projectsN + '개 프로젝트' : null, risk: '하위가 붙는 프로젝트 이름' },
    { layer: 'a', name: '봇 화면 이름', value: Number.isFinite(S.displayN) ? (S.displayN ? S.displayN + '개 이름표' : '없음(봇 이름 그대로)') : null, risk: '보이는 글자만' },
    { layer: 'b', name: '하위 자동 닫기 · 조용함 알림 · 종료', value: ends.every(Number.isFinite) ? ends.map((v) => v + '분').join(' · ') : null, risk: '일하던 하위가 닫힐 수 있음' },
    { layer: 'b', name: '하위 기본 모델 · 추론 깊이', value: null, risk: '사용량·속도' },
    { layer: 'b', name: '기억 불러오기 · 먼저 답하기', value: null, risk: '봇 행동이 바뀜' },
    { layer: 'c', name: '검사 장치 · 실행 경로 · 하위 권한', value: '표시 안 함', risk: '안전장치·비밀 값' },
    { layer: 'c', name: '웹 주소 여는 곳 · 열쇠', value: S.hosts || null, risk: '바깥 노출' },
  ]
  const setup = { layers: ux.settings_layers, writable: false, rows: allRows.filter((r) => ux.settings_layers.includes(r.layer)) }

  const bots = [...B.values()]
  // 응답 받침(봇 조건 1): task·게시판 줄 말고도 bot·sid·model·project·who·type 등 모든 글자 값을 safeText 로
  return scrubDeep({
    asOf: now, staleMin: Number.isFinite(S.staleMin) ? S.staleMin : null, days, ux,
    owner: { items, need, quotaLine },
    bots, sessions, graphSessions, projects, openBlocks, total,
    quota, ledger: null, approvals: null, setup,
    counts: { bots: bots.length, working: bots.filter((b) => b.state === 'busy' || (b.kidsStates.busy || 0) > 0).length,
      stale: bots.filter((b) => b.state === 'stale').length + sessions.filter((s) => s.state === 'stale').length, running: sessions.length },
  })
}
