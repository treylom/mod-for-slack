// lane: ui · owner: 봇 — terminal cell width (no `$`, no imports).
// East Asian Wide/Fullwidth (한글·한자·전각) = 2 cells · combining marks = 0 · everything else = 1.
// East Asian Ambiguous (○ ● ◎ × ▶ ▼ ▣) = 1, the width tmux and most terminals use by default.

export function charWidth(cp) {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1160 && cp <= 0x11ff) || (cp >= 0x200b && cp <= 0x200f) ||
      (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xfe20 && cp <= 0xfe2f)) return 0
  if ((cp >= 0x1100 && cp <= 0x115f) || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf) || (cp >= 0xa960 && cp <= 0xa97f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2
  return 1
}

export function strWidth(s) {
  let w = 0
  for (const ch of String(s)) w += charWidth(ch.codePointAt(0))
  return w
}

// A line = segments [{ text, color?, dim?, bold? }] (v2: no cutting helper here any more — a line that does not fit
// wraps or folds, below).
export function segWidth(segs) {
  return segs.reduce((n, s) => n + strWidth(s.text), 0)
}

// ── no end cut (봇 v2 5번 «크기 상관없이 잘리지 않게») ──
// A line's items: a new item starts at each « · » (the separator kept at the item's head, dropped when the item opens
// a line). Pieces keep their segment's style. A segment marked `atom` is never split at a « · » inside it (예약 머리
// «예약(bot · 1개)»: cut there, a narrow band showed «예약(bot +3» with its bracket left open).
const SEP = ' · '
function itemsOf(segs) {
  const items = [[]]
  for (const s of segs || []) {
    const parts = s.atom ? [String(s.text)] : String(s.text).split(SEP)
    parts.forEach((t, k) => {
      if (k > 0) items.push([{ ...s, text: SEP, sep: true }])
      if (t) items[items.length - 1].push({ ...s, text: t })
    })
  }
  return items.filter((it) => it.length)
}

function withoutSep(item) {
  return item[0] && item[0].sep ? item.slice(1) : item
}

function clean(pieces) {
  return pieces.filter((p) => p.text).map((p) => { const { sep, ...rest } = p; return rest })
}

// `s` split into chunks of at most `cols` cells (a word longer than a line; never a «…»). The one chunk past `cols`:
// a 2-cell character (한글) on a 1-cell line — it cannot be split, and dropping it would lose it (no pane or band here
// is under 20 cells: index.js floors both).
function hardSplit(text, cols) {
  const out = []
  let cur = ''
  let w = 0
  for (const ch of String(text)) {
    const cw = charWidth(ch.codePointAt(0))
    if (w + cw > cols && cur) { out.push(cur); cur = ''; w = 0 }
    cur += ch
    w += cw
  }
  if (cur) out.push(cur)
  return out
}

