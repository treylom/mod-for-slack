// DM thread ↔ project binding, pure helpers (no $). 봇 ③ 확정 · 주인 (one DM post = one project thread; its
// replies carry on that project only). Binding: ① automatic from the ledger (the row whose source holds the
// thread root ts) ② a «프로젝트: …» line in the bot's reply, read by the lane and REMOVED from the text before it is
// sent (owner-facing text carries no ledger ids or paths). Store = one JSON file per bot.

const CHANNEL_TAG = /<channel\b([^>]*)>/g
const ATTR = /([A-Za-z_]+)="([^"]*)"/g
const PROJECT_LINE = /^[ \t]*프로젝트:[ \t]*(\S[^\n]*)$/m
export const STORE_CAP = 500

function attrs(s) { const o = {}; for (const m of String(s).matchAll(ATTR)) o[m[1]] = m[2]; return o }

// The newest Slack DM message in a prompt (a prompt can carry several channel tags; the last one is the one being
// answered). Returns null unless it is a DM (channel D…) with a thread root.
export function dmThreadOf(text) {
  let last = null
  for (const m of String(text || '').matchAll(CHANNEL_TAG)) last = attrs(m[1])
  if (!last || !/^D[A-Z0-9]+$/.test(last.channel || '')) return null
  const root = last.thread_ts || last.ts || ''
  if (!/^\d{9,11}\.\d{1,8}$/.test(root)) return null
  return { channel: last.channel, root, key: last.channel + ':' + root }
}

export function replyThreadKey(chatId, threadTs) {
  if (!/^D[A-Z0-9]+$/.test(String(chatId || '')) || !/^\d{9,11}\.\d{1,8}$/.test(String(threadTs || ''))) return ''
  return chatId + ':' + threadTs
}

// «프로젝트: <방 폴더명 | 100-project/<방> | 팀 id>» → { value, binding, stripped } or null (no line).
// binding = { room } | { ledgerId } | null (a value we cannot use — still stripped, never sent).
export function takeProjectLine(text) {
  const t = String(text || '')
  const m = t.match(PROJECT_LINE)
  if (!m) return null
  const value = m[1].trim()
  const stripped = t.replace(/^[ \t]*프로젝트:[^\n]*(\n|$)/m, '').replace(/\n{3,}/g, '\n\n').trim()
  return { value, binding: projectBinding(value), stripped }
}

export function projectBinding(value) {
  const v = String(value || '').trim().replace(/[`'"]/g, '')
  if (/^L-[A-Za-z0-9_.-]{3,120}$/.test(v)) return { ledgerId: v }
  const room = (v.match(/100-project\/([^/\s]+)/) || [])[1] || v
  return /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]{1,120}$/.test(room) ? { room } : null
}

// Store: { "<D…>:<root ts>": { room?, ledgerId?, how, at } }, newest last, at most STORE_CAP entries.
export function parseStore(json) {
  try { const o = JSON.parse(json); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} } catch (err) { return {} }
}
export function putBinding(store, key, value, cap = STORE_CAP) {
  const out = {}
  for (const [k, v] of Object.entries(store || {})) if (k !== key) out[k] = v
  out[key] = value
  const keys = Object.keys(out)
  for (const k of keys.slice(0, Math.max(0, keys.length - cap))) delete out[k]
  return out
}

// Builder argv for scripts/project_context.py.
export function projectArgv(p, bot, script, thread, binding) {
  const argv = [p.python, '-I', script, '--ledger', p.ledger, '--rooms-root', p.roomsRoot, '--bot', bot,
    '--tail', String(p.tail), '--open-max', String(p.openMax)]
  if (binding && binding.room) argv.push('--room', binding.room)
  if (binding && binding.ledgerId) argv.push('--ledger-id', binding.ledgerId)
  if (!binding && thread) argv.push('--root-ts', thread.root)
  return argv
}

function clip(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }

// The context block. Whole lines are dropped past maxChars; '' when nothing is bound.
export function formatProjectBlock(ctx, maxChars) {
  if (!ctx || !ctx.bound) return ''
  const rows = Array.isArray(ctx.ledger) ? ctx.ledger : []
  const head = `[프로젝트(mods) · 이 DM 스레드 = ${ctx.room || '방 없음'}${rows.length ? ' · 대장 ' + rows.map(r => `${r.id}(${r.status})`).join(', ') : ''} — 이 스레드는 이 프로젝트 일만 이어서]`
  const lines = [clip(head, Math.min(400, maxChars))]
  for (const r of rows) if (r.release) lines.push(`- ${r.id} 해제조건: ${clip(r.release, 80)}`)
  for (const t of (Array.isArray(ctx.tail) ? ctx.tail : [])) lines.push(`- 02: ${clip(t, 200)}`)
  let out = ''
  for (const l of lines) {
    if ((out ? out.length + 1 : 0) + l.length > maxChars) break
    out = out ? out + '\n' + l : l
  }
  return out
}

export function parseProjectOut(stdout) {
  try { const o = JSON.parse(String(stdout || '').trim().split('\n').pop() || '{}'); return o && typeof o === 'object' ? o : {} } catch (err) { return {} }
}
