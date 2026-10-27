// lane: ui · owner: 봇 — r2 B (봇 ②″ · ③): the pure part
// of a tmux jump and its way back (no `$`; index.js runs the argv lists with $.process.run — no shell, so «=S:» needs no
// quoting there). Only the person's own terminal moves, never a guessed one (봇 r2 B·C 검토 F1): a press does not
// say which client pressed, so the presser = the ONE client that can type (not read-only) looking at this window, of
// all the server's clients (list-clients — a client on a view session of ours looks at the same window ids); two or
// more = refused, nothing guessed (client_activity is not the presser). The target = a registry row's tmux session and
// window, checked by shape and found in that session's window list by exact name (or id) — measured 10-18 on tmux 3.7c
// in a private server: display-message -t answers rc 0 with some other window for a window or session that does not
// exist, list-windows -t =S fails (rc 1) for a missing session and for a name that is only a prefix. A child of this bot
// is another window of the same tmux session (bot:bot-NNNNNN); only this very window is refused (window ids are
// one per server — display-message -t <pane> names a view session, not the real one, so no session name is compared).
// No other client moves (F2): switch-client -t S:W makes W the current window of S for every client of S (봇
// probe @1→@2), so a window that is not S's current one is shown through a view session of our own (moveArgs). The way
// back is kept on the tmux server per client (user option @mh-back-<tty>, newest last, BACK_MAX deep): the session
// jumped to finds it there, draws «← 돌아가기» and runs it, the same way (no window of anyone's session selected). Each
// hop carries the client's generation (F3): a tty is handed to a new client after a detach and the option outlives the
// client (봇 probe), so a hop of another generation is no way back and is dropped at the next jump. Each hop also
// carries its own mark (봇 R2 — stampOf): the session landed on asks for the keys once per landing, and the same way
// taken twice is two landings.
// 10-25 창 어댑터: the argv lists themselves are built in src/lib/window/tmux.js (the same lists as before) — this file
// still makes every choice of which one; VIEW_PREFIX is that file's one prefix (the session lane says the same one).
import { VIEW_PREFIX, setOptionArgv, unsetOptionArgv, switchClientArgv, viewSwitchArgv } from '../../lib/window/tmux.js'
export { VIEW_PREFIX }
export const NAME_RE = /^[A-Za-z0-9_.@$-]+$/ // a tmux session or window name this lane passes on
export const TTY_RE = /^\/dev\/[A-Za-z0-9]+$/
export const WINDOW_ID_RE = /^@\d+$/
export const GEN_RE = /^\d+\.\d+$/ // a client's generation: «client_pid.client_created»
export const BACK_MAX = 5 // jumps kept per client (newest last)

// A read that could not tell (봇 R1): the tmux call failed or could not be run — not «none», not «gone». Where a
// plan meets it, nothing moves and the way back is neither written over nor dropped (the next press reads again).
export const LOST = Object.freeze({ lost: true })

// A view session of ours: grouped with a real session (the same windows, its own current window), named after the
// client and the time, VIEW_OF = the real session it shows (a session user option, read back in CLIENT_FMT).
export const VIEW_OF = '@mh-view-of'

// Formats asked of tmux. HERE = this pane's window id only (with a view session up, display-message -t <pane> names the
// view — measured). CLIENT = «|»-separated, the session name last (a name may hold spaces or «|»: the rest of the line).
export const HERE_FMT = '#{window_id}'
export const CLIENT_FMT = '#{client_tty}|#{window_id}|#{client_readonly}|#{client_pid}.#{client_created}|#{' + VIEW_OF + '}|#{session_name}'
export const WINDOWS_FMT = '#{window_id} #{window_active} #{window_name}'

// A registry row's tmux place { session, window, id? } this lane may move a client to, or null (no tmux · a shape not
// passed on). REGISTRY.md: tmux = { session, window, target: «session:window», window_id? } — id = the window's tmux
// id when the row has one (R5: a top-level bot's window name changes under automatic-rename, its id does not).
// 10-19 ② (bot-NNNNNN): a row written before the session lane named the bot's own session (core.js homeSession) may
// name a view session of ours — gone once its client left, while the window lives on in the group. Such a row is looked
// for in the session of its nearest forebear whose row names a real one (the bot's session — the same group's windows).
// Any other row as it is.
export function rehome(entry, entries) {
  const t = entry && entry.tmux
  if (!t || typeof t.session !== 'string' || !t.session.startsWith(VIEW_PREFIX)) return entry
  const byId = new Map((entries || []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]))
  const seen = new Set([entry.id])
  let p = byId.get(entry.parent_id)
  while (p && !seen.has(p.id)) {
    seen.add(p.id)
    const s = p.tmux && typeof p.tmux.session === 'string' ? p.tmux.session : ''
    if (NAME_RE.test(s) && !s.startsWith(VIEW_PREFIX)) return { ...entry, tmux: { ...t, session: s, target: s + ':' + t.window } }
    p = byId.get(p.parent_id)
  }
  return entry
}

