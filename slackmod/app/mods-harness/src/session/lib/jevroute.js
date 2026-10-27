// lane: session · 10-26 Jev child router (주인 10-25 00:33 — a message may go to a child by the bot's child list ·
// 내부 작업 기록 · 설계 = run/bot-NNNNNN/result.md 설계 메모 · 부모 가름 Q1 (a) · Q3 예 · Q4 사람 채점 없음).
// PURE: no `$`, no I/O — index.js does the reading, the judge process, the sends and the record line.
//
// An owner message that reached the parent session (no child of mine on its thread) while children of mine live in OTHER
// threads → the judge (Jev, through the vault wrapper jev_route.py) picks «부모» or one child. Only a clear pick routes:
// the child gets the message too (the parent still gets it — Q1 a), the thread gets one line «→ ‘<project>’ 하위가 받음» (Q3).
// Accuracy = automatic signals only (Q4): S1 the child says not_mine · S2 the parent moves it with send_to_child route=<id>.
// mode off (default) · shadow (judge + record, nothing sent) · on (route) — and on falls back to shadow by itself while the
// last 20 routes of 7 days hold 3+ wrong ones (bounced or moved).

export const JEV_MODES = Object.freeze(['off', 'shadow', 'on'])
export const JEV_RECORD = 'jev-route.jsonl'
export const JEV_BOUNDARY = 'route1'
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
export const JEV_DEFAULTS = Object.freeze({ mode: 'off', argv: null, timeout_ms: 1500, min_chars: 6, max_candidates: 8 })
// fixed before any record (설계 설계 메모 «숫자는 그림자 결과 보고 바꾸지 않는다»). hint_min reuses the 0.10 already in the rule:
// a «low» verdict whose best child is under it gives no hint (Jev says it is the parent's — no noise on every message).
export const JEV_RULE = Object.freeze({ route_best: 0.85, route_second: 0.10, route_parent: 0.10, split_each: 0.30, hint_min: 0.10 })
export const JEV_AUTO_DOWN = Object.freeze({ window_ms: 7 * DAY, last_n: 20, max_bad: 3 })
export const PARENT_LABEL = '부모'
export const CHILD_LABELS = Object.freeze(['하위 A', '하위 B', '하위 C', '하위 D', '하위 E', '하위 F', '하위 G', '하위 H'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const expand = (p, home) => (typeof p === 'string' ? p.replace(/^\$HOME(?=\/|$)/, home || '').replace(/^~(?=\/|$)/, home || '') : p)

// session.jev_route → { mode, argv, timeout_ms, min_chars, max_candidates }. A bad mode = off · no usable argv = off (an install
// with no judge: the wizard hides the choice and this stays off).
export function jevRouteConfig(raw, home) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const argv = Array.isArray(s.argv) && s.argv.length && s.argv.every((x) => typeof x === 'string' && x) ? s.argv.map((x) => expand(x, home)) : null
  const int = (v, d, lo, hi) => (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : d)
  const mode = JEV_MODES.includes(s.mode) && argv ? s.mode : 'off'
  return {
    mode,
    argv,
    timeout_ms: int(s.timeout_ms, JEV_DEFAULTS.timeout_ms, 300, 5000),
    min_chars: int(s.min_chars, JEV_DEFAULTS.min_chars, 1, 200),
    max_candidates: int(s.max_candidates, JEV_DEFAULTS.max_candidates, 1, CHILD_LABELS.length),
  }
}

const msOf = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null }
const clip = (s, n) => { const a = Array.from(String(s || '').replace(/\s+/g, ' ').trim()); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join('') }

// the words the length rule reads: mentions and spaces as in triggerWords (core.js) — kept here so this file stays pure
export function bodyChars(body) {
  const s = String(body || '').normalize('NFKC').replace(/<@[A-Za-z0-9]+(?:\|[^>]*)?>/g, ' ').replace(/[\s　]+/g, ' ').trim()
  return Array.from(s).length
}

// ready children of mine on OTHER threads: running + a session id (a starting row cannot take a message yet), newest first
export function routeCandidates(rows, meId, head) {
  const out = (rows || []).filter((r) => r && r.role === 'child' && r.parent_id === meId && r.status === 'running' &&
    typeof r.session_uuid === 'string' && UUID.test(r.session_uuid) && r.thread && r.thread.channel && r.thread.ts &&
    !(head && r.thread.channel === head.chatId && r.thread.ts === head.threadTs))
  return out.sort((a, b) => (msOf(b.updated_at) || 0) - (msOf(a.updated_at) || 0) || String(a.id).localeCompare(String(b.id)))
}