// Wrap a line into lines of at most `cols` cells instead of cutting it: break between items first, else between words,
// else inside a word. Lines after the first start with `indent` spaces. Nothing is dropped and no «…» is added.
export function wrapSegments(segs, cols, indent) {
  const width = Math.max(1, Math.floor(cols))
  // the indent leaves room for at least half the line and for one 2-cell character
  const ind = Math.max(0, Math.min(Math.floor(indent || 0), Math.floor(width / 2), width - 2))
  const lines = []
  let cur = []
  let w = 0
  const fresh = () => cur.length === 0 || (lines.length > 0 && cur.length === 1 && cur[0].indent)
  // a finished row: the indent marker off, empty pieces out, spaces at its end trimmed (the pane pads the row anyway) —
  // except a painted piece (`bar`, a usage cell): its spaces are part of its paint, trimmed they shortened the gauge
  const done = (pieces) => {
    const out = clean(pieces.map((p) => (p.indent ? { text: p.text } : p)))
    while (out.length) {
      const last = out[out.length - 1]
      if (last.bar !== undefined) break
      const t = last.text.replace(/ +$/, '')
      if (t) { out[out.length - 1] = t === last.text ? last : { ...last, text: t }; break }
      out.pop()
    }
    return out
  }
  const flush = () => {
    lines.push(done(cur))
    cur = ind ? [{ text: ' '.repeat(ind), indent: true }] : []
    w = ind
  }
  const add = (p) => { cur.push(p); w += strWidth(p.text) }
  for (const item of itemsOf(segs)) {
    const whole = segWidth(item)
    if (w + whole <= width) { item.forEach(add); continue }
    const bare = withoutSep(item)
    if (!fresh() && ind + segWidth(bare) <= width) { flush(); bare.forEach(add); continue }
    // too long for a line: word by word, from where the line is
    for (const piece of fresh() ? bare : item) {
      for (const word of String(piece.text).split(/(?<= )/)) {
        if (!word) continue
        let t = fresh() ? word.replace(/^ +/, '') : word
        if (!t) continue
        if (w + strWidth(t.replace(/ +$/, '')) > width && !fresh()) { flush(); t = t.replace(/^ +/, '') }
        for (const chunk of hardSplit(t, Math.max(1, width - w))) {
          if (w + strWidth(chunk.replace(/ +$/, '')) > width && !fresh()) flush()
          add({ ...piece, text: w + strWidth(chunk) > width ? chunk.replace(/ +$/, '') : chunk })
        }
      }
    }
  }
  if (cur.length && !(lines.length > 0 && fresh())) lines.push(done(cur))
  return lines.length ? lines : [[]]
}

// Fold a line into `cols` cells for a place with no room to wrap (the band): whole items from the end are left out and
// counted as « +N»; never a «…». A first item longer than the line is split at a word, then inside a word.
export function foldSegments(segs, cols) {
  const width = Math.max(1, Math.floor(cols))
  const items = itemsOf(segs)
  if (!items.length || segWidth(segs) <= width) return segs || []
  for (let keep = items.length - 1; keep >= 1; keep--) {
    const tail = ' +' + (items.length - keep)
    const head = items.slice(0, keep).flat()
    if (segWidth(head) + strWidth(tail) <= width) return [...clean(head), { text: tail, dim: true }]
  }
  return wrapSegments(items[0], width, 0)[0]
}

export function segText(segs) {
  return segs.map((s) => s.text).join('')
}

// Every theme key of 2.1.296 (types `ThemeKey`): a color that follows the person's theme.
export const THEME_KEYS = ['text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning',
  'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide', 'diffAdded', 'diffRemoved',
  'diffAddedDimmed', 'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord']

