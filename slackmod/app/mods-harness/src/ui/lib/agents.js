// lane: ui · owner: 봇 — pure books of this session's subagents and of the Slack threads it saw (no `$`).
// r2 (owner 10-18 14:58 · 봇 ① 승인): the engine tells a
// mod about its session's subagents three ways (measured 10-18 15:11 with a probe mod on 2.1.296): agent.spawn — next's
// answer carries { agentId, model } · turn.complete — a subagent's run end carries its agentId · $.agent.list() —
// [{ id, type, description, status, parentId }], status pending|running|waiting|idle|completed|failed|killed.
// Other windows see them through this lane's own live file (`agents`), never the registry (the session lane's file).
// Threads (봇 ② 승인): «#채널 · 첫 몇 자» from the channel messages this window received — no Slack token,
// no API call. Only public channel ids (C…): a DM's or private group's text never goes into a live file every window reads.
import { channelHead } from '../../session/core.js'
import { RESULT_LOOK } from './text.js'

export const AGENT_LOOK = {
  pending: { glyph: '○', dim: true, word: '시작 중' },
  running: { glyph: '●', color: 'blue', word: '실행' }, // r2: «실행 N분» — the dock's tail room (167칸 캡처: «실행 중 N분» folded)
  waiting: { glyph: '◎', color: 'yellow', word: '대기' },
  idle: { glyph: '○', color: 'green', word: '쉼' },
  completed: { glyph: '✓', color: RESULT_LOOK.ok.color, dim: true, word: '끝' },
  failed: { glyph: '×', color: 'red', word: '실패' },
  killed: { glyph: '×', color: 'red', dim: true, word: '멈춤' },
}
export const ENDED = new Set(['completed', 'failed', 'killed'])
export const AGENT_KEEP_MS = 0 // R6 (봇 ③ · 10 min before): an ended subagent stays on the tree this long — not at all
// R6: the book keeps an ended one this long (the old 10 min) — the engine's list names it a while after it ends, and one
// dropped at once would read as new on every list read (a live write and a redraw each tick)
export const AGENT_BOOK_MS = 10 * 60 * 1000
export const AGENT_MAX = 8 // per session, newest kept (the live file carries the same)
const TEXT_MAX = 40

function str(v, max) {
  return typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null
}
function status(v) {
  return typeof v === 'string' && AGENT_LOOK[v] ? v : null
}
function ms(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// agent.spawn answered: `input` = the hook's e (description · subagentType · parentAgentId), `result` = next's answer.
// A deny or no agentId = nothing started, nothing noted.
export function noteSpawn(book, input, result, nowMs) {
  const id = result && typeof result.agentId === 'string' && result.agentId ? result.agentId : null
  if (!id || (result && result.deny)) return null
  const e = input || {}
  const had = book.get(id) || {}
  const a = {
    id,
    type: str(e.subagentType, TEXT_MAX) || had.type || 'agent',
    description: str(e.description, TEXT_MAX) || had.description || null,
    model: str(result.model, TEXT_MAX) || had.model || null,
    parentId: str(e.parentAgentId, 64) || had.parentId || null,
    status: had.status && had.status !== 'pending' ? had.status : 'running',
    at: had.at || nowMs,
    endAt: had.endAt || null,
  }
  book.set(id, a)
  return a
}

// A subagent's turn.complete: its run ended (the list read after it says how — completed, failed or killed).
export function noteEnd(book, agentId, nowMs) {
  const a = typeof agentId === 'string' ? book.get(agentId) : null
  if (!a) return null
  if (!ENDED.has(a.status)) a.status = 'completed'
  if (!a.endAt) a.endAt = nowMs
  return a
}

// $.agent.list() read: every listed agent's status is the engine's word. One the list does not hold is left as it is —
// the engine drops a subagent's entry some time after it ends, which is not a new state.
export function syncList(book, list, nowMs) {
  let changed = false
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x.id !== 'string' || !x.id || x.teammateId) continue
    const had = book.get(x.id)
    const st = status(x.status) || (had && had.status) || 'running'
    const a = {
      id: x.id,
      type: str(x.type, TEXT_MAX) || (had && had.type) || 'agent',
      description: str(x.description, TEXT_MAX) || (had && had.description) || null,
      model: (had && had.model) || null,
      parentId: str(x.parentId, 64) || (had && had.parentId) || null,
      status: st,
      at: (had && had.at) || nowMs,
      endAt: ENDED.has(st) ? (had && had.endAt) || nowMs : null,
    }
    if (!had || had.status !== a.status || had.description !== a.description || had.type !== a.type) changed = true
    book.set(x.id, a)
  }
  return changed
}

// What the tree draws: the ones not ended (R6: an ended one off the tree at once — AGENT_KEEP_MS 0, never by comparing its
// end time with this clock: another window's end time can be later than this window's now), oldest first, at most
// AGENT_MAX (newest kept).
export function shownAgents(list, nowMs) {
  const all = (Array.isArray(list) ? list : [...(list || new Map()).values()])
    .filter((a) => a && (!ENDED.has(a.status) || (AGENT_KEEP_MS > 0 && ms(a.endAt) !== null && nowMs - a.endAt <= AGENT_KEEP_MS)))
    .sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id)))
  return all.slice(Math.max(0, all.length - AGENT_MAX))
}

