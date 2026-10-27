// lane: ui · owner: 봇 — pure G7 meter (no `$`). 01-spec G7: per task (thread received → last reply) time · tokens
// · model calls · cache read/write, compared later with the same bot's 7 days before the move. This lane keeps the
// session's running totals in $.state `mh.usage` (types/index.d.ts); the session lane copies them into the registry
// row's `usage` at every turn.complete (src/session/REGISTRY.md). A task's numbers = the difference of two totals.
//
// Source (2.1.296 types): every model request is one turn.step whose result carries `usage` = { input_tokens,
// output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model }, null when no response arrived.
// Subagent requests are turn.steps too (with agentId), so they count — they are this session's spend.
// tokens_in = uncached input (the API's input_tokens); the whole prompt = tokens_in + cache_read + cache_write.
// wall_ms = the main loop's turn.complete durationMs, summed (a subagent's run sits inside a main turn).

export const USAGE_FIELDS = ['tokens_in', 'tokens_out', 'cache_read', 'cache_write', 'model_calls', 'wall_ms']

export function emptyUsage() {
  return { tokens_in: 0, tokens_out: 0, cache_read: 0, cache_write: 0, model_calls: 0, wall_ms: 0 }
}

const count = (v) => (Number.isFinite(v) && v >= 0 ? v : 0)

// Totals held in $.state from before a reload of this module (same process): taken only when every field is a
// non-negative number, else null (start again from zero rather than add to something unreadable).
export function seedUsage(value) {
  if (!value || typeof value !== 'object') return null
  const out = {}
  for (const k of USAGE_FIELDS) {
    if (!Number.isFinite(value[k]) || value[k] < 0) return null
    out[k] = value[k]
  }
  return out
}

// One turn.step result's usage added in. No usage (no response, or a made-up one without it) = not a model call.
export function addStep(total, usage) {
  if (!usage || typeof usage !== 'object') return total
  return {
    ...total,
    tokens_in: total.tokens_in + count(usage.input_tokens),
    tokens_out: total.tokens_out + count(usage.output_tokens),
    cache_read: total.cache_read + count(usage.cache_read_input_tokens),
    cache_write: total.cache_write + count(usage.cache_creation_input_tokens),
    model_calls: total.model_calls + 1,
  }
}

export function addWall(total, ms) {
  return { ...total, wall_ms: total.wall_ms + count(ms) }
}

// 1234 → «1.2k» · 1234567 → «1.2M» · under 1000 as is.
export function fmtTokens(n) {
  const v = count(n)
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(Math.round(v))
}

// 칸 나무 줄 끝 (설계 메모): «호출 12 · 캐시 1.2M/85k» (읽기/쓰기) — nothing before the first model call.
export function usageText(u) {
  const s = seedUsage(u)
  if (!s || s.model_calls === 0) return ''
  return '호출 ' + s.model_calls + ' · 캐시 ' + fmtTokens(s.cache_read) + '/' + fmtTokens(s.cache_write)
}
