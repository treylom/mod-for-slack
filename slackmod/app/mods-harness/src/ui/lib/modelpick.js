// lane: ui · owner: 봇 — 10-20 모델 칸 (설계 메모 11줄 «띠 모델 이름 누르기 → 모델·추론 고르기 → 다음 요청부터» · 설계 메모 72줄
//둘째 갈래 · 봇): the pure part of the ▣ line's model press (no `$`).
// A pick = { model?, effort? } of this session only, in this process's memory; index.js applies it to the main loop's
// model requests through turn.step — a subagent's step (agentId) is never touched.
// Measured first (봇 하위 D4′ 10-20 · engine 2.1.296 · hidden copy · the request bodies a 127.0.0.1 capture server took ·
// agent-bot/out/mods-model-press-d4-1019/REPORT-D4p-D3.md): a rewritten model goes out as given — a full id as it is, an
// alias («haiku») NOT resolved, a made-up id not refused → the picker offers only the ids the engine itself resolved its
// aliases to (opus · sonnet · haiku · fable, A8b–e) and the 1M form (the engine strips «[1m]» and adds the 1M context beta,
// A6); an effort left out comes back as the session's (A5) → a pick changes the effort, never removes it; every step comes
// in with the session's own values (A7) → the pick goes down on every main step, not once.
import { strWidth, segWidth, modelShown, modelColor } from './text.js'

export const MODEL_PRESS = 'mh-mdl'
export const MODEL_CHOICES = Object.freeze(['claude-opus-5-5[1m]', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
  'claude-fable-5-1'].map((id) => Object.freeze({ id })))
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
// the 추론 inks of the tree (text.js PANE_INK effLow … effMax — 주인 16:44)
const EFFORT_INK = { low: 'effLow', medium: 'effMed', high: 'effHigh', xhigh: 'effXhigh', max: 'effMax' }

export const pickPress = { model: (i) => MODEL_PRESS + '-m' + i, effort: (e) => MODEL_PRESS + '-e' + e, reset: MODEL_PRESS + '-reset', close: MODEL_PRESS + '-close' }

// The step as it goes down: the main loop's with the pick, anything else (a subagent's · no pick) the very input.
export function withPick(e, pick) {
  if (!e || e.agentId || !pick) return e
  const out = { ...e }
  if (typeof pick.model === 'string' && pick.model) out.model = pick.model
  if (EFFORTS.includes(pick.effort)) out.effort = pick.effort
  return out
}

// A pick less what the engine sends anyway (base = the main loop's last step as it came in) · nothing left = null.
export function tidyPick(pick, base) {
  if (!pick) return null
  const b = base || {}
  const out = {}
  if (typeof pick.model === 'string' && pick.model && pick.model !== b.model) out.model = pick.model
  if (EFFORTS.includes(pick.effort) && pick.effort !== b.effort) out.effort = pick.effort
  return out.model || out.effort ? out : null
}

// What the next main-loop request goes with: the pick, over what the engine last gave, over what was last drawn.
export function nextOf(pick, base, act) {
  const p = pick || {}
  const b = base || {}
  const a = act || {}
  return { model: p.model || b.model || a.model || null, effort: p.effort || b.effort || a.effort || null }
}

// 10-20 ① (봇 1번): the name typed after /model names the model the session is on after the run — «opus» or
// «claude-opus-5-5» on claude-opus-5-5, «opus[1m]» on claude-opus-5-5[1m] (text.js modelShown: the family and 1M, the
// version left out) — so a /model that left the session's model where it was is still the person's word. Nothing typed
// (the engine's picker) = no name.
export function namesModel(args, model) {
  const a = typeof args === 'string' ? args.trim() : ''
  return Boolean(a) && typeof model === 'string' && modelShown(a) === modelShown(model)
}

// «haiku:high» — the ▣ line's model shape (text.js modelShown) with its effort when known.
export function cellOf(v) {
  const m = v ? modelShown(v.model) : null
  return m ? (v.effort ? m + ':' + v.effort : m) : null
}

// The picker under ▣: a 모델 row and a 추론 row, each choice its own press (one Button each), the values the next request
// goes with bracketed and bold; «원래대로(<the engine's own>)» and «닫기» after the 추론 row when they fit, else on a row of
// their own. A row that does not fit goes on under its label's indent — every choice stays (a band line is never wrapped
// by the band itself, it folds whole items away: text.js foldSegments). st = { pick, base, act }.
export function pickerRows(st, cols) {
  const s = st || {}
  const width = Math.max(1, Math.floor(cols))
  const next = nextOf(s.pick, s.base, s.act)
  const item = (text, press, on, ink) => (on ? { text: '[' + text + ']', press, color: ink, bold: true } : { text: ' ' + text + ' ', press, color: 'sub' })
  const models = MODEL_CHOICES.map((c, i) => item(modelShown(c.id), pickPress.model(i), c.id === next.model, modelColor(c.id)))
  const efforts = EFFORTS.map((e) => item(e, pickPress.effort(e), e === next.effort, EFFORT_INK[e]))
  const own = cellOf(s.base)
  const resetText = own && strWidth(' 원래대로(' + own + ') ') + 2 <= width ? '원래대로(' + own + ')' : '원래대로'
  const acts = [{ text: ' ' + resetText + ' ', press: pickPress.reset, color: 'text' }, { text: ' 닫기 ', press: pickPress.close, color: 'text' }]
  const rows = []
  const pack = (label, items, ink) => {
    let row = [{ text: label, color: ink }]
    for (const it of items) {
      if (row.length > 1 && segWidth(row) + strWidth(it.text) > width) {
        rows.push(row)
        row = [{ text: ' '.repeat(strWidth(label)) }]
      }
      row.push(it)
    }
    rows.push(row)
  }
  pack('  모델 ', models, 'cyan')
  pack('  추론 ', efforts, 'cyan')
  const last = rows[rows.length - 1]
  if (segWidth(last) + 2 + segWidth(acts) <= width) last.push({ text: '  ' }, ...acts)
  else pack('  ', acts, 'text')
  return rows
}