// Text color follows whoever paints the background (봇 10-17 19:02 · 시연 화면 캡처):
// · 칸(Pane): the host paints it in the theme (light = 48;5;255), so every segment takes a theme key — a segment with
//   no color came out in the terminal's own white on that light gray and nothing could be read.
// · 띠(AbovePrompt): nothing paints it, it sits on the terminal's (dark) background, so it keeps the terminal's color
//   and the named colors; the theme's `text` there would be black on dark in a light theme.
// v2 (봇 v2 2번 «전부 검은 화면»): the pane no longer takes the theme's background — every row is
// painted PANE_BG, empty rows too, so it is black whatever theme the person runs (v1.1 measured why: on light the theme
// paints #eeeeee and only 3 of the 23 keys read 4.5:1 there). Letters take PANE_INK, chosen for that black. Written as
// «ansi256(n)»: measured 10-17, a hex is rounded one step brighter on a 256-color terminal (#5fd75f drawn #87d787) while
// ansi256(n) is drawn as that very color (254 → e4e4e4 · 77 → 5fd75f · 245 → 8a8a8a). Values = 설계 메모
// (every ink ≥ 6.08:1 on the black, ≥ 4.83:1 on a #1e1e1e terminal). Usage cells of team claude are painted like the
// teamclaude screen (BAR, 설계 메모 4번). A segment's `color` must be one of these keys — paneLook falls back to `text` for
// any other word, so a misspelt key would pass unseen (tests sweep every module's output against this list).
const c256 = (n) => 'ansi256(' + n + ')'
export const PANE_BG = c256(16)
export const SEL_BG = c256(235)
// v3 D (봇): a pressable's letters while the pointer is on it (the focus ring = the engine's inverse)
export const HOVER_BG = c256(236)
export const PANE_INK = {
  bright: c256(231), // 구역 대제목 · 부모 세션명 · 0 아닌 수
  text: c256(254), // 본문 · 자식 세션명
  sub: c256(250), // 표 머리글 · 시각
  dim: c256(245), // 구분 점선 · 0회 · 끝난 것 · #ts6
  divider: c256(209), // 가운데 ║ · ▣
  dividerSoft: c256(173),
  cursor: c256(81), // 나무 ▷
  green: c256(77), // ○ 쉼 · ✓ · ▲ · ► · active
  blue: c256(75), // ● 작업 중
  yellow: c256(221), // ◎ 대기 · 안 실림 · 예비 0
  red: c256(203), // × 응답 없음 · ✕ · 막힘
  cyan: c256(80), // ❖ 나무 · ◆ TeamClaude · 소제목 · 공유 기억 · 결정
  lavender: c256(183), // Project 열 · ◈ · plugin
  sky: c256(117), // Type 열 · MCP
  mint: c256(114), // skill · haiku
  gold: c256(222), // sonnet · 개별 기억
  magenta: c256(177), // opus
  amber: c256(215), // ◷ 예약 · 그 밖의 모델 · ▶▼
  // r2 (주인 16:44 · 봇): the 추론 cell, five steps
  // a glance tells apart — grey → light grey → yellow → orange (bold) → hot pink (bold); each ≥ 6.08:1 on the black
  effLow: c256(245),
  effMed: c256(252),
  effHigh: c256(228),
  effXhigh: c256(214),
  effMax: c256(204),
}

// P3 (주인 10-19): ✓ ✕ as 예약 (jobs.js) · 기억 (memory.js) · a TeamClaude press result (team.js)
// draw them — one place, so the legend (legend.js) reads the very ink the parts draw. Glyph literals stay where drawn.
export const RESULT_LOOK = { ok: { glyph: '✓', color: 'green' }, fail: { glyph: '✕', color: 'red' } }

// The 추론 cell's ink by the engine's effort word: low faint … max strongest (xhigh · max also bold) · anything else dim.
const EFFORT_INK = { low: ['effLow', false], medium: ['effMed', false], high: ['effHigh', false], xhigh: ['effXhigh', true], max: ['effMax', true] }
export function effortInk(effort) {
  const e = EFFORT_INK[typeof effort === 'string' ? effort : '']
  return e ? { color: e[0], bold: e[1] } : { color: 'dim', bold: false }
}
// track (주인 10-18 21:03): the unfilled rest of a usage cell — 237 (#3a3a3a), apart from
// SEL_BG 235 and HOVER_BG 236, letters 252 (#d0d0d0) ≈ 7.4:1 on it; the filled part keeps its threshold color.
export const BAR = { green: { bg: c256(35), fg: c256(16) }, yellow: { bg: c256(184), fg: c256(16) }, red: { bg: c256(160), fg: c256(231) },
  track: { bg: c256(237), fg: c256(252) },
  // P1 (주인 10-19 01:47): the pane's title row — a band of deep blue (24 · #005f87) the row's
  // width, white bold letters on it (231 on 24 ≈ 7.6:1); index.js paneRow paints the row's padding with it (line `fill`)
  title: { bg: c256(24), fg: c256(231) } }

