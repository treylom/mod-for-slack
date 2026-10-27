// lane: ui · owner: 봇 — pure TeamClaude account map + write requests (no `$`, no node imports, no network).
// 설계 메모 (셋째 판 r3a · 봇 · 봇 DA):
// the write addresses name an account by its name, while the 칸 never holds a name. So a name ↔ id map lives here, in
// this module's variables only — never written to a file, a record or $.state. An id is a random value made the first
// time a name is seen and kept for the whole process: a Button drawn before a re-read still points at the same account
// after it. The id is never computed from the name.

const idByName = new Map() // name → id
const nameById = new Map() // id → name
let spare = 0 // fallback ids when the random source keeps failing (never the name)

const ID_OK = /^[a-z0-9]+$/
const TRIES = 100

// The id of `name`: made once (the first 8 base-36 digits of `rnd()`, drawn again on a clash or a bad value), then the
// same for as long as the process lives. Not a string or empty = null.
export function idOf(name, rnd = Math.random) {
  if (typeof name !== 'string' || !name) return null
  const had = idByName.get(name)
  if (had) return had
  let id = null
  for (let i = 0; i < TRIES && id === null; i++) {
    let c = ''
    try { c = String(rnd().toString(36)).slice(2, 10) } catch (err) { c = '' }
    if (ID_OK.test(c) && !nameById.has(c)) id = c
  }
  while (id === null) {
    const c = 'z' + (spare++).toString(36)
    if (!nameById.has(c)) id = c
  }
  idByName.set(name, id)
  nameById.set(id, name)
  return id
}

// The name an id stands for, or null (an id this process never made).
export function nameOf(id) {
  return typeof id === 'string' && nameById.has(id) ? nameById.get(id) : null
}

// A deep copy of one status answer with the account names swapped for their ids: accounts[i].name = its id and an
// `id` field beside it (a name that is not a string = both null, so the original value is not carried) · currentAccount
// (a string) = the id of that name. The input is left as it was. No `accounts` array = a plain copy.
export function stripNames(json) {
  if (json === undefined) return undefined
  const out = JSON.parse(JSON.stringify(json))
  if (!out || typeof out !== 'object' || Array.isArray(out)) return out
  if (Array.isArray(out.accounts)) {
    out.accounts = out.accounts.map((a) => {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return a
      const id = idOf(a.name)
      return { ...a, name: id, id }
    })
  }
  if (typeof out.currentAccount === 'string') out.currentAccount = idOf(out.currentAccount)
  return out
}

function isObj(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

// What one press asks of TeamClaude (upstream 1.1.25, 봇 RESULT 10-18 · server.js 650~790): { path, body } for a
// POST, or null. `row` = the drawn row of that account (team.js claudeOf: enabled).
//   switch → /teamclaude/switch { account }
//   toggle → /teamclaude/disable { account, disabled } (on → switched off · off → on)
//   delok → /teamclaude/mcp, the remove_account tool
// The order (▲ ▼ 자동) is orderPlan + priorityRequest below — one request per row whose priority changes.
export function teamRequest(act, name, row) {
  if (typeof name !== 'string' || !name || !isObj(row)) return null
  const account = name
  if (act === 'switch') return { path: '/teamclaude/switch', body: { account } }
  if (act === 'toggle') return { path: '/teamclaude/disable', body: { account, disabled: row.enabled !== false } }
  // 추정: remove_account called as one tools/call in the JSON-RPC shape of the MCP standard — no initialize first
  // (upstream mcp.js: the handshake era issues no session id, so one call stands alone). Measured on a fake server only.
  if (act === 'delok') return { path: '/teamclaude/mcp', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'remove_account', arguments: { account } } } }
  return null
}

