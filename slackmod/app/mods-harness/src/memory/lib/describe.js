// Memory lane, pure helpers for the tool.describe hook (no $): a short «when to call» line per memory read tool.
// Keyed by «server/tool» (the engine name is mcp__<server>__<tool>). 봇 발주 memory-recall-newtask-1018 ②:
// hindsight (this bot's bank) · hindsight-shared (all bots) · kumiho (cloud, curated). memory-bank lines removed
// (the server was taken off every bot 10-18).
// 10-24 주인 공식 꼴로 다시 열기: the kumiho lines follow the server's own instructions — engage once when
// earlier context could matter, skip it when the conversation already answers, reflect the moment something is settled
// (the old «hindsight found nothing … Slow … not for every message» line made kumiho a last resort). The kumiho keys are
// applied only while memory.kumiho.enabled (index.js); the hindsight lines keep their own switch (memory.recall).
// reflect is the one write tool with a line: it exists in a session only where the engine deny lets it through.
// No import from recall.js (recall.js imports this file for the key list; toolPrefix lives there).
export const DESCRIBE_LINES = {
  'hindsight/recall': 'When to call: before you start a new task or a long one; when the request continues earlier work ("전에 어떻게 했지", "왜 그렇게 정했지", "지난번", a past decision, fix or file); or to check 주인\'s stated preferences. This is your own bot\'s bank (개별). Skip it for greetings and self-contained questions.',
  'hindsight-shared/recall': 'When to call: the same moments as hindsight recall, for what every bot shares (공유) — team rules, 주인\'s preferences and decisions recorded for all bots. Call it too when another bot may have decided this before.',
  'kumiho/kumiho_memory_engage': 'When to call: at the start of work on 주인\'s projects, a new task or thread, or when the request points back to something not visible here ("전에 정한", "지난번", a past decision or preference) — once per response, a brief query from the current message, no secrets. Skip it when this conversation or a memory block above already shows the answer. Cloud, a few seconds.',
  'kumiho/kumiho_memory_recall': 'When to call: instead of kumiho_memory_engage when the search must be limited to a memory type (only ["decision"] or ["preference"]) or a space. At most one memory search per response.',
  'kumiho/kumiho_memory_retrieve': 'When to call: you know the title, keyword, topic or date of a saved note ("the latest decision on X", what was saved recently = mode "latest"). It returns references, not the text.',
  'kumiho/kumiho_memory_reflect': 'When to call: in the bot\'s own session, the moment 주인 settles a decision, preference, fact or correction, or asks you to remember — one capture in your own words: type, a title with the date YYYY-MM-DD, one or two sentences, space_hint copied from engage results (else decisions · preferences · facts · corrections), source_krefs from engage. Never routine turns, transcripts, secrets, or a client\'s people (names, contacts). A 하위 never writes.',
}
// The kumiho keys (index.js gates them on memory.kumiho.enabled, apart from the hindsight lines' recall switch).
export function isKumihoKey(key) { return /^[^/]+\/kumiho_/.test(String(key || '')) }

// mcp__<server>__<tool> → «server/tool» ('' when not an MCP tool name). The server part stops at the first «__».
export function toolKey(name) { const m = /^mcp__(.+?)__(.+)$/.exec(String(name || '')); return m ? m[1] + '/' + m[2] : '' }

// null = leave the tool alone; else { description, isDeferred? } (isDeferred: false only for the upfront tools).
export function describeTool(key, original, upfront) {
  if (!Object.prototype.hasOwnProperty.call(DESCRIBE_LINES, key)) return null
  const base = typeof original === 'string' ? original : ''
  const description = base.includes('When to call:') ? base : (base.trimEnd() ? base.trimEnd() + '\n' : '') + DESCRIBE_LINES[key]
  const out = { description }
  if (Array.isArray(upfront) && upfront.includes(key)) out.isDeferred = false
  return out
}