// 설계 설계 메모 — the seven conditions, in order; the first false one is named and nothing is called (cost 0).
//   1 off · 2 not the owner in the bot's own session · 3 a trigger («하위로» …) · 4 a child of mine owns this thread (or the
//   dispatch fell — ambiguous / not ready) · 5 no ready child elsewhere · 6 a short body · 7 more than max_candidates (not a
//   refusal: the newest max go to the judge, the rest are counted for the hint)
export function routeCheck({ jr, owner, me, trig, plan, rows, head, body }) {
  if (!jr || jr.mode === 'off' || !jr.argv) return { why: 'off' }
  if (!me || !me.id || me.role === 'child' || me.depth !== 0) return { why: 'not-parent' }
  if (!owner) return { why: 'not-owner' }
  if (trig) return { why: 'trigger' }
  if (plan) return { why: 'thread-owned' }
  const all = routeCandidates(rows, me.id, head)
  if (!all.length) return { why: 'no-ready-child' }
  if (bodyChars(body) < jr.min_chars) return { why: 'short' }
  return { cands: all.slice(0, jr.max_candidates), more: Math.max(0, all.length - jr.max_candidates) }
}

const projectOf = (projects, r) => {
  const p = r && typeof r.project === 'string' ? r.project : ''
  if (!p) return ''
  const t = projects && typeof projects === 'object' ? projects : {}
  if (t[p]) return p
  for (const [name, aliases] of Object.entries(t)) if (Array.isArray(aliases) && aliases.includes(p)) return name
  return p
}

// the judge's options: «부모» + «하위 A…» (letters, never ids — no id-letter bias · the id table stays in the record)
export function routeOptions(cands, head, nowMs, projects) {
  const criteria = { [PARENT_LABEL]: '부모 봇(본 세션)이 받을 글 — 이 스레드에서 부모와 하던 이야기 · 새 일 · 짧은 답이나 확인 · 여러 일 조율 · 글만으로는 어느 하위의 일인지 알 수 없음' }
  const labels = {}
  ;(cands || []).slice(0, CHILD_LABELS.length).forEach((r, i) => {
    const label = CHILD_LABELS[i]
    labels[label] = r.id
    const started = msOf(r.started_at)
    const age = started == null ? '시작 시각 모름' : `${Math.max(0, Math.round((nowMs - started) / HOUR))}시간 전 시작`
    const where = head && r.thread.channel === head.chatId ? '같은 채널의 다른 스레드' : '다른 채널'
    const proj = projectOf(projects, r)
    criteria[label] = `이 하위 세션이 맡은 일에 대한 글 — 프로젝트: ${proj || '없음'} · 일: ${clip(r.task, 160) || '(없음)'} · 마지막 보고: ${clip(r.last_report, 100) || '아직 없음'} · 자리: ${where} · ${age}`
  })
  return { criteria, labels }
}

const isP = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

// 설계 설계 메모 (inclusive bounds: ≥ 0.85 · ≤ 0.10 · ≥ 0.30). → { verdict, … }
//   route  = best is a child · p(best) ≥ .85 · p(second) ≤ .10 · p(부모) ≤ .10 → that child
//   split  = two or more children each ≥ .30 → no send · hint names the two best
//   low    = the rest, when the best child is ≥ .10 → no send · hint names up to two (each ≥ .10)
//   parent = the rest, no child at .10 → no send, no hint
//   fail   = no answer · not ok · a label missing from the probabilities · a value outside [0, 1] → as if never asked
export function decideRoute(resp, labels) {
  if (!resp || typeof resp !== 'object') return { verdict: 'fail', why: 'no-answer' }
  if (resp.ok !== true) return { verdict: 'fail', why: String(resp.reason || 'not-ok').slice(0, 120) }
  const probs = resp.probs && typeof resp.probs === 'object' ? resp.probs : null
  const childLabels = Object.keys(labels || {})
  const all = [PARENT_LABEL, ...childLabels]
  if (!probs || !childLabels.length) return { verdict: 'fail', why: 'no-probabilities' }
  for (const l of all) if (!isP(probs[l])) return { verdict: 'fail', why: `bad-probability ${l}` }
  const ranked = all.map((label) => ({ label, p: probs[label], id: labels[label] || null })).sort((a, b) => b.p - a.p || all.indexOf(a.label) - all.indexOf(b.label))
  const kids = ranked.filter((x) => x.label !== PARENT_LABEL)
  const best = ranked[0]
  const second = ranked[1] ? ranked[1].p : 0
  if (best.label !== PARENT_LABEL && best.p >= JEV_RULE.route_best && second <= JEV_RULE.route_second && probs[PARENT_LABEL] <= JEV_RULE.route_parent) {
    return { verdict: 'route', label: best.label, id: best.id, p: best.p, top: kids.slice(0, 2) }
  }
  const wide = kids.filter((x) => x.p >= JEV_RULE.split_each)
  if (wide.length >= 2) return { verdict: 'split', top: wide.slice(0, 2) }
  const near = kids.filter((x) => x.p >= JEV_RULE.hint_min).slice(0, 2)
  if (near.length) return { verdict: 'low', top: near }
  return { verdict: 'parent', top: kids.slice(0, 2) }
}

