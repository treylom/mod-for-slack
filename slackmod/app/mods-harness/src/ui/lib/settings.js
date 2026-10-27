// lane: ui · owner: 봇 — pure reading of the ui part of config/local.config.json (no `$`).
// The file itself is found by index.js: env MODS_HARNESS_CONFIG first (봇 10-17), else the plugin's own
// config/local.config.json (same rule as the session lane). Every key is optional; defaults below.
//   ui.system_name      띠·칸 이름 (비면 «mods-harness», 봇 10-17)
//   ui.memory_tools     [{ label, match, tier }] 기억 칸에 셀 도구 호출 · tier = 공유|개별 (memory.js)
//   ui.team_claude_urls [주소…] team claude 상태 주소(GET 만 · http/https · 칸이 열려 있을 때만 30초마다 읽음, team.js)
//   ui.team_claude_control  TeamClaude 계정 조작(바꾸기·끄기/켜기·순서·지우기 = Claude 상태 주소의 origin 으로 POST) ·
//                       true 일 때만 켜짐, 그 밖의 값·없음 = 꺼짐(기본 · 설계 메모 쓰기 길 문)
//   ui.cron_groups      [{ bot, match: [substring…] }] 예약 작업 → 봇 묶음 (jobs.js)
//   ui.cron_pin         [label 조각…] 이 봇 예약 줄에 늘 한 줄로 남길 작업(접힌 칸 · 짧은 칸에서도 · jobs.js ownJobs) ·
//                       없음 = 기본 ["memory-same-env-daily"](매일 기억 시험 · 10-20 부모 봇 ㉯) · [] = 끔 ·
//                       줄 상한(4줄)은 그대로라 고정을 여럿 두면 칸이 넉넉해도 문제 줄이 «(+N개 · ✕…)» 숫자로만 남을 수 있음
//   ui.bot_names        [이름…] 라벨 조각으로 봇을 알아볼 이름 (config bots[].name 과 합침)
//   ui.bot_display      { 봇: 화면 이름 } 화면에 그리는 봇 이름만 바꿈(예 {"design":"jobs"} · 주인 10-18 18:21) — 등록부 bot·
//                       설정 파일 이름·기동 env 는 그대로 (display.js)
//   ui.stale_min        live 기록이 이 분 넘게 안 고쳐지면 «응답 없음» (기본 5 · 봇 10-17)
//   ui.keep_ended_min   끝난 세션을 나무에 남겨 둘 분 (기본 0 = 바로 뺌 · 10-19 주인 · 이 세션 자신·
//                       아래에 보이는 하위가 달린 줄·창이 아직 열린 줄은 그래도 남음)
//   ui.live_dir         세션별 활동 기록 폴더 (기본 $HOME/.mods-harness/live)
//   ui.launch_agents_dir 예약 작업 plist 폴더 (기본 $HOME/Library/LaunchAgents)
//   ui.auto_open        144칸 이상 창에서 세션 시작 때 칸 열기 시도 (기본 true)
//   ui.slack_channels   { 채널 id: 이름 } 하위 세션 줄 밑 «#이름 · 스레드 머리글» 의 이름표 (r2 · 기본 = 아래 6개, 설정이 덮음)
//   ui.tree_style       칸 나무의 계층 표시 안 A·B·C·D·E 한 글자 (r2 B · tree.js TREE_STYLES · 기본 B = 부모 가정, 주인 선택 뒤
//                       바뀜) · 모르는 값 = B + 경고 1줄(treeStyleWarn) · 설정 + 세션 재시작으로 바뀜(다시 짓기 없음)
//   session.registry_dir 세션 갈래 등록부 폴더 (읽기만 · 기본 $HOME/.mods-harness/registry.d)
//   session.projects   { 이름: [별칭, 접두-*] } 프로젝트 목록 — 나무·◈ 줄 묶음을 이 목록으로 읽음(등록부 파일은 안 고침 · 10-18)
//   session.child_close_after_report_min · child_idle_alert_min · child_idle_end_min  하위 줄 «남은 시간 또는 끝난 이유»
//   session.board_root · session.project_rooms  하위 세션 협의 게시판 자리 (세션 갈래 설정 그대로 · core.js sessionConfig 로
//                        읽음 · ◈ 프로젝트 줄이 게시판 수를 읽는 데만 씀 · board_root 없으면 «게시판 설정 없음»)
import { systemName } from './band.js'
import { memoryRules } from './memory.js'
import { DEFAULT_STALE_MIN, DEFAULT_KEEP_ENDED_MIN, TREE_STYLES, DEFAULT_TREE_STYLE } from './tree.js'
import { sessionConfig, liveDirOf, hiddenProjectsPath } from '../../session/core.js'
import { botDisplayMap } from './display.js'

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

export function expandHome(p, home) {
  if (typeof p !== 'string' || !p) return p
  if (!home) return p
  return p.replace(/^\$HOME(?=\/|$)/, home).replace(/^~(?=\/|$)/, home)
}

function minutes(v, dflt, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt
}

function names(list) {
  return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && n) : []
}

