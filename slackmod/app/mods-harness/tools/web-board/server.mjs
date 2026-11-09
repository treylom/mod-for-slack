#!/usr/bin/env node
// tools/web-board/server.mjs — MOD 현황판을 웹 한 장으로 (읽기 전용 · node 표준 모듈만 · 1파일)
//
// 원칙(24-web-design 설계 메모): 화면을 다시 그리지 않는다. MOD 가 그릴 때 쓰는 함수(plugin src 의 ui/lib/*.js ·
// session/core.js)를 그대로 import 해서 같은 줄을 만들고, 그 줄(글자 조각 + MOD 색)을 웹 글자로 옮긴다.
// import 가 안 되거나 함수 모양이 다르면 화면 전체를 «MOD 함수 못 읽음»으로 세운다 — 자체 재구현으로 떨어지지 않는다.
//
// 읽는 것(쓰기 0): MOD 설정 파일(mods_config) · 등록부(registry.d) · live 파일 · 묶음 기록 · 숨긴 프로젝트 ·
// 게시판 · 대화 기록 꼬리(«지금» 칸). 쓰는 것: pid_file 하나(설정에 있을 때만).
// 여는 곳: host 목록(127.0.0.0/8 · 100.64.0.0/10 = host 만 허락 · 0.0.0.0/:: 거절) · 모든 길 열쇠 필요(없으면 401).
//
// 웹이 MOD 와 «설계된 다름»(설계 메모 ★): 멈춤(× 응답 없음 → 회색 «멈춤») · «답 기다림» · 서브 돌면 작업 중(플러그인에
// workingState 없을 때만 같은 규칙을 live 사본에 먼저 적용) · 전 가족·전 서브 펼침 · 프로젝트 상세 상시 펼침 ·
// «끝난 프로젝트» 칸 · «지금» 한 칸 · 마지막 시각 · 미관측.

import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync, execFile } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { hostAllowed, busyFallback, lastTool, boardModel, boardInputOf, uxOf, maskSecret, maskEntry, maskLive, maskBoard, scrubDeep, kstDay } from './lib.mjs'
import { makeHandler, keyChecker, cachedJson } from './handler.mjs'
import { parseRoomSpec, rosterOf, withOwners, pickRooms, jobsModel, threadUrlOf, relink, WORKSPACE_RX, displayNameOf, hideWordsDeep, displayOf, usageOf, closedOf, autoTitle, aboutOf, followTokens, parseFind, parseShow, followupsModel, kstIso, threadTsOf, projgraphModel, kpiRowOf, historyPut, historyOf } from './jobs.mjs'
import { setupSteps, parseEnvStatus } from './setup.mjs'