// Drop ended ones past AGENT_BOOK_MS from the book itself (so it does not grow over a long session).
export function pruneAgents(book, nowMs) {
  for (const [id, a] of book) if (ENDED.has(a.status) && ms(a.endAt) !== null && nowMs - a.endAt > AGENT_BOOK_MS) book.delete(id)
}

// The live file's `agents` as another window reads it: only whole entries, at most AGENT_MAX.
export function parseAgents(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const x of v) {
    if (!x || typeof x.id !== 'string' || !x.id || !status(x.status)) continue
    out.push({ id: x.id.slice(0, 64), type: str(x.type, TEXT_MAX) || 'agent', description: str(x.description, TEXT_MAX), model: str(x.model, TEXT_MAX),
      parentId: str(x.parentId, 64), status: x.status, at: ms(x.at), endAt: ms(x.endAt) })
    if (out.length >= AGENT_MAX) break
  }
  return out
}

// ── threads ──
// «<@U…> 배차 재시험 S1 — 카파…» → «배차 재시험 S1 — 카파…»: mentions, channel links and link brackets dropped, spaces folded.
export function cleanHead(s) {
  return String(s || '')
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, ' ')
    .replace(/<#[A-Z0-9]+(\|([^>]*))?>/g, (m, a, name) => (name ? '#' + name : ' '))
    .replace(/<(https?:[^|>]+)(\|([^>]*))?>/g, (m, url, a, label) => label || url)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
export const HEAD_CHARS = 30
// the first HEAD_CHARS letters (a Korean syllable or an emoji = one), no space left hanging at the cut
function firstChars(s) {
  return [...s].slice(0, HEAD_CHARS).join('').trimEnd()
}

// 10-19 ①a (봇 · 주인 20:47): a public channel (C…) always; a DM (D…) only when `names` (the config's
// ui.slack_channels, settings.js slackChannels) names it — the owner's own DM thread — every other DM stays out.
export function threadChannelOk(id, names) {
  if (typeof id !== 'string') return false
  if (/^C[A-Z0-9]{8,12}$/.test(id)) return true
  return /^D[A-Z0-9]{8,12}$/.test(id) && Boolean(names) && typeof names === 'object' && Object.prototype.hasOwnProperty.call(names, id)
}

// One prompt's text → { channel, threadTs, ts, root, text } when it is a public channel message (or the named DM — see
// threadChannelOk): the parent's own «<channel …>…</channel>» or what a child got from its parent («[thread message]\n
// <channel …>…»). Else null.
export function threadNote(text, names) {
  const t = String(text || '').replace(/^<cross-session-message[^>\n]{0,400}>\n?/, '').replace(/^\[thread message\]\n/, '')
  const head = channelHead(t)
  if (!head || !threadChannelOk(head.chatId, names) || !/^\d{6,12}\.\d{1,8}$/.test(head.threadTs)) return null
  const close = t.indexOf('>')
  const end = t.indexOf('</channel>')
  const body = close >= 0 ? t.slice(close + 1, end > close ? end : undefined) : ''
  const words = cleanHead(body)
  if (!words) return null
  return { channel: head.chatId, threadTs: head.threadTs, ts: head.ts, root: !head.ts || head.ts === head.threadTs, text: firstChars(words) }
}

export const THREADS_MAX = 20
// The book of thread heads (Map threadTs → { channel, text, root, at }): a root post wins over a reply; the first reply
// seen stands until a root comes. The newest THREADS_MAX threads are kept.
export function noteThread(book, note, nowMs) {
  if (!note) return false
  const had = book.get(note.threadTs)
  if (had && (had.root || !note.root)) return false
  book.set(note.threadTs, { channel: note.channel, text: note.text, root: note.root, at: nowMs })
  if (book.size > THREADS_MAX) {
    const old = [...book.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, book.size - THREADS_MAX)
    for (const [k] of old) book.delete(k)
  }
  return true
}

// The live file's `threads` ([{ ts, channel, text, root }]) as another window reads it, merged into `into` (Map) —
// a root head wins over a reply head whoever saw it. A DM head only when this window's `names` names that DM too.
export function mergeThreads(into, v, names) {
  if (!Array.isArray(v)) return into
  for (const x of v.slice(0, THREADS_MAX)) {
    if (!x || typeof x.ts !== 'string' || !/^\d{6,12}\.\d{1,8}$/.test(x.ts) || !threadChannelOk(x.channel, names)) continue
    const text = str(x.text, HEAD_CHARS * 2)
    if (!text) continue
    const had = into.get(x.ts)
    if (had && (had.root || !x.root)) continue
    into.set(x.ts, { channel: x.channel, text, root: Boolean(x.root) })
  }
  return into
}

export function threadRecord(book) {
  return [...book.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, THREADS_MAX)
    .map(([ts, h]) => ({ ts, channel: h.channel, text: h.text, root: h.root }))
}

// A child row's thread line: «#전체-팀» + the head a window saw in that thread, else the child's task (from = 'task').
export function threadLabel(entry, heads, channels) {
  const t = entry && entry.thread
  if (!t || typeof t.channel !== 'string' || !t.channel) return null
  const name = (channels && channels[t.channel]) || t.channel
  const h = heads && typeof t.ts === 'string' ? heads.get(t.ts) : null
  const text = h ? h.text : firstChars(cleanHead(entry.task))
  return { name: '#' + name, text: text || '', from: h ? (h.root ? 'root' : 'seen') : 'task' }
}
