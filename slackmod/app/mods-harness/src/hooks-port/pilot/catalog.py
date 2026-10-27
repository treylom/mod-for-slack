"""Closed policy/event contract, parity checked against the mod's catalog.js."""
EVENTS = {
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
}