// Only plain http(s) addresses, no spaces or quotes, at most 4 (they are read with curl, never through a shell).
export function teamUrls(list) {
  return names(list).filter((u) => /^https?:\/\/[^\s"'`\\]+$/.test(u) && !u.startsWith('-')).slice(0, 4)
}

// r2 (봇 ①): the org's channel names (docs/rules · discord-comms) — a config's
// ui.slack_channels adds to or replaces them by id. Only channel ids that look like Slack's (C/G + 8-12 letters/digits).
// 10-19 ①a (봇 · 주인 20:47): a DM id (D…) too — the one way a DM
// thread reaches the board: only a DM the config names (the owner's own DM with the bot) is read; every other D… stays out.
export const DEFAULT_SLACK_CHANNELS = {
}
export function slackChannels(v) {
  const out = { ...DEFAULT_SLACK_CHANNELS }
  for (const [id, name] of Object.entries(obj(v))) {
    if (/^[CGD][A-Z0-9]{8,12}$/.test(id) && typeof name === 'string' && name.trim()) out[id] = name.trim().replace(/^#/, '').slice(0, 24)
  }
  return out
}

// r2 B: ui.tree_style → { style, warn } — one of TREE_STYLES (a lower-case letter or spaces around it are read as that
// letter); not set = DEFAULT_TREE_STYLE quietly; any other value = DEFAULT_TREE_STYLE and one warning line.
export function treeStyle(v) {
  if (v === undefined || v === null) return { style: DEFAULT_TREE_STYLE, warn: null }
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (TREE_STYLES.includes(s)) return { style: s, warn: null }
  const shown = String(typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ').slice(0, 12)
  return { style: DEFAULT_TREE_STYLE, warn: 'ui.tree_style «' + shown + '» 모름 → ' + DEFAULT_TREE_STYLE + ' (A·B·C·D·E 중 하나)' }
}

// 10-20 ㉯ (주인 10-19): ui.cron_pin → label substrings · not a list = the default ·
// [] = no pin · non-strings and blanks dropped, at most 8.
export const DEFAULT_CRON_PIN = ['memory-same-env-daily']
export function cronPin(v) {
  if (!Array.isArray(v)) return [...DEFAULT_CRON_PIN]
  return names(v).map((s) => s.trim()).filter(Boolean).slice(0, 8)
}

export function uiSettings(raw, home) {
  const r = obj(raw)
  const ui = obj(r.ui)
  const session = obj(r.session)
  const path = (v, dflt) => expandHome(typeof v === 'string' && v ? v : dflt, home)
  const bots = Array.isArray(r.bots) ? r.bots.map((b) => b && b.name) : []
  return {
    name: systemName(ui.system_name),
    registryDir: path(session.registry_dir, '$HOME/.mods-harness/registry.d'),
    liveDir: liveDirOf(r, home),   // one rule with the session lane's end-rule clock (core.js liveDirOf)
    launchAgentsDir: path(ui.launch_agents_dir, '$HOME/Library/LaunchAgents'),
    staleMs: minutes(ui.stale_min, DEFAULT_STALE_MIN, 1, 1440) * 60000,
    keepEndedMs: minutes(ui.keep_ended_min, DEFAULT_KEEP_ENDED_MIN, 0, 10080) * 60000,
    memoryRules: memoryRules(ui.memory_tools),
    cronGroups: Array.isArray(ui.cron_groups) ? ui.cron_groups : [],
    cronPin: cronPin(ui.cron_pin),
    botNames: [...new Set([...names(bots), ...names(ui.bot_names)])],
    autoOpen: ui.auto_open !== false,
    teamUrls: teamUrls(ui.team_claude_urls),
    teamControl: ui.team_claude_control === true,
    board: boardSettings(r, home),
    slackChannels: slackChannels(ui.slack_channels),
    treeStyle: treeStyle(ui.tree_style).style,
    treeStyleWarn: treeStyle(ui.tree_style).warn,
    botDisplay: botDisplayMap(ui.bot_display),
  }
}

// The consult boards' place, read exactly as the session lane reads it (one rule, one place: core.js sessionConfig —
// $HOME/~ expanded, trailing / dropped, project_rooms entries kept only when the label and the room name are valid).
// 10-18 (주인 17:58): the project list (one table — spawn_child refuses by it, the tree and ◈ lines group by it) and the
// child end rules' minutes (the tree's «남은 시간 또는 끝난 이유» = core.js childEndLabel) ride here too, read by the same rule.
export function boardSettings(raw, home) {
  const c = sessionConfig(obj(raw), home)
  return {
    board_root: c.board_root, project_rooms: c.project_rooms, projects: c.projects,
    childEnd: { child_close_after_report_min: c.child_close_after_report_min, child_idle_alert_min: c.child_idle_alert_min, child_idle_end_min: c.child_idle_end_min },
    // 10-19 ①b: the shared binding log (session.binding_file — the session lane's G log, read only here) · null = off
    binding_file: c.binding_file || null,
    // 10-20 패널 ✕: the projects taken off the list (core.js hiddenProjectsPath — the session lane writes it) · read only here
    hidden_file: hiddenProjectsPath(c),
  }
}
