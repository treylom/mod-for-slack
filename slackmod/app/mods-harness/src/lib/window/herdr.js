// lane: window · 10-25 창 어댑터 (bot-NNNNNN 발주 A · 기준 문서 1판 설계 메모 K4 ② · 설계 메모 «창 어댑터»): herdr — a child opens
// as a herdr TAB in the parent's own workspace. No `$`: argv builders and parsers; session/index.js runs them.
// Measured on herdr 0.9.5 (macOS arm64 · 10-24 bot-NNNNNN measure.md + 10-25 scripts-A probes):
// - here = the pane's own env, set by herdr for every pane: HERDR_ENV=1 · HERDR_WORKSPACE_ID · HERDR_TAB_ID ·
//   HERDR_PANE_ID · HERDR_SOCKET_PATH (the CLI honours it) · HERDR_BIN_PATH. TMUX/TMUX_PANE are not passed into a pane.
// - open = 2 steps: `tab create --workspace --cwd --label --env K=V… --no-focus` has no «command» slot → JSON
//   {result:{root_pane:{pane_id,tab_id,terminal_id,workspace_id}}} → `pane run <pane> <line>` TYPES the line + Enter
//   into the new tab's shell. While that shell is still starting (canonical mode) herdr refuses a line over 1024 bytes
//   (pane_send_failed — measured: 900 ok · 3000/6000 refused) and a real child argv is 674 B with the default config
//   alone. So the child's command goes into a 0600 start file (one quoting function, below) and the typed line is short:
//   « exec sh '<file>'» (leading space: kept out of shell history where the shell honours it). `exec` = the pane ends
//   when the child ends (measured: pane_not_found + tab_not_found after the command exits) — as a tmux window does.
// - close = `pane get <pane>` (same terminal_id and tab as opened — a pane id can be given again; the terminal id is one
//   per terminal) → `pane close <pane>` (measured: then pane get = pane_not_found rc 1 · its one-pane tab gone too).
// - no jump in 1판 (caps.jump false): the ui lane says so instead of moving anything.

export const NAME = 'herdr'
export const CAPS = Object.freeze({ jump: false })
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/

// the herdr binary: the pane's own HERDR_BIN_PATH when it is an absolute path, else «herdr» on PATH
export function binOf(get) {
  const b = typeof get === 'function' ? get('HERDR_BIN_PATH') : null
  return typeof b === 'string' && /^\/[^\0]+$/.test(b) ? b : 'herdr'
}

// this pane's place from its env, or null (not a herdr pane · an id that is not one)
export function here(get) {
  if (typeof get !== 'function' || get('HERDR_ENV') !== '1') return null
  const workspace = get('HERDR_WORKSPACE_ID')
  const pane = get('HERDR_PANE_ID')
  const tab = get('HERDR_TAB_ID')
  if (!ID_RE.test(String(workspace || '')) || !ID_RE.test(String(pane || ''))) return null
  return { backend: NAME, workspace, pane, tab: ID_RE.test(String(tab || '')) ? tab : null, socket: get('HERDR_SOCKET_PATH') || null }
}

// the registry place of a pane this session is in (its own row) — no terminal id (that would need a call)
export function placeOfHere(h) {
  return h ? { backend: NAME, id: h.pane, label: null, home: h.workspace, tab: h.tab } : null
}

// ── the one quoting function: every word typed into a herdr pane or written to a start file goes through it ──
export function shQuote(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`
}
// a word with a control character (a line break would end the typed line early) = no line at all (null)
const CONTROL = /[\u0000-\u001f\u007f]/
export function shLine(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => CONTROL.test(String(a)))) return null
  return argv.map(shQuote).join(' ')
}
// the 0600 start file: removes itself, then becomes the child's command (exec — the pane ends with it)
export function startFileText(argv) {
  const line = shLine(argv)
  return line === null ? null : `# mod-for-slack child start (herdr) — removes itself, then runs the child\nrm -f -- "$0"\nexec ${line}\n`
}
// the line typed into the new tab
export function typedLine(startPath) {
  return ' exec sh ' + shQuote(startPath)
}

// tab create in `workspace` with cwd · label · env (non-secret values only — names in env, secrets stay in files)
export function tabCreateArgv(bin, { workspace, cwd, label, env }) {
  const argv = [bin, 'tab', 'create', '--workspace', workspace, '--cwd', cwd, '--label', label]
  for (const [k, v] of Object.entries(env || {})) argv.push('--env', `${k}=${v}`)
  argv.push('--no-focus')
  return argv
}
export function paneRunArgv(bin, pane, line) {
  return [bin, 'pane', 'run', pane, line]
}
export function paneGetArgv(bin, pane) {
  return [bin, 'pane', 'get', pane]
}
export function paneCloseArgv(bin, pane) {
  return [bin, 'pane', 'close', pane]
}
// a tab create that answered 0 but whose answer could not be read (verifier 10-25 #3): the tab is found again by its
// label (a child's shown name — one per child) in that workspace and closed, so a retry leaves no idle shell tab
export function tabListArgv(bin, workspace) {
  return [bin, 'tab', 'list', '--workspace', workspace]
}
export function tabCloseArgv(bin, tab) {
  return [bin, 'tab', 'close', tab]
}
export function tabByLabel(stdout, label) {
  const j = json(stdout)
  const tabs = j && j.result && Array.isArray(j.result.tabs) ? j.result.tabs : []
  const hit = tabs.filter((t) => t && t.label === label && ID_RE.test(String(t.tab_id || '')))
  return hit.length === 1 ? hit[0].tab_id : null
}

function json(stdout) {
  try { return JSON.parse(String(stdout || '').trim().split('\n').pop()) } catch (err) { return null }
}
function paneShape(p) {
  if (!p || typeof p !== 'object' || !ID_RE.test(String(p.pane_id || ''))) return null
  return { pane: p.pane_id, tab: ID_RE.test(String(p.tab_id || '')) ? p.tab_id : null, terminal: ID_RE.test(String(p.terminal_id || '')) ? p.terminal_id : null, workspace: ID_RE.test(String(p.workspace_id || '')) ? p.workspace_id : null }
}
// tab create's answer → { pane, tab, terminal, workspace } | null
export function parseCreated(stdout) {
  const j = json(stdout)
  return paneShape(j && j.result && j.result.root_pane)
}
// pane get's answer → { pane, tab, terminal, workspace } | null
export function parsePane(stdout) {
  const j = json(stdout)
  return paneShape(j && j.result && j.result.pane)
}
// herdr's own error words from an answer (JSON error.code/message, else stderr), short
export function errorOf(r) {
  const j = json(r && r.stdout)
  const e = j && j.error
  const s = e ? `${e.code || 'error'}: ${e.message || ''}` : String((r && r.stderr) || '').trim()
  return s.slice(0, 200)
}

// the registry place of a tab this session opened
export function placeOf(created, label) {
  return { backend: NAME, id: created.pane, label, home: created.workspace, tab: created.tab, terminal: created.terminal }
}
// is the pane herdr answered for the place's id still the one opened at spawn (same terminal · same tab)?
export function samePane(place, got) {
  if (!place || !got || got.pane !== place.id) return false
  if (place.terminal && got.terminal !== place.terminal) return false
  if (place.tab && got.tab !== place.tab) return false
  return true
}
// a registry place this lane wrote for herdr (the shape close_child trusts)
export function placeOk(place) {
  return Boolean(place && place.backend === NAME && ID_RE.test(String(place.id || '')))
}
