// lane: tools · owner: 봇 — pure input check and argv for the tool «회의 진행 기록 한 줄» (no `$`).
// The tool never writes the file itself: it runs the vault's own helper (02-progress append script), which stamps
// the time, checks its gates and syncs. This file decides only whether the call is well-formed and how to run it.
// Config (config/local.config.json, all paths absolute):
//   tools.progress_append = "<helper path>"  or  { "helper": "<path>", "room_root": "<path>", "python": "<path>" }
//   paths.room_root · paths.pythonExecutable = fallbacks (config lane schema)

export const TOOL_NAME = 'progress_line'
export const MAX_MESSAGE = 600
export const MAX_STATUS = 24
export const MAX_REASON = 200
const ROOM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const BOT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

// Control characters, DEL and the two Unicode line/paragraph separators (U+2028, U+2029) — anything that would
// break the one-line record. Compared by code point so no raw separator ever sits in this source file.
function hasControl(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return true
  }
  return false
}

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

function absPath(p, home) {
  if (typeof p !== 'string' || !p) return null
  const x = home ? p.replace(/^\$HOME(?=\/|$)/, home).replace(/^~(?=\/|$)/, home) : p
  return x.startsWith('/') && !x.includes('\0') ? x : null
}

export function toolSettings(raw, home) {
  const r = obj(raw)
  const paths = obj(r.paths)
  const pa = obj(r.tools).progress_append
  const spec = typeof pa === 'string' ? { helper: pa } : obj(pa)
  return {
    helper: absPath(spec.helper, home),
    roomRoot: absPath(spec.room_root, home) || absPath(paths.room_root, home),
    python: absPath(spec.python, home) || absPath(paths.pythonExecutable, home) || 'python3',
  }
}

function oneLine(v, max, what) {
  if (typeof v !== 'string') return { error: what + ' 가 글자가 아닙니다' }
  const s = v.trim()
  if (!s) return { error: what + ' 가 비었습니다' }
  if (hasControl(s)) return { error: what + ' 에 줄바꿈·제어 문자가 있습니다(한 줄만)' }
  if ([...s].length > max) return { error: what + ' 가 ' + max + '자를 넘습니다' }
  return { value: s }
}

// e = the tool call (arguments are fields of e). Returns { ok: true, … } or { ok: false, error }.
export function checkInput(e, settings, bot) {
  const s = settings || {}
  if (!s.helper) return { ok: false, error: '설정에 tools.progress_append(헬퍼 경로)가 없습니다' }
  if (!s.roomRoot) return { ok: false, error: '설정에 방 폴더(tools.progress_append.room_root 또는 paths.room_root)가 없습니다' }
  if (typeof bot !== 'string' || !BOT_RE.test(bot)) return { ok: false, error: '봇 이름(MODS_HARNESS_BOT)이 없거나 꼴이 틀립니다' }
  const room = typeof e.room === 'string' ? e.room.trim() : ''
  if (!ROOM_RE.test(room) || room.includes('..')) return { ok: false, error: 'room 은 방 폴더 이름 하나입니다(/ · .. ❌): ' + String(e.room).slice(0, 80) }
  const status = oneLine(e.status, MAX_STATUS, 'status')
  if (status.error) return { ok: false, error: status.error }
  if (status.value.includes('|')) return { ok: false, error: 'status 에 | 를 쓸 수 없습니다' }
  const message = oneLine(e.message, MAX_MESSAGE, 'message')
  if (message.error) return { ok: false, error: message.error }
  const gates = []
  const prefix = []
  for (const [key, envKv, label] of [
    ['graph_gate_reason', 'GRAPH_GATE=0', 'GRAPH_GATE=0'],
    ['room_doc_gate_reason', 'ROOM_DOC_GATE=off', 'ROOM_DOC_GATE=off'],
  ]) {
    if (e[key] === undefined || e[key] === null || e[key] === '') continue
    const reason = oneLine(e[key], MAX_REASON, key)
    if (reason.error) return { ok: false, error: reason.error }
    gates.push(envKv)
    prefix.push(label + ' 사유: ' + reason.value + ' · ')
  }
  const progressPath = s.roomRoot.replace(/\/+$/, '') + '/' + room + '/02-progress.md'
  const text = prefix.join('') + message.value
  return {
    ok: true,
    room,
    progressPath,
    argv: ['/usr/bin/env', ...gates, s.python, s.helper, progressPath, bot, status.value, text],
  }
}

function lines(s) {
  return String(s || '').split('\n').map((x) => x.trim()).filter(Boolean)
}

// Helper exit 0 → the line it wrote (+ its sync note). Its own time stamp is the one recorded.
export function resultText(run) {
  const out = lines(run.stdout)
  if (!out.length) return '기록됨(헬퍼 출력 없음)'
  return ('기록됨: ' + out[0] + (out[1] ? '\n' + out[1] : '')).slice(0, 1200)
}

// Helper refused or failed → its own words, so the model can fix the call (e.g. add a gate reason).
export function failText(run) {
  const err = lines(run.stderr).slice(0, 4).join(' / ')
  return ('progress-append 거부(종료 코드 ' + run.exitCode + '): ' + (err || '(오류 출력 없음)')).slice(0, 800)
}