// The painted cell for a usage percent (설계 메모 4번): the shown (rounded) value decides, so the number and its paint
// agree — 0% or no value = not painted · 1–59 green · 60–89 yellow · 90 and up red.
export function barOf(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null
  const p = Math.round(pct)
  if (p <= 0) return null
  return p < 60 ? 'green' : p < 90 ? 'yellow' : 'red'
}

// 10-19 J1 (주인 16:08): one shape for a model wherever the
// screen draws it (the tree's 모델 column, the band's ▣ line, a subagent row, a project's open lines) — a Claude model by
// its family alone, «·1M» when it runs with the 1M context: «claude-opus-5-5[1m]» = «opus[1m]» = «opus·1M» ·
// «claude-sonnet-5-5» = «sonnet» = «sonnet». An alias as the registry keeps it («opus» — spawn_child writes what it was
// given) is the family already; the id it stands for is the live file's (`$.session.model()` · read first where both
// are). Any other model (opencodex «gpt-6-luna» · «gpt-6.1-sol») as it is, so they stay apart. none = null (callers
// draw «–»).
const MODEL_FAMILY = /^(opus|sonnet|haiku|fable)$/i
export function modelShown(model) {
  const raw = typeof model === 'string' ? model.trim() : ''
  if (!raw) return null
  const one = /\[1m\]$/i.test(raw)
  const base = one ? raw.slice(0, -4) : raw
  const id = /^claude-([a-z]+)(?:-[0-9][0-9a-z.-]*)?$/i.exec(base)
  const fam = id ? id[1] : MODEL_FAMILY.test(base) ? base : null
  if (!fam) return raw.replace(/^claude-/, '')
  return fam.toLowerCase() + (one ? '·1M' : '')
}

// 모델 color by family (설계 메모): opus magenta · sonnet gold · haiku mint · any other model amber · unknown dim.
export function modelColor(model) {
  const m = typeof model === 'string' ? model : ''
  if (!m || m === '?' || m === '–') return 'dim'
  if (/opus/i.test(m)) return 'magenta'
  if (/sonnet/i.test(m)) return 'gold'
  if (/haiku/i.test(m)) return 'mint'
  return 'amber'
}

// { color, backgroundColor, bold } for one pane segment: dim wins over a color · a segment with `bar` is a painted cell.
export function paneLook(s) {
  const seg = s || {}
  const bar = BAR[seg.bar]
  if (bar) return { color: bar.fg, backgroundColor: bar.bg, bold: Boolean(seg.bold) }
  const color = seg.dim ? PANE_INK.dim : PANE_INK[seg.color] || PANE_INK.text
  return { color, backgroundColor: PANE_BG, bold: Boolean(seg.bold) }
}

// What a render hook draws for one line. Segments with no text are left out — 기둥 ③ 실측 10-17: the depth-0 indent
// ('') was drawn as a 1-cell space, so a parent row sat one column right of its place. A line with nothing left is
// one space, so the row keeps its height.
export function drawable(segs) {
  const out = (segs || []).filter((s) => s && typeof s.text === 'string' && s.text.length > 0)
  return out.length ? out : [{ text: ' ' }]
}

// v3 D (봇 D): a drawn row as runs — plain segments, and runs of one `press` (one Button each in
// index.js). A run's «s: » segment (`hk`, calls.js pressable) is left out and becomes the run's `hotkey`: the engine
// draws «s: » itself in front of a plain Button with a hotkey (d.ts ButtonProps.plain), in the 3 cells it took here.
export function pressRuns(segs) {
  const runs = []
  for (const s of segs || []) {
    const p = s.press || null
    const last = runs[runs.length - 1]
    if (last && last.press === p) last.segs.push(s)
    else runs.push({ press: p, segs: [s] })
  }
  return runs.map((r) => {
    if (!r.press) return r
    const hk = r.segs.find((s) => s.hk)
    const segs = r.segs.filter((s) => !s.hk)
    return { press: r.press, hotkey: hk ? hk.hk : null, segs: segs.length ? segs : [{ text: ' ', press: r.press }] }
  })
}
