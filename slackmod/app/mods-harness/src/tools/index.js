// lane: tools · owner: 봇
// scope: 전용 도구 세트 v0 — 도구 1개 «회의 진행 기록 한 줄» (mcp__mods-harness__progress_line) · 이후 확장
// The tool runs the vault's 02-progress helper with `$.process.run` (no shell): the helper stamps the time, runs
// its gates (graph / room document) and syncs; a refusal comes back to the model as a deny with the helper's words.
// Loader rules: one hooks module per plugin and one hook per event per matcher — session.start is held without a
// matcher by the session lane and with { isInteractive: true } by the ui lane, so this lane uses its own matcher.
import { TOOL_NAME, toolSettings, checkInput, resultText, failText } from './lib/progress.js'
// Same two lines in the four lane files: the validator follows $ only into same-file functions. The first call pins the verdict for this process (a later /clear changes the session id, the launcher's does not).
let optInAnchor
async function optedIn($) { if (optInAnchor === undefined) { const bot = await $.env.get('MODS_HARNESS_BOT'); const expected = await $.env.get('MODS_HARNESS_SESSION_ID'); optInAnchor = Boolean(bot) && Boolean(expected) && expected === await $.session.id() } return optInAnchor }

const FULL_NAME = 'mcp__mod-for-slack__progress_line'

async function loadToolSettings($) {
  const home = (await $.env.get('HOME')) || ''
  let path = (await $.env.get('MODS_HARNESS_CONFIG')) || ''
  if (!path) path = $.plugin.root + '/config/local.config.json'
  let raw = null
  try {
    if (await $.fs.exists(path)) raw = JSON.parse(await $.fs.read(path, 'text'))
  } catch (err) {
    raw = null
  }
  return toolSettings(raw, home)
}

// Config is read on every call, so a fixed path applies without restarting the session.
async function progressLine($, e) {
  const settings = await loadToolSettings($)
  const bot = await $.env.get('MODS_HARNESS_BOT')
  const c = checkInput(e, settings, bot)
  if (!c.ok) return { deny: c.error }
  if (!(await $.fs.exists(c.progressPath))) return { deny: '방 기록 파일이 없습니다: ' + c.room + '/02-progress.md' }
  const run = await $.process.run(c.argv, { timeoutMs: 60000 })
  if (run.exitCode !== 0) return { deny: failText(run) }
  return { result: resultText(run) }
}

export function register(on, options) {
  optInAnchor = undefined
  // Interactive and -p sessions alike get the tool.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    if (!(await optedIn($))) return next(e)
    try {
      await $.tool.register({
        name: TOOL_NAME,
        description: 'Append ONE line to a meeting room\'s 02-progress.md through the vault helper, which stamps the KST time, ' +
          'checks its gates and syncs the live vault. Use it instead of shell printf/echo for 02 lines. ' +
          'Inputs: room = the room folder name (e.g. 2026-10-17-mods-harness-rebuild), status = one short word ' +
          '(시작 · 완료 · 판단 · blocked · 생존 …), message = one line of at most 600 characters. ' +
          'Only when a helper gate must be passed on purpose, give graph_gate_reason (GRAPH_GATE=0) or room_doc_gate_reason ' +
          '(ROOM_DOC_GATE=off); the reason is written at the start of the line. A refusal returns the helper\'s own words.',
        inputSchema: {
          type: 'object',
          properties: {
            room: { type: 'string', description: 'Room folder name under the room root (no slashes).' },
            status: { type: 'string', description: 'Short status word, no "|" (max 24 characters).' },
            message: { type: 'string', description: 'One line, no newline, max 600 characters.' },
            graph_gate_reason: { type: 'string', description: 'Why this line skips the dependency-graph gate (optional).' },
            room_doc_gate_reason: { type: 'string', description: 'Why this line skips the room-document gate (optional).' },
          },
          required: ['room', 'status', 'message'],
        },
        isDeferred: false,
      })
    } catch (err) {
      try { $.ui.status('mod-for-slack tools: ' + String((err && err.message) || err).slice(0, 100)) } catch (e2) { /* ignore */ }
    }
    return next(e)
  })

  on('tool.call', { tool: FULL_NAME }, async ($, e) => {
    try {
      return await progressLine($, e)
    } catch (err) {
      return { deny: 'progress_line 오류: ' + String((err && err.message) || err).slice(0, 300) }
    }
  }).catch(() => ({ deny: 'progress_line: 처리기가 실패했거나 시간을 넘겼습니다(기록 안 됨)' }))
}