// ── 설정 ──
function argOf(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : null
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONF_PATH = argOf('--config')
if (!CONF_PATH) { console.error('쓰는 법: node server.mjs --config web.json'); process.exit(2) }
const HOME = os.homedir()
const exp = (p) => (typeof p === 'string' ? p.replace(/^~(?=\/|$)/, HOME).replace(/^\$HOME(?=\/|$)/, HOME) : p)
const CONF = JSON.parse(fs.readFileSync(CONF_PATH, 'utf8'))
const OPT = {
  pluginSrc: exp(CONF.plugin_src || path.join(HERE, '..', '..', 'src')),
  modsConfig: exp(CONF.mods_config || process.env.MODS_HARNESS_CONFIG || ''),
  hosts: Array.isArray(CONF.host) ? CONF.host : [CONF.host || '127.0.0.1'],
  port: Number.isInteger(CONF.port) ? CONF.port : 8794,
  pollMs: Number.isInteger(CONF.poll_ms) && CONF.poll_ms >= 2000 ? CONF.poll_ms : 10000,
  keyFile: exp(CONF.key_file || ''),
  transcriptsRoot: exp(CONF.transcripts_root || '~/.claude/projects'),
  pidFile: exp(CONF.pid_file || ''),
  stallMs: 60000,
  // 10-31 UX 판 세 칸(시안 설계 메모 · 주인 답 전 기본값): owner_turn_quota · project_graph_scope · settings_layers (lib.mjs uxOf)
  ux: uxOf(CONF),
  // 11-01 봇 새 화면(/ · /api/jobs): 회의방 폴더(01-spec 의존 그래프 · 읽기만) · 봇 명부(담당 이름 찾기 · 읽기만) — 없으면 방 0개 · 담당 미상
  roomsRoot: exp(CONF.rooms_root || ''),
  rosterFile: exp(CONF.roster_file || ''),
  roomsDays: Number.isInteger(CONF.rooms_days) && CONF.rooms_days > 0 ? CONF.rooms_days : 31,
  roomsMax: Number.isInteger(CONF.rooms_max) && CONF.rooms_max > 0 ? CONF.rooms_max : 40,
  botNames: CONF.bot_names && typeof CONF.bot_names === 'object' && !Array.isArray(CONF.bot_names) ? CONF.bot_names : {}, // 명부에 없는 봇 키 → 화면 이름(예: jobs → 봇)
  // 11-03 방 스레드 링크: Slack 워크스페이스 주소(https://<이름>.slack.com) — 설정에서만 · 없거나 꼴이 틀리면 기록된 주소만 씀(jobs.mjs threadUrlOf)
  slackWorkspaceUrl: typeof CONF.slack_workspace_url === 'string' && WORKSPACE_RX.test(CONF.slack_workspace_url.replace(/\/+$/, '')) ? CONF.slack_workspace_url.replace(/\/+$/, '') : '',
  hideWords: Array.isArray(CONF.hide_words) ? CONF.hide_words.filter((w) => typeof w === 'string') : [], // 화면 글에서 지울 낱말(계정 이름 등)
  setupRoot: exp(CONF.setup_root || ''), // 11-03 /api/jobs setup 칸 = SlackMod 설치 루트(slackmod board start 가 씀) · 없으면 setup = null
  usagePollMs: Number.isInteger(CONF.usage_poll_ms) && CONF.usage_poll_ms >= 2000 ? CONF.usage_poll_ms : 30000, // 11-04 /api/jobs usage 칸 읽기 주기(패널 «Claude · usage» 와 같은 30초 · 시험만 줄임)
  displayText: CONF.display_text === undefined ? null : CONF.display_text, // 11-03 /api/jobs display 칸 = 방 제목·노드 글·되돌이 선 표시 글(주인 설정 · 기본 null)
  // 11-08: 숨길 봇(키 또는 별칭 · 명부 은퇴·멈춤 꼴은 설정 없이도 숨김) · «이게 뭔가» 글(플러그인 ui.about 이 없을 때) — jobs.mjs botHidden · aboutOf
  hideBots: Array.isArray(CONF.hide_bots) ? CONF.hide_bots.filter((w) => typeof w === 'string' && w) : [],
  glossary: CONF.glossary && typeof CONF.glossary === 'object' && !Array.isArray(CONF.glossary) ? CONF.glossary : null, // 11-08 노드 글 주인 낱말표 { 낱말: 풀이 } (jobs.mjs plainLabel)
  about: CONF.about && typeof CONF.about === 'object' && !Array.isArray(CONF.about) ? CONF.about : null,
  // 11-08 로그인 직후 host 주소가 아직 없을 때(EADDRNOTAVAIL) 기다릴 상한 — 넘으면 rc 75(launchd 가 다시 켬) · 시험만 줄임
  listenWaitMs: Number.isInteger(CONF.listen_wait_ms) && CONF.listen_wait_ms >= 0 ? CONF.listen_wait_ms : 90000,
  // 11-09 «회의 결정 후속» 칸: 할 일 목록 읽기 명령(절대 경로 배열 · 예: ["/usr/bin/python3", "/path/to/tasks-cli"] · 하위 명령 find·show 를 받는 도구) — 없으면 칸 없음(followups = null)
  followups: followOpt(CONF.followups),
  // 11-09 숫자 칸 하루 1행 기록(③) 파일 = 설정 history_file · 없으면 pid_file 옆 «jobs-history.json»(웹 상태 폴더 · 설정 손 0) · 둘 다 없으면 기록 안 함(history = null)
  historyFile: exp(CONF.history_file || (CONF.pid_file ? path.join(path.dirname(exp(CONF.pid_file)), 'jobs-history.json') : '')),
  historyMs: Number.isInteger(CONF.history_ms) && CONF.history_ms >= 2000 ? CONF.history_ms : 300000, // 보는 사람이 없어도 그날 행을 남기는 주기 · 파일 쓰기 최소 간격(시험만 줄임)
}

function followOpt(f) {
  if (!f || typeof f !== 'object' || !Array.isArray(f.cmd) || !f.cmd.length || !f.cmd.every((x) => typeof x === 'string' && x)) return null
  const cmd = f.cmd.map(exp)
  if (!path.isAbsolute(cmd[0])) return null // launchd 아래 PATH 는 짧음 — 이름만 쓴 명령은 받지 않음
  return { cmd, days: Number.isInteger(f.days) && f.days > 0 ? f.days : 14, pollMs: Number.isInteger(f.poll_ms) && f.poll_ms >= 10000 ? f.poll_ms : 300000 }
}
for (const h of OPT.hosts) {
  if (!hostAllowed(h)) { console.error('거절: host ' + h + ' — 127.0.0.1 또는 host(100.64.0.0/10) 주소만'); process.exit(2) }
}

// 열쇠: 파일(0600)에서만 읽음 · 값은 어디에도 찍지 않음.
function readKey() {
  if (!OPT.keyFile) { console.error('거절: key_file 없음 — 열쇠 없이는 안 뜸'); process.exit(2) }
  const st = fs.statSync(OPT.keyFile)
  if ((st.mode & 0o077) !== 0) { console.error('거절: 열쇠 파일 권한이 넓음(0600 이어야)'); process.exit(2) }
  const k = fs.readFileSync(OPT.keyFile, 'utf8').trim()
  if (k.length < 24) { console.error('거절: 열쇠가 짧음(24자+)'); process.exit(2) }
  return crypto.createHash('sha256').update(k).digest()
}
const keyOk = keyChecker(readKey()) // 비교기 = handler.mjs(시험이 메모리 속 가짜 열쇠로 같은 비교기를 씀)

// ── MOD 함수 import (재구현 0) ──
const NEED = {
  'ui/lib/tree.js': ['paneTree', 'flatten', 'aliveAfterEnd', 'familyOf', 'splitFamilies', 'othersHead', 'meFirst', 'parseEntry', 'parseLive', 'stateOf', 'LOOK'],
  // 11-09 «봇 · 프로젝트» 줄기(A안): 세션 단위 막힘 · _boards 게시판 · 세션 예약 3등급 · 마디·묶음 — MOD project.js 에 이 이름이 먼저 설치돼 있어야 함(없으면 E_MOD_LOAD)
  'ui/lib/project.js': ['projectGroups', 'withThreadGroups', 'shownGroups', 'projectLines', 'endedToday', 'boundThreads', 'boundProjectOf', 'childProjects', 'endedProject', 'projectKeyOf',
    'blockedSessions', 'blockedAcross', 'newlyBlocked', 'boardRoomOf', 'placesLinkFree', 'sessionLoops', 'sessionLive', 'graphData', 'graphGroups', 'loopGrade'],
  'ui/lib/agents.js': ['shownAgents', 'parseAgents', 'mergeThreads'],
  'ui/lib/legend.js': ['paneHead', 'LEGEND'],
  'ui/lib/settings.js': ['uiSettings'],
  'ui/lib/display.js': ['setBotDisplay', 'botShown'],
  'ui/lib/text.js': ['paneLook', 'segText', 'wrapSegments'],
  'ui/lib/band.js': ['paneLines', 'backHead'],
  'session/core.js': ['labelOk', 'boardRoom', 'boardPath', 'parseBoard', 'boardSummary', 'projectLabel', 'foldBindings', 'parseHidden', 'autoBoardPlaces'],
}
const M = {}
// FATAL = 고정 코드(handler.mjs FATAL 표)만 — 자세한 오류는 서버 로컬 기록(console.error)으로만, 응답엔 안 실림(10-31 봇 조건 3)
let FATAL = null
const logLocal = (s) => console.error('[web-board] ' + s)
let HAS_WORKING = false
// 11-03 판 바뀜 = 깨끗이 끝내고 launchd(KeepAlive SuccessfulExit=false + 래퍼)가 다시 켬 — 이 코드만 다시 켬(거절 rc 2 · 죽음 = 안 켬)
// 75 = sysexits EX_TEMPFAIL(«잠깐 실패 · 다시 하면 됨») · 1(죽음)·2(거절)와 겹치지 않음
const RESTART_RC = 75
const SERVERS = []
const SOCKS = new Set() // 열린 연결(끝낼 때 하나씩 «응답 다 보낸 뒤» 닫음)
let TIMER = null
let USAGE_TIMER = null
let FOLLOW_TIMER = null
let HISTORY_TIMER = null
let STOPPING = false
// 연결 하나 닫기: 지금 응답이 아직 안 끝났으면 끝날 때까지 기다림 → 다음 요청은 http 층에 안 넘김 → end() = 쌓인 바이트를 다 보낸 뒤 FIN
// (http.Server.close 는 node 19+ 에서 «end() 부른 응답»의 연결을 destroy 해 아직 못 보낸 바이트를 자름 — 독립 재검 verify-1 FIX-1 실측 · 그래서 net 의 close + 여기)
// 들어오는 바이트는 «안 읽음»이 아니라 «읽어서 버림»(11-03 실측 · 옛 판 = pause): 안 읽으면 ① 상대 FIN 을 못 봐 연결 close·122줄 콜백이 안 오고,
// 마지막 바이트가 커널로 넘어간 순간 고리가 비어 115줄 코드로 저절로 끝남 ② 그때 받기 버퍼에 남은 요청(http 역압으로 못 읽은 것) 때문에 커널이 FIN 대신 RST
// → 상대가 아직 못 읽은 응답 꼬리가 버려짐(«시작된 응답 n 중 다 온 것 n-1») · 시험 = restart.test «받기 버퍼에 남아 있어도 FIN»
function settle(sock) {
  const res = sock._httpMessage
  if (res && !res.writableEnded) { res.once('finish', () => settle(sock)); return }
  sock.removeAllListeners('data') // http 층의 요청 읽기(다음 요청 처리)를 뗌
  sock.on('data', () => {}) // 버림 · http 가 소켓에 씌운 on() 이 'data' 듣는 이를 보면 parser 의 직접 읽기(consume)를 풂
  sock.resume()
  if (sock._handle && !sock._handle.reading) { sock._handle.reading = true; sock._handle.readStart() } // http 역압이 멈춘 읽기는 resume() 만으로 안 켜짐(11-03 실측 · node 25)
  sock.end()
}
function shutdown(code, waitMs) {
  if (STOPPING) return
  STOPPING = true
  process.exitCode = code // close 콜백이 안 와도 고리가 비면 이 코드로 끝남
  if (TIMER) clearInterval(TIMER)
  if (USAGE_TIMER) clearInterval(USAGE_TIMER)
  if (HISTORY_TIMER) clearInterval(HISTORY_TIMER)
  try { historyFlush(true) } catch { /* 기록 못 씀 = 끝내기는 그대로 */ }
  if (OPT.pidFile) { try { if (fs.readFileSync(OPT.pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(OPT.pidFile) } catch { /* 없음 */ } }
  const done = () => process.exit(code)
  let left = SERVERS.length
  if (!left) return done()
  setTimeout(done, waitMs).unref() // 상한: 안 읽는 상대·반쯤 온 요청이 끝내기를 붙잡지 못하게
  for (const s of SERVERS) net.Server.prototype.close.call(s, () => { if (--left === 0) done() }) // 새 연결만 멈춤(연결 destroy 0) · 마지막 연결이 닫히면 콜백
  for (const sock of SOCKS) settle(sock)
}
const COMMIT_FILE = path.join(OPT.pluginSrc, '..', '.org-commit')
const readCommit = () => { try { return fs.readFileSync(COMMIT_FILE, 'utf8').trim() } catch { return null } }
const COMMIT0 = readCommit()
async function loadMod() {
  try {
    for (const [f, names] of Object.entries(NEED)) {
      const mod = await import(pathToFileURL(path.join(OPT.pluginSrc, f)).href)
      for (const n of names) {
        if (!(n in mod)) throw new Error(f + ' 에 ' + n + ' 없음')
        M[n] = mod[n]
      }
      if (f === 'ui/lib/agents.js') HAS_WORKING = typeof mod.workingState === 'function'
    }
    if (Object.isFrozen(M.LOOK) || Object.isFrozen(M.LOOK.stale)) throw new Error('LOOK 이 얼어 있음')
  } catch (err) {
    FATAL = 'E_MOD_LOAD'
    logLocal('MOD 함수 못 읽음: ' + String(err && err.stack || err))
  }
}

// ── 설계된 다름 ①② : 멈춤 · 답 기다림 (LOOK 와 범례 글자만 이 프로세스 메모리 안에서 · 파일 손 0) ──
const WEB_LOOK = { stale: { word: '멈춤', color: 'dim' }, waiting: { word: '답 기다림' } }
function withLook(web, fn) {
  if (!web) return fn()
  const saved = []
  const put = (obj, k, v) => { saved.push([obj, k, obj[k]]); obj[k] = v }
  for (const [state, patch] of Object.entries(WEB_LOOK)) {
    const look = M.LOOK[state]
    for (const [k, v] of Object.entries(patch)) put(look, k, v)
    // legend.js 의 LEGEND 는 모듈을 읽을 때 낱말을 글자로 복사해 둠 — 같은 칸을 함께 바꿔야 범례가 화면과 맞음
    for (const it of M.LEGEND) {
      if (Array.isArray(it.parts) && it.parts[0] && it.parts[0][1] === look && it.parts[1]) {
        put(it, 'parts', [it.parts[0], [patch.word || it.parts[1][0]], ...it.parts.slice(2)])
        put(it, 'text', it.parts.map((p) => p[0]).join(''))
      }
    }
  }
  try { return fn() } finally { for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v] = saved[i]; o[k] = v } }
}


// ── 읽기(바뀐 파일만) ──
const ST = {
  cfg: null, cfgKey: null,
  entries: new Map(), lives: new Map(), // 파일 이름 → { key, val }
  archive: new Map(), archiveDir: null, // 11-09 등록부 보관 폴더(끝난 지 오래된 하위 행) · 캐시 따로 · 14일 칸 재료만(boardEntries)
  bindings: null, bindKey: null, hidden: {}, hidKey: null,
  boards: new Map(), boardFiles: new Map(), rooms: new Map(), notePaths: new Map(),
  tx: new Map(), txPath: new Map(), txScanAt: 0,
  okAt: 0, tickAt: 0, seq: 0, err: null, commitNow: COMMIT0,
  setup: null, // 11-03 설치 단계 판정 { at, val } · 30초 묵힘(env-status 를 봇마다 부름)
  specs: new Map(), roster: null, rosterKey: null, // 봇 화면: 방 이름 → { key, val(파싱한 방 | null) } · 명부
}
const stamp = (st) => st.mtimeMs + ':' + st.size
function statOr(p) { try { return fs.statSync(p) } catch { return null } }

function readDir(dir, cache, parse, oldMs) {
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')) } catch { names = [] }
  const keep = new Set(names)
  for (const k of [...cache.keys()]) if (!keep.has(k)) cache.delete(k)
  for (const n of names) {
    const st = statOr(path.join(dir, n))
    if (!st) continue
    if (Number.isFinite(oldMs) && st.mtimeMs < oldMs) { cache.delete(n); continue } // 보관 폴더만: 14일 칸에 못 드는 옛 파일 = 안 읽음
    const had = cache.get(n)
    if (had && had.key === stamp(st)) continue
    try {
      const v = parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      if (v) cache.set(n, { key: stamp(st), val: v })
    } catch { /* 찢긴 파일: 마지막 좋은 것 유지 */ }
  }
}

function readCfg() {
  const st = statOr(OPT.modsConfig)
  if (!st) { if (!ST.cfg) ST.cfg = M.uiSettings(null, HOME); return }
  if (ST.cfgKey === stamp(st)) return
  const raw = JSON.parse(fs.readFileSync(OPT.modsConfig, 'utf8'))
  ST.cfg = M.uiSettings(raw, HOME)
  M.setBotDisplay(ST.cfg.botDisplay)
  ST.archiveDir = archiveDirOf(raw, ST.cfg.registryDir)
  ST.cfgKey = stamp(st)
}

// ── 11-09 지난 기록(주인 «이대로 ㄱㄱ.» · 14일 앞 칸 ≈0 고침) ──
// MOD 는 끝난 지 archive_after_days(기본 3일) 지난 하위 행을 등록부(registry.d)에서 보관 폴더로 옮김(같은 파일 이름 · core.js archiveDue).
// 이 서버는 등록부만 읽어 14일 칸 앞 날이 0 으로 보였음 → 보관 폴더도 같은 M.parseEntry 로 읽음(캐시 따로 · 읽기만).
// 보관 폴더 자리 = MOD 와 같은 규칙(core.js: session.registry_archive_dir · 없으면 registry_dir 옆 «registry-archive»)
//   — uiSettings 엔 이 칸이 없어 설정 원문에서 읽음(NEED 표 손 0) · 설정 파일이 없으면 기본 등록부 옆
const siblingDir = (dir, name) => String(dir || '').replace(/\/+$/, '').replace(/\/[^/]*$/, '') + '/' + name
function archiveDirOf(raw, registryDir) {
  const s = raw && typeof raw === 'object' && raw.session && typeof raw.session === 'object' ? raw.session.registry_archive_dir : null
  return typeof s === 'string' && s ? exp(s) : registryDir ? siblingDir(registryDir, 'registry-archive') : null
}
// 옛 파일 거름: 행 파일을 마지막으로 쓴 때 ≥ 그 행의 시작·끝 시각 → (14+1)일보다 오래전에 마지막으로 쓴 파일은 14일 칸 어디에도 못 듦(실측 대조 = 결과 파일)
const ARCHIVE_KEEP_MS = 15 * 86400e3
// /api/board · /api/jobs 의 boardModel 두 곳에만 넣는 행 = 등록부 + 보관(같은 id = 등록부 행 우선 · 살아 있는 판이 최신)
//   나무(/api/state)·줄기(projgraph)·후속·게시판 읽기(refreshBoards)엔 안 넣음 — 끝난 지 오래된 행이 «지금» 칸을 바꾸지 않게
function boardEntries() {
  const out = [...ST.entries.values()].map((x) => x.val)
  const ids = new Set(out.map((e) => e && e.id))
  for (const x of ST.archive.values()) {
    const e = x.val
    if (!e || typeof e.id !== 'string' || ids.has(e.id)) continue
    ids.add(e.id)
    out.push(e)
  }
  return out
}

function readText(p, keyName, parse, empty) {
  if (!p) { ST[keyName] = null; return empty }
  const st = statOr(p)
  if (!st) { ST[keyName] = null; return empty }
  if (ST[keyName] === stamp(st)) return undefined
  const v = parse(fs.readFileSync(p, 'utf8'))
  ST[keyName] = stamp(st)
  return v
}

// 봇 화면 방(읽기만): rooms_root 바로 아래 «YYYY-MM-DD-…» 폴더 중 최근 rooms_days 일 · 최대 rooms_max 개의 01-spec.md(바뀐 파일만 다시 읽음)
function refreshRooms() {
  if (OPT.rosterFile) {
    const st = statOr(OPT.rosterFile)
    if (!st) { ST.roster = null; ST.rosterKey = null } else if (ST.rosterKey !== stamp(st)) { ST.roster = rosterOf(fs.readFileSync(OPT.rosterFile, 'utf8')); ST.rosterKey = stamp(st) }
  }
  if (!OPT.roomsRoot) return
  let names = []
  try { names = fs.readdirSync(OPT.roomsRoot) } catch { return }
  const pick = new Set(pickRooms(names, Date.now(), OPT.roomsDays, OPT.roomsMax))
  for (const k of [...ST.specs.keys()]) if (!pick.has(k)) ST.specs.delete(k)
  for (const n of pick) {
    const p = path.join(OPT.roomsRoot, n, '01-spec.md')
    let dl = null, st = null
    try { dl = fs.lstatSync(path.join(OPT.roomsRoot, n)); st = fs.lstatSync(p) } catch { dl = null; st = null }
    // 링크 안 따라감(방 폴더·01-spec 둘 다) · 1MB 넘는 글 건너뜀 — 읽는 곳이 rooms_root 밖으로 새지 않게
    if (!dl || !dl.isDirectory() || !st || !st.isFile() || st.size > 1048576) { ST.specs.delete(n); continue }
    // 스레드 링크 재료(11-03): 00-context 전문 · 02 앞 8KB(개설 줄) — 같은 받침(링크 안 따라감 · 1MB) · 02 는 붙여 쓰기만 하므로 키 = 파일 번호(내용 바뀜 ❌)
    // 11-08 닫힘 판정 재료: 02 전문(4MB 받침 · 넘으면 끝 1MB — 닫힘 줄은 끝에 붙음) · 03 결과 문서 머리 — 02 는 붙여 쓰기라 열쇠 = 크기·시각(예전 «내용 바뀜 ❌» 열쇠면 켠 뒤 닫힌 방이 영영 진행 중)
    const cp = path.join(OPT.roomsRoot, n, '00-context.md'), pp = path.join(OPT.roomsRoot, n, '02-progress.md'), op = path.join(OPT.roomsRoot, n, '03-outcome.md')
    let cst = null, pst = null, ost = null
    try { cst = fs.lstatSync(cp); if (!cst.isFile() || cst.size > 1048576) cst = null } catch { cst = null }
    try { pst = fs.lstatSync(pp); if (!pst.isFile()) pst = null } catch { pst = null }
    try { ost = fs.lstatSync(op); if (!ost.isFile() || ost.size > 1048576) ost = null } catch { ost = null }
    const hand = handTitle(n)
    const key = [stamp(st), cst ? stamp(cst) : '-', pst ? pst.ino + ':' + stamp(pst) : '-', ost ? stamp(ost) : '-', hand || '-'].join('|')
    const had = ST.specs.get(n)
    if (had && had.key === key) continue
    try {
      const text = fs.readFileSync(p, 'utf8'), g = parseRoomSpec(text, n)
      if (g && g.nodes.length) {
        let head = '', prog = ''
        if (pst) {
          const fd = fs.openSync(pp, 'r')
          try {
            const MAXP = 4 * 1048576, from = pst.size > MAXP ? pst.size - 1048576 : 0, len = Math.min(pst.size, MAXP)
            const b = Buffer.alloc(len), got = fs.readSync(fd, b, 0, len, from)
            prog = b.subarray(0, got).toString('utf8')
            if (from === 0) head = prog.slice(0, 8192)
            else { const hb = Buffer.alloc(8192); head = hb.subarray(0, fs.readSync(fd, hb, 0, 8192, 0)).toString('utf8') }
          } finally { fs.closeSync(fd) }
        }
        const ctx = cst ? fs.readFileSync(cp, 'utf8') : ''
        g.thread_url = threadUrlOf({ context: ctx, spec: text, progressHead: head, workspace: OPT.slackWorkspaceUrl })
        const c = closedOf({ progress: prog, outcome: ost ? fs.readFileSync(op, 'utf8') : '' })
        g.closed = c.closed
        g.closed_by = c.by
        g.name = hand || autoTitle({ context: ctx, spec: text })
      }
      ST.specs.set(n, { key, val: g && g.nodes.length ? g : null })
    } catch { /* 찢긴 파일: 마지막 좋은 것 유지 */ }
  }
}
// 손으로 쓴 방 제목(web.json display_text.titles · 덮어쓰기용) — 없으면 자동 한글 제목(jobs.mjs autoTitle)
function handTitle(room) {
  const t = OPT.displayText && typeof OPT.displayText === 'object' && OPT.displayText.titles && typeof OPT.displayText.titles === 'object' && Object.prototype.hasOwnProperty.call(OPT.displayText.titles, room) ? OPT.displayText.titles[room] : null
  return typeof t === 'string' && t.trim() ? t.trim() : null
}
// ── 11-09 «회의 결정 후속»: 닫힌 회의 방(03-outcome 있음 · 최근 days 일) × 팀(읽기 명령 find · show 출력만) ──
// 주기 = followups.poll_ms(기본 5분) · 서버 본 고리 밖(비동기 · 한 번에 한 바퀴) · 실패 = 마지막 좋은 값 유지 + 로컬 기록 1줄
function ledgerRun(args) {
  const F = OPT.followups
  return new Promise((ok) => execFile(F.cmd[0], [...F.cmd.slice(1), ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1048576, cwd: path.dirname(F.cmd[F.cmd.length - 1]) },
    (err, out) => ok(err ? null : String(out || ''))))
}
function readHead(p, max) {
  try { const st = fs.lstatSync(p); if (!st.isFile()) return ''; const fd = fs.openSync(p, 'r'); try { const b = Buffer.alloc(Math.min(st.size, max)); return b.subarray(0, fs.readSync(fd, b, 0, b.length, 0)).toString('utf8') } finally { fs.closeSync(fd) } } catch { return '' }
}
function followRooms() {
  if (!OPT.roomsRoot) return []
  let names = []
  try { names = fs.readdirSync(OPT.roomsRoot) } catch { return [] }
  const out = []
  for (const n of pickRooms(names, Date.now(), OPT.followups.days, 80)) {
    const d = path.join(OPT.roomsRoot, n)
    let dl = null, ol = null
    try { dl = fs.lstatSync(d); ol = fs.lstatSync(path.join(d, '03-outcome.md')) } catch { continue }
    if (!dl.isDirectory() || !ol.isFile() || ol.size === 0) continue // 03 결과 문서가 있는 방만(닫힌 회의)
    const ctx = readHead(path.join(d, '00-context.md'), 1048576), spec = readHead(path.join(d, '01-spec.md'), 1048576), head = readHead(path.join(d, '02-progress.md'), 8192)
    out.push({ room: n, name: handTitle(n) || autoTitle({ context: ctx, spec }), thread_url: threadUrlOf({ context: ctx, spec, progressHead: head, workspace: OPT.slackWorkspaceUrl }), thread_ts: threadTsOf({ context: ctx, progressHead: head }) })
  }
  return out
}
async function refreshFollowups() {
  if (!OPT.followups || ST.followBusy) return
  ST.followBusy = true
  try {
    const rooms = followRooms(), ids = new Set()
    let bad = 0
    for (const r of rooms) for (const t of followTokens(r)) { const o = await ledgerRun(['find', t]); if (o === null) bad++; else for (const i of parseFind(o)) ids.add(i) }
    const rows = []
    for (const i of [...ids].sort()) { const o = await ledgerRun(['show', i]); const r = o === null ? null : parseShow(o); if (r) rows.push(r); else bad++ }
    if (bad && !rows.length && ids.size) throw new Error('읽기 명령 실패 ' + bad)
    ST.follow = { at: Date.now(), rooms, rows, bad }
    ST.seq += 1
  } catch (e) { logLocal('회의 결정 후속 읽기 실패(마지막 좋은 값 유지): ' + String(e && e.message || e).slice(0, 120)) }
  finally { ST.followBusy = false }
}
function followupsNow() {
  if (!OPT.followups) return null
  if (!ST.follow) return { ready: false, rooms: [] }
  const val = followupsModel({ rooms: ST.follow.rooms, rows: ST.follow.rows, now: Date.now(), roster: ST.roster, names: OPT.botNames, hideBots: OPT.hideBots, hide: OPT.hideWords })
  return { ready: true, at: kstIso(ST.follow.at), days: OPT.followups.days, read_errors: ST.follow.bad, rooms: val }
}
function roomsNow() {
  return [...ST.specs.keys()].sort().map((n) => ST.specs.get(n).val).filter(Boolean).map((g) => withOwners(g, ST.roster))
}

// 게시판 수(index.js refreshBoards 모양 그대로 · core.js 함수로)
function roomExists(root, name) {
  const hit = ST.rooms.get(name)
  if (hit && Date.now() - hit.at < 60000) return hit.ok
  const ok = fs.existsSync(path.join(root, name))
  ST.rooms.set(name, { ok, at: Date.now() })
  return ok
}
function readBoardNote(p) {
  const st = statOr(p)
  if (!st) { ST.boardFiles.delete(p); return null }
  const had = ST.boardFiles.get(p)
  if (had && had.mtimeMs === st.mtimeMs) return had
  try {
    const rec = { mtimeMs: st.mtimeMs, entries: M.parseBoard(fs.readFileSync(p, 'utf8')) }
    ST.boardFiles.set(p, rec)
    return rec
  } catch {
    return had ? { ...had, error: true } : { mtimeMs: st.mtimeMs, entries: [], error: true }
  }
}
// 11-09 링크 검사(MOD index.js linkedPlaces 와 같은 뜻 · 셸 실행 0): 자리마다 fs.lstatSync(p).isSymbolicLink() → 링크인 자리 Set ·
// 없는 자리(ENOENT·ENOTDIR) = 링크 아님 · 그 밖 오류 = 답 없음(null) → 그 라운드 auto 게시판 전부 안 읽음(placesLinkFree 가 거부)
function linkedPlaces(places) {
  const links = new Set()
  for (const p of places) {
    try { if (fs.lstatSync(p).isSymbolicLink()) links.add(p) } catch (e) { if (!e || (e.code !== 'ENOENT' && e.code !== 'ENOTDIR')) return null }
  }
  return links
}
// 11-09 (MOD index.js refreshBoards 2b3e7a1 와 같은 길): 날짜 방이 없으면 auto 게시판 <board_root>/_boards/<이름>(project.js boardRoomOf) ·
// auto 게시판은 가는 길에 링크가 하나라도 있으면 안 읽음(placesLinkFree) · counts.openBlocks = 막힌 세션 수(blockedAcross · sessionLive) · openList = 그 세션들.
// ST.notePaths(/api/board · 14일 · 봇 7일 막힘의 재료) = 날짜 방 경로만 — 11-09 전과 같은 값(auto 게시판 줄을 14일 숫자에 섞지 않음)
function refreshBoards(entries, lives) {
  const cfg = ST.cfg.board
  const byProject = new Map()
  if (!cfg.board_root) { ST.boards = byProject; return }
  const notes = new Map() // project → Set(path) · ◈ 수 · 줄기 그림
  const dated = new Map() // project → Set(path) · 날짜 방만(/api/board · 14일)
  const autoPlaces = new Map() // auto 게시판 경로 → 가는 길의 자리(core.js autoBoardPlaces)
  for (const e of entries) {
    if (!e || e.role !== 'child' || typeof e.parent_id !== 'string' || !e.parent_id || !M.labelOk(e.project)) continue
    const project = M.projectLabel(cfg.projects, e.project)
    const have = new Set()
    for (const n of [project, cfg.project_rooms[project]]) if (n && roomExists(cfg.board_root, n)) have.add(n)
    const pick = M.boardRoomOf(project, cfg, (n) => have.has(n))
    if (!notes.has(project)) { notes.set(project, new Set()); dated.set(project, new Set()) }
    if (!pick || typeof pick.room !== 'string') continue
    const p = M.boardPath(cfg, pick.room, e.parent_id, project)
    notes.get(project).add(p)
    if (pick.auto) autoPlaces.set(p, M.autoBoardPlaces(cfg, pick.room, p))
    else dated.get(project).add(p)
  }
  const links = autoPlaces.size ? linkedPlaces([...new Set([...autoPlaces.values()].flat())]) : null
  const rowById = new Map()
  for (const e of entries) if (e && typeof e.id === 'string') rowById.set(e.id, e)
  const isLive = (id) => M.sessionLive(rowById.get(id) || null, (lives && lives.get(id)) || null)
  for (const [project, paths] of notes) {
    const c = { decisions: 0, blocks: 0, questions: 0, open: 0, openBlocks: 0 }
    const lists = []
    let found = 0
    let error = false
    let last = []
    for (const p of paths) {
      if (autoPlaces.has(p) && !M.placesLinkFree(autoPlaces.get(p), links)) continue
      const rec = readBoardNote(p)
      if (!rec) continue
      found++
      if (rec.error) error = true
      const sum = M.boardSummary(rec.entries, 0)
      c.decisions += sum.decisions.length
      c.blocks += sum.blocks.length
      c.questions += sum.questions
      c.open += sum.openQuestions
      lists.push(rec.entries)
      last = [...last, ...rec.entries.slice(-3)]
    }
    const openList = M.blockedAcross(lists, isLive)
    c.openBlocks = Array.isArray(openList) ? openList.length : 0
    last.sort((a, b) => String(a.at).localeCompare(String(b.at)))
    byProject.set(project, found ? { status: error && !c.decisions && !c.blocks && !c.questions ? 'error' : 'ok', counts: c, last: last.slice(-3), openList: Array.isArray(openList) ? openList : [] } : { status: 'none' })
  }
  ST.boards = byProject
  ST.notePaths = dated // 10-31 UX 판: 어느 게시판 노트가 어느 프로젝트 것인지(/api/board 의 막힘·마지막 줄) — 날짜 방만(11-09 전과 같음)
}
function boardOf(project) {
  if (!ST.cfg || !ST.cfg.board || !ST.cfg.board.board_root) return { status: 'unset' }
  return ST.boards.get(project) || { status: 'none' }
}

// ── «지금» 한 칸 (웹 덧 · 대화 기록 꼬리만 읽음 · 토큰 0) ──
function tailOf(p, size, bytes) {
  const fd = fs.openSync(p, 'r')
  try {
    const n = Math.min(size, bytes)
    const buf = Buffer.alloc(n)
    fs.readSync(fd, buf, 0, n, size - n)
    return buf.toString('utf8')
  } finally { fs.closeSync(fd) }
}
function txPathOf(uuid) {
  if (ST.txPath.has(uuid)) return ST.txPath.get(uuid)
  return null
}
function scanTranscripts(uuids) {
  const want = uuids.filter((u) => !ST.txPath.has(u))
  if (!want.length || Date.now() - ST.txScanAt < 60000) return
  ST.txScanAt = Date.now()
  let dirs = []
  try { dirs = fs.readdirSync(OPT.transcriptsRoot) } catch { dirs = [] }
  for (const u of want) {
    if (!/^[0-9a-f-]{36}$/.test(u)) continue
    for (const d of dirs) {
      const p = path.join(OPT.transcriptsRoot, d, u + '.jsonl')
      if (fs.existsSync(p)) { ST.txPath.set(u, p); break }
    }
  }
}
function refreshNow(entries, lives) {
  const uuids = new Set()
  for (const e of entries) {
    const lv = lives.get(e.id)
    const u = (lv && lv.session_uuid) || e.session_uuid
    if (typeof u === 'string' && e.status !== 'ended' && e.status !== 'failed') uuids.add(u)
  }
  scanTranscripts([...uuids])
  for (const u of uuids) {
    const p = txPathOf(u)
    if (!p) continue
    const st = statOr(p)
    if (!st) { ST.txPath.delete(u); continue }
    const had = ST.tx.get(u)
    if (had && had.size === st.size) continue
    let v = null
    try {
      v = lastTool(tailOf(p, st.size, 65536))
      if (!v && st.size > 65536) v = lastTool(tailOf(p, st.size, 524288))
    } catch { v = null }
    ST.tx.set(u, { size: st.size, val: v })
  }
  for (const k of [...ST.tx.keys()]) if (!uuids.has(k)) ST.tx.delete(k)
}

function tick() {
  ST.tickAt = Date.now()
  if (FATAL) return
  const c = readCommit()
  if (COMMIT0 && c && c !== COMMIT0) {
    FATAL = 'E_MOD_CHANGED'
    logLocal('MOD 판 바뀜(' + COMMIT0.slice(0, 7) + ' → ' + c.slice(0, 7) + ') · 응답 끝낸 뒤 rc ' + RESTART_RC + ' 로 끝냄 → launchd 가 다시 켬')
    shutdown(RESTART_RC, 5000)
    return
  }
  try {
    readCfg()
    readDir(ST.cfg.registryDir, ST.entries, M.parseEntry)
    readDir(ST.cfg.liveDir, ST.lives, M.parseLive)
    if (ST.archiveDir) readDir(ST.archiveDir, ST.archive, M.parseEntry, Date.now() - ARCHIVE_KEEP_MS) // 없는 폴더 = 빈 목록(readDir)
    const b = readText(ST.cfg.board.binding_file, 'bindKey', M.foldBindings, null)
    if (b !== undefined) ST.bindings = b
    const h = readText(ST.cfg.board.hidden_file, 'hidKey', M.parseHidden, {})
    if (h !== undefined) ST.hidden = h
    const entries = [...ST.entries.values()].map((x) => x.val)
    const lives = new Map([...ST.lives.values()].map((x) => [x.val.id, x.val]))
    // 게시판·«지금» 읽기 예외는 그 칸만 마지막 좋은 값 유지(MOD 와 같음) — 머리띠 «멈춤» 은 등록부·live 읽기 실패에만
    try { refreshBoards(entries, lives) } catch { /* 마지막 좋은 수 유지 */ }
    try { refreshNow(entries, lives) } catch { /* 마지막 좋은 값 유지 */ }
    try { refreshRooms() } catch { /* 마지막 좋은 방 유지 */ }
    ST.okAt = Date.now()
    ST.err = null
    ST.seq++
    CACHE.clear()
  } catch (err) {
    ST.err = String(err && err.message || err).slice(0, 160)
  }
}

// ── 그리기: MOD 함수로 줄 만들기 ──
const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
function c256hex(n) {
  const sys = ['000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0', '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff']
  if (n < 16) return '#' + sys[n]
  if (n >= 232) { const v = (8 + 10 * (n - 232)).toString(16).padStart(2, '0'); return '#' + v + v + v }
  const lv = [0, 95, 135, 175, 215, 255]
  const k = n - 16
  return '#' + [Math.floor(k / 36), Math.floor(k / 6) % 6, k % 6].map((i) => lv[i].toString(16).padStart(2, '0')).join('')
}
function inkOf(v) {
  const m = /ansi256\((\d+)\)/.exec(String(v || ''))
  return m ? c256hex(Number(m[1])) : null
}
function segOut(s) {
  const look = M.paneLook(s)
  const o = { t: maskSecret(s.text), c: inkOf(look.color) } // /api/state 도 비밀·개인정보 꼴 조각은 가림(경로는 MOD 와 같게 둠 · 독립 재검 #1)
  if (look.bold) o.b = 1
  if (s.dim) o.d = 1
  if (look.backgroundColor && s.bar) o.bg = inkOf(look.backgroundColor)
  if (s.web) o.w = 1
  return o
}
const lineOut = (l, sec) => ({ k: l.key, s: sec, i: l.indent || 0, g: (l.segs || []).filter((x) => x && typeof x.text === 'string' && x.text.length).map(segOut) })

function baseView(web, asId) {
  const cfg = ST.cfg
  const now = Date.now()
  // /api/state 원천 가림(그리기 «전» — MOD 가 긴 글을 여러 줄로 감으면 조각 검사만으론 긴 토큰이 갈라져 새므로 · 독립 재검 #1)
  const entries = [...ST.entries.values()].map((x) => maskEntry(x.val))
  const live = new Map()
  for (const x of ST.lives.values()) { const lv = maskLive(x.val); live.set(lv.id, web && !HAS_WORKING ? busyFallback(lv) : lv) }
  if (asId && live.has(asId)) live.set(asId, { ...live.get(asId), self: true, last_seen: now })
  const rows = M.flatten(entries, now, cfg.keepEndedMs, (e) => e.id === asId || M.aliveAfterEnd(e, live.get(e.id), now, cfg.staleMs), (id) => live.get(id) || null)
  const projectOf = (p) => M.projectLabel(cfg.board.projects, p)
  const attachOf = (e) => M.boundProjectOf(e, ST.bindings)
  // index.js threadHeads 모양: (대조 창이 있으면) 그 창 자기 것이 먼저 · 그다음 다른 창 live 파일을 mergeThreads 로
  const heads = new Map()
  const own = asId && live.has(asId) ? live.get(asId).threads : null
  if (Array.isArray(own)) for (const h of own) if (h && typeof h.ts === 'string') heads.set(h.ts, { channel: h.channel, text: h.text, root: h.root })
  for (const r of live.values()) if (r.id !== asId) M.mergeThreads(heads, r.threads, cfg.slackChannels)
  const agentsOf = (e) => {
    const lv = e ? live.get(e.id) : null
    if (!lv || !Number.isFinite(lv.last_seen) || now - lv.last_seen > cfg.staleMs) return []
    return M.shownAgents(M.parseAgents(lv.agents), now)
  }
  // index.js threadSources 모양 그대로(본 세션만 · 신선한 live 만)
  const role = new Map(entries.filter(Boolean).map((e) => [e.id, e.role]))
  const main = (id) => role.has(id) && role.get(id) !== 'child'
  const sources = []
  for (const r of live.values()) {
    if (!r || !main(r.id) || !Number.isFinite(r.last_seen) || now - r.last_seen > cfg.staleMs) continue
    sources.push({ bot: r.bot || r.id, threads: r.threads })
  }
  const me = asId ? entries.find((e) => e && e.id === asId) || null : null
  const family = me ? M.familyOf(rows, me.id) : []
  const threads = M.boundThreads(sources, ST.bindings, cfg.slackChannels, projectOf)
  const ordered = M.meFirst(rows, family)
  const all = M.withThreadGroups(M.projectGroups(ordered, live, now, cfg.staleMs, projectOf, attachOf), threads)
  const ever = M.childProjects(entries, projectOf, attachOf)
  const shown = M.shownGroups(all, ST.hidden, threads, cfg.board.projects, ever)
  const endedGroups = all.filter((g) => M.endedProject(g, cfg.board.projects, ever))
  const boards = new Map([...shown.groups, ...endedGroups].map((g) => [g.project, maskBoard(boardOf(g.project))]))
  const ended = M.endedToday(entries, now, projectOf, attachOf, live)
  return { cfg, now, entries, live, rows, family, heads, agentsOf, projectOf, attachOf, threads, shown, endedGroups, boards, ended }
}

function renderWeb(cols, pure) {
  // pure = 대조 시험용: 같은 펼침 배치에서 웹 덧(멈춤·답 기다림 글자 · 서브 작업 중 · 지금 · 마지막) 을 모두 끈 판
  const web = !pure
  return withLook(web, () => {
    const v = baseView(web, null)
    const { cfg, now, live } = v
    const opts = { agentsOf: v.agentsOf, heads: v.heads, channels: cfg.slackChannels, projectOf: v.projectOf, endCfg: cfg.board.childEnd,
      style: cfg.treeStyle, isOpen: () => true, subsOpen: () => true }
    const tree = M.paneTree(v.rows, live, now, cfg.staleMs, cols, opts)
    const popts = { open: new Set(), live, nowMs: now, heads: v.heads, channels: cfg.slackChannels, ended: v.ended, threads: v.threads, confirm: null,
      hiddenN: v.shown.hidden, endedN: v.shown.ended, dispatchFailedN: 0 }
    const proj = M.projectLines(v.shown.groups, v.boards, cols, true, popts)
    const endedProj = M.projectLines(v.endedGroups, v.boards, cols, true, popts)
    const head = M.paneHead(cfg.name, cols)
    const out = []
    head.forEach((l) => out.push(lineOut(l, 'head')))
    out.push(lineOut({ key: 'tree-head', segs: tree.header }, 'tree'))
    let staleN = 0
    let webBusyN = 0
    for (const r of tree.rows) {
      const l = lineOut(r, 'tree')
      // 웹 덧은 MOD 줄을 건드리지 않고 그 세션 줄 바로 밑 한 줄(흐린 글자)로: 멈춤의 «마지막 심박 · 미관측» + «지금/마지막 일»
      const sub = []
      if (r.kind === 'session') {
        const lv = live.get(r.id)
        const e = v.entries.find((x) => x.id === r.id)
        if (r.state === 'stale') staleN++
        if (web && r.state === 'stale') {
          const seen = lv && Number.isFinite(lv.last_seen) ? lv.last_seen : Date.parse((e && e.updated_at) || '')
          sub.push('마지막 심박 ' + (Number.isFinite(seen) ? hhmm(seen) : '--:--') + ' · 미관측')
        }
        if (lv && lv.webBusy && r.state === 'busy') { webBusyN++; l.wb = 1 }
        if (web && r.state !== 'ended' && r.state !== 'failed') {
          const u = (lv && lv.session_uuid) || (e && e.session_uuid)
          const t = u ? ST.tx.get(u) : null
          // 작업 중·답 기다림 = «지금» · 쉼·멈춤 = «마지막 일»(지금 하는 일이 아님) · 기록 없음 = 미관측
          const word = r.state === 'busy' || r.state === 'waiting' ? '지금: ' : '마지막 일: '
          sub.push(t && t.val ? word + t.val.text + (Number.isFinite(t.val.at) ? ' ' + hhmm(t.val.at) : '') : '지금: 미관측')
          l.now = sub[sub.length - 1]
        }
      }
      out.push(l)
      if (sub.length) {
        const pad = ' '.repeat(Math.max(0, (r.indent || 4)))
        out.push({ k: r.key + ':web', s: 'tree', i: r.indent || 4, web: 1, g: [segOut({ text: pad + sub.join(' · '), color: 'dim', web: true })] })
      }
    }
    out.push(lineOut({ key: 'proj-head', segs: proj.head }, 'proj'))
    proj.rows.forEach((r) => out.push(lineOut(r, 'proj')))
    const endedOut = endedProj.rows.map((r) => lineOut(r, 'ended'))
    return { lines: out, ended: endedOut, endedN: v.endedGroups.length, sessions: v.rows.length, staleN, webBusyN }
  })
}

// MOD 창 하나가 보는 그대로(대조 시험용 · 원래 LOOK · 덧 0): index.js paneOf 모양 — 자기 가족만 펼침 · 서브 접힘 · 다른 봇 접힘
function renderMod(cols, asId, maxRows) {
  return withLook(false, () => {
    const v = baseView(false, asId)
    const { cfg, now, live } = v
    const { mine, others } = M.splitFamilies(v.rows, v.family)
    const rootId = v.family.length ? v.family[0].entry.id : null
    const opts = { agentsOf: v.agentsOf, heads: v.heads, channels: cfg.slackChannels, projectOf: v.projectOf, endCfg: cfg.board.childEnd,
      style: cfg.treeStyle, isOpen: (id) => id === rootId, subsOpen: () => false }
    const tree = M.paneTree(mine, live, now, cfg.staleMs, cols, opts)
    const oHead = M.othersHead(others, false)
    const proj = M.projectLines(v.shown.groups, v.boards, cols, false, { open: new Set(), live, nowMs: now, heads: v.heads, channels: cfg.slackChannels,
      ended: v.ended, threads: v.threads, confirm: null, hiddenN: v.shown.hidden, endedN: v.shown.ended, dispatchFailedN: 0 })
    const head = M.paneHead(cfg.name, cols)
    const rest = Number.isFinite(maxRows) ? Math.max(1, maxRows - head.length) : maxRows
    const body = M.paneLines({ back: null, treeHead: tree.header, treeRows: tree.rows, othersHead: oHead, othersRows: [], projHead: proj.head, projRows: proj.rows,
      team: () => [], teamOpen: false, cron: { head: [{ text: '◷ 예약' }] }, lowerOpen: false, cronOpen: false, lowerHead: () => [{ text: '▶ TeamClaude' }],
      teamWhole: true, rules: true, headRule: true }, cols, rest)
    const lines = body.length && body[0].key === 'rule-head' ? [head[0], body[0], ...head.slice(1), ...body.slice(1)] : [...head, ...body]
    return { lines: lines.map((l) => ({ k: l.key, text: maskSecret(M.segText(l.segs || [])) })) }
  })
}

const CACHE = new Map()
function stateJson(q) {
  const mode = q.get('mode') === 'mod' ? 'mod' : q.get('mode') === 'pure' ? 'pure' : 'web'
  const cols = Math.max(30, Math.min(240, parseInt(q.get('cols') || '120', 10) || 120))
  const asId = mode === 'mod' ? String(q.get('as') || '') : ''
  const rowsQ = parseInt(q.get('rows') || '', 10)
  const maxRows = Number.isFinite(rowsQ) && rowsQ > 0 ? rowsQ : Infinity
  return cachedJson(CACHE, [ST.seq, mode, cols, asId, maxRows].join('|'), { fatalCode: FATAL || (ST.cfg ? null : 'E_NOT_READY'), log: logLocal, build: () => {
    const body = mode === 'mod' ? renderMod(cols, asId, maxRows) : renderWeb(cols, mode === 'pure')
    body.commit = COMMIT0 ? COMMIT0.slice(0, 7) : null
    body.working = HAS_WORKING ? 'plugin' : 'web-fallback'
    body.staleMin = Math.round(ST.cfg.staleMs / 60000)
    return body
  } })
}

// ── 10-31 UX 판: /api/board = 보는 사람 순서의 화면 재료(lib.mjs boardModel) ──
// 원천 = 위 tick 이 이미 읽은 것만(등록부 · live · 묶음 기록 · 게시판). 판정 = MOD stateOf · projectKeyOf · botShown 주입.
// 사용량 한도 · 대장 · 승인 대기는 이 서버가 읽지 않음 → null(화면 «모름»).
function boardJson() {
  return cachedJson(CACHE, ['board', ST.seq].join('|'), { fatalCode: FATAL || (ST.cfg ? null : 'E_NOT_READY'), log: logLocal, build: () => {
    const body = boardModel(boardInputOf({ cfg: ST.cfg, entries: boardEntries(),
      lives: new Map([...ST.lives.values()].map((x) => [x.val.id, x.val])), notePaths: ST.notePaths, boardFiles: ST.boardFiles,
      bindings: ST.bindings, M, hasWorking: HAS_WORKING, hosts: OPT.hosts, ux: OPT.ux, now: Date.now(), boards: ST.boards }))
    body.commit = COMMIT0 ? COMMIT0.slice(0, 7) : null
    body.working = HAS_WORKING ? 'plugin' : 'web-fallback'
    // 11-03 봇 칸 합의: 봇 칸 display_name(설정 bot_names → 명부 한글 별칭 → MOD 이름 → null) · 응답 글 전체 = 설정 hide_words 가림
    //   (boardModel 이 이미 scrubDeep 한 몸통은 다시 안 거침 · 새 칸 display_name 만 같은 받침)
    if (Array.isArray(body.bots)) body.bots = body.bots.map((b) => ({ ...b, display_name: scrubDeep(displayNameOf(b.bot, b.name, ST.roster, OPT.botNames)) }))
    return hideWordsDeep(body, OPT.hideWords)
  } })
}

// ── 11-09 «봇 · 프로젝트» 줄기 칸(A안 · 주인 11-09 «좋아요») — 판정은 전부 MOD project.js: ──
// 마디 = graphData(등록부 · live · 위 refreshBoards 의 막힌 세션 · 세션 예약) · 묶음 = graphGroups(막힌 세션을 쓴 봇 줄기 아래 · botOf = 등록부 행 bot) ·
// 세션 예약 = sessionLoops(웹 = 모든 live 파일 · me null) · 화면 이름·숨긴 봇·글 손질 = jobs.mjs projgraphModel.
// 실패(함수 모양 다름·던짐) = 이 칸만 마지막 좋은 값(첫 실패 = null) + 로컬 기록(같은 까닭은 한 번만) — 다른 칸 영향 0
// 숨긴 봇 세션 id 를 불투명 열쇠로 바꿀 때 쓰는 값 = 설정 파일 바이트에서(보는 사람 손에 없음 · 서버를 다시 켜도 같음 · 값은 어디에도 안 실림)
const PG_HIDE_SALT = crypto.createHash('sha256').update('wb-projgraph-hide\n').update(fs.readFileSync(CONF_PATH)).digest()
function projgraphNow(board) {
  try {
    const cfg = ST.cfg, now = Date.now()
    const entries = [...ST.entries.values()].map((x) => x.val)
    const lives = new Map([...ST.lives.values()].map((x) => [x.val.id, x.val]))
    const byId = new Map()
    for (const e of entries) if (e && typeof e.id === 'string') byId.set(e.id, e)
    // 상태 판정은 /api/board·/api/jobs 봇 칸과 같은 받침: 플러그인에 workingState 가 없을 때만 busyFallback(boardInputOf stateOf 와 같음)
    const lv = HAS_WORKING ? lives : new Map([...lives].map(([k, v]) => [k, busyFallback(v)]))
    const projectOf = (p) => M.projectLabel(cfg.board.projects, p)
    const attachOf = (e) => M.boundProjectOf(e, ST.bindings)
    const loops = M.sessionLoops(entries, lives, { now, staleMs: cfg.staleMs, table: cfg.board.projects, me: null })
    const gd = M.graphData(entries, lv, ST.boards, loops, { nowMs: now, staleMs: cfg.staleMs, projectOf, attachOf })
    if (!gd || !Array.isArray(gd.nodes)) throw new Error('graphData 모양 다름')
    const groups = M.graphGroups(gd.nodes, (id) => (byId.get(id) || {}).bot)
    if (!Array.isArray(groups)) throw new Error('graphGroups 모양 다름')
    const val = projgraphModel({ groups, outside: gd.outside, rows: byId, board, roster: ST.roster, names: OPT.botNames, hideBots: OPT.hideBots, hide: OPT.hideWords, hideSalt: PG_HIDE_SALT, now })
    ST.pgLast = val
    ST.pgErr = null
    return val
  } catch (err) {
    const why = String(err && err.message || err).slice(0, 120)
    if (ST.pgErr !== why) logLocal('봇 · 프로젝트 줄기 못 만듦(마지막 좋은 값 유지): ' + why)
    ST.pgErr = why
    return ST.pgLast || null
  }
}

// ── 11-01 봇 새 화면: /api/jobs = 봇 board-data v2 모양(jobs.mjs jobsModel) ──
// 봇·14일 숫자 = /api/board 와 같은 boardModel(같은 원천·같은 판정) · 방 = 회의방 01-spec 의존 그래프 · 사용량·대장·승인·7일 토큰 = null(«연결 전»)
// 응답 전체 = scrubDeep(글자 칸 전부 safeText) — 덧붙이는 칸 = 링크(thread_url · 허용 꼴만 · relink)뿐(commit·working 도 안 실음)
function jobsJson() {
  return cachedJson(CACHE, ['jobs', ST.seq, TEAM.rev].join('|'), { fatalCode: FATAL || (ST.cfg ? null : 'E_NOT_READY'), log: logLocal, build: () => {
    const board = boardModel(boardInputOf({ cfg: ST.cfg, entries: boardEntries(),
      lives: new Map([...ST.lives.values()].map((x) => [x.val.id, x.val])), notePaths: ST.notePaths, boardFiles: ST.boardFiles,
      bindings: ST.bindings, M, hasWorking: HAS_WORKING, hosts: OPT.hosts, ux: OPT.ux, now: Date.now(), boards: ST.boards }))
    // 링크 칸 = scrubDeep 이 주소를 깎으므로 허용 꼴(jobs.mjs SLACK_PERMALINK_RX)만 뒤에 다시 붙임
    const model = jobsModel({ board, rooms: roomsNow(), okAt: ST.okAt, hide: OPT.hideWords, roster: ST.roster, names: OPT.botNames, hideBots: OPT.hideBots, glossary: OPT.glossary })
    const out = relink(hideWordsDeep(scrubDeep(model), OPT.hideWords), model)
    out.setup = setupNow()
    // 11-08 «이게 뭔가» 두 층 글(플러그인 ui.about → web.json about → 제품 기본 글) · 이름 = web.json about.system_name → mod-for-slack
    out.about = hideWordsDeep(scrubDeep(aboutOf(ST.cfg && ST.cfg.about, OPT.about, OPT.about && OPT.about.system_name)), OPT.hideWords)
    out.display = displayOf(OPT.displayText, OPT.hideWords) // 설정 display_text(없거나 꼴이 틀리면 null) · 가림 받침 밖(jobs.mjs displayOf 주석)
    // 11-09 «회의 결정 후속»(대장 읽기 명령 출력 · 위 refreshFollowups 가 읽어 둔 값) — 글자 칸 = scrubDeep · 가림 낱말 · 링크만 다시 붙임
    const fu = followupsNow()
    out.followups = fu ? hideWordsDeep(scrubDeep(fu), OPT.hideWords) : null
    if (fu && out.followups && Array.isArray(out.followups.rooms)) out.followups.rooms.forEach((r, i) => { r.thread_url = fu.rooms[i] ? fu.rooms[i].thread_url : null })
    out.usage = TEAM.val ? hideWordsDeep(TEAM.val, OPT.hideWords) : null // 11-04 위 pollUsage 가 읽어 둔 값(요청마다 바깥 호출 0) · 글자 = «#P»·낱말·ISO 뿐
    // 11-09 «봇 · 프로젝트» 줄기(위 projgraphNow · 실패 = 마지막 좋은 값 또는 null) — 글자 칸 = scrubDeep · 가림 낱말(링크 칸 없음)
    out.projgraph = hideWordsDeep(scrubDeep(projgraphNow(board)), OPT.hideWords)
    // 11-09 숫자 칸 하루 1행(③) — 이 몸통(화면이 받는 것 그대로)에서 셈 · 기록 파일이 없으면 null(화면 = «기록 전»)
    out.history = historyRecord(out)
    return out
  } })
}

// ── 11-09 숫자 칸 하루 1행 기록(주인 «이대로 ㄱㄱ.» ③ · MOD 손 0) ──
// 하루 = KST 달력일 · 그날 마지막으로 읽은 값이 그날 행(같은 날 = 덮어씀) · 파일 1개 · 최근 30행 · start = 처음 쓴 날
// 읽는 때 = /api/jobs 를 만들 때마다(메모리) + 보는 사람이 없어도 historyMs(5분)마다 한 번 만듦(main) — 파일 쓰기 = 날이 바뀌었거나 값이 바뀌고 historyMs 지났을 때 · 끝낼 때
// 쓰기 = 임시 파일 → 이름 바꾸기(찢긴 파일 0) · 0600 · 실패 = 메모리 값 유지 + 로컬 기록 한 줄(같은 까닭은 한 번만) · 화면 다른 칸 영향 0
const HIST = { val: null, loaded: false, day: null, wroteAt: 0, wroteText: null, err: null }
function historyLoad() {
  if (HIST.loaded) return
  HIST.loaded = true
  let raw = null
  try { raw = JSON.parse(fs.readFileSync(OPT.historyFile, 'utf8')) } catch (err) { if (err && err.code !== 'ENOENT') logLocal('숫자 칸 기록 파일 못 읽음(새로 시작): ' + String(err && err.message || err).slice(0, 120)) }
  HIST.val = historyOf(raw)
  HIST.wroteText = raw ? JSON.stringify(HIST.val) : null
  HIST.day = HIST.val.daily.length ? HIST.val.daily[HIST.val.daily.length - 1].day : null
}
function historyFlush(force) {
  if (!OPT.historyFile || !HIST.val) return
  const text = JSON.stringify(HIST.val)
  if (text === HIST.wroteText) return
  const now = Date.now()
  const last = HIST.val.daily.length ? HIST.val.daily[HIST.val.daily.length - 1].day : null
  if (!force && last === HIST.day && now - HIST.wroteAt < OPT.historyMs) return // 같은 날 · 막 썼음 = 다음에(그날 마지막 값은 날 바뀔 때·끝낼 때 씀)
  try {
    const tmp = OPT.historyFile + '.tmp-' + process.pid
    fs.writeFileSync(tmp, text + '\n', { mode: 0o600 })
    fs.renameSync(tmp, OPT.historyFile)
    HIST.wroteText = text; HIST.wroteAt = now; HIST.day = last; HIST.err = null
  } catch (err) {
    const why = String(err && err.message || err).slice(0, 120)
    if (HIST.err !== why) logLocal('숫자 칸 기록 못 씀(메모리 값 유지): ' + why)
    HIST.err = why
  }
}
function historyRecord(out) {
  if (!OPT.historyFile) return null
  try {
    historyLoad()
    HIST.val = historyPut(HIST.val, kstDay(Date.now()), kpiRowOf(out))
    historyFlush(false)
  } catch (err) { logLocal('숫자 칸 기록 실패: ' + String(err && err.message || err).slice(0, 120)) }
  if (!HIST.val) return null
  return hideWordsDeep(scrubDeep({ start: HIST.val.start, daily: HIST.val.daily }), OPT.hideWords)
}

// 설치 단계 «끝남»(setup.mjs) — 토큰 = env-status 낱말(set/missing)만 · 그 줄·경로는 응답에 0 · 부르기 실패 = 그 봇 null → 그 단계 unknown
function envStatusOf(bot) {
  try {
    const out = execFileSync('python3', ['-I', path.join(OPT.setupRoot, 'lib', 'slackmod_config.py'), 'env-status', '--file', path.join(OPT.setupRoot, 'bots', bot, 'slack', '.env')],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })
    return parseEnvStatus(String(out).trim())
  } catch { return null }
}
function setupNow() {
  if (!OPT.setupRoot) return null
  const now = Date.now()
  if (!ST.setup || now - ST.setup.at > 30000) ST.setup = { at: now, val: setupSteps({ root: OPT.setupRoot, home: HOME, envStatus: envStatusOf }) }
  return ST.setup.val
}

