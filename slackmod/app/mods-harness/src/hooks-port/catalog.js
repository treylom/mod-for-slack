// Closed policy/event contract. Keep in sync with pilot/catalog.py (parity test).
export const nativePolicyEvents = {
  'typesafe-destructive': ['PreToolUse'],
  'typesafe-dispatch': ['PreToolUse'],
  'typesafe-signature': ['PreToolUse'],
  'api-spend': ['PreToolUse'],
  'aside-web': ['UserPromptSubmit','PreToolUse'],
  'rsync-safety': ['PreToolUse'],
  'directives-intake': ['UserPromptSubmit', 'PreToolUse'],
  'directives-open-rows': ['UserPromptSubmit', 'Stop'],
  'memory-index': ['SessionStart', 'PreToolUse'],
  'feedback-h2': ['PreToolUse'],
  'pinned-legacy': ['PreToolUse','UserPromptSubmit','SessionStart'],
};
export function validNativeEntry(entry) {
  return Object.hasOwn(nativePolicyEvents, entry.nativePolicy) &&
    nativePolicyEvents[entry.nativePolicy].includes(entry.event);
}
