// lane: ui · owner: 봇 — /mh 모양 (v3 r3b): the skin presets, the argument parser and the usage cells
// (봇 DESIGNS.md 2-2·2-3 · 봇 Q2·Q3: the default stays the current shape «classic», a switch lasts
// for the session only). Pure — no `$`, no state; index.js keeps the chosen skin in S.skin.
// Changes from the design's code (measured 10-18): the color is decided by the shown, rounded percent — the rule
// barOf already follows («the number and its paint agree»; 59.6% used showed «60%» in green before) — and the
// reset bar keeps its width for any input (NaN times drew an empty string; a negative width could throw).

// ── presets ──
// usage = the TeamClaude usage cells · tools = the engine's tool lines · hint = the mode/hint line under the prompt.
export const SKIN_DEFAULT = 'classic'
const CLASSIC = { usage: 'classic', tools: 'classic', hint: 'classic' }
export const SKINS = {
  classic: CLASSIC,
  'battery-cell': { ...CLASSIC, usage: 'battery-cell' },
  'battery-tower': { ...CLASSIC, usage: 'battery-tower' },
  'pipeline-rail': { ...CLASSIC, tools: 'pipeline-rail' },
  'cockpit-pill': { ...CLASSIC, hint: 'cockpit-pill' },
}
// Named in the design, not built in this round (r3b = 1–4 first · 봇).
export const SKINS_LATER = ['subway-tree', 'gauge-dial', 'synapse-pulse', 'bento-grid', 'braille-spark', 'zen-hud']

// «/mh 모양» arguments → what to do. Names are matched exactly, lowercase; nothing else is read.
export function parseSkinArgs(text) {
  const name = String(text ?? '').trim().toLowerCase()
  if (!name) return { kind: 'list' }
  if (Object.prototype.hasOwnProperty.call(SKINS, name)) return { kind: 'set', name, skin: SKINS[name] }
  if (SKINS_LATER.includes(name)) return { kind: 'later', name }
  return { kind: 'unknown' }
}

// What «/mh 모양» answers (r3b P1): the skin in use and the names to pick from — the built ones only, in the design's
// order. `cur` not a built name = the default. One line, no name the user typed (an unknown word is never echoed).
export const SKIN_NAMES = Object.keys(SKINS)
export function skinOf(name) {
  return Object.prototype.hasOwnProperty.call(SKINS, name) ? SKINS[name] : SKINS[SKIN_DEFAULT]
}
export function skinListText(cur) {
  const now = Object.prototype.hasOwnProperty.call(SKINS, cur) ? cur : SKIN_DEFAULT
  return '모양 = ' + now + ' · 고를 수 있는 것: ' + SKIN_NAMES.join(' · ') + ' («/mh 모양 <이름>» · 이 세션만)'
}
// The answer to one «/mh 모양 …»: { skin = the skin after it (unchanged unless a built name was given), set = a built
// name was given, changed = it differs from `cur`, text = the one line said back }.
export function skinCommand(cur, args) {
  const now = Object.prototype.hasOwnProperty.call(SKINS, cur) ? cur : SKIN_DEFAULT
  const a = parseSkinArgs(args)
  if (a.kind === 'set') return { skin: a.name, set: true, changed: a.name !== now, text: '모양 → ' + a.name + (a.name === now ? ' (이미 그 모양)' : '') }
  if (a.kind === 'later') return { skin: now, set: false, changed: false, text: a.name + ' = 다음 회차(아직 없음) · ' + skinListText(now) }
  if (a.kind === 'unknown') return { skin: now, set: false, changed: false, text: '모르는 이름 · ' + skinListText(now) }
  return { skin: now, set: false, changed: false, text: skinListText(now) }
}

// ── cells ──
function pctOf(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null
}

// The rounded percent decides the paint (as barOf): <60 green · 60–89 yellow · 90+ red.
export function usageInk(pctUsed) {
  const p = pctOf(pctUsed)
  if (p === null) return 'dim'
  const r = Math.round(p)
  return r < 60 ? 'green' : r < 90 ? 'yellow' : 'red'
}

function count(v, lo, hi, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : dflt
}