export function targetOf(entry) {
  const t = entry && entry.tmux
  if (!t || typeof t !== 'object') return null
  let session = typeof t.session === 'string' ? t.session : ''
  let window = typeof t.window === 'string' ? t.window : ''
  if ((!session || !window) && typeof t.target === 'string') {
    const i = t.target.indexOf(':')
    if (i > 0) { session = t.target.slice(0, i); window = t.target.slice(i + 1) }
  }
  if (!NAME_RE.test(session) || !NAME_RE.test(window)) return null
  const place = { session, window }
  if (WINDOW_ID_RE.test(t.window_id || '')) place.id = t.window_id
  return place
}

// `display-message -p -t <this pane> HERE_FMT` → { window } (this pane's window id), or null.
export function parseHere(stdout) {
  const window = String(stdout || '').trim()
  return WINDOW_ID_RE.test(window) ? { window } : null
}

// `list-clients -F CLIENT_FMT` (every client of the server) → [{ tty, window, ro, gen, place }] (valid lines only).
// gen = the client's generation ('' when tmux gave none) · place = the real session the client is on (the view's
// VIEW_OF when on a view of ours), null when not a name passed on.
export function parseClients(stdout) {
  const out = []
  for (const line of String(stdout || '').split('\n')) {
    const [tty, window, ro, gen, viewOf, ...rest] = line.replace(/\s+$/, '').split('|')
    if (!TTY_RE.test(tty || '') || !WINDOW_ID_RE.test(window || '')) continue
    const session = rest.join('|')
    const real = viewOf && session.startsWith(VIEW_PREFIX) ? viewOf : session
    out.push({ tty, window, ro: ro === '1', gen: GEN_RE.test(gen || '') ? gen : '', place: NAME_RE.test(real) ? real : null })
  }
  return out
}

// The client that pressed (봇 F1): the one client that can type (a read-only one cannot have pressed) looking at
// `window` — a session has one current window, all its clients see it. Two or more = { refuse: 'many' }: the press does
// not say whose it was, so none is guessed. null = nobody looks at this window.
export function pickClient(clients, window) {
  const here = (clients || []).filter((c) => c && c.window === window && !c.ro)
  if (here.length > 1) return { refuse: 'many' }
  return here.length ? here[0] : null
}

// 10-19 ② (주인 20:47): on the window a jump LANDED on, the bot's own
// terminal tab is often there too (every bot session has its client attached) — two clients look at it, pickClient says
// «many», and the «← 돌아가기» line was never drawn. Here the way back belongs to the one client whose newest jump landed
// on this very window (its own generation · backHere); one client = as pickClient; two or more that landed here, or
// none of several = { refuse: 'many' } as before (nothing guessed). stacks = Map(tty → that client's way back, read now).
export function pickLanded(clients, here, stacks) {
  const all = (clients || []).filter((c) => c && here && c.window === here.window && !c.ro)
  if (all.length <= 1) return all.length ? all[0] : null
  const landed = all.filter((c) => backHere(here, (stacks && stacks.get(c.tty)) || [], c.gen))
  return landed.length === 1 ? landed[0] : { refuse: 'many' }
}

// `list-windows -t =<session> -F WINDOWS_FMT` → the window to go to and the session's current window: { to: '@id' |
// null, current: '@id' | null }. to = the window with id `id` when that session has it (R5: a renamed window) · else the
// one named `window` exactly (or whose id it is) · else null (gone).
export function findWindow(stdout, window, id) {
  let byId = null
  let byName = null
  let current = null
  for (const line of String(stdout || '').split('\n')) {
    const m = /^(@\d+) ([01]) (.*)$/.exec(line.replace(/\s+$/, ''))
    if (!m) continue
    if (m[2] === '1') current = m[1]
    if (id && m[1] === id) byId = m[1]
    if (!byName && (m[3] === window || m[1] === window)) byName = m[1]
  }
  return { to: byId || byName, current }
}