// ── records (<state_dir>/jev-route.jsonl · one line per event · never the message text) ──
// kind judge: at · bot · parent · chat_id · thread_ts · ts · text_h · chars · n_cand · more · labels · probs · verdict · why ·
//   mode · mode_eff · acted (routed · shadow · none · send-failed) · route · child · latency_ms · http
// kind bounce: at · route · child · reason (≤ 200) · delivered       kind moved: at · route · from · to
export function textHash(s) {
  let h = 0x811c9dc5
  const t = String(s || '')
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + ':' + t.length
}
export const routeIdOf = (head) => (head && head.ts ? 'r' + String(head.ts) : null)
export function parseRecords(text) {
  const out = []
  for (const l of String(text || '').split('\n')) {
    if (!l.trim()) continue
    try { const o = JSON.parse(l); if (o && typeof o === 'object') out.push(o) } catch (err) { /* a torn line is skipped */ }
  }
  return out
}
export const recordLine = (o) => JSON.stringify(o) + '\n'

// 설계 설계 메모 «2단계 상시» → 부모 가름: on falls to shadow while the last 20 routes within 7 days hold 3+ wrong ones (a route
// bounced by its child or moved by the parent counts once). Computed from the record each time — no sticky state: in shadow
// nothing is routed, so the wrong ones age out of the 7 days and on comes back by itself.
export function effectiveMode(records, mode, nowMs) {
  if (mode !== 'on') return { mode, n: 0, bad: 0 }
  const recs = records || []
  const routes = recs.filter((r) => r.kind === 'judge' && r.acted === 'routed' && r.route && msOf(r.at) != null && nowMs - msOf(r.at) <= JEV_AUTO_DOWN.window_ms && nowMs - msOf(r.at) >= 0)
    .slice(-JEV_AUTO_DOWN.last_n)
  const ids = new Set(routes.map((r) => r.route))
  const bad = new Set(recs.filter((r) => (r.kind === 'bounce' || r.kind === 'moved') && ids.has(r.route)).map((r) => r.route)).size
  return { mode: bad >= JEV_AUTO_DOWN.max_bad ? 'shadow' : 'on', n: routes.length, bad }
}
// the effective mode of the last judge made while the configured mode was on (a configured shadow or off is not an auto change)
export function lastEffective(records) {
  const recs = records || []
  for (let i = recs.length - 1; i >= 0; i--) if (recs[i].kind === 'judge' && recs[i].mode === 'on' && recs[i].mode_eff) return recs[i].mode_eff
  return null
}
// the routed judge record a route id names (null = none)
export function routedRecord(records, route) {
  for (const r of records || []) if (r.kind === 'judge' && r.acted === 'routed' && r.route === route) return r
  return null
}
export function lastRoutedTo(records, childId) {
  const recs = records || []
  for (let i = recs.length - 1; i >= 0; i--) if (recs[i].kind === 'judge' && recs[i].acted === 'routed' && recs[i].child === childId) return recs[i]
  return null
}
export const bounced = (records, route) => (records || []).some((r) => r.kind === 'bounce' && r.route === route)

