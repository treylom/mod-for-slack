// lane: owner · 주인 지시 장치 셋(bot-NNNNNN · 2026-10-26) — 볼트 훅(promise_gate · owner-reply-first-gate ·
// 다리 withOwnerMention diff)을 SlackMOD 기본 구성으로 옮김. 볼트 훅은 클로드 코드판 8봇(--setting-sources '')엔 안 실리고
// 도구마다 파이썬을 띄우지만, mod 는 같은 프로세스 안 tool.call 이라 8봇까지 같은 자리에서 돈다.
//   ① 약속 검사 + 미루는 말: 주인행 Slack/Discord reply · Bash 의 slack-send.py 발신 → lib/promise.js 판정 → deny
//   ② 답 늦음 막기: 모든 도구 tool.call → $.session.messages() 로 주인 DM 미답 스레드 셈 → 넘으면 reply·읽기 밖 deny
//   ③ 스레드 태그: 주인 DM 스레드 답글 맨 앞에 <@주인> (막지 않고 붙임 · memory lane 의 «프로젝트:» 줄 떼기와 같은 고쳐 쓰기 길)
// 설정 = config.owner(lib/settings.js 머리 주석) · 없으면 lane 전체 꺼짐(오늘 동작 그대로) · 하위 세션(MH_SESSION_DEPTH ≥ 1) = 꺼짐.
// 실패 = 통과(fail-open) — 이 lane 의 고장이 발신·도구를 막지 않게. 기록 줄 = logDir 에 건마다 파일 1개(셈 = count.mjs).
// Loader rules: one hook per event per matcher — memory lane holds /^mcp__slack-channel__reply$/ and hooks-port holds /^/,
// so this lane uses /^mcp__(?:slack-channel__reply|plugin_discord_discord__reply)$/ and /[\s\S]/.
import { judge as judgePromise, cleanRegistry } from './lib/promise.js'
import { scan, judge as judgeReply, ownerWroteIn } from './lib/replyfirst.js'
import { withOwnerMention } from './lib/tag.js'
import { ownerSettings, ownerBound, senderScriptArgs, payloadText } from './lib/settings.js'

// Same two lines in the four lane files: the validator follows $ only into same-file functions. The first call pins the verdict for this process (a later /clear changes the session id, the launcher's does not).
let optInAnchor
async function optedIn($) { if (optInAnchor === undefined) { const bot = await $.env.get('MODS_HARNESS_BOT'); const expected = await $.env.get('MODS_HARNESS_SESSION_ID'); optInAnchor = Boolean(bot) && Boolean(expected) && expected === await $.session.id() } return optInAnchor }
let depthAnchor
async function topLevel($) {
  if (depthAnchor === undefined) { const d = Number((await $.env.get('MH_SESSION_DEPTH')) || 0); depthAnchor = !(d >= 1) }
  return depthAnchor
}
async function laneOn($) { return (await optedIn($)) && (await topLevel($)) }

const CACHE_MS = 30000
let cached = null
let cachedAt = -1
const firstSeen = new Map()
let stats = { blocks: 0, passBasis: 0, tags: 0, replyFirst: 0, errors: 0, last: '' }
export function ownerStats() { return { ...stats, pending: firstSeen.size } }

async function nowMs($) { try { return Number(await $.clock.now()) || 0 } catch (err) { return 0 } }

async function load($) {
  const t = await nowMs($)
  if (cached && t && cachedAt >= 0 && t - cachedAt < CACHE_MS) return cached
  const home = (await $.env.get('HOME')) || ''
  const bot = (await $.env.get('MODS_HARNESS_BOT')) || ''
  let path = (await $.env.get('MODS_HARNESS_CONFIG')) || ''
  if (!path) path = $.plugin.root + '/config/local.config.json'
  let raw = null
  try { if (await $.fs.exists(path)) raw = JSON.parse(await $.fs.read(path, 'text')) } catch (err) { raw = null }
  const s = { ...ownerSettings(raw, home, bot), bot, registry: {}, devExists: {} }
  if (s.enabled && s.promise.enabled && s.promise.devicesFile) {
    try {
      const j = JSON.parse(await $.fs.read(s.promise.devicesFile, 'text'))
      s.registry = cleanRegistry(j && j.devices ? j.devices : j)
      const root = s.promise.devicesRoot.replace(/\/+$/, '')
      for (const [name, row] of Object.entries(s.registry)) {
        const f = String(row.file || '')
        const abs = f.startsWith('/') ? f : (root ? root + '/' + f : '')
        try { s.devExists[name] = Boolean(abs) && Boolean(await $.fs.exists(abs)) } catch (err) { s.devExists[name] = false }
      }
    } catch (err) { stats.last = 'devices file unreadable' }
  }
  cached = s; cachedAt = t
  return s
}