// The server user option that holds one client's way back.
export function backOption(tty) {
  return '@mh-back-' + String(tty || '').replace(/^\/dev\//, '').replace(/[^A-Za-z0-9]/g, '')
}

function placeOk(p) {
  const i = String(p || '').lastIndexOf(':')
  return i > 0 && NAME_RE.test(p.slice(0, i)) && WINDOW_ID_RE.test(p.slice(i + 1))
}

// «from|to|gen|at;…» (newest last): from = where the client was, to = where it went — each «real session:@window id»
// (never a view session: a view is dropped by tmux when its client leaves it) · gen = the generation of the client that
// jumped ('' when none was given) · at = this jump's own mark (봇 R2: the same way taken twice is two arrivals, and
// the session landed on can only tell them apart by it — AT_RE, stampOf; a hop noted before it had none, and keeps none).
export const AT_RE = /^[0-9a-z]+\.[0-9a-z]+$/

export function parseBack(v) {
  const out = []
  for (const part of String(v || '').trim().split(';')) {
    const [from, to, gen, at] = part.split('|')
    if (!placeOk(from) || !placeOk(to)) continue
    const hop = { from, to, gen: GEN_RE.test(gen || '') ? gen : '' }
    if (AT_RE.test(at || '')) hop.at = at
    out.push(hop)
  }
  return out.slice(-BACK_MAX)
}

export function formatBack(stack) {
  return (stack || []).slice(-BACK_MAX).map((b) => b.from + '|' + b.to + (b.gen || b.at ? '|' + (b.gen || '') : '') + (b.at ? '|' + b.at : '')).join(';')
}

// A jump's mark: the time of the press and the press's number in this process, each in base 36 — two jumps of one
// process never share it (the time alone can: two presses inside one clock tick).
export function stampOf(now, seq) {
  return Math.max(0, Math.floor(Number(now) || 0)).toString(36) + '.' + Math.max(0, Math.floor(Number(seq) || 0)).toString(36)
}

// The hops of one client generation (F3): the others were left by a client gone before this one got the tty.
function ofGen(stack, gen) {
  return (stack || []).filter((h) => h && h.gen === (gen || ''))
}

// «session:@id» → { session, window }.
export function splitPlace(place) {
  const i = String(place || '').lastIndexOf(':')
  return { session: place.slice(0, i), window: place.slice(i + 1) }
}

// The view session's name for one client: VIEW_PREFIX + the tty's name + the time in base 36 (a new one per move; the
// one left behind is gone by then — destroy-unattached).
export function viewName(tty, now) {
  return VIEW_PREFIX + String(tty || '').replace(/^\/dev\//, '').replace(/[^A-Za-z0-9]/g, '') + '-' + Math.max(0, Math.floor(Number(now) || 0)).toString(36)
}

// How one client is shown window `id` of the real session `session` without changing what any other client sees
// (봇 F2), as ONE argv list (tmux runs a «;» list in order, stops at the first failure, nothing of another client's
// in between). `id` is the session's current window → switch-client to the session (no window selected). Else → a view
// session of ours, grouped with it (new-session -d -t: the same windows, its own current window), dropped by tmux once
// no client is on it (destroy-unattached — set before the switch: a switch that fails leaves nothing behind), its real
// session noted (VIEW_OF), and this client alone switched to its window. Measured 10-18 on tmux 3.7c in private servers
// (f2/probe_view · probe_fail): B's other client stays on its window, B's current window is unchanged, the view is
// gone once the client leaves it or the switch fails, B keeps its windows. set-option -t takes a pane target, so the
// view is named «=V:» there (a bare «=V» = no such session, measured); new-session · switch-client take «=V».
export function moveArgs({ tty, session, id, current, now }) {
  if (id === current) return { go: switchClientArgv(tty, '=' + session), view: null }
  const view = viewName(tty, now)
  return { go: viewSwitchArgv({ session, view, viewOf: VIEW_OF, tty, id }), view }
}

// The jump once the reads are in: { set, go, to } or { refuse }. here = parseHere (this pane) · entry = the row pressed ·
// clients = parseClients (every client of the server) · windows = findWindow of the target session (null = no such
// session: a list of the server's sessions read without it) · stack = parseBack of the presser's option (hops of
// another client generation dropped) · now = the time (the view's name) · seq = this press's number in this process
// (with now, the hop's own mark — stampOf; none given = no mark). Any read LOST = refused, nothing written.
// Refusals: no-target (no tmux place) · lost (a read failed — 봇 R1) · no-client (nobody looks at this window, or
// the one looking is on a session not passed on) · many (two or more could have pressed — F1) · gone (no such session
// or window) · self (that row's window is this very window).
export function jumpPlan({ here, entry, clients, windows, stack, now, seq }) {
  const t = targetOf(entry)
  if (!t) return { refuse: 'no-target' }
  if (here === LOST || clients === LOST) return { refuse: 'lost' }
  if (!here) return { refuse: 'no-client' }
  const c = pickClient(clients, here.window)
  if (c && c.refuse) return { refuse: c.refuse }
  if (!c || !c.place) return { refuse: 'no-client' }
  if (windows === LOST) return { refuse: 'lost' }
  if (!windows || !windows.to || !windows.current) return { refuse: 'gone' }
  if (windows.to === here.window) return { refuse: 'self' }
  // the way back as it stands could not be read: a note written now would put this hop over hops never read (R1)
  if (stack === LOST) return { refuse: 'lost' }
  const hop = { from: c.place + ':' + here.window, to: t.session + ':' + windows.to, gen: c.gen || '' }
  if (seq) hop.at = stampOf(now, seq)
  return {
    set: setOptionArgv(backOption(c.tty), formatBack([...ofGen(stack, c.gen), hop])),
    go: moveArgs({ tty: c.tty, session: t.session, id: windows.to, current: windows.current, now }).go,
    tty: c.tty,
    to: t.session + ':' + t.window,
  }
}

// Is there a way back from here for this client (gen = its generation)? Its newest jump landed on this very window
// (window ids are one per server: the session it shows through does not matter) — a jump of this client, not of the
// one that had the tty before (F3).
export function backHere(here, stack, gen) {
  const top = (stack || [])[(stack || []).length - 1]
  return Boolean(here && top && top.gen === (gen || '') && splitPlace(top.to).window === here.window)
}

// The way back from here: { go, after, from } · { lost, from } · null when the client's newest jump did not land here
// (or was not its own — gen = its generation). windows = findWindow of the session it came from — null = that session
// is gone (a list of the server's sessions read without it) → go = null, the hop dropped · LOST (or a list that names
// no current window) = could not tell → { lost }: nothing moved, nothing dropped (봇 R1 — a failed lookup is no
// proof the session is gone) · go = moveArgs back to the window it came from (that session's current window when the
// window is gone) — no window of anyone else's session selected · after = the stack without that jump (the option
// unset when empty) · from = that session's name.
export function backPlan({ here, tty, gen, stack, windows, now }) {
  const list = stack || []
  if (!backHere(here, list, gen) || !TTY_RE.test(tty || '')) return null
  const top = list[list.length - 1]
  const rest = ofGen(list.slice(0, -1), gen)
  const from = splitPlace(top.from)
  if (windows === LOST || (windows && !windows.current)) return { lost: true, from: from.session }
  const after = rest.length ? setOptionArgv(backOption(tty), formatBack(rest)) : unsetOptionArgv(backOption(tty))
  if (!windows) return { go: null, after, from: from.session }
  return { go: moveArgs({ tty, session: from.session, id: windows.to || windows.current, current: windows.current, now }).go, after, from: from.session }
}

// What a refusal says (one line, $.ui.status): the reason in plain words.
export const REFUSE_TEXT = {
  ended: '끝난 세션이라 창이 닫혔어요', // R4: a row the registry calls ended (its window closed with it) — no tmux call
  'no-target': '그 세션은 tmux 자리가 없어요',
  lost: 'tmux 에서 지금 자리를 읽지 못해 그대로 두었어요 — 다시 눌러 보세요',
  'no-client': '이 창을 보는 화면을 못 찾았어요',
  many: '이 창을 보는 화면이 여럿이라 누른 쪽을 모르겠어요',
  gone: '그 세션의 tmux 창이 없어요',
  self: '지금 보고 있는 창이에요',
  // 10-25 창 어댑터: herdr · Orca (lib/window caps.jump false · 1판) — this session or the row pressed is not in tmux
  // (one wording for both — verifier 10-25 #4: an Orca session was told «herdr»)
  'no-jump': '이 창 도구(herdr · Orca)에서는 아직 화면 옮기기가 안 돼요 — 그 탭을 직접 고르세요',
}
