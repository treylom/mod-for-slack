// lane: ui · owner: 봇 — pure TeamClaude 칸 (no `$`, no node imports, no network).
// Design = 설계 메모 (원형 TeamClaude 축소판): head `◆ TeamClaude · 라우팅 <mode>(<문턱>) … Port <port> ▲`, then the
// original screen's sections in its order — Claude · usage (one row per account: `>►N. #P active Ses Wk Fbl`) →
// Codex → Grok → Cursor → Gemini — with every usage cell painted like the original (BAR via text.js barOf).
// Input = what index.js read from each `ui.team_claude_urls` status address (GET only, read-only):
//   [{ url, ok, json, at }] — fields are picked by shape, not by address: the answer whose `accounts[]` carry no
//   `provider` holds the Claude accounts; the router answer holds `sessions`, `server`, `accounts[]` with
//   `provider: 'codex'` and `externalUsage[]`.
// 🔒 An account is shown only by its row number and priority (#P). Names, labels, messages, model keys and every
// other free text of the answers never leave teamModel; the few words shown (mode, version, status, provider) must
// look like a plain word (SAFE) or become «?». externalUsage entries of `claude-legacy` are skipped whole (they
// duplicate the Claude accounts and carry their names). r3a: index.js hands the answers in with every account name
// already swapped for a random id (accounts.js stripNames) — the id is what a press carries, the name stays out.
// Width: the richest of 4 formats (W ≈64 · M ≈56 · S ≈39 · XS ≈28 cells · 10-18 T3 grid) whose every line fits `cols` — measured,
// never wrapped (a wrapped line would break the caller's row budget), never «…». Below XS: the head line alone,
// folded. Height: an ordered fold (설계 메모) — the first form whose line count fits `rows`.
import { strWidth, segWidth, barOf, RESULT_LOOK } from './text.js'
import { hhmm } from './schedule.js'
import { pressable } from './calls.js'
import { orderPlan } from './accounts.js'
import { batteryCell, batteryTower, resetProgressBar, usageInk } from './skin.js'

const SAFE = /^[A-Za-z0-9._:-]{1,20}$/
const FORMATS = ['W', 'M', 'S', 'XS']

