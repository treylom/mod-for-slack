"""TypeSafe timing helpers — keep in sync with budget.js"""
import re

DEFAULT_ENTRY_TIMEOUT_MS = 7000
TYPESAFE_ENTRY_TIMEOUT_MS = 25000
DEFAULT_EVENT_BUDGET_MS = 7000
TYPESAFE_EVENT_BUDGET_MS = 30000
PROMPT_RUNNER_TIMEOUT_MS = 8000
DEFAULT_TOOL_RUNNER_TIMEOUT_MS = 8000
TYPESAFE_TOOL_RUNNER_TIMEOUT_MS = 32000
TYPESAFE_NATIVE_POLICIES = frozenset({'typesafe-destructive', 'typesafe-dispatch', 'typesafe-signature'})

def is_typesafe_native_policy(policy):
    return isinstance(policy, str) and policy in TYPESAFE_NATIVE_POLICIES

def is_qualifying_typesafe_entry(entry):
    return bool(
        entry
        and entry.get('enabled', True) is not False
        and entry.get('blocking') is True
        and entry.get('event') == 'PreToolUse'
        and is_typesafe_native_policy(entry.get('nativePolicy'))
    )

def matcher_key(event_name):
    return {
        'SessionStart': 'source',
        'SessionEnd': 'reason',
        'PreCompact': 'trigger',
        'Notification': 'notification_type',
        'SubagentStart': 'agent_type',
        'SubagentStop': 'agent_type',
        'PermissionRequest': 'tool_name',
    }.get(event_name, 'tool_name')

def entry_matches_event(entry, event):
    if not entry or entry.get('enabled', True) is False or entry.get('event') != event.get('hook_event_name'):
        return False
    matcher = entry.get('matcher')
    if not matcher or matcher == '*':
        return True
    key = matcher_key(event.get('hook_event_name'))
    try:
        return re.search(matcher, str(event.get(key, ''))) is not None
    except re.error:
        return False

def qualifying_typesafe_match(entries, event):
    if not event or event.get('hook_event_name') != 'PreToolUse':
        return False
    return any(is_qualifying_typesafe_entry(entry) and entry_matches_event(entry, event) for entry in (entries or []))

def entry_timeout_cap_ms(entry):
    return TYPESAFE_ENTRY_TIMEOUT_MS if is_qualifying_typesafe_entry(entry) else DEFAULT_ENTRY_TIMEOUT_MS

def validate_configured_event_budget_ms(max_event_ms):
    return type(max_event_ms) is int and 1 <= max_event_ms <= DEFAULT_EVENT_BUDGET_MS

def effective_event_budget_ms(hooks, event, entries=None):
    entries = entries if entries is not None else hooks.get('entries', [])
    configured = hooks.get('maxEventMs', DEFAULT_EVENT_BUDGET_MS)
    if not validate_configured_event_budget_ms(configured):
        return None
    if not qualifying_typesafe_match(entries, event):
        return configured
    return TYPESAFE_EVENT_BUDGET_MS

def tool_runner_timeout_ms(hooks, event, entries=None):
    entries = entries if entries is not None else hooks.get('entries', [])
    return TYPESAFE_TOOL_RUNNER_TIMEOUT_MS if qualifying_typesafe_match(entries, event) else DEFAULT_TOOL_RUNNER_TIMEOUT_MS