// 57 정정 A (봇 10-18 · 원형 TUI tui.js _moveOrder · _setAutoOrder · _applyRanking 530~624): the order is a rank to
// move, not a number to type. The ranked rows = those with a priority, in the drawn order (priority, then list place).
//   up   — an unranked row joins the ranked ones at their end · a ranked row swaps with the one above · the top = null
//   down — an unranked row = null · a ranked row swaps with the one below · the last ranked one leaves the ranking
//   auto — an unranked row = null · a ranked row leaves the ranking
// Then the ranked rows are numbered 0..n−1 and every other row gets null (= 자동). The answer = only the rows whose
// priority changes, [{ id, priority }] in the drawn order; null = nothing to do (no such row, or a press with no effect).
// `rows` = team.js claudeOf rows (id · ranked · pr).
export const ORDER_DIRS = ['up', 'down', 'auto']
export function orderPlan(rows, id, dir) {
  const list = Array.isArray(rows) ? rows.filter(isObj) : []
  const row = typeof id === 'string' && id ? list.find((r) => r.id === id) : undefined
  if (!row) return null
  const ranked = list.filter((r) => r.ranked === true)
  const k = ranked.indexOf(row)
  if (dir === 'up') {
    if (k === -1) ranked.push(row)
    else if (k > 0) [ranked[k - 1], ranked[k]] = [ranked[k], ranked[k - 1]]
    else return null
  } else if (dir === 'down') {
    if (k === -1) return null
    if (k < ranked.length - 1) [ranked[k], ranked[k + 1]] = [ranked[k + 1], ranked[k]]
    else ranked.splice(k, 1)
  } else if (dir === 'auto') {
    if (k === -1) return null
    ranked.splice(k, 1)
  } else return null
  const out = []
  for (const r of list) {
    const want = ranked.includes(r) ? ranked.indexOf(r) : null
    const had = typeof r.pr === 'number' && Number.isFinite(r.pr) ? r.pr : null
    if (had !== want) out.push({ id: r.id, priority: want })
  }
  return out.length ? out : null
}

// One row's new priority as a request: an integer, or null = 자동 (the rank given up).
// 엔진 계약 틈: null = 자동 — 엔진 패치 때 받게 해야 함 (upstream config-ops.js setAccountPriority 368~378 takes an
// integer or a place only; the installed CLI's 'auto' deletes the priority).
export function priorityRequest(name, priority) {
  if (typeof name !== 'string' || !name) return null
  if (priority !== null && !Number.isSafeInteger(priority)) return null
  return { path: '/teamclaude/priority', body: { account: name, priority } }
}

// The word a press is reported by: 바꾸기 · 끄기 (a switched-on account) / 켜기 (a switched-off one) · 순서 · 지우기.
export function actWord(act, row) {
  if (act === 'switch') return '바꾸기'
  if (act === 'toggle') return row && row.enabled === false ? '켜기' : '끄기'
  if (act === 'up' || act === 'down' || act === 'auto') return '순서'
  if (act === 'del' || act === 'delok') return '지우기'
  return null
}

function parsed(text) {
  if (typeof text !== 'string' || !text) return null
  try { return JSON.parse(text) } catch (err) { return null }
}

// The answer's status when it is a 2xx, else null (`res` = what $.http.fetch resolved to, or null when it threw).
function status(res) {
  return res && typeof res === 'object' && typeof res.status === 'number' && Number.isFinite(res.status) ? Math.trunc(res.status) : null
}
export function is2xx(res) {
  const st = status(res)
  return st !== null && st >= 200 && st <= 299
}

// The short note a finished call leaves — fixed words and the status number only, never the answer's text (upstream
// answers and errors can carry the account name). `res` = { status, text } of $.http.fetch, or null when it threw.
//   2xx = «<word> ✓» · another status = «<word> ✕<status>» · thrown = «<word> ✕»
//   switch (정정 B · server.js 749~790): a 2xx whose JSON says eligible === false = «바꾸기 ✓ · 돌림 안 탐» (recorded, but
//     rotation will not use it; the reason is not shown)
//   delok (정정 C · mcp.js): a JSON-RPC error rides a 200 too — ✓ only when the body's result is an object, its isError
//     is not true and there is no error; else «지우기 ✕»
export function callNote(act, word, res) {
  const st = status(res)
  if (st === null) return word + ' ✕'
  if (!is2xx(res)) return word + ' ✕' + st
  const j = parsed(res.text)
  if (act === 'switch') return isObj(j) && j.eligible === false ? word + ' ✓ · 돌림 안 탐' : word + ' ✓'
  if (act === 'delok') return isObj(j) && isObj(j.result) && j.result.isError !== true && j.error === undefined ? word + ' ✓' : word + ' ✕'
  return word + ' ✓'
}

export function _resetForTests() {
  idByName.clear()
  nameById.clear()
  spare = 0
}
