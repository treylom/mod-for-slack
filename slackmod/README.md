# SlackMod 최소판 — 설치하는 사람용 안내

> 공개 저장소로 받았다면 맨 위 README 의 설치 마법사(`bash install.sh`)로 설치하세요. 이 문서는 키트만 따로 받아 손으로 설치할 때의 안내이고, 아래 «안 되는 때»는 두 길 모두에 해당합니다.

Slack 채널에 메시지를 보내면 봇이 받고, 여러 단계가 걸리는 일은 **그 스레드 전용 하위 세션을 tmux 새 창에 열어** 맡깁니다(설정 `children: false` = 하위 없이 봇 본 창에서). 스레드마다 세션이 따로라서 대화가 서로 섞이지 않습니다.

하위 세션은 Claude Code 의 기억(`~/.claude/projects/…/memory` · `~/.claude/CLAUDE.md` · 봇 폴더의 `CLAUDE.md`)에 직접 쓰지 못합니다 — 하위는 결과만 보고하고, 남길지는 본 봇이 정합니다(하위 일이 봇의 기억에 섞이지 않게). 본 봇 자신은 전처럼 씁니다.

## 들어 있는 것

| 자리 | 하는 일 |
|---|---|
| `install.sh` | 설치 · 갱신(두 번 실행해도 결과 같음 · `--dry-run` = 미리 보기) |
| `bin/slackmod` | 켜기 · 끄기 · 상태 · 토큰 넣기 · 판정기 키 넣기 · Windows 쪽 겹침 확인 |
| `config.example.json` | 설정 1개의 모양(봇 2개 · 채널 · 작업 폴더) |
| `app/mods-harness` | 하위 세션을 여는 Claude Code 플러그인 |
| `app/channel-server` | Slack 다리(Slack ↔ Claude Code) |
| `hooks/pass.sh` | 하위 세션 플러그인(`app/mods-harness`)이 도구 호출마다 거치는 관문 자리(지금은 모두 통과) |
| `lib/route_judge.py` | 하위 라우터의 예시 판정기(선택 · 아래 «하위 라우터») |
| `MANIFEST.txt` · `SHA256SUMS` | 묶음 출처 · 파일 지문 |

## 순서 (WSL Ubuntu 터미널)

0. (한 번 · 관리자) `sudo apt-get update && sudo apt-get install -y unzip tmux python3 uuid-runtime curl ca-certificates`
1. 묶음 확인·풀기: `sha256sum slackmod-*.zip` 이 받은 값과 같은지 본 뒤 `unzip slackmod-*.zip && cd slackmod-*/`
2. 미리 보기: `bash install.sh --dry-run` — 빠진 프로그램이 있으면 «sudo 묶음» 한 줄과 «sudo 없이» 줄을 보여 줍니다. 그대로 실행한 뒤 다시.
3. 첫 실행: `bash install.sh` — 설정 파일 `~/.slackmod/config.json` 을 만들고 멈춥니다. `nano ~/.slackmod/config.json` 으로 채널 ID · 사용자 ID · 봇 폴더를 채웁니다.
4. 설치: `bash install.sh` → 끝 줄 «결과: 바뀜 N · 그대로 M · 지문 …»
5. 다시 한 번 `bash install.sh` → «바뀜 0» 이면 정상(같은 지문).
6. `source ~/.bashrc`
7. 봇마다 토큰: `slackmod set-token chonggwal` (붙여 넣어도 화면에 안 보임 · 봇마다 Slack 앱이 따로여야 함)
8. Windows 겹침 확인: `slackmod check-windows` — Windows 쪽에서 같은 Slack 앱을 켜 둔 창이 있으면 먼저 닫습니다(두 곳이 동시에 켜지면 Slack 이 메시지를 나눠 보내 한쪽이 못 받음).
9. 켜기: 봇 하나씩 `chonggwal` · `docbot`(이미 켜져 있으면 그 봇만 끄고 새 대화로 켠 뒤 그 화면으로 들어감 · 켠 직후 30초쯤 온 Slack 글은 다시 보내기) / 한 번에 `allbots` · 끄기 `chonggwal-stop` · `allbots-stop`
10. 처음 켠 봇은 확인 화면이 뜹니다: `slackmod attach chonggwal` → 폴더 신뢰 · 권한 건너뛰기 경고 = 처음 한 번, 커서가 «No, exit» 에 있으니 아래 화살표로 «Yes» → Enter(그냥 Enter = 봇 꺼짐) · 개발 채널 확인 = 켤 때마다(`slackmod start` 가 대신 고름 · 끄기 `SLACKMOD_NO_AUTO_DEVCHANNEL=1`) → 나오기 `Ctrl+b` 뗀 뒤 `d`
11. 상태: `slackmod status` (켜짐 · 다리 · 토큰 · 하위 창 수)