// 1안 — a phone battery lying down: «[███▌░]▸» · cells × 8 steps · mode 'remain' fills what is left.
const H_BLOCKS = ['░', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']
export function batteryCell(pctUsed, cells = 5, mode = 'remain') {
  const n = count(cells, 1, 20, 5)
  const used = pctOf(pctUsed)
  if (used === null) return { text: '[' + '·'.repeat(n) + ']▸', color: 'dim' }
  const val = mode === 'used' ? used : 100 - used
  const eighths = Math.round((val / 100) * n * 8)
  const full = Math.floor(eighths / 8)
  const rem = eighths % 8
  let body = '█'.repeat(full)
  if (full < n) body += (rem > 0 ? H_BLOCKS[rem] : '░') + '░'.repeat(n - full - 1)
  return { text: '[' + body + ']▸', color: usageInk(used) }
}

// 2안 — a standing battery: «▐▆▆·▌» · cols columns × 8 steps, filled left to right by what is left.
const V_BLOCKS = ['·', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
export function batteryTower(pctUsed, cols = 3) {
  const n = count(cols, 1, 20, 3)
  const used = pctOf(pctUsed)
  if (used === null) return { text: '▐' + '·'.repeat(n) + '▌', color: 'dim' }
  const steps = Math.round(((100 - used) / 100) * n * 8)
  let bars = ''
  for (let i = 0; i < n; i++) bars += V_BLOCKS[Math.max(0, Math.min(8, steps - i * 8))]
  return { text: '▐' + bars + '▌', color: usageInk(used) }
}

// Time left to a reset as a bar: full = the whole window ahead, empty = about to reset. 'line' «━━━──» · 'seg' «▰▰▱».
// Always exactly `width` cells; an unknown or past reset = a dim empty bar.
export function resetProgressBar(resetEpochMs, nowMs, windowMinutes = 300, width = 6, style = 'line') {
  const w = count(width, 0, 60, 6)
  const ok = (v) => typeof v === 'number' && Number.isFinite(v)
  const win = ok(windowMinutes) && windowMinutes > 0 ? windowMinutes : 300
  if (!ok(resetEpochMs) || !ok(nowMs) || resetEpochMs <= nowMs) return { text: (style === 'seg' ? '▱' : '─').repeat(w), color: 'dim' }
  const leftMin = (resetEpochMs - nowMs) / 60000
  const filled = Math.max(0, Math.min(w, Math.round(Math.min(1, leftMin / win) * w)))
  if (style === 'seg') return { text: '▰'.repeat(filled) + '▱'.repeat(w - filled), color: 'cyan' }
  const head = filled === 0 && w > 0 ? '╸' : ''
  return { text: '━'.repeat(filled) + head + '─'.repeat(w - filled - head.length), color: 'cyan' }
}

// ── 3안 pipeline-rail (DESIGNS 안 3 · 주인) ──
// The engine's tool line (ui.render ToolUse: props tool · input · isRunning · isErrored · isInterrupted — no time and no
// progress in them, engine 2.1.296) drawn as a rail: «─▶ [✦ skill] km:search ━━━━━● ✓ 0.6s». The rail says the state
// only — running «━━●───» (a fixed look: the engine gives no share done, so no percent is drawn), done «━━━━━●», failed
// «━━━━━✕», stopped «━━╳───». `ms` = the time this mod saw it run (first drawn running → first drawn settled, index.js),
// shown «경과 1.8s» while running and «0.6s» when done; under 0.1 s or unknown = no time. Plain text: the engine takes the
// label as a string (its tool name's place) and draws the input after it.
const RAIL_KIND = { skill: '✦ skill', mcp: '◇ MCP  ', tool: '▪ 도구 ' }
export function railState(p) {
  const x = p || {}
  if (x.isInterrupted === true) return 'stopped'
  if (x.isErrored === true) return 'failed'
  return x.isRunning === true ? 'running' : 'done'
}
function secs(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 100 ? (ms < 10000 ? (Math.round(ms / 100) / 10).toFixed(1) : String(Math.round(ms / 1000))) + 's' : ''
}
export function railLabel(kind, name, state, ms) {
  const badge = '[' + (RAIL_KIND[kind] || RAIL_KIND.tool) + ']'
  const t = secs(ms)
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '') || '?'
  const tail = state === 'running' ? '━━●───' + (t ? ' 경과 ' + t : '')
    : state === 'failed' ? '━━━━━✕ 실패' + (t ? ' ' + t : '')
      : state === 'stopped' ? '━━╳─── 중단'
        : '━━━━━● ✓' + (t ? ' ' + t : '')
  return '─▶ ' + badge + ' ' + n + ' ' + tail
}

// The band's 도구 item under pipeline-rail: «▐▇▇░░▌» = this name's calls against the kind's most-called (cells × 1 step,
// at least one cell while it has a call) — the share of use, read before the count beside it.
export function heatBar(n, max, cells = 4) {
  const w = count(cells, 1, 12, 4)
  const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
  const m = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 0
  const k = v && m ? Math.max(1, Math.min(w, Math.round((v / m) * w))) : 0
  return '▐' + '▇'.repeat(k) + '░'.repeat(w - k) + '▌'
}

// ── 4안 cockpit-pill (DESIGNS 안 4 · 주인) ──
// A capsule «▐ 본문 ▌» around one piece. PromptHint takes plain text only (engine: hint / tail strings, drawn dim), so
// there the capsules are plain marks (design 4 «PromptHint 에는 단색 기호 캡슐»); the ▣ line's capsules keep the
// pieces' own inks (pillSegments).
export const pill = (text) => '▐ ' + text + ' ▌'
// Segments → capsules: `groups` = arrays of segments, each group one capsule whose marks take its first ink.
export function pillSegments(groups) {
  const out = []
  for (const g of groups) {
    if (!g || !g.length) continue
    const ink = g[0].color || 'text'
    out.push({ text: '▐ ', color: ink }, ...g, { text: ' ▌', color: ink })
  }
  return out
}
