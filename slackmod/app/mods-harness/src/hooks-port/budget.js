// TypeSafe timing helpers — keep in sync with budget.py
export const DEFAULT_ENTRY_TIMEOUT_MS = 7000;
export const TYPESAFE_ENTRY_TIMEOUT_MS = 25000;
export const DEFAULT_EVENT_BUDGET_MS = 7000;
export const TYPESAFE_EVENT_BUDGET_MS = 30000;
export const PROMPT_RUNNER_TIMEOUT_MS = 8000;
export const DEFAULT_TOOL_RUNNER_TIMEOUT_MS = 8000;
export const TYPESAFE_TOOL_RUNNER_TIMEOUT_MS = 32000;
export const TYPESAFE_NATIVE_POLICIES = new Set(['typesafe-destructive', 'typesafe-dispatch', 'typesafe-signature']);

export function isTypesafeNativePolicy(policy) {
  return typeof policy === 'string' && TYPESAFE_NATIVE_POLICIES.has(policy);
}

export function isQualifyingTypesafeEntry(entry) {
  return Boolean(
    entry &&
    entry.enabled !== false &&
    entry.blocking === true &&
    entry.event === 'PreToolUse' &&
    isTypesafeNativePolicy(entry.nativePolicy)
  );
}

export function matcherKey(eventName) {
  return {
    SessionStart: 'source',
    SessionEnd: 'reason',
    PreCompact: 'trigger',
    Notification: 'notification_type',
    SubagentStart: 'agent_type',
    SubagentStop: 'agent_type',
    PermissionRequest: 'tool_name',
  }[eventName] || 'tool_name';
}

export function entryMatchesEvent(entry, event) {
  if (!entry || entry.enabled === false || entry.event !== event.hook_event_name) return false;
  const matcher = entry.matcher;
  if (!matcher || matcher === '*') return true;
  const key = matcherKey(event.hook_event_name);
  try {
    return new RegExp(matcher).test(String(event[key] ?? ''));
  } catch {
    return false;
  }
}

export function qualifyingTypesafeMatch(entries, event) {
  if (!event || event.hook_event_name !== 'PreToolUse') return false;
  return (entries || []).some((entry) => isQualifyingTypesafeEntry(entry) && entryMatchesEvent(entry, event));
}

export function entryTimeoutCapMs(entry) {
  return isQualifyingTypesafeEntry(entry) ? TYPESAFE_ENTRY_TIMEOUT_MS : DEFAULT_ENTRY_TIMEOUT_MS;
}

export function validateConfiguredEventBudgetMs(maxEventMs) {
  return Number.isInteger(maxEventMs) && maxEventMs >= 1 && maxEventMs <= DEFAULT_EVENT_BUDGET_MS;
}

export function effectiveEventBudgetMs(hooks, event, entries = hooks?.entries) {
  const configured = hooks?.maxEventMs ?? DEFAULT_EVENT_BUDGET_MS;
  if (!validateConfiguredEventBudgetMs(configured)) return null;
  if (!qualifyingTypesafeMatch(entries, event)) return configured;
  return TYPESAFE_EVENT_BUDGET_MS;
}

export function toolRunnerTimeoutMs(hooks, event, entries = hooks?.entries) {
  return qualifyingTypesafeMatch(entries, event) ? TYPESAFE_TOOL_RUNNER_TIMEOUT_MS : DEFAULT_TOOL_RUNNER_TIMEOUT_MS;
}