## 주인 태그 (기본 켬)

주인 사용자 ID(`slack.owner_user_id`)가 있으면, 봇이 주인 DM 의 스레드에 답할 때 글 맨 앞에 주인 태그(`<@주인>`)를 붙입니다(이미 있으면 그대로 · 최상위 글 · 채널 · 다른 사람 DM 은 손 안 댐). 주인 DM 은 «그 대화에 주인이 직접 쓴 DM» 으로 봇이 알아봅니다(DM 번호를 따로 적지 않음). 끄려면 설정에 `"owner_tag": false` 를 넣고 `bash install.sh` 다시.

## 하위 라우터 (판정 모델이 고름 · 선택)

주인이 봇에게 쓴 글이, 다른 스레드에서 일하는 하위 세션의 일이면 판정 모델이 그 하위를 골라 같이 넘겨 줍니다(봇도 그 글을 그대로 받음). 기본은 끔입니다.

- 설정: `"router": {"mode": "off" | "shadow" | "on", "judge": "bundled" | ["명령", "낱말", …]}` — `shadow` = 고르기만 하고 기록 · `on` = 고른 하위에게도 넘김 · `children: false` 면 아무것도 안 씀. 주인 사용자 ID(`slack.owner_user_id`)가 없으면 켜도 돌지 않습니다.
- 동봉 판정기(`"bundled"`): `lib/route_judge.py` · Claude API(claude-haiku-5-5)를 판정 1번에 1번 부릅니다 — 주인이 봇에게 쓴 글(최대 4000자)과 하위 세션 설명이 그 API 로 나갑니다 · 시간 한도 5초(넘으면 판정 없이 봇이 받음). 키 = `slackmod set-judge-key <봇>`(화면에 안 보임 · 봇의 slack 폴더 `route-judge.key` 0600 · 판정기가 부를 때마다 그 파일을 읽음 · 봇 환경과 실행 줄엔 안 들어감 · 넣으면 바로 적용). 같은 계정의 프로그램(봇의 Bash 포함)은 그 파일을 읽을 수 있으니 판정 전용으로 한도를 건 키를 쓰세요. 라우터를 꺼도 키 파일은 남습니다 — 지우려면 `~/.slackmod/bots/<봇>/slack/route-judge.key` 를 지우세요.
- 내 판정 명령: 표준 입력 JSON `{v, boundary:"route1", body, dm, criteria: {"부모": …, "하위 A": …}, timeout_s}` → 표준 출력 한 줄 `{"ok": true, "probs": {라벨: 0~1, …}}` (못 고르면 `{"ok": false, "reason": "…"}`) · 시간 한도 1.5초. 넘기는 규칙(고정): 한 하위 ≥ 0.85 · 둘째 ≤ 0.10 · 부모 ≤ 0.10.

## Slack 앱 확인 (봇마다)

