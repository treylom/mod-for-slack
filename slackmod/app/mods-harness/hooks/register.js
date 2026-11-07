// mods-harness entry. One module per lane; each lane owns only its src/<lane>/ folder.
// A lane whose register throws is reported and skipped so other lanes still load.
// Safety note: the mod-down detector lives OUTSIDE the mod (settings command hook) on purpose.
// Static-analysis rule (claude plugin validate, 2.1.296): call each imported lane function directly —
// passing a lane function through a parameter (run(name, fn, ...)) is rejected. Run validate before every commit.
// Hooks-lane contract: collect EVERY lane's registration error, then call finalizeRegistration({errors}) once.
// Without that call the hooks lane stays "not finalized" and fails closed on every classic event.
import { register as registerConfig } from '../src/config/index.js'
import { register as registerHooksPort, registerPromptLifecycle, finalizeRegistration } from '../src/hooks-port/index.js'
import { register as registerSession } from '../src/session/index.js'
import { register as registerUi } from '../src/ui/index.js'
import { register as registerTools } from '../src/tools/index.js'
import { register as registerMemory, registerReplyStrip } from '../src/memory/index.js'
import { register as registerOwner } from '../src/owner/index.js'

function report(name, err, errors) {
  const msg = `lane ${name} failed to register: ${err && err.message}`
  console.error(`[mod-for-slack] ${msg}`)
  errors.push(msg)
}

export function register(on, options) {
  const errors = []
  try { registerConfig(on, options) } catch (err) { report('config', err, errors) }
  // The «프로젝트:» reply-line strip runs BEFORE the hooks-port gates (first registered = first to run, probe 10-18),
  // so no gate and no Slack message ever sees that line.
  try { registerReplyStrip(on, options) } catch (err) { report('memory-reply-strip', err, errors) }
  // Owner devices (약속 검사 · 미루는 말 · 답 늦음 막기 · 스레드 태그) run right after the strip and BEFORE the hooks-port
  // gates: a refused reply never gets a permit, and the owner tag is in the text every later gate sees. Off without config.owner.
  try { registerOwner(on, options) } catch (err) { report('owner', err, errors) }
  try { registerHooksPort(on, options) } catch (err) { report('hooks-port', err, errors) }
  try { registerSession(on, options) } catch (err) { report('session', err, errors) }
  // Prompt policies run AFTER the session lane, so a child-owned thread prompt is dropped
  // before any policy sees it, and BEFORE finalization (hooks-port index.js contract).
  try { registerPromptLifecycle(on, options) } catch (err) { report('prompt-lifecycle', err, errors) }
  // Memory recall attaches context AFTER the prompt policies (a dropped prompt is never searched).
  try { registerMemory(on, options) } catch (err) { report('memory', err, errors) }
  try { registerUi(on, options) } catch (err) { report('ui', err, errors) }
  try { registerTools(on, options) } catch (err) { report('tools', err, errors) }
  try { finalizeRegistration({ errors }) } catch (err) { console.error(`[mod-for-slack] finalize failed: ${err && err.message}`) }
}
