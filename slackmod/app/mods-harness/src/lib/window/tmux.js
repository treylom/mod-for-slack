// lane: window (shared by session + ui) · 10-25 창 어댑터 (bot-NNNNNN 발주 A · 기준 문서 1판 설계 메모 «창 어댑터»):
// EVERY argv this mod gives tmux lives here, and the tmux shapes read back (display-message lines, the registry's tmux
// place). No `$` — pure builders and parsers; the lane files (session/index.js · ui/index.js) run the argv lists with
// $.process.run (no shell). Moved here unchanged from session/core.js (buildTmuxArgv · HERE_FMT · homeSession ·
// parseHere · closeTargets · tmuxSocket · VIEW_PREFIX) and from the argv literals of session/index.js, ui/index.js and
// ui/lib/jump.js — core.js and jump.js re-export the moved names, so their callers and tests did not change.

const BIN = 'tmux'
// the argv head: this binary, on `socket` when one is given (-S) — the session lane names its own server's socket
// (from TMUX), the ui lane runs on the default one
export function base(socket) {
  return socket ? [BIN, '-S', socket] : [BIN]
}

// ── the session lane: open · here · close ──────────────────────────────────────────────────────────────────────

// tmux new-window in the parent's tmux session; -d keeps focus where the person is; -e passes env explicitly
// (a new window inherits the tmux server's env, not the parent process's).
export function buildTmuxArgv(p) {
  const argv = base(p.socket)
  argv.push('new-window', '-d', '-P', '-F', '#{session_name}:#{window_name}', '-t', `=${p.tmuxSession}:`, '-n', p.window, '-c', p.cwd)
  for (const [k, v] of Object.entries(p.env)) argv.push('-e', `${k}=${v}`)
  argv.push('--', ...p.claudeArgv)
  return argv
}

// ── 10-19 (봇 하위 세션 ② · bot-NNNNNN 재현): where a session's window really lives ──
// The ui lane's jump shows a window through a view session of its own («mh-view-<tty>-<time>», grouped with the bot's
// session, destroy-unattached — ui/lib/jump.js). display-message -t <pane> then names the VIEW session, so spawn put
// children into it and wrote it in the registry; once the person's client left, that session was gone and the end rule's
// kill-window «=view:=name» failed — the window lived on (bot-NNNNNN: registry ended 02:18, its process still
// running 13 h later). One prefix for both lanes (session/core.js and ui/lib/jump.js re-export it).
export const VIEW_PREFIX = 'mh-view-'
const SESSION_RE = /^[A-Za-z0-9_.@$-]+$/
// The session to name for this pane: the view session's own (its @mh-view-of, set by jump.js), else its group (the bot's
// session it was made with «new-session -t»), else as read. A session that is not a view is as read.
export function homeSession(name, group, viewOf) {
  const n = typeof name === 'string' ? name : ''
  if (!n.startsWith(VIEW_PREFIX)) return n || null
  for (const s of [viewOf, group]) if (typeof s === 'string' && SESSION_RE.test(s) && !s.startsWith(VIEW_PREFIX)) return s
  return n
}
export const HERE_FMT = '#{session_name}\t#{window_name}\t#{window_id}\t#{session_group}\t#{@mh-view-of}'
// One display-message line (HERE_FMT) → { session, window, target, window_id? } | null.
export function parseHere(stdout) {
  const [name, window, windowId, group, viewOf] = String(stdout || '').replace(/\n+$/, '').split('\t')
  const session = homeSession(name, group, viewOf)
  if (!session) return null
  const place = { session, window, target: `${session}:${window}` }
  if (/^@\d+$/.test(windowId || '')) place.window_id = windowId
  return place
}
// The -t targets to close a child's window, in order: its window id (checked by name before use — ids restart with
// the tmux server) · the session and window as written · for a row written with a view session, the same window name in
// `home` (the parent's own session, read now; the view's windows are that group's). Each one once.
// 10-25: `place` (the row's place{backend,id,label,home}) first when it is a tmux one with a window id — the same id the
// tmux block carries once the child wrote it, so the targets do not change; a row without place = as before.
export function closeTargets(tmux, home, place) {
  const t = tmux || {}
  const out = []
  const seen = new Set()
  const add = (c) => { const k = c.id || c.target; if (!seen.has(k)) { seen.add(k); out.push(c) } }
  if (place && place.backend === BIN && /^@\d+$/.test(place.id || '') && typeof place.label === 'string' && place.label) add({ id: place.id, check: place.label })
  if (/^@\d+$/.test(t.window_id || '')) add({ id: t.window_id, check: t.window })
  if (t.session && t.window) add({ target: `=${t.session}:=${t.window}` })
  if (t.window && typeof t.session === 'string' && t.session.startsWith(VIEW_PREFIX) && home && home !== t.session && SESSION_RE.test(home)) add({ target: `=${home}:=${t.window}` })
  return out
}

