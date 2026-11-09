// tools/web-board/handler.mjs — HTTP 처리기 = import 할 수 있는 순수 진입점
//
// 모듈을 읽을 때 하는 일 0(argv·파일·열쇠·망 손 0). server.mjs 가 열쇠 비교기·화면·두 JSON 만들기·읽기 상태·시계를
// 넣어 처리기를 만든다 → handler.test.mjs 가 socket 없이 합성 req/res 와 캐시 spy 로 실제 처리기를 시험한다.
// (10-31 봇 THREAT 해제 조건 2·3: 실제 처리기 행렬 · fatal = 고정 문구·코드, 자세한 오류는 서버 로컬 기록만)
import crypto from 'node:crypto'
import { routeOf, replyStatus, cleanLocation } from './lib.mjs'

export const SEC_HEADERS = Object.freeze({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'" })

const sha256 = (s) => crypto.createHash('sha256').update(s).digest()

// 열쇠 비교기: 열쇠 «지문»(sha256 32바이트)만 받는다 — 경로·파일은 안 받음(파일 읽기는 server.mjs readKey 한 곳)
export function keyChecker(keyHash) {
  if (!Buffer.isBuffer(keyHash) || keyHash.length !== 32) throw new Error('열쇠 지문 꼴이 아님(sha256 32바이트)')
  return (k) => typeof k === 'string' && k.length > 0 && crypto.timingSafeEqual(sha256(k), keyHash)
}

// 쿠키 열쇠: 깨진 % 꼴(«mhwb=%»)은 decodeURIComponent 가 던짐 → 요청 처리기 안에서 던지면 프로세스가 죽음 → 열쇠 없음으로
export function cookieKey(req) {
  const m = /(?:^|;\s*)mhwb=([^;]+)/.exec(String(req.headers.cookie || ''))
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return null }
}
export function bearer(req) {
  const m = /^Bearer\s+(.+)$/.exec(String(req.headers.authorization || ''))
  return m ? m[1].trim() : null
}

// fatal = 고정 문구 + 코드만 응답에. 오류 글(err.message — 절대경로·열쇠 꼴이 섞일 수 있음)은 log(서버 로컬)로만.
export const FATAL = Object.freeze({
  E_MOD_LOAD: 'MOD 함수 못 읽음 — 서버 기록을 보세요',
  E_MOD_CHANGED: 'MOD 판 바뀜 — 서버를 다시 켜야 같은 함수로 그림',
  E_NOT_READY: '아직 첫 읽기 전',
  E_BUILD: '화면 재료 만들기 실패 — 서버 기록을 보세요',
})
export function fatalBody(code) {
  const c = Object.prototype.hasOwnProperty.call(FATAL, code) ? code : 'E_BUILD'
  return { fatal: FATAL[c], code: c }
}

// 캐시 감싼 JSON: 같은 열쇠(읽기 차례·모드)면 한 번만 만든다 · fatalCode 가 있으면 build 를 부르지 않는다
export function cachedJson(cache, key, { fatalCode, build, log }) {
  if (cache.has(key)) return cache.get(key)
  let body
  if (fatalCode) body = fatalBody(fatalCode)
  else {
    try { body = build() } catch (err) {
      if (typeof log === 'function') log('화면 재료 만들기 실패: ' + String(err && err.stack || err))
      body = fatalBody('E_BUILD')
    }
  }
  const text = JSON.stringify(body)
  const res = { text, etag: '"' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 20) + '"' }
  cache.set(key, res)
  return res
}

// deps = { keyOk(k) → bool, page: string(/ 봇 새 화면), classic: string(/classic 10-31 판), stateJson(searchParams) → {text, etag}, boardJson() → {text, etag}, jobsJson() → {text, etag},
//          status() → { okAt, tickAt }, now() → ms, stallMs }
// 차례: 400(주소 못 읽음) → 405(GET·HEAD 밖) → ?key= (틀림 401 · 맞음 302+쿠키) → 401(쿠키·Bearer 둘 다 틀림 — 길보다 먼저)
//       → 200 화면 · 데이터 길 304/200 · 404. 미인증은 stateJson·boardJson 을 부르기 전에 끝난다(캐시 채움 0).
// HEAD = 본문 바이트를 res.end 에 넘기지 않음(node 도 HEAD 본문은 버림 — 시험이 «넘긴 바이트»를 그대로 묶도록 명시).
export function makeHandler({ keyOk, page, classic, stateJson, boardJson, jobsJson, status, now, stallMs }) {
  return function handler(req, res) {
    const send = (code, headers, body) => {
      res.writeHead(code, headers)
      return req.method === 'HEAD' || body == null ? res.end() : res.end(body)
    }
    let u
    try { u = new URL(req.url, 'http://x') } catch { return send(400, SEC_HEADERS) }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, SEC_HEADERS)
    const qk = u.searchParams.get('key')
    if (qk !== null) {
      // 주소창의 열쇠 = 쿠키로 옮기고 열쇠 없는 주소로 다시 보냄(주소·기록에 열쇠가 남지 않게)
      if (!keyOk(qk)) return send(401, { ...SEC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, '열쇠가 맞지 않음\n')
      u.searchParams.delete('key')
      return send(302, { ...SEC_HEADERS, 'Set-Cookie': 'mhwb=' + encodeURIComponent(qk) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000', Location: cleanLocation(u) })
    }
    const authed = keyOk(cookieKey(req)) || keyOk(bearer(req))
    const route = routeOf(u.pathname)
    if (replyStatus({ authed, route }) === 401) return send(401, { ...SEC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, '열쇠 필요\n')
    if (route === 'page' || route === 'classic') return send(200, { ...SEC_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }, route === 'page' ? page : classic)
    if (route === 'state' || route === 'board' || route === 'jobs') {
      const s = route === 'board' ? boardJson() : route === 'jobs' ? jobsJson() : stateJson(u.searchParams)
      const st = status()
      const hdr = { ...SEC_HEADERS, ETag: s.etag, 'X-Read-At': String(st.okAt), 'X-Tick-At': String(st.tickAt), 'X-Stalled': st.okAt && now() - st.okAt > stallMs ? '1' : '0',
        'Access-Control-Expose-Headers': 'X-Read-At, X-Tick-At, X-Stalled' }
      if (replyStatus({ authed, route, inm: req.headers['if-none-match'], etag: s.etag }) === 304) return send(304, hdr)
      return send(200, { ...hdr, 'Content-Type': 'application/json; charset=utf-8' }, s.text)
    }
    return send(404, SEC_HEADERS)
  }
}