async function record($, s, row) {
  if (!s.logDir) return
  const t = await nowMs($)
  const who = String(s.bot || 'x').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)
  const name = `${s.logDir}/${who}-${row.kind}-${t}-${Math.random().toString(36).slice(2, 8)}.json`
  try { await $.fs.write(name, JSON.stringify({ at: t, bot: s.bot, ...row })) } catch (err) { stats.errors++; stats.last = 'log write failed' }
}

async function promiseVerdict($, s, tool, chatId, text, surface) {
  if (!s.promise.enabled || !ownerBound(tool, chatId, text, s)) return null
  const v = judgePromise(text, s.registry, name => s.devExists[name] === true, s.label)
  if (!v.hits.length) return null
  if (v.decision === 'block') stats.blocks++; else stats.passBasis++
  await record($, s, { kind: v.kind, decision: v.decision === 'block' ? 'block' : 'pass_basis', surface, word: v.hits[0][0], devices: v.devices })
  return v.decision === 'block' ? { deny: v.reason } : null
}

export function register(on, options) {
  // ① + ③ — 주인행 답(Slack·Discord)
  on('tool.call', { tool: /^mcp__(?:slack-channel__reply|plugin_discord_discord__reply)$/ }, async ($, e, next) => {
    if (!(await laneOn($))) return next(e)
    const s = await load($)
    if (!s.enabled || typeof e.text !== 'string') return next(e)
    const tool = String(e.tool || '')
    const discord = tool.includes('discord')
    const refused = await promiseVerdict($, s, tool, e.chat_id, e.text, discord ? 'discord' : 'slack')
    if (refused) return refused
    if (!discord && s.threadTag.enabled) {
      // "auto" DM (공개판 키트): a thread reply in a D channel where the owner themself wrote in this session counts as the owner's DM
      let dms = s.dmChannels
      if (s.dmAuto && e.thread_ts && !dms.includes(e.chat_id) && /^D/.test(String(e.chat_id || ''))) {
        let msgs = []
        try { msgs = await $.session.messages() } catch (err) { msgs = [] }
        if (ownerWroteIn(msgs, s.slackUser, e.chat_id)) dms = [...dms, String(e.chat_id)]
      }
      const text = withOwnerMention(e.text, { chatId: e.chat_id, threadTs: e.thread_ts, dmChannels: dms, ownerUserId: s.slackUser })
      if (text !== e.text) { stats.tags++; await record($, s, { kind: 'tag', decision: 'tag', surface: 'slack' }); return next({ ...e, text }) }
    }
    return next(e)
  }).catch(async ($, e, next) => { stats.errors++; return next.called ? next(e) : next(e) })

  // ① Bash 발신 스크립트 + ② 답 늦음 막기 — 모든 도구
  on('tool.call', { tool: /[\s\S]/ }, async ($, e, next) => {
    if (!(await laneOn($))) return next(e)
    const s = await load($)
    if (!s.enabled) return next(e)
    const tool = String(e.tool || '')
    if (tool === 'Bash' && s.promise.enabled) {
      const a = senderScriptArgs(e.command)
      if (a && a.payload) {
        let text = ''
        try {
          const p = a.payload.startsWith('/') ? a.payload : String(await $.session.cwd()).replace(/\/+$/, '') + '/' + a.payload
          text = payloadText(JSON.parse(await $.fs.read(p, 'text')))
        } catch (err) { text = '' }
        if (text) { const refused = await promiseVerdict($, s, 'slack', a.channel, text, 'slack-send-bash'); if (refused) return refused }
      }
    }
    const r = s.replyFirst
    if (r.mode !== 'off' && s.slackUser && s.dmChannels.length) {
      const pending = scan(await $.session.messages(), { ownerUser: s.slackUser, dmChannels: s.dmChannels, currentToolUseId: e.tool_use_id })
      const t = await nowMs($)
      const live = new Set()
      for (const [k, v] of pending) { const id = k + '#' + v.resets; live.add(id); if (!firstSeen.has(id)) firstSeen.set(id, t) }
      for (const id of [...firstSeen.keys()]) if (!live.has(id)) firstSeen.delete(id)
      const v = judgeReply(tool, pending, firstSeen, t, { maxTools: r.maxTools, maxSeconds: r.maxSeconds, dm: s.dmChannels[0] })
      if (v.decision === 'deny') {
        stats.replyFirst++
        await record($, s, { kind: 'reply-first', decision: r.mode === 'deny' ? 'deny' : 'shadow', surface: tool, thread: v.key, n: v.n, age_s: v.age })
        if (r.mode === 'deny') return { deny: v.reason }
      }
    }
    return next(e)
  }).catch(async ($, e, next) => { stats.errors++; return next.called ? next(e) : next(e) })
}
