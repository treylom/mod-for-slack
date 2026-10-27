// lane: window · 10-25 창 어댑터 (bot-NNNNNN 발주 A · 기준 문서 1판 설계 메모 «창 어댑터»): which window tool this session
// opens its child windows with. Pure (no `$`): the lane files read the env names below with literal $.env.get calls and
// pass the values (or a getter); they also run the chosen backend's argv (tmux.js · herdr.js) — the mod validator follows
// `$` only into same-file functions, so the backend's here/open/close steps are run by the lane, not returned as closures.
//
// pickBackend(env, forced) → { name, caps: { jump }, refuse? }
//   auto (forced omitted / 'auto' / anything else): TMUX set and not Orca's stand-in socket → tmux · HERDR_ENV=1 → herdr ·
//   ORCA_TERMINAL_HANDLE set, or TMUX naming Orca's stand-in socket → orca (refused, 1판) · else none (refused, the words
//   spawn_child said before). The order matters: tmux started inside a herdr pane (K4 ①) has both → tmux, its innermost.
//   forced (session.window_backend): 'tmux' · 'herdr' · 'none' = that one whatever the env says ('tmux' = the old way:
//   display-message decides).
import { NAME as HERDR, CAPS as HERDR_CAPS } from './herdr.js'
import { NONE, ORCA, CAPS as NONE_CAPS, NONE_REFUSAL, ORCA_REFUSAL } from './none.js'

export const TMUX_NAME = 'tmux'
export const BACKENDS = Object.freeze(['auto', 'tmux', 'herdr', 'none'])
// Orca's agent-teams tmux stand-in: TMUX=/tmp/orca-claude-agent-teams/<team>,0,1 (claude-agent-teams-service.ts:33-40)
export const ORCA_FAKE_SOCKET = 'orca-claude-agent-teams'
// the env names the lanes read for this (literal $.env.get in each lane file)
export const ENV_NAMES = Object.freeze(['TMUX', 'HERDR_ENV', 'ORCA_TERMINAL_HANDLE'])

const TMUX_B = Object.freeze({ name: TMUX_NAME, caps: Object.freeze({ jump: true }) })
const HERDR_B = Object.freeze({ name: HERDR, caps: HERDR_CAPS })
const NONE_B = Object.freeze({ name: NONE, caps: NONE_CAPS, refuse: NONE_REFUSAL })
const ORCA_B = Object.freeze({ name: ORCA, caps: NONE_CAPS, refuse: ORCA_REFUSAL })

export function normBackend(v) {
  return typeof v === 'string' && BACKENDS.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : 'auto'
}

export function pickBackend(env, forced) {
  const get = typeof env === 'function' ? env : (n) => (env && typeof env === 'object' ? env[n] : undefined)
  const f = normBackend(forced)
  if (f === 'tmux') return TMUX_B
  if (f === 'herdr') return HERDR_B
  if (f === 'none') return NONE_B
  const tmux = get('TMUX')
  const orcaFake = typeof tmux === 'string' && tmux.split(',')[0].includes(ORCA_FAKE_SOCKET)
  if (typeof tmux === 'string' && tmux !== '' && !orcaFake) return TMUX_B
  if (get('HERDR_ENV') === '1') return HERDR_B
  const orca = get('ORCA_TERMINAL_HANDLE')
  if ((typeof orca === 'string' && orca !== '') || orcaFake) return ORCA_B
  return NONE_B
}
