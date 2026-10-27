// lane: ui — pure «화면에 보이는 봇 이름» (주인 10-18 18:21).
// config ui.bot_display = { "<bot>": "<shown name>" } changes only what the screen draws: the tree's names, the ◈ project
// lines, the ▣ band and the schedule groups. The registry `bot`, row ids, config file names, keys (mh-bot-…) and the
// launch env (MODS_HARNESS_BOT) keep the real name — other parts of the system key on it.
// The map is set once per settings load (index.js) and read by the drawing functions, so no signature changes ripple.
let shown = {}

const NAME = /^[A-Za-z0-9._-]{1,40}$/
export function botDisplayMap(v) {
  const out = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [bot, name] of Object.entries(v)) {
    if (NAME.test(bot) && typeof name === 'string' && name.trim() && name.trim().length <= 40 && !/[\u0000-\u001f\u007f]/.test(name)) out[bot] = name.trim()
  }
  return out
}

export function setBotDisplay(map) {
  shown = botDisplayMap(map)
}

// a bot name → the name the screen shows (no alias = the name itself)
export function botShown(bot) {
  return typeof bot === 'string' && Object.prototype.hasOwnProperty.call(shown, bot) ? shown[bot] : bot
}

// a session's name (registry id «<bot>» or «<bot>-<ts6>[-n]») → its bot part shown under the alias, the rest kept
export function sessionShown(name, bot) {
  if (typeof name !== 'string' || !name) return name
  const b = typeof bot === 'string' && bot ? bot : name
  if (!Object.prototype.hasOwnProperty.call(shown, b)) return name
  if (name === b) return shown[b]
  return name.startsWith(b + '-') ? shown[b] + name.slice(b.length) : name
}

// 10-22 (주인 09:58): a 하위 row may carry name_prefix — its project's slug, written by
// the session lane at spawn (core childNamePrefix) — and then shows «<prefix>-<name as shown>». The session lane's rule
// said again here (the lanes do not import each other): a-z0-9 words joined by single «-», at most 20 characters.
const NAME_PREFIX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export function withNamePrefix(name, prefix) {
  return typeof name === 'string' && name && typeof prefix === 'string' && prefix.length <= 20 && NAME_PREFIX.test(prefix) ? `${prefix}-${name}` : name
}