// ── the lines (one line each · Korean · no newline inside) ──
const pf = (p) => (isP(p) ? p.toFixed(2) : '?')
const one = (s) => String(s).replace(/[\r\n]+/g, ' ')
const nameOf = (x) => (x && (x.name || x.id)) || '?'
export function routedChildText(text, routeId, head, p, parentId) {
  return `[routed message · Jev ${routeId}]\n` + one(`이 글은 네 스레드 밖(${head.chatId}/${head.threadTs})에서 왔다 · Jev 가 네 일로 골랐다(확신 ${pf(p)}) · ` +
    `부모(${parentId})도 같은 글을 받았다 · 네 일이 아니면 not_mine 도구를 route="${routeId}", reason=<까닭 한 줄> 로 한 번 불러라(부모에게 돌아감) · ` +
    '네 일이면 네 일에 반영하고 평소처럼 이어 가라(답은 보고·부모를 거친다)') + `\n${String(text || '')}`
}
export function routedParentLine(child, project, p, routeId, posted) {
  return one(`[mods Jev 넘김 ${routeId}] 이 글을 하위 ${nameOf(child)}${project ? `(${project})` : ''}에게도 넘김(Jev 확신 ${pf(p)}) — 네 몫이 없으면 그 하위 보고를 기다려. ` +
    `틀린 넘김이면 맞는 하위에 send_to_child 로 옮기며 route="${routeId}" 를 넣어(정확도 기록) · 어느 하위 일도 아니면 네가 답해.` +
    (posted && posted.ok ? '' : posted ? ` 스레드 줄을 못 올림(${posted.why}) — 답할 때 첫 줄에 «${posted.line}» 를 붙여.` : ''))
}
export function hintLine(dec, names, more) {
  const tops = (dec.top || []).map((x) => `${names[x.id] || x.id}(${pf(x.p)})`)
  const tail = more > 0 ? ` (후보에 못 넣은 하위 ${more}개 더 — list_children)` : ''
  if (dec.verdict === 'split') return one(`[mods Jev 힌트] 이 스레드엔 하위가 없음 · 이 글은 다른 스레드의 하위 ${tops.join(' · ')} 둘 다에 걸쳐 보여 넘기지 않았음 — 하위 일이면 send_to_child 로 넘겨.${tail}`)
  if (dec.verdict === 'low') return one(`[mods Jev 힌트] 이 스레드엔 하위가 없음 · 다른 스레드의 하위 중 가까운 후보: ${tops.join(' · ')} — 확신이 낮아 넘기지 않았음 · 하위 일이면 send_to_child 로 넘겨.${tail}`)
  return null
}
export function sendFailedLine(child, why) {
  return one(`[mods Jev 넘김 실패] Jev 가 이 글을 하위 ${nameOf(child)} 일로 골랐지만 전달 실패: ${String(why || 'unknown').slice(0, 160)} — 하위 일이면 send_to_child 로 넘겨.`)
}
export function threadLineText(lang, project) {
  return lang === 'en' ? `→ the ‘${project}’ sub-session got this` : `→ ‘${project}’ 하위가 받음`
}
export function autoModeLine(prev, eff) {
  if (!prev || prev === eff.mode) return null
  if (eff.mode === 'shadow' && prev === 'on') return one(`[mods Jev 넘김 자동 내림] 지난 7일 넘김 ${eff.n}건 중 되돌림·옮김 ${eff.bad}건(${JEV_AUTO_DOWN.max_bad}건 이상) → 이제 기록만(넘김 0) · 틀린 넘김이 7일 창에서 ${JEV_AUTO_DOWN.max_bad}건 아래로 빠지면 다시 켜짐 · 아주 끄기 = 설정 session.jev_route.mode "off".`)
  if (eff.mode === 'on' && prev === 'shadow') return one(`[mods Jev 넘김 다시 켜짐] 지난 7일 틀린 넘김 ${eff.bad}건(${JEV_AUTO_DOWN.max_bad}건 아래) → 넘김 다시 켬.`)
  return null
}
export function bounceNotice(child, routeId, rec, reason) {
  return one(`[mods Jev 되돌림 ${routeId}] 하위 ${nameOf(child)} 가 Jev 가 넘긴 글(스레드 ${rec.chat_id}/${rec.thread_ts})을 자기 일이 아니라고 돌려보냄: ${reason}. ` +
    `원문은 그때 너도 받았다 — 네가 답하거나 맞는 하위에 send_to_child(route="${routeId}").`)
}
