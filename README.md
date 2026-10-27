# Claude Code MOD 키트 (미리보기)

> 공개 이름은 정식 공개 때 정합니다. 지금은 «미리보기(알파)» 판입니다 — 문제는 이슈로 알려 주세요.

Slack 채널에 글을 쓰면 Claude Code 봇이 받고, 여러 단계가 걸리는 일은 **그 스레드 전용 하위 세션을 새 창에 열어** 맡깁니다(설치 마법사의 «하위 세션 쓰기» 를 끄면 하위 없이 봇 본 창에서 합니다 · 선택 칸 «하위 라우터» 를 켜면 주인 글이 어느 하위의 일인지 판정 모델이 골라 넘겨 줍니다 · 주인 DM 스레드의 봇 답 맨 앞엔 주인 태그가 붙습니다). 봇끼리 스레드에서 대화하고, 허락한 사람(손님)이 있는 채널에서도 대화할 수 있습니다.

손님 글에는 대화와 답만 합니다. 손님 글이 들어온 턴에는 읽기와 Slack 답·반응 말고는 도구가 스스로 거절하고, 뒤 턴에도 손님 글의 문장(30자 이상)을 그대로 담아 하위 세션에 넘기는 일은 거절합니다. **한계:** 봇이 손님 말을 바꿔 써서 넘기는 것까지는 도구로 막지 못합니다 — 그 부분은 봇 규칙(손님 글은 하위 세션으로 옮기지 않는다)으로 지킵니다.

## 빠른 시작 (macOS · WSL Ubuntu · Linux)

```bash
git clone <이 저장소 주소> mod-kit && cd mod-kit
bash install.sh
```

`install.sh` 는 필요한 프로그램(Claude Code · node 20+ · python3 · git · 다중 창 도구)을 점검하고, 빠진 것은 설치 명령만 보여 줍니다(관리자 권한 명령을 스스로 실행하지 않습니다). 그다음 Claude Code 가 **설치 마법사**로 바로 시작합니다.

마법사가 하는 일:

1. 이미 쓰던 설정(Claude Code · Codex · 다른 봇)을 찾아 보여 주고, 가져올지 묻습니다. 가져올 때는 **사본**만 별도 폴더로 옮깁니다 — 원본은 건드리지 않습니다.
2. 모드를 고릅니다: 빠른(추천 기본값) · 전체(칸마다 고르기) · 빈 판(설치만).
3. 창 도구 · Slack 연결 · 위키 폴더 · MCP · 코덱스 · 점검 스킬 · 브라우저 · 메모리 · 하위 세션 쓰기 · 하위 라우터를 고릅니다(빠른 모드는 Slack 연결 · 하위 세션 쓰기 · 하위 라우터만 묻습니다).
4. 봇마다 이름과 성격을 짧은 인터뷰로 정하고, 넣기 전에 점검합니다. 가져올 봇이 없으면 역할 기본값 셋(총괄 · 감시/일정 · 조사)으로 시작합니다.
5. 고른 것을 **한 번에** 설치하고, 점검 표를 보여 준 뒤, 새 터미널 창을 열어 토큰을 넣고 봇을 켭니다. 처음 켤 때 봇 창에 확인 화면이 뜹니다 — 고르는 법은 [SUPPORT.md](SUPPORT.md) 의 «처음 켤 때 봇 창의 확인 화면» 줄.

칸 하나만 다시 하려면: Claude Code 에서 `/mods-setup:setup --section slack` 처럼 부릅니다.

## 지원 환경

[SUPPORT.md](SUPPORT.md) 를 보세요. 다중 창 도구는 tmux(정식)를 기본으로 하고, cmux 와 herdr 는 그 창 안에서 tmux 를 켜면 됩니다. herdr 는 하위 창을 herdr 탭으로 직접 여는 방식도 지원합니다. Orca 는 시험 중입니다.

## 텔레그램·디스코드 채널을 이미 쓰고 있다면

Claude Code 의 공식 채널 플러그인(텔레그램 · 디스코드 · iMessage · fakechat)을 계정 전체에서 켜 두었다면, 키트 봇이 켜질 때 그 플러그인도 같이 켜져 기존 봇과 같은 토큰을 다툽니다(텔레그램은 기존 연결이 끊깁니다). 점검 표 [8] 칸이 그런 봇과 플러그인을 알려 줍니다. 봇이 그 채널을 일부러 쓰는 것이면 설정(`~/.slackmod/config.json`)의 그 봇 `extra_channels` 에 넣고 `install.sh` 를 다시 돌리세요(그러면 [8] 이 세지 않습니다). 아니면 적힌 대로 그 봇 폴더의 `.claude/settings.local.json` 에서 끄세요 — 그 폴더에서 여는 Claude 창은 모두 꺼지므로, 봇 폴더를 다른 작업 창과 같이 쓰고 있다면 그쪽도 꺼집니다.

## 컴퓨터를 다시 켠 뒤

봇은 저절로 켜지지 않습니다(키트는 자동 켜기 장치를 설치하지 않습니다). 컴퓨터를 다시 켰거나 다중 창 도구(tmux 등)가 꺼졌으면 터미널에서 한 번 `slackmod start all` — 봇 창과 Slack 다리가 다시 켜집니다. 꺼질 때 남은 다리 기록 파일은 이때 키트가 치웁니다. 확인은 `slackmod status`(봇마다 «켜짐»).

