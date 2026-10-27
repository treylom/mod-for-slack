// owner lane 설정 — 순수. config.owner 꼴(전부 선택 · 없으면 lane 전체 꺼짐):
// {
//   "enabled": true,
//   "label": "주인",                         // 막는 글에 쓰는 주인 호칭(기본 «주인»)
//   "bots": ["*"],                              // 이 lane 을 켤 봇(MODS_HARNESS_BOT) · "*" = 전부 · 기본 ["*"]
//   "slack_user_id": "U…",                      // 주인 Slack id
//   "slack_dm_channels": ["D…"] | "auto",       // 이 봇과 주인의 Slack DM · "auto" = 주인이 직접 쓴 글이 이 세션에 들어온 D 채널
//   "discord_user_ids": ["…"], "discord_dm_channels": ["…"],
//   "promise": { "enabled": true, "devicesFile": "/abs/repair_devices.json", "devicesRoot": "/abs/root" },
//   "replyFirst": { "mode": "off|shadow|deny", "maxTools": 3, "maxSeconds": 120 },
//   "threadTag": { "enabled": true },
//   "logDir": "/abs/dir"                        // 기록 줄(걸린 봇 수 셈) · 기본 $HOME/.claude-state/owner-guard
// }
const ID = /^[A-Z0-9]{6,}$/
const list = (v, re) => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && re.test(x))

export function ownerSettings(raw, home, bot) {
  const o = raw && typeof raw === 'object' && raw.owner && typeof raw.owner === 'object' ? raw.owner : null
  const off = { enabled: false }
  if (!o || o.enabled === false) return off
  const bots = Array.isArray(o.bots) && o.bots.length ? o.bots : ['*']
  if (!bots.includes('*') && !bots.includes(bot)) return off
  const slackUser = typeof o.slack_user_id === 'string' && /^[UW][A-Z0-9]{5,}$/.test(o.slack_user_id) ? o.slack_user_id : ''
  const p = o.promise && typeof o.promise === 'object' ? o.promise : {}
  const r = o.replyFirst && typeof o.replyFirst === 'object' ? o.replyFirst : {}
  const t = o.threadTag && typeof o.threadTag === 'object' ? o.threadTag : {}
  const num = (v, d, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d)
  return {
    enabled: true,
    label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 20) : '주인',
    slackUser,
    dmChannels: list(o.slack_dm_channels, /^D[A-Z0-9]{6,}$/),
    // "auto" (공개판 키트 · 설치 마법사는 주인 id 만 앎): 이 세션에 주인이 직접 쓴 글이 들어온 D 채널 = 주인 DM (index.js)
    dmAuto: o.slack_dm_channels === 'auto',
    discordUsers: list(o.discord_user_ids, /^\d{6,}$/),
    discordDms: list(o.discord_dm_channels, /^\d{6,}$/),
    promise: { enabled: p.enabled !== false && Boolean(slackUser || (o.discord_user_ids || []).length),
      devicesFile: typeof p.devicesFile === 'string' ? p.devicesFile : '',
      devicesRoot: typeof p.devicesRoot === 'string' ? p.devicesRoot : '' },
    replyFirst: { mode: ['off', 'shadow', 'deny'].includes(r.mode) ? r.mode : 'off',
      maxTools: num(r.maxTools, 3, 1, 50), maxSeconds: num(r.maxSeconds, 120, 10, 3600) },
    threadTag: { enabled: t.enabled !== false && Boolean(slackUser) },
    // null = 기록 안 함(공개판 키트: 태그만 켜고 기록 폴더를 따로 만들지 않음)
    logDir: o.logDir === null ? '' : typeof o.logDir === 'string' && o.logDir.startsWith('/') ? o.logDir : (home ? home + '/.claude-state/owner-guard' : ''),
  }
}

// 이 발신이 주인행인가 — Slack: 주인 DM · 글 안 주인 태그 · chat_id 빠짐(다리가 «마지막 대화»로 보냄) / Discord: 주인 DM · 주인 태그
export function ownerBound(tool, chatId, text, s) {
  const body = String(text || '')
  if (/discord/i.test(tool)) {
    return s.discordDms.includes(String(chatId || '')) || s.discordUsers.some(u => body.includes(`<@${u}>`) || body.includes(`<@!${u}>`))
  }
  if (!chatId) return true
  return s.dmChannels.includes(String(chatId)) || (Boolean(s.slackUser) && body.includes(`<@${s.slackUser}>`))
}

// Bash 로 부르는 Slack 발신 스크립트(slack-send.py --channel X --payload F) — 인자만 뽑음(셸 해석 ❌ · 따옴표 1겹만)
export function senderScriptArgs(command) {
  const cmd = String(command || '')
  if (!/slack-send\.py(?![\w.])/.test(cmd)) return null
  const tok = cmd.match(/'[^']*'|"[^"]*"|\S+/g) || []
  const un = x => x.replace(/^(['"])(.*)\1$/, '$2')
  let channel = '', payload = ''
  for (let i = 0; i < tok.length - 1; i++) {
    if (tok[i] === '--channel') channel = un(tok[i + 1])
    if (tok[i] === '--payload') payload = un(tok[i + 1])
  }
  return { channel, payload }
}
export function payloadText(obj) {
  const out = []
  const walk = v => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
  walk(obj)
  return out.join('\n')
}
