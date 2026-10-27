// 답 늦음 막기 — 순수 함수. 볼트 .claude/hooks/owner-reply-first-gate.py 의 규칙을 SessionMessage 꼴로 옮김.
// 근거: 주인 요청(10-25) — 하위 세션 일이 많아도 주인 DM 답이 늦지 않게.
// 입력 = $.session.messages() 줄: {role, text, toolUses:[{tool_use_id, tool, input}], toolResults:[{tool_use_id, text, isError}]}
// (꼴 출처 = hooks-port/pilot/pinned_legacy.py transcript_lines 설명 · 오프라인 기동 실측은 결과 문서).
// 메시지 줄엔 시각이 없어서 «몇 초»는 lane 이 처음 본 시각(firstSeen)으로 잰다.

export const REPLY_TOOL = 'mcp__slack-channel__reply'
export const BRIDGE_PREFIX = 'mcp__slack-channel__'
export const OPEN_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ToolSearch', 'TaskList', 'TaskGet', 'TaskOutput'])
const TAG_RE = /<channel\b([^>]*)>/g
const ATTR_RE = /([A-Za-z_][\w-]*)="([^"]*)"/g

export function ownerThreadKeys(text, ownerUser, dmChannels) {
  const out = []
  if (typeof text !== 'string' || !text.includes('<channel')) return out
  TAG_RE.lastIndex = 0
  let m
  while ((m = TAG_RE.exec(text))) {
    const a = {}
    ATTR_RE.lastIndex = 0
    let p
    while ((p = ATTR_RE.exec(m[1]))) a[p[1]] = p[2]
    if (!String(a.source || '').includes('slack') || a.user !== ownerUser || !dmChannels.includes(a.channel)) continue
    if (a.sender_is_bot === 'true') continue
    const key = a.thread_ts || a.ts
    if (key) out.push(key)
  }
  return out
}

// "auto" DM (공개판 키트): did the owner themself write in this D channel during this session? (bot posts · other people = no)
export function ownerWroteIn(messages, ownerUser, chatId) {
  if (!ownerUser || !/^D[A-Z0-9]{6,}$/.test(String(chatId || ''))) return false
  return (Array.isArray(messages) ? messages : []).some(m => m && m.role === 'user' && ownerThreadKeys(textOf(m), ownerUser, [String(chatId)]).length > 0)
}

function textOf(msg) {
  if (typeof msg.text === 'string') return msg.text
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) return msg.content.filter(b => b && b.type === 'text').map(b => b.text || '').join('')
  return ''
}
function usesOf(msg) {
  if (Array.isArray(msg.toolUses)) return msg.toolUses.map(u => ({ id: u.tool_use_id || u.id, tool: u.tool || u.name, input: u.input || {} }))
  if (Array.isArray(msg.content)) return msg.content.filter(b => b && b.type === 'tool_use').map(b => ({ id: b.id, tool: b.name, input: b.input || {} }))
  return []
}
function failedIds(messages) {
  const bad = new Set()
  for (const m of messages) {
    const rows = Array.isArray(m.toolResults) ? m.toolResults.map(r => ({ id: r.tool_use_id, err: r.isError, text: r.text }))
      : Array.isArray(m.content) ? m.content.filter(b => b && b.type === 'tool_result').map(b => ({ id: b.tool_use_id, err: b.is_error, text: JSON.stringify(b.content) })) : []
    for (const r of rows) if (r.err || /NOT sent|partially sent/.test(String(r.text || ''))) bad.add(r.id)
  }
  return bad
}

// → Map key → {n, resets}  (아직 답이 닿지 않은 주인 DM 스레드)
export function scan(messages, { ownerUser, dmChannels, currentToolUseId = null }) {
  const list = Array.isArray(messages) ? messages : []
  const failed = failedIds(list)
  const pending = new Map()
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'user') for (const k of ownerThreadKeys(textOf(m), ownerUser, dmChannels)) if (!pending.has(k)) pending.set(k, { n: 0, resets: 0 })
    if (m.role !== 'assistant') continue
    for (const u of usesOf(m)) {
      if (currentToolUseId && u.id === currentToolUseId) continue
      const tool = String(u.tool || '')
      if (tool === REPLY_TOOL) {
        const th = String(u.input.thread_ts || '')
        if (dmChannels.includes(u.input.chat_id) && pending.has(th)) {
          if (!failed.has(u.id)) pending.delete(th)
          else { const v = pending.get(th); pending.set(th, { n: 0, resets: v.resets + 1 }) }   // 다른 게이트가 답을 막음 → 다시 셈(교착 방지)
        }
        continue
      }
      if (tool.startsWith(BRIDGE_PREFIX)) continue
      for (const v of pending.values()) v.n += 1
    }
  }
  return pending
}

// firstSeen: Map `${key}#${resets}` → ms (lane 이 채움) · now = ms
export function judge(tool, pending, firstSeen, now, { maxTools = 3, maxSeconds = 120, dm = '' } = {}) {
  if (String(tool).startsWith(BRIDGE_PREFIX) || OPEN_TOOLS.has(tool)) return { decision: 'allow' }
  let worst = null
  for (const [key, v] of pending) {
    const seen = firstSeen.get(key + '#' + v.resets)
    const age = seen ? Math.max(0, Math.round((now - seen) / 1000)) : 0
    if (v.n >= maxTools || age > maxSeconds) if (!worst || age > worst.age) worst = { key, n: v.n, age }
  }
  if (!worst) return { decision: 'allow' }
  return { decision: 'deny', ...worst,
    reason: `답 먼저(답 늦음 막기): 주인 DM 글이 들어온 뒤 ${worst.age}초 · 도구 ${worst.n}번이 지났는데 아직 그 스레드에 답이 없어요 ` +
      `(기준 ${maxTools}번 또는 ${maxSeconds}초). 먼저 한 줄 답부터 — ${REPLY_TOOL} chat_id=${dm} thread_ts=${worst.key} ` +
      '(받음 · 지금 하는 일 · 언제 결과). 그동안 열린 도구 = Slack 다리(reply·react)·Read·Grep·Glob.' }
}