function word(v) {
  return typeof v === 'string' && SAFE.test(v) ? v : '?'
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function nonneg(v) {
  const n = num(v)
  return n !== null && n >= 0 ? n : null
}

function isObj(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function list(v) {
  return Array.isArray(v) ? v.filter(isObj) : []
}

function answered(r) {
  return Boolean(r && r.ok && isObj(r.json))
}

function portOf(url) {
  try {
    const u = new URL(url)
    const p = u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '')
    return p ? word(p) : null
  } catch (err) {
    return null
  }
}

// ── model (name-free) ──
// A usage value: pct = 0–100 · reset = epoch ms or null.
function use(pct, reset) {
  const p = nonneg(pct)
  return p === null ? null : { pct: p, reset: num(reset) }
}

function useFrac(f, reset) {
  const v = nonneg(f)
  return v === null ? null : use(v * 100, reset)
}

// The answer holding the Claude accounts (index.js takes the write address from the first one — 설계 메모).
export function isClaudeAnswer(j) {
  const a = list(isObj(j) ? j.accounts : null)
  return a.length > 0 && a.every((x) => x.provider === undefined || x.provider === null)
}

// Rows in priority order (ties: list position). N = row number · P = priority + 1 (row number when there is none).
// r3a (설계 메모): `id` = the random id index.js put in place of the name (accounts.js stripNames), never the name ·
// `ranked` = the account has a priority (the original TUI's rank) · `pr` = that priority as given — accounts.js orderPlan
// reads these model rows, never the drawn lines (정정 F).
function claudeOf(j) {
  const accts = list(j.accounts)
  const cur = typeof j.currentAccount === 'string' ? accts.findIndex((a) => a.name === j.currentAccount) : -1
  const order = accts.map((a, k) => ({ a, k, pr: num(a.priority) }))
  order.sort((x, y) => (x.pr ?? Infinity) - (y.pr ?? Infinity) || x.k - y.k)
  return order.map(({ a, k, pr }, i) => {
    const q = isObj(a.quota) ? a.quota : {}
    // Fbl = the modelWeekly entry (0 or 1 in practice; several → the highest). Its key (a model name) is not kept.
    let fbl = null
    for (const w of Object.values(isObj(q.modelWeekly) ? q.modelWeekly : {})) {
      const u = isObj(w) ? useFrac(w.utilization, w.reset) : null
      if (u && (!fbl || u.pct > fbl.pct)) fbl = u
    }
    const enabled = a.enabled !== false
    return {
      n: i + 1,
      p: pr !== null && pr >= 0 ? pr + 1 : i + 1,
      id: typeof a.id === 'string' ? a.id : null,
      ranked: pr !== null,
      pr,
      status: enabled ? word(a.status) : 'disabled',
      enabled,
      current: k === cur,
      ses: useFrac(q.unified5h, q.unified5hReset),
      wk: useFrac(q.unified7d, q.unified7dReset),
      fbl,
    }
  })
}

// Codex: routable = active and not disabled · Wk = the highest 7d use among them · recover = when the others come back:
// only a real rest time of the account itself (rateLimitedUntil · pausedUntil · entitlementDeniedUntil, a number) —
// T2 (주인 10-18 21:03): the 7d usage reset (quota.unified7dReset) was read as «복구 22d14h»,
// while the accounts were in status «error» (the router's log: «needs re-login (refresh token rejected)») and come back
// only by a login · relogin = those accounts (status «error», not switched off).
const REST_KEYS = ['rateLimitedUntil', 'pausedUntil', 'entitlementDeniedUntil']
function codexOf(accts) {
  const cx = accts.filter((a) => a.provider === 'codex')
  if (!cx.length) return null
  const ok = cx.filter((a) => a.status === 'active' && a.disabled !== true)
  const quota = (a) => (isObj(a.quota) ? a.quota : {})
  let wk = null
  for (const a of ok) {
    const u = useFrac(quota(a).unified7d, quota(a).unified7dReset)
    if (u && (!wk || u.pct > wk.pct)) wk = u
  }
  const recover = cx.filter((a) => !ok.includes(a)).flatMap((a) => REST_KEYS.map((k) => num(a[k]))).filter((t) => t !== null).sort((x, y) => x - y)
  return {
    routable: ok.length,
    relogin: cx.filter((a) => a.disabled !== true && a.status === 'error').length,
    errors: cx.filter((a) => a.disabled !== true && a.status !== 'active').length,
    off: cx.filter((a) => a.disabled === true).length,
    wk,
    recover,
    // v3 r2: one row per account for the opened Codex section — row number, on / err / off and the usage cells only
    rows: cx.map((a, i) => ({
      n: i + 1,
      status: a.disabled === true ? 'off' : a.status === 'active' ? 'on' : 'err',
      ses: useFrac(quota(a).unified5h, quota(a).unified5hReset),
      wk: useFrac(quota(a).unified7d, quota(a).unified7dReset),
    })),
  }
}

// A window picked by its label (compared, never kept).
function windowOf(x, labels) {
  for (const w of list(x.windows)) {
    if (typeof w.label === 'string' && labels.includes(w.label.toLowerCase())) return use(w.percent, w.resetAt)
  }
  return null
}

function extOf(x) {
  return { status: word(x.status), ok: x.status === 'ok', at: num(x.observedAt) }
}

// results → the display model (no names in it).
export function teamModel(results) {
  const rs = Array.isArray(results) ? results : []
  const m = { port: null, up: false, mode: null, distribute: null, threshold: null, version: null, claude: null, codex: null, grok: null, cursor: null, gemini: null }
  let claudeAt = -1
  let routerThreshold = null
  rs.forEach((r, i) => {
    if (!answered(r)) return
    const j = r.json
    if (isClaudeAnswer(j)) {
      if (claudeAt < 0) {
        claudeAt = i
        m.claude = claudeOf(j)
        m.threshold = nonneg(j.switchThreshold)
      }
    } else {
      if (!m.codex) m.codex = codexOf(list(j.accounts))
      if (routerThreshold === null) routerThreshold = nonneg(j.switchThreshold)
    }
    if (isObj(j.sessions)) {
      if (m.mode === null && typeof j.sessions.mode === 'string') m.mode = word(j.sessions.mode)
      if (m.distribute === null && typeof j.sessions.distribute === 'boolean') m.distribute = j.sessions.distribute
    }
    if (m.version === null && isObj(j.server) && typeof j.server.version === 'string') m.version = word(j.server.version)
    for (const x of list(j.externalUsage)) {
      const p = typeof x.provider === 'string' ? x.provider : ''
      if (p === 'xai') m.grok ||= { ...extOf(x), wk: windowOf(x, ['week']) }
      // ASSUMPTION: the original screen shows Cursor `Tot` and `Int`; the answer's windows are `Month`,
      // `First-party models` and `API usage` → Month = Tot · First-party models = Int · API usage = API (shown when it fits).
      else if (p === 'cursor') m.cursor ||= { ...extOf(x), tot: windowOf(x, ['month']), int: windowOf(x, ['first-party models']), api: windowOf(x, ['api usage']) }
      else if (/gemini|antigravity/i.test(p)) m.gemini ||= { ...extOf(x), name: word(p), ses: windowOf(x, ['5h']), wk: windowOf(x, ['week']) }
      // claude-legacy (names inside) and any other provider: skipped
    }
  })
  if (m.threshold === null) m.threshold = routerThreshold
  // Port in the head = the address holding the Claude accounts. ASSUMPTION when none answered with them: the first
  // address that did not answer (else the first address) — that one is shown, with ▼.
  const down = rs.findIndex((r) => !answered(r))
  const pick = claudeAt >= 0 ? claudeAt : down >= 0 ? down : 0
  m.port = rs[pick] && typeof rs[pick].url === 'string' ? portOf(rs[pick].url) : null
  m.up = claudeAt >= 0
  return m
}

// ── drawing ──
const SEP = { text: ' · ', color: 'dim' }

function padTo(s, n) {
  return s + ' '.repeat(Math.max(0, n - strWidth(s)))
}

// Time left until `ms`, compact (4h56m · 4d22h · 30d5h · 59m) — at most 6 cells; past or unknown = ''.
function left(ms, nowMs) {
  if (num(ms) === null || num(nowMs) === null || ms <= nowMs) return ''
  const min = Math.floor((ms - nowMs) / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  if (d >= 100) return d > 9999 ? '9999d+' : d + 'd'
  if (d > 0) return d + 'd' + h + 'h'
  if (h > 0) return h + 'h' + (min % 60) + 'm'
  return min + 'm'
}

function pctText(p) {
  return Math.min(Math.round(p), 999) + '%'
}

// The painted cells of a usage cell `width` cells wide (주인 10-18 21:03):
// round(pct/100 × width), at least 1 while the shown value is 1% or more (barOf), at most the whole cell.
export function fillCells(pct, width) {
  if (!barOf(pct)) return 0
  return Math.max(1, Math.min(width, Math.round((pct / 100) * width)))
}

// One usage cell = an Array of segments, always the same width and letters: wide = 11 cells (percent right-aligned in
// 4 · space · time left, left-aligned in 6), narrow = 6 cells (percent only). The first fillCells of it are painted in
// the shown percent's color (barOf), the rest in BAR.track — letters ride on both, no block glyphs (ambiguous width).
// 0% = all track · no value = a dim «-» · a switched-off account = dim, unpainted. Callers spread it.
function cell(u, wide, nowMs, dimmed) {
  if (!u) return [{ text: wide ? '     -     ' : '  -   ', color: 'dim' }]
  const text = wide ? pctText(u.pct).padStart(4) + ' ' + left(u.reset, nowMs).padEnd(6) : ' ' + pctText(u.pct).padStart(4) + ' '
  if (dimmed) return [{ text, color: 'dim' }]
  const bar = barOf(u.pct)
  const n = fillCells(u.pct, text.length)
  if (!bar || n <= 0) return [{ text, bar: 'track' }]
  return n >= text.length ? [{ text, bar }] : [{ text: text.slice(0, n), bar }, { text: text.slice(n), bar: 'track' }]
}

// A usage label, always 5 cells (« Ses » « Wk  » « Fbl » « Tot » « Int » « API »), so the k-th cell of every row sits
// in the same column (T3 한 격자).
function labText(name) {
  return ' ' + padTo(name, 3) + ' '
}

function fits(line, cols) {
  return Boolean(line) && segWidth(line) <= cols
}

// The first variant that fits, else null.
function richest(variants, cols) {
  for (const v of variants) if (fits(v, cols)) return v
  return null
}

// `Claude · usage ───…` — the rule fills the line to exactly `cols`.
function rule(title, cols) {
  const n = cols - strWidth(title) - 1
  return n >= 1 ? [{ text: title, color: 'cyan' }, { text: ' ' + '─'.repeat(n), color: 'dim' }] : null
}

function absent(name) {
  return [{ text: name + ' · 자료 없음', color: 'dim' }]
}

function routingText(m) {
  const th = m.threshold !== null ? pctText(m.threshold * 100) : null
  const core = m.mode !== null ? m.mode + (th ? '(' + th + ')' : '') : th
  if (core === null) return null
  return core + (m.distribute === false ? ' 분배 끔' : '')
}

// `lead` = the glyph in front: ◆ for the block's own head, or the pane's fold arrow (▼ open · ▶ folded) when the head is
// P3: the relay's ▲ 켜짐 · ▼ 꺼짐 (headLine) and the current account's «>>» (CUR_MARK) — the TeamClaude legend line
// (legend.js teamLegend) takes its inks from these
export const UP_DOWN = { up: { glyph: '▲', color: 'green' }, down: { glyph: '▼', color: 'red' } }

// the pane's boundary line (T5: one «TeamClaude» line, one key).
function title(lead) {
  return [{ text: lead || '◆', color: 'cyan', bold: true }, { text: ' ' }, { text: 'TeamClaude', color: 'bright', bold: true }]
}

// The head: left part + right part pushed to the line end; folded by dropping «라우팅 …», then «Port …».
function headLine(m, cols, lead) {
  const routing = routingText(m)
  const arrow = m.up ? { text: UP_DOWN.up.glyph, color: UP_DOWN.up.color } : { text: UP_DOWN.down.glyph, color: UP_DOWN.down.color }
  const port = [{ text: 'Port ' + (m.port || '?') + ' ', color: 'sub' }, arrow]
  const lefts = []
  if (routing !== null) lefts.push([...title(lead), { text: ' · 라우팅 ' + routing, color: 'sub' }], [...title(lead), { text: ' · ' + routing, color: 'sub' }])
  if (m.mode !== null) lefts.push([...title(lead), { text: ' · ' + m.mode, color: 'sub' }])
  lefts.push(title(lead))
  const variants = lefts.map((l) => [l, port])
  variants.push([title(lead), [arrow]], [[{ text: 'TeamClaude', color: 'bright', bold: true }], [arrow]])
  for (const [l, r] of variants) {
    const gap = cols - segWidth(l) - segWidth(r)
    if (gap >= 1) return [...l, { text: ' '.repeat(gap) }, ...r]
  }
  return richest([[{ text: 'TeamClaude', color: 'bright', bold: true }], [{ text: lead || '◆', color: 'cyan', bold: true }, { text: ' TC ' }, arrow], [{ text: 'TC', color: 'bright', bold: true }]], cols)
}

// One line for «no addresses» / «reading»: folded by dropping words from the end.
function noteLine(note, cols, lead) {
  return richest([
    [...title(lead), { text: ' · ' + note, color: 'dim' }],
    ...(note.includes(' (') ? [[...title(lead), { text: ' · ' + note.slice(0, note.indexOf(' (')), color: 'dim' }]] : []),
    title(lead),
    [{ text: 'TeamClaude', color: 'bright', bold: true }],
    [{ text: 'TC', color: 'bright', bold: true }],
  ], cols)
}

// T5 (주인 10-18 21:03): the pane's one TeamClaude line — the boundary
// over the lower part (band.js paneLines, key f) carrying the block's head: «▼ TeamClaude · 라우팅 adaptive(99%) … Port
// 3456 ▲» open, «▶ …» folded; «주소 설정 없음» / «읽는 중» in it too. The block under it is then drawn headless (teamBlock
// opts.headless), so no other line names TeamClaude. opts = { urls, cols, open }; null when nothing fits.
export function teamHead(m, opts) {
  const o = opts || {}
  const cols = Math.floor(num(o.cols) ?? 0)
  if (cols <= 0) return null
  const lead = o.open === false ? '▶' : '▼'
  if (!o.urls) return noteLine('주소 설정 없음 (ui.team_claude_urls)', cols, lead)
  if (!m) return noteLine('읽는 중', cols, lead)
  return headLine(m, cols, lead)
}

// ── T3 한 격자 (주인 10-18 21:03): within one width format every row that carries usage cells —
// a Claude account, a Codex account, a Grok / Cursor / Gemini line, titled or merged — starts its first cell in one
// column `g` (its head padded to it) and each next cell 16 (wide) or 11 (narrow) cells further: labels are 5 cells
// (labText), cells 11 or 6. g = the widest head that format can draw (gridOf), whether its section is open or not, so
// a press never moves the columns. The current-account mark is ASCII «>>» (was «>►»: ► is East Asian Ambiguous, 2 cells
// under a CJK-ambiguous terminal setting — that row alone moved one cell right).
export const CUR_MARK = () => [{ text: '>', color: 'cyan' }, { text: '>', color: 'green' }]

function padSeg(segs, g) {
  const n = g - segWidth(segs)
  return n > 0 ? [...segs, { text: ' '.repeat(n) }] : segs
}

// A Claude account row's head: W `  1. #1 active  ` · M `  #1 on ` · S / XS `  #1` (before the padding to g).
function accountHead(r, f) {
  const off = !r.enabled
  const bold = r.current && !off
  const idColor = off ? 'dim' : r.current ? 'green' : r.status === 'active' ? 'text' : 'red'
  const stColor = off ? 'dim' : r.status === 'active' ? (r.current ? 'green' : 'text') : 'red'
  const out = r.current ? CUR_MARK() : [{ text: '  ' }]
  if (f === 'W') out.push({ text: r.n + '. ', color: off ? 'dim' : 'text' })
  out.push(bold ? { text: '#' + r.p, color: idColor, bold } : { text: '#' + r.p, color: idColor })
  if (f === 'W' || f === 'M') {
    const st = f === 'W' ? r.status : off ? 'off' : r.status === 'active' ? 'on' : 'err'
    out.push({ text: ' ' }, bold ? { text: st, color: stColor, bold } : { text: st, color: stColor }, { text: ' '.repeat(Math.max(0, (f === 'W' ? 8 : 3) - strWidth(st))) })
  }
  return out
}

// One account row: its head padded to g, then Ses Wk Fbl (XS: Ses Wk). W ≈64 · M ≈56 · S ≈39 · XS ≈28 cells.
function accountRow(r, f, nowMs, g) {
  const off = !r.enabled
  const wide = f === 'W' || f === 'M'
  const lab = (t) => ({ text: labText(t), color: off ? 'dim' : 'sub' })
  const out = padSeg(accountHead(r, f), g)
  out.push(lab('Ses'), ...cell(r.ses, wide, nowMs, off), lab('Wk'), ...cell(r.wk, wide, nowMs, off))
  if (f !== 'XS') out.push(lab('Fbl'), ...cell(r.fbl, wide, nowMs, off))
  return out
}

// ── /mh 모양 1·2안 (봇 DESIGNS 안 1 battery-cell · 안 2 battery-tower · 봇): a Claude account row as
// two lines — the battery (what is left, filled; its paint = the shown used percent, as barOf) with «잔 17%( 83%)» on
// the top line, under each cell the reset bar (time left to the reset over the window: Ses 5h · Wk 7d · Fbl 7d —
// the installed TeamClaude's unified5h · unified7d · modelWeekly, their *Reset times) on the bottom line.
// Every cell is exactly C cells wide on both lines, so the columns hold (T3). The plan is made once per drawing from
// the width and the grid column (usagePlan): 3 big cells → 3 small (the «( 83%)» used part goes first — 2안 «74칸에서도
// Ses·Wk·Fbl 3열») → 2 big → 2 small → 1 small; nothing fits = the classic row. No value = a dim empty battery and bar;
// a switched-off account = all dim. Only the top line presses (one Button per account).
export const USAGE_SKINS = ['battery-cell', 'battery-tower']
const WINDOW_MIN = { Ses: 300, Wk: 10080, Fbl: 10080 }
const WINDOW_TAG = { Ses: '5h', Wk: '7d', Fbl: '7d' }
const CELL_W = { 'battery-cell': { big: 20, small: 14 }, 'battery-tower': { big: 17, small: 11 } }
const PLANS = [[3, true], [3, false], [2, true], [2, false], [1, false]]

export function usagePlan(skin, cols, g) {
  if (!USAGE_SKINS.includes(skin)) return null
  for (const [n, big] of PLANS) {
    const c = CELL_W[skin][big ? 'big' : 'small']
    if (g + n * (5 + c) <= cols) return { skin, n, big, c }
  }
  return null
}

// One cell of plan u as { top, bot }: two segment lists, each exactly u.c cells.
export function batteryParts(v, lab, u, nowMs, off) {
  const tower = u.skin === 'battery-tower'
  const pad = (segs) => {
    const n = u.c - segWidth(segs)
    return n > 0 ? [...segs, { text: ' '.repeat(n) }] : segs
  }
  const ink = (color) => (off ? 'dim' : color)
  const used = v ? v.pct : null
  const bat = tower ? batteryTower(used, 3) : batteryCell(used, 5)
  const shown = used === null ? null : Math.min(100, Math.round(used))
  const rest = shown === null ? '   -' : (100 - Math.max(0, shown) + '%').padStart(4)
  const top = [{ text: bat.text, color: ink(bat.color) }, { text: '잔' + rest, color: ink(shown === null ? 'dim' : usageInk(used)) }]
  if (u.big) top.push({ text: '(' + (shown === null ? '  - ' : pctText(used).padStart(4)) + ')', color: ink(shown === null ? 'dim' : 'sub') })
  const reset = v ? v.reset : null
  const win = WINDOW_MIN[lab] || 300
  const t = left(reset, nowMs)
  let bot
  if (tower) {
    const bar = resetProgressBar(reset, nowMs, win, u.big ? 5 : 4, 'seg')
    bot = u.big ? [{ text: '└' + WINDOW_TAG[lab] + ' ', color: 'dim' }] : []
    bot.push({ text: bar.text, color: ink(bar.color) }, { text: ' ' + t.padEnd(6), color: ink('sub') })
  } else {
    const bar = resetProgressBar(reset, nowMs, win, u.big ? 6 : 5, 'line')
    bot = [{ text: u.big ? '└ ◷ ' : '└◷', color: 'dim' }, { text: bar.text, color: ink(bar.color) }, { text: ' ' + t.padEnd(6), color: ink('sub') }]
  }
  return { top: pad(top), bot: pad(bot) }
}

// A Claude account under a usage skin: [top, bottom] (the head on the top line, padded to g; the bottom indented to g).
function batteryRows(r, f, nowMs, g, u) {
  const off = !r.enabled
  const top = padSeg(accountHead(r, f), g)
  const bot = [{ text: ' '.repeat(Math.max(g, segWidth(top))) }]
  const cells = [['Ses', r.ses], ['Wk', r.wk], ['Fbl', r.fbl]].slice(0, u.n)
  for (const [lab, v] of cells) {
    const c = batteryParts(v, lab, u, nowMs, off)
    top.push({ text: labText(lab), color: off ? 'dim' : 'sub' }, ...c.top)
    bot.push({ text: ' '.repeat(5) }, ...c.bot)
  }
  return [top, bot]
}

// One account's lines: classic = its one row · a usage plan = the battery's two.
function accountRows(r, f, nowMs, g, u) {
  return u ? batteryRows(r, f, nowMs, g, u) : [accountRow(r, f, nowMs, g)]
}

// A Codex account row's head: W / M `  #1 err` · S / XS `  #1`.
function codexHead(r, f) {
  const off = r.status === 'off'
  const color = off ? 'dim' : r.status === 'on' ? 'text' : 'red'
  const out = [{ text: '  ' }, { text: '#' + r.n, color }]
  if (f === 'W' || f === 'M') out.push({ text: ' ' }, { text: r.status, color }, { text: ' '.repeat(Math.max(0, 3 - strWidth(r.status))) })
  return out
}

// The first-cell column of format f: the widest head any row of it may have (see T3 above).
function gridOf(m, f) {
  const w = [0]
  for (const r of m.claude || []) w.push(segWidth(accountHead(r, f)))
  for (const r of (m.codex && m.codex.rows) || []) w.push(segWidth(codexHead(r, f)))
  for (const d of [...descriptors(m), geminiDescriptor(m)]) {
    if (d.missing || !d.cells.length) continue
    w.push(strWidth(d.name))
    if (f === 'W') w.push(2 + strWidth(d.labelW))
  }
  return Math.max(...w)
}

// Accounts at 100% on Wk or switched off, as one line (current account never in it).
function gone(r) {
  return !r.current && (!r.enabled || Boolean(r.wk && Math.round(r.wk.pct) >= 100))
}

function groupLine(g, cols) {
  const spent = g.filter((r) => r.enabled).length
  const offN = g.length - spent
  const parts = []
  if (spent) parts.push('100% 소진 ' + spent)
  if (offN) parts.push('꺼짐 ' + offN)
  return richest([[{ text: '  +' + g.length + '개 (' + parts.join(' · ') + ')', color: 'dim' }], [{ text: '  +' + g.length + '개', color: 'dim' }]], cols)
}

function claudeLines(m, f, cols, nowMs, grouped, titled, g, u) {
  if (!m.claude) return [absent('Claude')]
  const out = titled ? [rule('Claude · usage', cols)] : []
  let rows = m.claude
  let group = null
  if (grouped && rows.some(gone)) {
    group = groupLine(rows.filter(gone), cols)
    rows = rows.filter((r) => !gone(r))
  }
  out.push(...rows.flatMap((r) => accountRows(r, f, nowMs, g, u)))
  if (group) out.push(group)
  return out
}

// ── external providers: one descriptor each, drawn per style ──
// style: 'titled' (W: value line under a title rule) · 'merged' (name + label, one line) · 'S' · 'XS'
function timeTail(x) {
  return x.at !== null ? [SEP, { text: hhmm(x.at), color: 'sub' }] : []
}

function statusTail(x) {
  return [SEP, { text: x.status, color: x.ok ? 'green' : 'red' }]
}

function descriptors(m) {
  const out = []
  const c = m.codex
  if (!c) out.push({ key: 'codex', name: 'Codex', missing: true })
  else if (c.routable > 0) {
    const errs = [...(c.errors ? [SEP, { text: '오류 ' + c.errors, color: 'red' }] : []), ...(c.off ? [SEP, { text: '꺼짐 ' + c.off, color: 'dim' }] : [])]
    out.push({ key: 'codex', name: 'Codex', title: 'Codex · usage', labelW: 'Routable (' + c.routable + ')', labelM: 'Routable (' + c.routable + ')',
      tag: 'Routable (' + c.routable + ')', cells: [['Ses', null], ['Wk', c.wk]], xs: 1, must: [], tails: [errs, []], rows: c.rows || [] })
  } else {
    // nothing routable: no usage number is drawn (none would be true) — why, and when they come back: «복구 <left>» from
    // a real rest time only, else «재로그인 필요» while an account is in error (T2)
    const why = c.errors ? [SEP, { text: '오류 ' + c.errors, color: 'red' }] : c.off ? [SEP, { text: '꺼짐 ' + c.off, color: 'dim' }] : []
    const more = c.errors && c.off ? [SEP, { text: '꺼짐 ' + c.off, color: 'dim' }] : []
    out.push({ key: 'codex', name: 'Codex', title: 'Codex · usage', labelW: 'Routable (0)', labelM: 'Routable (0)', cells: [], xs: -1, must: why,
      recover: c.recover, relogin: c.relogin || 0, tails: [[...more, 'recover'], ['recover'], more, []], rows: c.rows || [] })
  }
  const g = m.grok
  // tag = the merged line's word after its cells (T3: the label left the head so the cells line up) — Cursor has none
  out.push(g ? { key: 'grok', name: 'Grok', title: 'Grok · shared weekly', labelW: 'Shared pool', labelM: 'Shared weekly', tag: 'Shared weekly', cells: [['Ses', null], ['Wk', g.wk]], xs: 1, must: [],
    tails: [[...timeTail(g), ...statusTail(g)], statusTail(g), []] } : { key: 'grok', name: 'Grok', missing: true })
  const u = m.cursor
  if (u) {
    const api = [{ text: labText('API'), color: 'sub' }, 'api']
    out.push({ key: 'cursor', name: 'Cursor', title: 'Cursor · usage', labelW: 'Account', labelM: 'Usage', cells: [['Tot', u.tot], ['Int', u.int]], xs: 0, must: [], api: u.api,
      tails: [[...api, ...timeTail(u), ...statusTail(u)], [...timeTail(u), ...statusTail(u)], statusTail(u), []] })
  } else out.push({ key: 'cursor', name: 'Cursor', missing: true })
  return out
}

function geminiDescriptor(m) {
  const x = m.gemini
  if (!x) return { key: 'gemini', name: 'Gemini', missing: true }
  return { key: 'gemini', name: 'Gemini', title: 'Gemini · usage', labelW: x.name, labelM: x.name, tag: x.name, cells: [['Ses', x.ses], ['Wk', x.wk]], xs: 1, must: [],
    tails: [[...timeTail(x), ...statusTail(x)], statusTail(x), []] }
}

// One provider line. Its head is padded to the format's grid column g (T3), so its cells sit under the account rows'
// cells: titled `  Shared pool     Ses …` · merged / S / XS `Grok            Ses …` — the merged line's label (tag) moved
// behind its cells, the first piece a narrow line gives up. A line without cells (Codex · Routable (0)) keeps its
// label in front: nothing of it has to line up.
function extLine(d, style, cols, nowMs, g) {
  const wide = style === 'titled' || style === 'merged'
  const cells = style === 'XS' ? (d.xs >= 0 ? [d.cells[d.xs]] : []) : d.cells
  const col = Number.isFinite(g) ? g : 0
  let base = []
  if (style === 'titled') base.push({ text: '  ' + d.labelW, color: 'text' })
  else {
    base.push({ text: d.name, color: 'cyan' })
    if (!cells.length && style !== 'XS') base = padSeg(base, Math.max(col, strWidth(d.name) + 1)).concat({ text: d.labelM, color: 'text' })
  }
  if (cells.length) base = padSeg(base, col)
  for (const [lab, u] of cells) base.push({ text: labText(lab), color: 'sub' }, ...cell(u, wide, nowMs, false))
  base.push(...d.must)
  // tail pieces: 'recover' / 'api' are filled here (they depend on nowMs and the cell width)
  const fill = (tail) => {
    const out = []
    for (const p of tail) {
      if (p === 'recover') {
        const t = (d.recover || []).find((ms) => ms > nowMs)
        if (t !== undefined && left(t, nowMs) !== '') out.push(SEP, { text: '복구 ' + left(t, nowMs), color: 'sub' })
        else if (d.relogin > 0) out.push(SEP, { text: '재로그인 필요', color: 'yellow' })
        else return null
      } else if (p === 'api') out.push(...cell(d.api, wide, nowMs, false))
      else out.push(p)
    }
    return out
  }
  const tails = d.tails.map(fill).filter(Boolean)
  const tagged = style === 'merged' && cells.length && d.tag && tails.length ? [[SEP, { text: d.tag, color: 'text' }, ...tails[0]]] : []
  const variants = [...tagged, ...tails].map((t) => [...base, ...t])
  return richest(variants, cols) || base
}

function extSection(d, style, cols, nowMs, g) {
  if (d.missing) return [absent(d.name)]
  if (style === 'titled') return [rule(d.title, cols), extLine(d, style, cols, nowMs, g)]
  return [extLine(d, style, cols, nowMs, g)]
}

// The 3-line form's Claude line: the current account's cells + how many others.
function claudeSummary(m, cols, nowMs, skin) {
  if (!m.claude) return richest([absent('Claude')], cols)
  const cur = m.claude.find((r) => r.current) || m.claude[0]
  const others = m.claude.length - 1
  const off = !cur.enabled
  const mark = cur.current ? CUR_MARK() : [{ text: '  ' }]
  const id = cur.current && !off ? { text: '#' + cur.p, color: 'green', bold: true } : { text: '#' + cur.p, color: off ? 'dim' : 'text' }
  // the summary line stands alone (no grid to keep): its labels stay as short as they are
  // a usage skin draws its small battery here too (the 3-line form is where a short pane lands — the skin stays seen)
  const bu = USAGE_SKINS.includes(skin) ? { skin, n: 1, big: false, c: CELL_W[skin].small } : null
  const c = (lab, u) => [{ text: ' ' + lab + ' ', color: 'sub' }, ...(bu ? batteryParts(u, lab, bu, nowMs, off).top : cell(u, false, nowMs, off))]
  const more = others > 0 ? [{ text: ' +' + others + '개', color: 'dim' }] : []
  const core = [...mark, id, ...c('Ses', cur.ses), ...c('Wk', cur.wk)]
  return richest([
    [{ text: 'Claude ', color: 'cyan' }, ...core, ...c('Fbl', cur.fbl), ...more],
    [...core, ...c('Fbl', cur.fbl), ...more],
    [...core, ...more],
    core,
    [...mark, id, ...c('Wk', cur.wk)],
  ], cols)
}

// The 3-line form's external line: `Codex Wk <c> · Grok Wk <c> · Cur ✓`, whole items only (+N for the rest).
// v3 r2: `keys` = which providers (default all) · `press` = each item presses its own section (teamPress).
function extSummary(m, cols, nowMs, keys, press) {
  const items = []
  const has = (k) => !keys || keys.includes(k)
  const item = (k, segs) => items.push(press ? pressable(segs, teamPress(k)) : segs)
  const name = (t) => ({ text: t, color: 'cyan' })
  const wk = (u) => [{ text: ' Wk ', color: 'sub' }, ...cell(u, false, nowMs, false)]
  const mark = (x) => (x.ok ? { text: ' ✓', color: 'green' } : { text: ' ✕', color: 'red' })
  const c = m.codex
  if (c && has('codex')) item('codex', c.routable > 0 ? [name('Codex'), ...wk(c.wk)] : [name('Codex'), c.errors ? { text: ' 오류 ' + c.errors, color: 'red' } : { text: ' 꺼짐 ' + c.off, color: 'dim' }])
  if (m.grok && has('grok')) item('grok', [name('Grok'), ...wk(m.grok.wk)])
  if (m.cursor && has('cursor')) item('cursor', [name('Cur'), mark(m.cursor)])
  if (m.gemini && has('gemini')) item('gemini', [name('Gem'), ...wk(m.gemini.wk)])
  let line = []
  let k = 0
  for (; k < items.length; k++) {
    const next = [...line, ...(line.length ? [SEP] : []), ...items[k]]
    if (segWidth(next) > cols) break
    line = next
  }
  if (line.length && k < items.length) {
    const tail = { text: ' +' + (items.length - k), color: 'dim' }
    if (segWidth(line) + strWidth(tail.text) <= cols) line.push(tail)
  }
  return line.length ? line : null
}

// The forms of one width format, richest first (설계 메모): full → without «Gemini · 자료 없음» → external titles merged
// into their value lines → disabled / 100%-Wk accounts in one line → that without the «Claude · usage» title →
// 3 lines (head + Claude + externals).
function forms(m, f, cols, nowMs, skin) {
  const style = f === 'W' || f === 'M' ? 'merged' : f
  const g = gridOf(m, f)
  const u = usagePlan(skin, cols, g)
  const ext = (st) => descriptors(m).flatMap((d) => extSection(d, st, cols, nowMs, g))
  const gem = geminiDescriptor(m)
  const gemLines = (st) => extSection(gem, st, cols, nowMs, g)
  const full = [...claudeLines(m, f, cols, nowMs, false, true, g, u), ...ext(f === 'W' ? 'titled' : style), ...gemLines(f === 'W' ? 'titled' : style)]
  const keepGem = (st) => (gem.missing ? [] : gemLines(st))
  const out = [full]
  if (gem.missing) out.push(full.slice(0, -1))
  out.push(
    [...claudeLines(m, f, cols, nowMs, false, true, g, u), ...ext(style), ...keepGem(style)],
    [...claudeLines(m, f, cols, nowMs, true, true, g, u), ...ext(style), ...keepGem(style)],
    [...claudeLines(m, f, cols, nowMs, true, false, g, u), ...ext(style), ...keepGem(style)],
    [claudeSummary(m, cols, nowMs, skin), extSummary(m, cols, nowMs)].filter(Boolean),
  )
  return out
}

// ── v3 r2 presses (봇 ④) ──
//
// Given `open` (a Set of TEAM_SECTIONS), the block is pressable: each section's head line opens or shuts it (T5: the
// block head's own «t» that opened every section is gone — one TeamClaude line, one key f, band.js; the pane scrolls,
// so index.js opens every section to begin with). Shut: Claude = the first TEAM_SHOW accounts by priority, the current one
// kept among them · Codex = its line and its first TEAM_SHOW accounts · Grok/Cursor/Gemini = one line without the time.
// Open: every account, the time, the title rule where the width has it (W). Short of rows, the shut providers join one
// summary line before an opened section loses rows. Without `open` the block is drawn as before (no presses).
export const TEAM_SECTIONS = ['claude', 'codex', 'grok', 'cursor', 'gemini']
export const TEAM_SHOW = 3
export const teamPress = (section) => 'mh-tc-' + section

// ── r3a (설계 메모 대조표 1~9 · 정정 A~F): TeamClaude account controls ──
// In press mode a Claude account row with an id is a Button (TEAM_ACCT) — pressed, it is the selected account (`sel`)
// and the line under it is its action line: «↳ w: 바꾸기 · e: 끄기|켜기 · ▲ · ▼ · 자동 · d: 지우기» (an order step with
// nothing to do — accounts.js orderPlan null — dim, no press), «↳ 정말 지우기? · y: 정말 지우기 · n: 취소» while its
// delete waits for the confirm (`confirm` = that id), or one dim «↳ 조작 = 설정 꺼짐 · 엔진 주소 없음» while
// ui.team_claude_control is off (`control`). A short result (`note`) ends the line and is the first thing left out.
// An open Claude section's titled forms end in one tail line «↻ 다시 읽기 · 더하기 = 엔진 화면에서 · 최근 요청 = 준비 중»
// (↻ = TEAM_RELOAD), the first line a form drops. The selected account stays drawn like the account in use (never
// folded into «+N개»), so its line does not vanish in a short pane. Ids are [a-z0-9] (accounts.js idOf) — a row whose id
// is not is never pressable. Hotkeys (정정 E): w e d · y n — none of s m p (도구) · t j r (칸 머리) in the same drawing.
export const TEAM_ACCT = (id) => 'mh-tc-acct-' + id
export const TEAM_ACT = (act, id) => 'mh-tc-act-' + act + '-' + id

// ── 10-21 (주인 · measured on a real 2.1.296 pane): a pane taller than its
// window (T4) gives ↑ ↓ to the engine's scroll — the whole pane moves a row and the ring stays; ← → walk the ring. `keys`
// = the pane's Button keys in drawing order (index.js buttonProps: «<press>@<line key>», a wrapped part «…:1», a second
// draw «#2»). The account a key belongs to: the id after TEAM_ACCT, before «@».
const ACCT_PREFIX = TEAM_ACCT('')
const acctOf = (key) => (typeof key === 'string' && key.startsWith(ACCT_PREFIX) && key.includes('@') ? key.slice(ACCT_PREFIX.length, key.indexOf('@')) : null)
// The first Button key of account `id`'s row, or null (not drawn).
export function accountKeyOf(keys, id) {
  return (Array.isArray(keys) ? keys : []).find((k) => acctOf(k) === id && !/(:\d+|#\d+)$/.test(k)) || null
}
// The person's arrow on a ui.scroll (`e`) while the ring is on an account row → the key of the next (↓) or previous (↑)
// account row; null = let the pane scroll as before: a wheel tick (it carries `pointer`), a page key (more than a row),
// a plugin's scroll, the ring off the account rows (a head, an action button, unknown), or no row that way.
export function accountArrow(keys, ring, e) {
  if (!e || !e.origin || e.origin.kind !== 'person' || e.pointer || Math.abs(e.by) !== 1) return null
  const at = acctOf(ring)
  if (at === null) return null
  const ids = []
  for (const k of Array.isArray(keys) ? keys : []) {
    const id = acctOf(k)
    if (id !== null && !ids.includes(id)) ids.push(id)
  }
  const i = ids.indexOf(at)
  if (i < 0) return null
  const to = ids[i + (e.by > 0 ? 1 : -1)]
  return to === undefined ? null : accountKeyOf(keys, to)
}
export const TEAM_RELOAD = 'mh-tc-reload'
export const TEAM_KEYS = { switch: 'w', toggle: 'e', del: 'd', delok: 'y', cancel: 'n' }
const ID_RE = /^[a-z0-9]+$/
const pickable = (r) => typeof r.id === 'string' && ID_RE.test(r.id)

const foldMark = (open) => ({ text: ' ' + (open ? '▾' : '▸'), color: 'cyan' })

// «Claude · usage · 6개 ▸ ───…» — a section head as a rule filling the line to exactly `cols`; null when it cannot.
// 10-19 ④ 부모 답(«접힌 공급사 한 줄 안에 >> 쓰는 계정을 붙여 한 줄 유지 · 좁으면 계정부터 자름»): `extra` = segments
// after the count (a shut Claude head's «· >>#2»), the first thing given up when the line is short.
function headRule(title, count, open, press, cols, extra) {
  const left = (more) => [{ text: title, color: 'cyan' }, ...(Number.isFinite(count) ? [{ text: ' · ' + count + '개', color: 'sub' }] : []), ...more, foldMark(open)]
  for (const more of extra && extra.length ? [extra, []] : [[]]) {
    const l = left(more)
    const n = cols - segWidth(l) - 1
    if (n >= 1) return pressable([...l, { text: ' ' + '─'.repeat(n), color: 'dim' }], press)
  }
  return null
}

// «· >>#2» — the account in use as the screen names it (its place, never its name — names are never drawn), for a shut
// Claude section's one line; none in use = nothing.
function inUse(m) {
  const c = (m.claude || []).find((r) => r.current)
  return c ? [{ text: ' · ', color: 'sub' }, ...CUR_MARK(), { text: '#' + c.p, color: 'green' }] : []
}

// The first k rows by priority, the rows `kept` says (the current account · r3a: the selected one) kept among them, each
// in its own place — a kept row outside the first k takes the last place no kept row holds.
function firstOf(rows, k, kept) {
  if (rows.length <= k) return rows
  const top = rows.slice(0, k)
  for (const r of rows.filter(kept)) {
    if (top.includes(r)) continue
    for (let i = top.length - 1; i >= 0; i--) {
      if (!kept(top[i])) { top[i] = r; break }
    }
  }
  return rows.filter((r) => top.includes(r))
}

// One Codex account: W/M `  #1 err` · S/XS `  #1`, padded to the grid column g, then Ses <c> Wk <c> — no name. (XS
// keeps Ses too now, so its Wk sits under the Claude rows' Wk.)
function codexRow(r, f, nowMs, g) {
  const off = r.status === 'off'
  const wide = f === 'W' || f === 'M'
  const lab = (t) => ({ text: labText(t), color: off ? 'dim' : 'sub' })
  const out = padSeg(codexHead(r, f), g)
  out.push(lab('Ses'), ...cell(r.ses, wide, nowMs, off), lab('Wk'), ...cell(r.wk, wide, nowMs, off))
  return out
}

const noteColor = (note) => (note.includes('✕') ? RESULT_LOOK.fail.color : note.includes('✓') ? RESULT_LOOK.ok.color : 'sub')
const joined = (items, sep) => items.flatMap((it, i) => (i ? [{ text: sep, color: 'dim' }, ...it] : it))

// One word of the action line: pressable (its hotkey, if it has one), or dim with no press when it would do nothing.
function actWordSegs(act, id, text, color, live) {
  return live ? pressable([{ text, color }], TEAM_ACT(act, id), TEAM_KEYS[act]) : [{ text, color: 'dim' }]
}

// The selected account's line (see TEAM_ACCT above), the richest that fits `cols`: the « · » between the words become
// spaces while the note still fits (a docked pane, 69 cells, keeps «바꾸기 ✓ · 돌림 안 탐» so), then the note goes, then
// the indent, then words from the end of the line — the note never pushes a word out; null when not even one word
// fits. Whether ▲ ▼ 자동 have something to do = x.can, made once by teamBlock from the model rows (정정 F-2).
function actionLine(r, x, cols) {
  const id = r.id
  const lead = { text: '  ↳ ', color: 'dim' }
  const short = { text: '↳ ', color: 'dim' }
  const note = x.note ? [{ text: ' · ' + x.note, color: noteColor(x.note) }] : []
  if (!x.control) {
    const t = (s) => ({ text: s, color: 'dim' })
    return richest([[lead, t('조작 = 설정 꺼짐 · 엔진 주소 없음'), ...note], [lead, t('조작 = 설정 꺼짐 · 엔진 주소 없음')], [lead, t('조작 = 설정 꺼짐')], [short, t('조작 꺼짐')]], cols)
  }
  if (x.confirm === id) {
    const ask = [{ text: '정말 지우기?', color: 'yellow' }]
    const ok = pressable([{ text: '정말 지우기', color: 'red', bold: true }], TEAM_ACT('delok', id), TEAM_KEYS.delok)
    const no = pressable([{ text: '취소', color: 'text' }], TEAM_ACT('cancel', id), TEAM_KEYS.cancel)
    return richest([[lead, ...joined([ask, ok, no], ' · '), ...note], [lead, ...joined([ask, ok, no], ' · ')], [lead, ...joined([ok, no], ' · ')],
      [short, ...joined([ok, no], ' ')], [short, ...ok]], cols)
  }
  const can = (dir) => Boolean(x.can && x.can[dir])
  const sw = actWordSegs('switch', id, '바꾸기', 'text', true)
  const tg = actWordSegs('toggle', id, r.enabled ? '끄기' : '켜기', r.enabled ? 'text' : 'green', true)
  const up = actWordSegs('up', id, '▲', 'text', can('up'))
  const dn = actWordSegs('down', id, '▼', 'text', can('down'))
  const au = actWordSegs('auto', id, '자동', 'text', can('auto'))
  const del = actWordSegs('del', id, '지우기', 'red', true)
  const all = [sw, tg, up, dn, au, del]
  return richest([[lead, ...joined(all, ' · '), ...note], ...(note.length ? [[lead, ...joined(all, ' '), ...note]] : []), [lead, ...joined(all, ' · ')],
    [lead, ...joined(all, ' ')], [short, ...joined(all, ' ')], [short, ...joined([sw, tg, up, dn, del], ' ')], [short, ...joined([sw, tg, del], ' ')],
    [short, ...joined([sw, tg], ' ')], [short, ...sw]], cols)
}

// «  ↻ 다시 읽기 · 더하기 = 엔진 화면에서 · 최근 요청 = 준비 중» (대조표 6 · 7 · 9): only ↻ presses (TEAM_RELOAD).
function tailLine(cols) {
  const reload = pressable([{ text: '↻ 다시 읽기', color: 'cyan' }], TEAM_RELOAD)
  const add = { text: ' · 더하기 = 엔진 화면에서', color: 'dim' }
  const recent = { text: ' · 최근 요청 = 준비 중', color: 'dim' }
  const pad = { text: '  ' }
  return richest([[pad, ...reload, add, recent], [pad, ...reload, add], [pad, ...reload], reload], cols)
}

function claudeLinesIx(m, f, cols, nowMs, grouped, titled, open, x, g, u) {
  if (!m.claude) return [absent('Claude')]
  const isOpen = open.has('claude')
  const out = titled ? [headRule('Claude · usage', m.claude.length, isOpen, teamPress('claude'), cols, isOpen ? [] : inUse(m))] : []
  const isSel = (r) => x.sel !== null && pickable(r) && r.id === x.sel
  const kept = (r) => r.current || isSel(r)
  // 10-19 ④ (봇 하위 세션 «공급사마다 접기·펼치기 — 다른 칸 접기와 같은 방식»): shut = the head line alone (was: the
  // first TEAM_SHOW accounts kept under it) — only the selected account and its action line stay (r3a: never folded).
  // Without the head (an untitled form) the shut section is one «+N개 … ▸» line, the same press.
  if (!isOpen) {
    const sel = m.claude.filter(isSel)
    const rest = m.claude.filter((r) => !isSel(r))
    const body = []
    for (const r of sel) {
      // merge ⑤ r3b × ⑥ ④: the selected account as its skin draws it (⑤ accountRows) — the top line presses, as in the open path
      const [first, ...more] = accountRows(r, f, nowMs, g, u)
      body.push(pickable(r) ? pressable(first, TEAM_ACCT(r.id)) : first, ...more)
      if (!x.line || x.line.cols !== cols) x.line = { cols, segs: actionLine(r, x, cols) }
      if (x.line.segs) body.push(x.line.segs)
    }
    if (!titled && rest.length) body.push(pressable(restLine(rest, cols, inUse(m)), teamPress('claude')))
    return [...out, ...body]
  }
  let rows = m.claude
  let tail = null
  if (grouped) {
    // open: the 100%-Wk / switched-off accounts in one line, as before · shut: one line for every account not drawn
    // (those and the folded ones), so the count stays true when the head rule with «N개» is left out · the selected
    // account is never folded (r3a)
    const keep = rows.filter((r) => kept(r) || !gone(r))
    const rest = m.claude.filter((r) => !keep.includes(r))
    if (rest.length) tail = isOpen ? groupLine(rest, cols) : pressable(restLine(rest, cols), teamPress('claude'))
    rows = keep
  }
  for (const r of rows) {
    // a usage skin's two lines: the top one presses (the account's one Button), the reset bars under it do not
    const [first, ...more] = accountRows(r, f, nowMs, g, u)
    out.push(pickable(r) ? pressable(first, TEAM_ACCT(r.id)) : first, ...more)
    // the same line in every form of one drawing (one row, one width): made once per teamBlock call
    if (isSel(r) && (!x.line || x.line.cols !== cols)) x.line = { cols, segs: actionLine(r, x, cols) }
    const act = isSel(r) ? x.line.segs : null
    if (act) out.push(act)
  }
  if (tail) out.push(tail)
  return out
}

// «  +5개 (100% 소진 2 · 꺼짐 1) ▸» — the accounts a shut Claude section does not draw, folded ones included.
// 10-19 ④ 부모 답: `cur` = «· >>#2» on that line too (the untitled shut form), given up first.
function restLine(rest, cols, cur) {
  const spent = rest.filter((r) => r.enabled && gone(r)).length
  const offN = rest.filter((r) => !r.enabled).length
  const parts = [...(spent ? ['100% 소진 ' + spent] : []), ...(offN ? ['꺼짐 ' + offN] : [])]
  const more = '  +' + rest.length + '개'
  const full = { text: more + (parts.length ? ' (' + parts.join(' · ') + ')' : ''), color: 'dim' }
  const c = cur && cur.length ? [[full, ...cur, foldMark(false)]] : []
  return richest([...c, [full, foldMark(false)], [{ text: more, color: 'dim' }, foldMark(false)], [{ text: more, color: 'dim' }]], cols)
}

// A time piece of a tail (timeTail) or the API cell: what a shut single provider leaves out.
const timely = (t) => t.some((x) => x === 'api' || (x && typeof x.text === 'string' && /^\d\d:\d\d$/.test(x.text)))

function extSectionIx(d, f, cols, nowMs, open, withRows, g) {
  if (d.missing) return [absent(d.name)]
  const isOpen = open.has(d.key)
  const press = teamPress(d.key)
  // 10-19 ④: shut = its one line, no account rows under it (was: its first TEAM_SHOW accounts)
  const accts = d.rows && isOpen ? d.rows.map((r) => codexRow(r, f, nowMs, g)) : []
  const dd = isOpen || d.rows ? d : { ...d, tails: d.tails.filter((t) => !timely(t)) }
  if (isOpen && f === 'W') return [headRule(d.title, d.rows ? d.rows.length : null, true, press, cols), extLine(dd, 'titled', cols, nowMs, g), ...accts]
  const line = extLine(dd, f === 'W' || f === 'M' ? 'merged' : f, cols - 2, nowMs, g)
  return [pressable([...line, foldMark(isOpen)], press), ...accts]
}

// The forms of one width format with presses, richest first: full → without «Gemini · 자료 없음» → shut providers without
// their account rows → the shut providers in one summary line → disabled / 100%-Wk accounts in one line → without the
// Claude title → 3 lines.
function formsIx(m, f, cols, nowMs, open, x, skin) {
  const exts = [...descriptors(m), geminiDescriptor(m)]
  const g = gridOf(m, f)
  const u = usagePlan(skin, cols, g)
  const sec = (list, withRows) => list.flatMap((d) => extSectionIx(d, f, cols, nowMs, open, withRows, g))
  const opened = exts.filter((d) => open.has(d.key) && !d.missing)
  const shutKeys = exts.filter((d) => !open.has(d.key)).map((d) => d.key)
  const one = (l) => (l ? [l] : [])
  const claude = (grouped, titled) => claudeLinesIx(m, f, cols, nowMs, grouped, titled, open, x, g, u)
  const shut = one(extSummary(m, cols, nowMs, shutKeys, true))
  // r3a: a form whose Claude section is open and titled ends in the tail line, and the same form without it comes next
  // (the tail is the first line a short pane gives up)
  const tl = m.claude && open.has('claude') ? tailLine(cols) : null
  const out = []
  const add = (titled, body) => {
    if (titled && tl) out.push([...body, tl])
    out.push(body)
  }
  add(true, [...claude(false, true), ...sec(exts)])
  const known = exts[exts.length - 1].missing ? exts.slice(0, -1) : exts
  if (known !== exts) add(true, [...claude(false, true), ...sec(known)])
  add(true, [...claude(false, true), ...sec(known, false)])
  const cs = claudeSummary(m, cols, nowMs, skin)
  const csLine = cs ? [m.claude ? pressable(cs, teamPress('claude')) : cs] : []
  add(true, [...claude(false, true), ...sec(opened), ...shut])
  add(true, [...claude(true, true), ...sec(opened), ...shut])
  add(false, [...claude(true, false), ...sec(opened), ...shut])
  // r2b 고침(74·91 글줄 칸 실측 10-18: 다 펼치면 높이 4~10 어디서든 3줄 요약으로 무너지고 칸 아래가 비었다): the open
  // sections that fit come first — in press order, the providers left out fold into one summary line — then the shut
  // layout, and only then the 3-line summary.
  const order = [...open].filter((k) => (k === 'claude' ? m.claude : opened.some((d) => d.key === k)))
  for (let j = order.length; j >= 1; j--) {
    const kept = order.slice(0, j)
    const rest = one(extSummary(m, cols, nowMs, exts.filter((d) => !kept.includes(d.key)).map((d) => d.key), true))
    const exp = opened.filter((d) => kept.includes(d.key))
    if (kept.includes('claude')) {
      add(true, [...claude(true, true), ...sec(exp), ...rest])
      add(false, [...claude(true, false), ...sec(exp), ...rest])
    } else add(false, [...csLine, ...sec(exp), ...rest])
  }
  // the shut layout gets the selection too (r3a: its action line must not vanish exactly where a short pane falls back)
  if (open.size) out.push(...formsIx(m, f, cols, nowMs, new Set(), x, skin).slice(0, -1))
  out.push([...csLine, ...one(extSummary(m, cols, nowMs, null, true))])
  return out
}

// The TeamClaude block: Array<line>, line = Array<{ text, color?, bold?, bar? }> (color = a PANE_INK key, bar = a BAR key).
// opts = { urls, fetchedAt, cols, rows, nowMs, open?, sel?, confirm?, control?, note?, usage? } — every line ≤ cols cells, at
// most `rows` lines (rows = Infinity: every line, unfolded). With `open` (press mode, a Set): sel = the selected account's id · confirm = the id whose delete
// waits for its confirm · control = ui.team_claude_control · note = the last press's short result (r3a).
// headless (T5): no head line — the pane's boundary line is the head (teamHead) — so the body alone, at most `rows`
// lines, and nothing at all for «주소 설정 없음» / «읽는 중» (teamHead says those).
export function teamBlock(m, opts) {
  const o = opts || {}
  const cols = Math.floor(num(o.cols) ?? 0)
  // rows = Infinity: the whole block (T4 — the pane scrolls it; 봇 r1: no 40-line cap) · any other non-number = nothing
  const rows = o.rows === Infinity ? Infinity : Math.floor(num(o.rows) ?? 0)
  if (cols <= 0 || rows <= 0) return []
  const one = (line) => (line ? [line] : [])
  const headless = o.headless === true
  if (!o.urls) return headless ? [] : one(noteLine('주소 설정 없음 (ui.team_claude_urls)', cols))
  if (!m) return headless ? [] : one(noteLine('읽는 중', cols))
  const nowMs = num(o.nowMs) ?? num(o.fetchedAt)
  const ix = o.open instanceof Set ? o.open : null
  // /mh 모양 (r3b): the usage skin of the Claude account rows — anything but a USAGE_SKINS name = classic, as before
  const skin = USAGE_SKINS.includes(o.usage) ? o.usage : 'classic'
  const head = headless ? null : headLine(m, cols)
  if (!headless && !head) return []
  const lead = head ? [head] : []
  const str = (v) => (typeof v === 'string' && v ? v : null)
  const x = { sel: str(o.sel), confirm: str(o.confirm), control: o.control === true, note: str(o.note), can: null }
  // 정정 F-2: whether ▲ ▼ 자동 would change anything comes from the model rows (claudeOf: priority, then list place), once,
  // before any form is built — so no drawn subset or drawing order (봇 Q5 next) can reach the order
  const picked = ix && x.sel && Array.isArray(m.claude) ? m.claude.find((r) => pickable(r) && r.id === x.sel) : null
  if (picked) x.can = Object.fromEntries(['up', 'down', 'auto'].map((dir) => [dir, orderPlan(m.claude, picked.id, dir) !== null]))
  for (const f of FORMATS) {
    const all = ix ? formsIx(m, f, cols, nowMs, ix, x, skin) : forms(m, f, cols, nowMs, skin)
    // the format is the richest whose full form fits the width; within it, the first form that fits the rows
    if (!all[0].every((l) => fits(l, cols))) continue
    for (const body of all) {
      if (lead.length + body.length <= rows && body.every((l) => fits(l, cols))) return [...lead, ...body]
    }
    break
  }
  return lead
}