- api.slack.com → 그 앱 → Event Subscriptions 에 `message.channels` · `app_mention` · `message.im` 이 있어야 합니다. `message.channels` 가 없으면 멘션 없는 스레드 글을 Slack 이 아예 안 보냅니다.
- 봇끼리 일을 넘기려면: 설정 `bots[].slack_bot_user_id` 에 두 봇 ID 를 모두 채웁니다(서로 허용). 봇이 쓴 글은 받는 봇을 `@이름`(멘션)으로 불러야 전달됩니다 — 사람 글과 다릅니다. 봇 사이 DM 은 안 됩니다.
- 버림 알림(기본 켬): 허용 안 된 봇이 부르거나, 허용된 봇이 멘션 없이 쓰면 그 스레드에 «전달 안 됨» 알림이 뜹니다. 끄려면 설정 `slack.drop_notice` · `slack.drop_notice_no_mention` 을 false 로 바꾼 뒤 install.sh 다시.
- 멘션 없는 봇 글 알림(`slack.drop_notice_no_mention`): 한 채널에 봇이 2개면 둘 다 켜 둬도 됩니다(알림 = 채널당 30분에 1통 이하). 봇이 3개 이상이면 받는 쪽 1~2개만 켜고 나머지는 false — 다 켜면 상대 봇의 평소 답에도 알림이 겹쳐 뜹니다.
- 위 알림은 `message.channels` 구독이 있어야 뜹니다(없으면 멘션 없는 글을 Slack 이 아예 안 보내서 알림도 못 뜸).

## 안 되는 때

- `slackmod status` 에서 토큰 `missing` → 7번.
- 다리 `없음` → `slackmod attach <봇>` 후 `Ctrl+b` `0` 으로 bridge 창의 마지막 줄 확인(토큰 · 채널 ID · 앱 초대 여부).
- 봇의 도구 호출이 모두 «확인 값이 안 맞음: pass.sh · 다시 맞추기 = …» 로 막힘 → 설치 자리의 관문 파일(`~/.slackmod/hooks/pass.sh`)이 설치 뒤 바뀐 것입니다(점검 표 [13] 칸에도 뜸). slackmod 키트 폴더(`MANIFEST.txt` 가 있는 곳 · 묶음을 푼 폴더, 공개 저장소면 그 안 `slackmod/`)에서 `bash install.sh` 를 다시 돌리면 원본으로 돌아가고 확인 값을 새로 씁니다(고친 파일은 백업 폴더에 · 저장소 맨 위 `install.sh` 를 다시 돌리면 바로 맞춰지지는 않고, 설치 마법사를 끝까지 진행하면 마지막에 이 키트 설치기를 불러 다시 맞춥니다). 고정 파일이라 저절로 되돌리지 않습니다. «권한이 느슨함» 이면 그 파일에 `chmod go-w`.
- 컴퓨터가 아주 바쁠 때 봇의 도구 호출이 가끔 «hook-timeout-or-interrupt» 로 막힘 → 도구 호출마다 앞에서 도는 관문이 시간 한도(7초)를 넘긴 것입니다(통과만 시키는 관문이어도). 다시 시도하면 됩니다 — 다음 판에서 고칩니다.
- 하위 창이 안 열림 → 봇 화면에 «spawn_child refused: …» 이유가 나옵니다. 디스크 여유가 설정 `child.min_disk_free_gb` 보다 적으면 거절합니다.
- 봇을 껐다 켠 뒤 예전 스레드에서 «already working … close_child» 로 거절 → 끄기 전 하위의 기록이 남아서입니다. 그 스레드에서 봇에게 «list_children 보고 꺼진 하위를 close_child 해 줘» 라고 하면 새로 열립니다(가만 둬도 60분 뒤 저절로 닫힘).
- 되돌리기: `slackmod stop all` → 되살릴 파일이 있으면 `~/.slackmod/backup/<시각>/` 에서 먼저 꺼내 두기(설치 전 `~/.bashrc` 사본도 여기 있고, 이 폴더도 `~/.slackmod` 안이라 마지막 단계에서 같이 지워짐) → `~/.bashrc` 의 `# >>> slackmod >>>` 칸 삭제 → `rm -rf ~/.slackmod`(토큰·판정기 키 파일도 같이 지워짐). 봇 작업 폴더(설정의 `work_dir`)는 그대로 남으니, 필요 없으면 따로 지우세요.