- 봇 하나만 새로 켜려면 터미널에서 봇 이름(예: `lead`)을 칩니다 — 켜져 있으면 그 봇 세션만 끄고 새 대화로 켠 뒤 그 봇 화면으로 들어갑니다. 켠 직후 30초쯤 사이에 온 Slack 글은 놓칠 수 있으니 다시 보내 주세요.
- 그때 돌던 하위 세션은 같이 끝납니다. 그 스레드에 새 글을 쓰면 봇 본 창이 받습니다.
- 봇 세션 안에서 걸어 둔 예약(세션 안 반복 작업 등)은 세션과 함께 사라집니다 — 다시 걸어야 합니다.

## 알아 둘 점 (미리보기 판)

- **봇 창의 파일 권한:** 봇 창은 umask 077 로 돕니다. 봇이 Bash·git·npm 으로 만드는 파일과 폴더도 기본이 «나만 읽기»(600/700)라서, 팀 공유 폴더·웹 서버·Docker 볼륨처럼 다른 계정이 읽어야 하는 곳에서는 그 파일만 권한을 넓혀 주세요(`chmod`). 봇이 꺼진 뒤 같은 창에 남는 셸도 같은 설정을 이어받습니다.
- **하위 라우터의 동봉 판정기(선택 · 기본 끔):** 켜면 판정 1번마다 주인이 봇에게 쓴 글(최대 4,000자)과 하위 세션 설명이 Anthropic API(Claude API)로 나갑니다. 키는 `slackmod set-judge-key <봇>` 으로 넣습니다 — 봇 환경에는 들어가지 않지만, 같은 계정의 프로그램(봇의 Bash 포함)은 그 키 파일을 읽을 수 있으니 판정 전용으로 사용 한도를 건 키를 쓰세요. 라우터를 꺼도 키 파일은 남습니다 — 지우려면 그 봇의 `~/.slackmod/bots/<봇>/slack/route-judge.key` 를 지우세요.
- **아주 바쁜 컴퓨터:** 봇의 도구 호출마다 앞에서 도는 관문이 시간 한도(7초)를 넘기면 그 호출은 막힙니다(통과만 시키는 관문이어도 그렇습니다). 부하가 아주 높을 때 도구 호출이 가끔 막히면 다시 시도하면 됩니다 — 다음 판에서 고칩니다.

## 되돌리기

`slackmod stop all` → 되살릴 파일이 있으면 `~/.slackmod/backup/<시각>/` 에서 먼저 꺼내 두기(설치 전 셸 설정 파일 사본도 여기 있고, 이 폴더도 `~/.slackmod` 안이라 마지막 단계에서 같이 지워짐) → 셸 설정 파일(`~/.zshrc` 또는 `~/.bashrc`)의 `# >>> slackmod >>>` 칸 삭제 → `~/.slackmod` 폴더 삭제(토큰·판정기 키 파일도 같이 지워짐). 봇 작업 폴더(기본 `~/bots/<이름>`)와 마법사가 그 안에 넣은 파일(성격 파일 · `.claude/settings.json` · `.mcp.json`)은 남으니, 필요 없으면 따로 지우세요.

## 라이선스

MIT — [LICENSE](LICENSE). 봇 성격 틀 일부는 MIT 공개 틀을 일반화했습니다([setup/ATTRIBUTIONS.md](setup/ATTRIBUTIONS.md)).

---

## English (short)

A Claude Code mod kit: a Slack message reaches your Claude Code bot; multi-step work opens a per-thread sub-session in a new window. Bots can talk to each other in threads and, if you allow it, with listed guests in a shared channel. A guest's message only gets conversation and replies: in that turn every tool except reading and the Slack reply/reaction refuses, and a later hand-off to a sub-session that carries a guest's sentence (30+ characters) word for word is refused. Limit: a reworded copy is not caught by the tools — the bot's rules cover it. `bash install.sh` checks prerequisites and starts Claude Code in a setup wizard (import existing settings as copies → pick options → install once → health check → a terminal opens to enter tokens and start the bot). On first launch the bot window asks you to trust the folder and accept the bypass-permissions warning (once each: `slackmod attach <bot>`, arrow down to «Yes», Enter — plain Enter picks «No, exit»); the development-channels prompt comes every launch and `slackmod start` answers it for you. If you already run Claude Code's official Telegram/Discord/iMessage/fakechat channel plugin account-wide, it also starts inside each kit bot and fights over the same token (Telegram drops your existing connection) — health-check cell [8] names those bots. If a bot uses that channel on purpose, list it in that bot's `extra_channels` in `~/.slackmod/config.json` and re-run `install.sh`; otherwise switch the plugin off in that bot folder's `.claude/settings.local.json` (this affects every Claude window opened in that folder). After a reboot nothing starts by itself: run `slackmod start all` once (sub-sessions that were running have ended; schedules set inside a session must be set again). Known limits of this preview: the bot window runs with umask 077, so files the bot creates are owner-only (widen them with chmod where another account must read them); the optional bundled router judge sends the owner's message (up to 4,000 characters) and the sub-session descriptions to the Anthropic API, and its key file stays out of the bot's environment but is readable by programs of the same account (use a judge-only key with a spend limit; turning the router off leaves that key file in place — delete `~/.slackmod/bots/<bot>/slack/route-judge.key` to remove it); on a very busy machine the gate in front of every tool call can exceed its 7 s limit and refuse that call — retry it. To undo: `slackmod stop all`; copy anything you need out of `~/.slackmod/backup/<time>/` first (it holds the pre-install copy of your shell rc file and sits inside `~/.slackmod`, so the last step deletes it too); remove the `# >>> slackmod >>>` block from `~/.zshrc` or `~/.bashrc`; delete `~/.slackmod` (tokens and the judge key file included). Bot work folders (default `~/bots/<name>`) and the files the setup put there stay — delete them yourself if you no longer need them. Preview release — see SUPPORT.md. MIT licensed.
