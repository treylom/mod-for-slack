// Pure event/output adapter. No host APIs here: the mod compiler resolves $ only in index.js.
import {validNativeEntry} from './catalog.js';
const strip = name => String(name).replace(/^classic\./, '');
const reserved = new Set(['tool','tool_use_id','agentId','consent']);
export function normalizeEvent(name, e, identity = {}) {
  const event = strip(name);
  if (event !== 'PreToolUse') return { ...e, hook_event_name: event };
  const input = {};
  for (const [key, value] of Object.entries(e)) if (!reserved.has(key)) input[key] = value;
  return { hook_event_name: event, session_id: identity.sessionId, cwd: identity.cwd,
    transcript_path: identity.transcriptPath || '', permission_mode: identity.permissionMode || 'default',
    tool_name: e.tool, tool_use_id: e.tool_use_id, tool_input: input,
    ...(e.agentId ? {agent_id:e.agentId} : {}) };
}
export function failureResult(name, reason) {
  if (strip(name) === 'PreToolUse') return { deny: reason };
  return { block: reason };
}
export function registrationIds(hooks, {nativeOnly = false, supportedEvents = ['PreToolUse']} = {}) {
  if (!hooks || !Array.isArray(hooks.requiredGateIds) || !hooks.requiredGateIds.length) throw new Error('required gates empty');
  const entries = hooks.entries || [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error('duplicate or missing hook id');
    if (!entry.disposition || !entry.disposition.trim()) throw new Error('missing disposition');
    if (entry.nativePolicy !== undefined && !validNativeEntry(entry)) throw new Error('unknown native policy/event');
    if (nativeOnly && entry.enabled !== false && !supportedEvents.includes(entry.event)) throw new Error('legacy event adapter not registered');
    if (nativeOnly && entry.enabled !== false && entry.event !== 'PreToolUse' && !entry.nativePolicy) throw new Error('non-tool policy requires a native adapter');
    ids.add(entry.id);
  }
  const required = new Set(hooks.requiredGateIds);
  if (required.size !== hooks.requiredGateIds.length) throw new Error('duplicate required gate');
  for (const id of required) {
    const entry = entries.find(x => x.id === id);
    if (!entry || entry.enabled === false || entry.blocking !== true) throw new Error('required gate not registered');
  }
  return [...required].sort();
}
const eventFields = {
  UserPromptSubmit: ['sessionTitle','suppressOriginalPrompt'], UserPromptExpansion:['suppressOriginalPrompt'],
  SessionStart:['sessionTitle','initialUserMessage','watchPaths','reloadSkills'],
  PermissionRequest:['decision'], PreModelSwitch:['permissionDecision','permissionDecisionReason'],
  PostToolUse:['updatedToolOutput','updatedMCPToolOutput'], PermissionDenied:['retry'],
  MessageDisplay:['displayContent'], WorktreeCreate:['worktreePath'],
};
export function mergeClassicResult(name, run, downstream = {}) {
  const event = strip(name);
  if (run.deny) return failureResult(event, typeof run.deny === 'string' ? run.deny : run.reason || 'hook refused');
  const result = {...(downstream || {})};
  const context = [...(result.additionalContext || []), ...(run.context || [])];
  for (const out of run.outputs || []) {
    const h = out.hookSpecificOutput || {};
    if (out.continue === false) {
      if (event === 'PreToolUse') return {deny: out.stopReason || 'hook stopped continuation'};
      result.preventContinuation = true; result.stopReason = out.stopReason || 'hook stopped continuation';
    }
    if (out.decision === 'block' || h.permissionDecision === 'deny') return failureResult(event, out.reason || h.permissionDecisionReason || 'hook refused');
    if (typeof h.additionalContext === 'string' && h.additionalContext) context.push(h.additionalContext);
    if (event === 'PreToolUse') {
      // Input rewriting must be re-evaluated by every gate before a permit can bind it.
      // Until that protocol exists, refuse the rewrite rather than authorize the old input.
      if (h.updatedInput !== undefined) return {deny:'hook input rewriting requires a new gate evaluation'};
      if (h.permissionDecision === 'ask' && !result.deny) { delete result.allow; result.ask = h.permissionDecisionReason || 'hook requires approval'; }
      // An allow from one migrated hook never overrides downstream denial/approval.
    } else for (const key of eventFields[event] || []) if (h[key] !== undefined) result[key] = h[key];
  }
  if (context.length) result.additionalContext = context;
  return result;
}