// 10-25 registry place{backend,id,label,home} of a tmux window (the old tmux block stays beside it): id = the window id
// when known (a child writes its own at its start), label = the window name, home = the session
export function placeOf(session, window, windowId) {
  return { backend: BIN, id: /^@\d+$/.test(windowId || '') ? windowId : null, label: window, home: session }
}

// TMUX = "<socket>,<server pid>,<session index>"
export function tmuxSocket(tmuxVar) {
  if (typeof tmuxVar !== 'string' || !tmuxVar) return null
  const s = tmuxVar.split(',')[0]
  return s || null
}

// display-message for this pane (`pane` = TMUX_PANE; none = tmux's own pick) in format `fmt` (the session lane's
// HERE_FMT by default · the ui lane asks its own)
export function hereArgv(socket, pane, fmt) {
  return [...base(socket), 'display-message', '-p', ...(pane ? ['-t', pane] : []), fmt || HERE_FMT]
}
// the check before a close by window id: that id's id and name (compared with the row's window name)
export const WINDOW_CHECK_FMT = '#{window_id}\t#{window_name}'
export function windowCheckArgv(socket, id) {
  return [...base(socket), 'display-message', '-p', '-t', id, WINDOW_CHECK_FMT]
}
export function killWindowArgv(socket, target) {
  return [...base(socket), 'kill-window', '-t', target]
}

// ── the ui lane: the bot's name · jump and its way back (ui/lib/jump.js plans them) ───────────────────────────
export function sessionNameArgv(pane) {
  return [BIN, 'display-message', '-p', '-t', pane, '#S']
}
export function listWindowsArgv(session, fmt) {
  return [BIN, 'list-windows', '-t', '=' + session, '-F', fmt]
}
export function listSessionsArgv() {
  return [BIN, 'list-sessions', '-F', '#{session_name}']
}
export function listClientsArgv(fmt) {
  return [BIN, 'list-clients', '-F', fmt]
}
export function showOptionArgv(name) {
  return [BIN, 'show-options', '-gqv', name]
}
export function setOptionArgv(name, value) {
  return [BIN, 'set-option', '-g', name, value]
}
export function unsetOptionArgv(name) {
  return [BIN, 'set-option', '-gu', name]
}
export function switchClientArgv(tty, target) {
  return [BIN, 'switch-client', '-c', tty, '-t', target]
}
// one «;» list: a view session of ours grouped with `session` (destroy-unattached, its real session noted in `viewOf`
// = the option name), then this client alone switched to window `id` in it — see ui/lib/jump.js moveArgs
export function viewSwitchArgv({ session, view, viewOf, tty, id }) {
  return [BIN, 'new-session', '-d', '-t', '=' + session, '-s', view,
    ';', 'set-option', '-t', '=' + view + ':', 'destroy-unattached', 'on',
    ';', 'set-option', '-t', '=' + view + ':', viewOf, session,
    ';', 'switch-client', '-c', tty, '-t', '=' + view + ':' + id]
}