// ── 11-04 /api/jobs «usage» 칸: mods 패널 «Claude · usage» 줄과 같은 원천·같은 함수 ──
// 원천 = mods 설정 ui.team_claude_urls(ST.cfg.teamUrls = 패널과 같은 uiSettings) 상태 주소 GET — 패널 index.js fetchTeam 과 같은 curl(-sS · 3초)
//   → plugin ui/lib/accounts.js stripNames(이름 → 임의 id) → ui/lib/team.js teamModel → jobs.mjs usageOf(칸 이름만 옮김)
// 읽기 = 이 서버 자체 주기(30초)뿐 · /api/jobs 요청은 읽어 둔 값만 실음(요청마다 바깥 호출 0) · 받은 글 원문·이름은 버림(기록·응답 0)
// 함수 모양이 다름 = usage null + 로컬 기록 한 줄(NEED 밖 · 화면은 그대로) — 단 team.js 파일이 아예 없으면 NEED 의 ui/lib/legend.js 가 team.js 를 import 해서
//   먼저 E_MOD_LOAD 로 화면 전체가 섬(05507c0 부터 그대로인 동작 · 이 칸 때문이 아님)
const TEAM = { mod: null, val: null, rev: 0, busy: false }
async function loadTeam() {
  try {
    const t = await import(pathToFileURL(path.join(OPT.pluginSrc, 'ui/lib/team.js')).href)
    const a = await import(pathToFileURL(path.join(OPT.pluginSrc, 'ui/lib/accounts.js')).href)
    if (typeof t.teamModel === 'function' && typeof t.isClaudeAnswer === 'function' && typeof a.stripNames === 'function') TEAM.mod = { teamModel: t.teamModel, isClaudeAnswer: t.isClaudeAnswer, stripNames: a.stripNames }
    else logLocal('사용량 함수 모양 다름 — usage = null')
  } catch (err) { logLocal('사용량 함수 못 읽음 — usage = null: ' + String(err && err.message || err)) }
}
function curlGet(url) {
  return new Promise((ok) => execFile('curl', ['-sS', '--max-time', '3', '--', url], { encoding: 'utf8', timeout: 5000, maxBuffer: 8 << 20 }, (err, out) => ok(err ? null : out)))
}
async function pollUsage() {
  if (!TEAM.mod || TEAM.busy || STOPPING || FATAL) return
  TEAM.busy = true
  let val = null
  try {
    const urls = ST.cfg && Array.isArray(ST.cfg.teamUrls) ? ST.cfg.teamUrls : []
    if (urls.length) {
      const results = []
      for (const url of urls) {
        const r = { url, ok: false, json: null, at: null }
        const out = await curlGet(url)
        r.at = Date.now()
        if (out !== null) { try { const j = JSON.parse(out); if (j && typeof j === 'object' && !Array.isArray(j)) { r.ok = true; r.json = TEAM.mod.stripNames(j) } } catch { /* 못 읽음 = 안 답함 */ } }
        results.push(r)
      }
      const claude = results.find((r) => r.ok && TEAM.mod.isClaudeAnswer(r.json))
      val = usageOf(TEAM.mod.teamModel(results), claude ? claude.json : null)
    }
  } catch (err) { val = null; logLocal('사용량 읽기 실패 — usage = null: ' + String(err && err.message || err)) } finally { TEAM.busy = false }
  if (JSON.stringify(val) !== JSON.stringify(TEAM.val)) { TEAM.val = val; TEAM.rev += 1 }
}

