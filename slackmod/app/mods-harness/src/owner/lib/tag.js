// 주인 DM 스레드 답글 맨 앞에 주인 태그 — 순수 함수. 근거: 주인 요청(10-25) — 답글 스레드에서
// 주인을 먼저 태그하고, mod 기본 구성으로. 막지 않고 붙임 · 이미 어디든 있으면 그대로 · 최상위 글·다른 채널 = 손 0.
// 주인 id = 설정값(owner.slack_user_id) — 하드코딩 0.
export function withOwnerMention(text, { chatId, threadTs, dmChannels, ownerUserId, enabled = true }) {
  if (!enabled || typeof text !== 'string' || !threadTs) return text
  if (!Array.isArray(dmChannels) || !dmChannels.includes(chatId)) return text
  if (typeof ownerUserId !== 'string' || !/^[UW][A-Z0-9]{5,}$/.test(ownerUserId)) return text
  const tag = `<@${ownerUserId}>`
  return text.includes(tag) ? text : `${tag} ${text}`
}
