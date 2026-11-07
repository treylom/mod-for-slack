# 개발자 안내

[English](developers.en.md) · [처음 쓰는 분 안내(README)](../README.md)

이 문서는 mod-for-slack 을 고쳐 쓰거나 늘리려는 개발자를 위한 것입니다. 설치와 처음 쓰기는 [README](../README.md) 를 보세요.

## 두 층

- **Claude Code mod** — Claude Code 의 보이는 모습과 동작을 바꾸는 플러그인입니다. 플러그인의 `hooks/hooks.json` 에 `modules` 키가 있고 그것이 가리키는 모듈(`register.js`)이 `register(on)` 을 내보내면 mod 가 됩니다. 처리기는 사건(`tool.call` · `prompt.submit` · `turn.complete` · `ui.render` · `session.*` 등)에 걸리고, 넘겨받는 `$`(mods API)로 칸·띠·상태 줄·알림(`$.ui`), 명령(`$.command`), 도구(`$.tool`) 등을 씁니다. 터미널 Claude Code 2.1.287 이상. 공식 문서: [개요](https://code.claude.com/docs/en/plugins/mods/overview.md) · [API](https://code.claude.com/docs/en/plugins/mods/api.md) · [참고](https://code.claude.com/docs/en/plugins/mods/reference.md).
- **mod-for-slack** — 위 틀로 만든 플러그인 하나(`slackmod/app/mods-harness`)와, 그것을 Slack 에 잇고 설치·켜기를 맡는 묶음입니다.

mods API 의 전체 타입은 저장소에 없습니다. Claude Code 가 `--plugin-dir` 로 플러그인을 실을 때 그 플러그인의 `.claude-plugin/types/claude-code/index.d.ts` 로 써 줍니다. 저장소의 `types/index.d.ts` 는 이 플러그인이 쓰는 상태 키(`mh.*`)만 적은 작은 파일입니다.

## 폴더 구조

| 자리 | 무엇 |
|---|---|
| `install.sh` | 입구. 필요한 프로그램을 점검하고 Claude Code 를 설치 마법사(`setup/`)와 함께 엽니다(`--section` · `--resume` · `--answers`). |
| `setup/` | 설치 마법사 플러그인(이름 `mods-setup` · 명령 `/mods-setup:setup`). 스킬 `mods-setup` · `mods-doctor` · `bot-interview`, 도우미 `lib/`, 시험 `tests/`. |
| `slackmod/` | 설치되는 묶음(이름은 기존 설치를 위해 옛 이름 그대로). 아래 표. |
| `rules/` | 봇 운영 규칙 세 묶음(Claude Code · Codex · 일반판). 규칙이 부르는 도구 스크립트는 들어 있지 않습니다. |
| `docs/` | Slack 앱 안내서와 이 문서. |

`slackmod/` 안:

| 자리 | 무엇 |
|---|---|
| `install.sh` | 설치기. `~/.slackmod` 아래에 깔고, 바꾼 것을 기록해 `slackmod undo` 로 되돌릴 수 있게 합니다. 두 번 돌려도 결과가 같습니다. |
| `bin/slackmod` | 켜기·끄기·상태 명령(`start` · `stop` · `status` · `attach` · `open` · `set-token` · `set-judge-key` · `set-effort` · `effort` · `undo` · `check-windows`). |
| `lib/slackmod_config.py` | 설정 파일을 읽어 검사하고 봇마다 켜기 파일을 만드는 곳. |
| `lib/record.py` | 설치 기록과 되돌리기. |
| `app/mods-harness` | Claude Code mod 플러그인(아래). |
| `app/channel-server` | Slack 다리(Slack ↔ 봇 창). |
| `hooks/pass.sh` | 도구 호출마다 거치는 관문 자리(지금은 모두 통과). |
| `templates/` | 봇 규칙(본 세션 계약 · 하위 없는 판), 도움말 스킬 `slackmod-help`, 빈 노트 폴더 틀. |
| `MANIFEST.txt` · `SHA256SUMS` | 묶음을 만든 원본 커밋 · 고정한 Claude Code 판 · 파일 확인 값. |

플러그인 `app/mods-harness` 는 `hooks/hooks.json` → `register.js` 로 일곱 갈래를 싣습니다: 설정 읽기 · 관문(훅 실행기) · 세션(스레드마다 하위 세션) · 화면(띠와 현황판) · 도구 · 기억 · 주인 태그. 도구: 봇 본 세션 = `spawn_child` · `list_children` · `close_child` · `send_to_child` · `board_summary` · 하위 세션 = `report_to_parent` · `ask_sibling` · `answer_sibling` · `board_post` · `board_read`(하위 라우터를 켜면 `not_mine` 도 · 깊이가 남으면 `spawn_child` 등도) · 둘 다 = `progress_line`. 하위 세션 쓰기를 끄면(`children: false`) 본 세션의 이 다섯 도구는 실리지 않습니다.

## 켜질 때 무엇이 도나

`slackmod start <봇>` 은 봇 이름의 세션에 창 두 개를 엽니다.

- `bridge` — Slack 다리(`app/channel-server`). 기록은 봇의 `slack/server.log`.
- `main` — Claude Code. 환경 변수 `MODS_HARNESS_BOT` · `MODS_HARNESS_SESSION_ID`(새 값) · `MODS_HARNESS_CONFIG`(그 봇의 `harness.json`)를 두고, `--plugin-dir app/mods-harness` · `--mcp-config` · `--append-system-prompt-file`(봇 규칙) · Slack 채널 서버를 싣고, 봇 작업 폴더에서 umask 077 로 돕니다.

herdr 안에서는 세션 대신 herdr 작업공간 하나에 탭 두 개로 엽니다(`--backend auto|tmux|herdr`).

봇마다 설치기가 만드는 파일(`~/.slackmod/bots/<봇>/`): `harness.json`(플러그인 설정) · `mcp.json` · `launch.sh`(켜기 값 · 나만 읽기) · `slack/.env`(열쇠 · `slackmod set-token` 으로만 넣음).

## 설정

설정 파일 하나 = `~/.slackmod/config.json`(본보기 `slackmod/config.example.json`). 고친 뒤 `bash install.sh` 를 다시 돌리면 봇마다 파일이 다시 만들어집니다.

- 꼭 있는 칸: `schema` · `slack`(채널 · 주인) · `bots`(1~4개) · `aliases` · `permission` · `child`(하위 세션 모델·생각 깊이·디스크/메모리 여유 문턱).
- 고를 수 있는 칸: `mode` · `wiki` · `memory_setup` · `browser` · `help_skill` · `children` · `children_open` · `owner_tag` · `window_backend` · `router` — 뜻은 `slackmod/lib/slackmod_config.py` 맨 위 설명에 있습니다.
- 봇마다: `name` · `work_dir` · `slack_bot_user_id` · `model` · (선택) `effort` · `projects`(작업 폴더) · `extra_channels` · `extra_env`(허용된 이름만 · 비밀 같은 이름은 봇 `.env` 로만).

`harness.json` 은 손으로 고치지 않습니다(설치기가 다시 씀). 큰 묶음: `hooks`(관문) · `memory` · `session`(기본 모델 · 주인 · 하위 세션) · `ui`(화면 이름 `system_name`) · `owner`.

## 고쳐 쓰고 늘리기

- **봇 규칙** — 봇 작업 폴더의 `.claude/rules/` 에 md 파일을 둡니다(설치기가 만든 `slackmod-projects.md` · `slackmod-memory.md` 는 설치기가 다시 씁니다). 저장소의 `rules/` 는 참고용 세 묶음입니다.
- **스킬** — 봇 작업 폴더의 `.claude/skills/<이름>/SKILL.md` 또는 사용자 폴더 `~/.claude/skills/`. Claude Code 의 보통 스킬 방식 그대로입니다.
- **다른 채널** — 봇의 `extra_channels` 에 넣으면 Slack 채널 서버 뒤에 함께 실립니다.
- **관문** — `slackmod/hooks/pass.sh` 를 고친 뒤 `bash install.sh` 를 다시 돌리면 새 확인 값이 기록됩니다. 설치된 사본만 고치면 확인 값이 안 맞아 도구 호출이 막힙니다(점검 표가 알려 줌).
- **마법사 칸 다시 하기** — `/mods-setup:setup --section <칸>` 또는 `bash install.sh --section <칸>`. 칸 = `mux` · `slack` · `wiki` · `mcp` · `codex` · `doctor` · `browser` · `memory` · `children` · `router` · `bots`.
- **mod 를 직접 고치기** — `slackmod/app/mods-harness/src/` 를 고친 뒤 `claude plugin validate slackmod/app/mods-harness` 로 확인하고 봇을 다시 켭니다.

## 시험

이 저장소에 들어 있는 시험은 `setup/tests/` 입니다.

```bash
bash setup/tests/run-all.sh          # 전부 · 파일마다 rc 와 PASS/FAIL 수
bash setup/tests/run-all.sh m4       # 이름이 m4 로 시작하는 것만
MUTATE=1 bash setup/tests/run-all.sh # 검사를 하나씩 꺼 보며 시험이 잡는지도 셈
```

손으로 돌리는 것(`m3-bundle-layout` · `m3-live-wizard` · `m3-g34-live`)은 묶음에서 빠집니다. 묶음 만들기·설치기 계약·흔적 검사 시험은 공개 저장소에 들어 있지 않아 `run-all.sh` 가 건너뜁니다.

## Claude Code 판

묶음은 Claude Code 판 하나에 맞춰 시험합니다(`slackmod/app/mods-harness/.claude-code-version`). 다른 판이면 설치기가 경고와 맞추는 명령만 보여 주고 막지는 않습니다. 봇 창은 자동 업데이트를 끄고 돕니다.

## 이름에 대해

제품 이름은 mod-for-slack 입니다. 기존 설치가 그대로 돌도록 명령 `slackmod` · 설치 폴더 `~/.slackmod` · 저장소 안 폴더 `slackmod/` · 셸 설정 칸 표식 `# >>> slackmod >>>` · 환경 변수 `SLACKMOD_*` · 플러그인 이름 `mods-harness` 는 옛 이름 그대로입니다. Claude Code 는 플러그인의 상태 줄과 알림 앞에 플러그인 이름을 붙이므로, 화면의 알림 줄은 «mods-harness:» 로 시작합니다.

## 규칙과 관련 저장소

봇 운영 규칙 원본(`rules/`)과 그 사본을 담은 관련 저장소는 [README 의 «규칙과 관련 저장소»](../README.md#규칙과-관련-저장소)에 있습니다.
