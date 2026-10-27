// lane: window · 10-25 창 어댑터: the places a child window cannot be opened from (1판) — the refusal words only.
// none = no window tool around this session (the words spawn_child said before the adapter, unchanged) · orca = an Orca
// terminal (기준 문서 1판 설계 메모 K4: «시험 중» — its agent-teams mode fakes TMUX with a tmux stand-in that has no
// new-window/kill-window, claude-agent-teams-tmux-dispatcher.ts:28-80 · source read 10-24, not run).
export const NONE = 'none'
export const ORCA = 'orca'
export const CAPS = Object.freeze({ jump: false })
export const NONE_REFUSAL = 'this session is not inside tmux (TMUX/TMUX_PANE missing)'
export const ORCA_REFUSAL = 'Orca 는 시험 중 — tmux 안에서 켜세요 (this session is in an Orca terminal; mods child windows are not supported there yet — start the bot inside tmux)'