// ── HTTP ──
// / = 봇 새 화면(jobs.html · 11-01 주인 승인) · /classic = 10-31 UX 판(page.html · 그대로)
const PAGE = fs.readFileSync(path.join(HERE, 'jobs.html'), 'utf8')
const CLASSIC = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8')
// 처리기 = handler.mjs makeHandler(socket 없이 handler.test.mjs 가 같은 처리기를 시험)
const handler = makeHandler({ keyOk, page: PAGE, classic: CLASSIC, stateJson, boardJson, jobsJson, status: () => ({ okAt: ST.okAt, tickAt: ST.tickAt }), now: Date.now, stallMs: OPT.stallMs })

async function main() {
  await loadMod()
  await loadTeam()
  tick()
  TIMER = setInterval(tick, OPT.pollMs)
  pollUsage()
  USAGE_TIMER = setInterval(pollUsage, OPT.usagePollMs)
  USAGE_TIMER.unref()
  if (OPT.followups) { refreshFollowups(); FOLLOW_TIMER = setInterval(refreshFollowups, OPT.followups.pollMs); FOLLOW_TIMER.unref() }
  if (OPT.historyFile) { HISTORY_TIMER = setInterval(() => { if (!FATAL && !STOPPING && ST.cfg) jobsJson() }, OPT.historyMs); HISTORY_TIMER.unref() } // 보는 사람 없는 날도 그날 행
  for (const h of OPT.hosts) {
    const srv = http.createServer(handler)
    srv.requestTimeout = 10000
    srv.headersTimeout = 10000
    srv.on('connection', (sock) => { SOCKS.add(sock); sock.once('close', () => SOCKS.delete(sock)); if (STOPPING) settle(sock) })
    const listenOnce = () => new Promise((ok, bad) => { srv.once('error', bad); srv.listen(OPT.port, h, () => { srv.removeListener('error', bad); ok() }) })
    // 주소가 아직 없음(로그인 직후 host) = 거절이 아니라 기다림 · 상한 넘으면 rc 75 로 끝내 launchd 가 다시 켬(래퍼는 75 만 다시 켬)
    const t0 = Date.now()
    for (;;) {
      try { await listenOnce(); break } catch (e) {
        if (!e || e.code !== 'EADDRNOTAVAIL') throw e
        if (Date.now() - t0 >= OPT.listenWaitMs) {
          console.error('[web-board] 주소 아직 없음(' + OPT.listenWaitMs + 'ms 기다림) · rc 75 로 끝냄 → launchd 가 다시 켬')
          return shutdown(75, 200)
        }
        await new Promise((ok) => setTimeout(ok, Math.min(2000, Math.max(100, OPT.listenWaitMs / 5))))
      }
    }
    SERVERS.push(srv)
  }
  if (OPT.pidFile) fs.writeFileSync(OPT.pidFile, String(process.pid) + '\n')
  // 열쇠·주소 값은 찍지 않음 — 뜬 곳과 상태만
  console.log('web-board 뜸 · ' + OPT.hosts.join(',') + ' : ' + OPT.port + ' · MOD ' + (COMMIT0 ? COMMIT0.slice(0, 7) : '?') + ' · 서브 판정 ' + (HAS_WORKING ? 'plugin' : 'web-fallback') + (FATAL ? ' · ' + FATAL : ''))
  const stop = () => shutdown(0, 200)
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

// 본 실행 판정 = 진짜 경로끼리(import.meta.url 은 링크를 푼 경로 · argv[1] 은 부른 그대로 — /var→/private/var 같은 링크 아래에 깔리면
// 두 값이 달라 main() 없이 rc 0 으로 조용히 끝났음 · 11-03 실측 · 시험 = handler.test «링크 경로 아래서도 뜸»)
function realOr(p) { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
if (process.argv[1] && realOr(process.argv[1]) === realOr(fileURLToPath(import.meta.url))) main()
