---
name: mods-doctor
description: 설치한 Slack 봇의 상태를 읽기만 하는 점검 스크립트로 보고, 칸마다 쉬운 말로 풀어 준다(창 도구 · Claude 로그인 · Slack 토큰 · 성격 점검 · Slack 왕복 · 봇 초대 실패 3갈래 · 켜짐 상태 · 채널 기능 꺼짐 외). 고치기는 사람이 고른 것만 하고 자동으로 고치지 않는다. 부르는 말 — "상태 점검", "봇 점검", "봇 상태 봐 줘", "봇이 답을 안 해", "봇이 대답이 없어", "Slack 이 안 붙어", "Slack 글이 봇에 안 들어와", "Channels are not currently available", "봇을 채널에 초대할 수 없어", "앱 설치가 안 돼", "설치 잘 됐는지 봐 줘", "doctor".
---

# 상태 점검 (mods-doctor)

봇이 답을 안 하거나 Slack 이 안 붙을 때, 무엇이 막혔는지 **읽기만 해서** 찾는다. 이 스킬은 아무것도 고치지 않는다. 찾은 것을 쉬운 말로 풀고, 고칠 길을 사람이 고르게 할 뿐이다.

## 1. 점검 돌리기

스크립트 자리(위에서부터 처음 있는 것):

1. `${CLAUDE_PLUGIN_ROOT}/lib/doctor.sh` (마법사 플러그인 폴더)
2. 이 SKILL.md 가 있는 폴더에서 두 단계 위의 `lib/doctor.sh` (이 스킬을 불러올 때 보이는 «Base directory for this skill» 기준)

```bash
bash "<위에서 찾은 doctor.sh>"
```

- 인자 없이 돌린다. 끝 코드는 언제나 0 이다. `--strict` 는 사람이 끝 코드를 원할 때만(0 = 주의 · 실패 없음 · 1 = 주의 또는 실패 있음 · 2 = 점검 못 함).
- 쓰기 · 끄기 · 고치기를 하지 않고, 토큰 값을 찍지 않는다. Slack 에는 읽기 호출 둘(`auth.test` · 채널 글 한 줄 읽기)만 보낸다. 출력은 그대로 사람에게 보여 줘도 된다.
- 스크립트가 안 보이면: «점검 스크립트가 안 보입니다 — 설치 묶음의 setup/lib 폴더를 알려 주세요» 라고 묻는다(스크립트를 새로 지어 내지 않는다).

## 2. 출력 읽는 법

```
상태 점검 · 2026-10-24 17:20 · Darwin · 읽기만(쓰기·끄기·고치기 0)
OK · [1] 창 도구 있음: tmux 3.x(정식) · 할 것 없음 …
실패 · [6] 봇 초대 실패: alpha ③ 손님 계정·채널 제한 — 봇이 그 채널에 없음(not_in_channel) … · 채널에서 /invite 로 봇 초대 …
건너뜀 · [10] WSL 이 아님(Darwin) — Windows 쪽 확인할 것 없음 · 해당 없음
…
할 일 · 사람이 할 1가지: 시험 채널에 봇을 부르는 글 1개 …
요약: OK 10 · 주의 1 · 실패 1 · 건너뜀 1
```

한 줄 = 한 칸 = `OK|주의|실패|건너뜀 · [번호] 무엇 · 고칠 1줄`. 맨 끝 «요약:» 네 수를 더하면 언제나 13(칸 수)이다. **건너뜀** 은 해당 없음이거나 앞 칸이 막혀 볼 수 없다는 뜻이고, 이유가 줄에 적혀 있다.

## 3. 칸마다 쉬운 말

| 칸 | 무엇을 보나 | 실패 · 주의일 때 쉬운 말 | 고칠 길(사람이 고름) |
|---|---|---|---|
| [1] 창 도구 | tmux(정식) · cmux · herdr · Orca 가 있는지 | tmux 가 없으면 봇을 켤 수 없다. herdr 만 있으면 그 탭에서는 켜지만 기본 길은 tmux. Orca 안에서는 하위 세션이 안 열린다(시험 중 · 따로 설정) | tmux 설치 한 줄 · Orca 는 밖의 일반 터미널에서 tmux 로 켜기 |
| [2] Claude 로그인 | 이 컴퓨터의 Claude 로그인 · API 키가 걸려 있는지 | 로그인이 없으면 봇이 생각을 못 한다. API 키가 걸려 있으면 쓴 만큼 돈이 나갈 수 있다 | 터미널에서 `claude` → `/login` 1회 · API 키는 사람이 고르기 |
| [3] Slack 토큰 | 봇마다 토큰 2개(xoxb · xapp)가 있는지 · 두 봇이 같은 앱을 쓰는지 | 토큰이 없으면 다리가 못 붙는다. 같은 앱이면 메시지가 갈린다 | 사람이 터미널에서 `slackmod set-token 봇이름`(화면에 안 보임 · 채팅에 붙이지 않기) |
| [4] 성격 점검 | 봇 폴더의 성격 파일이 점검(persona-check)을 통과하는지 | 남은 자리표시자 · 비밀값 · 비어 있는 칸 · 너무 긴 글이 있다. 비밀값이면 실패 | 점검이 알려 준 칸만 인터뷰로 다시(bot-interview) |
| [5] Slack 왕복 | 토큰으로 Slack 에 물어봤을 때 살아 있는지(`auth.test`) | 토큰이 틀리거나 막혔거나 인터넷이 안 닿는다 | `slackmod set-token 봇이름` 뒤 껐다 켜기 · 인터넷 확인 |
| [6] 봇 초대 실패 3갈래 | 그 채널이 보이고 봇이 들어 있는지(채널 글 한 줄 읽기) | 아래 표 | 아래 표 |
| [7] 밖 Slack 다리 | 설치 밖에서 켠 Slack 다리(예전 봇 창)가 도는지 | 같은 Slack 앱을 두 군데서 켜면 Slack 이 메시지를 둘로 나눠 보내 한쪽이 못 받는다 | 예전 방식 봇 창 닫기 · 다른 앱이 확실하면 그대로 |
| [8] 옛 ThisCode 훅 · 다른 채널 플러그인 | 설정 파일에 예전 훅 줄(bot-only)이 남았는지 · ThisCode 플러그인이 켜졌는지 · 텔레그램·디스코드 같은 다른 채널 플러그인이 봇에도 켜졌는지 | 화면의 «bot-only.sh: No such file» 오류가 옛 훅이다(봇 동작은 막지 않지만 매번 뜬다). 다른 채널 플러그인이 봇에도 켜지면 기존 봇과 같은 토큰을 다툰다(텔레그램은 기존 연결이 끊김) | 설정 파일을 백업한 뒤 그 줄 지우기 · `/plugin` 에서 끄기 · 일부러 쓰는 채널이면 설정의 그 봇 `extra_channels` 에 넣고 install 다시 · 아니면 그 봇 폴더 `.claude/settings.local.json` 에서 끄기 |
| [9] 봇 켜짐 · 창 · 연결 | 봇마다 켜짐 · bridge 창 · main 창 · 다리 기록의 마지막 연결 줄 | 꺼짐 = 아직 안 켬. 창이 빠지면 반쯤 꺼짐. «invalid_auth» = 토큰이 틀림. «socket disconnected» = Slack 과 끊김 | `slackmod start 봇이름` · 반쯤 꺼짐은 stop 뒤 start · 토큰 틀림은 set-token 뒤 다시 켜기 |
| [10] Windows 쪽 | WSL 이면 Windows 쪽에서 같은 봇이 켜져 있는지 | [7] 과 같은 갈림, Windows 쪽에서 | Windows 쪽 봇 창 닫기 |
| [11] 예약 목록 | 맥 예약 목록을 읽을 수 있는지 | 리눅스 · WSL 에서 Mod 화면의 빨간 «예약 · 읽기 실패» 줄은 표시만의 오류 | 할 것 없음 |
| [12] 채널 기능 | Slack 글이 봇에 들어오는 길(Claude 의 «채널» 기능)이 꺼질 만한 원인이 있는지 | 아래 «④ 채널 기능 꺼짐» 표 | 아래 표 |
| [13] 관문 파일 확인 값 | 설치한 관문 파일(`pass.sh`)이 설치 뒤 바뀌었는지 · 권한이 느슨한지 | 바뀌거나 없으면 봇의 도구 호출이 모두 막힌다(«확인 값이 안 맞음» · «고정 파일이 없음») | slackmod 키트 폴더(`MANIFEST.txt` 있는 곳 · 공개 저장소면 그 안 `slackmod/`)에서 `bash install.sh` 다시 · «권한이 느슨함» 이면 그 파일에 `chmod go-w` |

### 채널 기능이 꺼지는 경우 ([12] 칸 · 줄에 «④ 채널 기능 꺼짐» 으로 나온다)

봇 시작 화면에 «--dangerously-load-development-channels ignored · Channels are not currently available» 가 뜨면 Slack 글이 봇에 들어오지 않는다. 읽는 것은 변수 이름과 설정 파일뿐이고 값(열쇠 · 주소)은 읽지도 찍지도 않는다.

| 이렇게 보일 때 | 판정 | 쉬운 말 | 고칠 길 |
|---|---|---|---|
| 조직 관리 설정(맥 `/Library/Application Support/ClaudeCode/managed-settings.json` 과 같은 자리의 `managed-settings.d/*.json` · 리눅스 `/etc/claude-code/`)에서 `channelsEnabled` 가 false | 실패 | 조직 관리자가 채널을 꺼 두었다(개발용 플래그도 막힌다) | 조직 Owner 에게 켜 달라고 요청(Team/Enterprise: Organization settings > Claude Code > Channels) |
| 환경 변수 · 창 도구 전역 환경 · 설정 파일 env 에 `CLAUDE_CODE_USE_BEDROCK` · `CLAUDE_CODE_USE_VERTEX` · `CLAUDE_CODE_USE_FOUNDRY` 중 하나 | 실패 | 이 로그인 방식에서는 채널이 안 된다(채널은 claude.ai 로그인 또는 Console API 키에서만) | 그 변수를 빼고 claude.ai 로그인으로 |
| 같은 곳에 `ANTHROPIC_AUTH_TOKEN` · `ANTHROPIC_BASE_URL` | 주의 | 중계 · 대리 로그인이면 채널이 꺼질 수 있다 | claude.ai 로그인 권장: 그 변수를 빼고 `/login` 1회 |
| 다리 기록이나 봇 화면에 «Channels are not currently available» 또는 «development-channels ignored» | 실패 | 이미 꺼진 채로 떴다는 흔적 | 위 원인을 고친 뒤 `slackmod stop 봇이름 ; slackmod start 봇이름` |

- 정상인데 헷갈리기 쉬운 줄: 봇 시작 화면에 «server:slack-channel · no MCP server configured with that name» 와 «restart without --dangerously-load-development-channels to stop» 이 보여도 정상이다(Slack 글이 들어오고 봇이 답하면 무시). 이 줄들은 «꺼짐» 으로 세지 않는다.
- Pro/Max 개인 계정은 조직 검사가 없다. Team/Enterprise 는 Owner 가 조직 설정에서 채널을 켜야 하는데, 이 값은 여기서 읽을 수 없어서 OK 줄에 «여기서는 못 읽음» 이라고 적는다.

### 봇 초대 실패 3갈래 ([6] 칸)

봇이 채널에 못 들어가는 이유는 세 갈래다. 줄에 ① ② ③ 중 어느 갈래인지가 적힌다.

판정은 표준 매니페스트 권한만으로 되는 두 호출을 차례로 본다: ① 토큰이 있나 → ② `auth.test` → ③ 채널 글 한 줄 읽기(`conversations.history` limit 1). 갈래를 가르는 기준은 아래 표가 전부다.

| 갈래 | 이렇게 보일 때 | 쉬운 말 | 고칠 길 |
|---|---|---|---|
| ① 다른 워크스페이스 | 글 읽기가 `channel_not_found` | 이 채널 ID 는 봇의 워크스페이스(줄에 그 ID 가 나온다)에서 안 보인다. 채널이 다른 워크스페이스에 있거나, 비공개 채널에 아직 초대 전이다 | 앱을 그 워크스페이스에 설치했는지 · 채널 링크의 워크스페이스가 같은지 확인 · 비공개 채널이면 먼저 초대 |
| ② 관리자 승인 대기 | 봇 토큰이 없음(빈칸 포함), 또는 `auth.test` 가 `invalid_auth` · `token_revoked` · `account_inactive` | 앱이 워크스페이스에 아직 설치되지 않았거나 승인 대기다(설치 취소 · 승인 철회 포함). `auth.test` 로 걸린 경우는 «토큰을 다시 받으세요» 가 붙는다 | 관리자에게 앱 승인 요청 → 승인 뒤 OAuth 화면의 Bot Token 을 `slackmod set-token 봇이름` 으로 |
| ③ 손님 계정·채널 제한 | 글 읽기가 `not_in_channel`, 또는 `ekm_access_denied` · `restricted_action` | 봇이 채널에 없다(`not_in_channel`). 손님 계정(멀티/싱글 채널 게스트)은 앱을 초대할 수 없다. 뒤의 둘은 워크스페이스 정책이 앱의 이 채널 접근을 막는 경우(조직 정책 제한) | `/invite @봇` · 손님 계정이면 정회원이 초대 · 정책 제한이면 워크스페이스 관리자에게 문의 |

- `missing_scope` 는 갈래가 아니라 «매니페스트 권한 부족» 으로 따로 나온다(앱 권한에 channels:history 가 없음 · 비공개 채널은 groups:history). 매니페스트를 갱신해 재설치한 뒤 토큰을 다시 넣는다.
- ② 는 «꼴» 이다(토큰이 없거나 인증이 거부되는 모양으로 추정). 실제로 승인 대기인지는 Slack 앱 설정 화면에서 확인해야 한다.
- `auth.test` 가 그 밖의 오류(예: 요청이 너무 많음)를 주면 갈래를 짚지 않고 [5] 칸이 그 오류를 말한다.

## 4. 고치기 규칙 (자동 고침 없음)

1. 문제 칸마다 고칠 길을 번호로 보여 주고, **사람이 고르게** 한다. 고르기 전에는 아무것도 바꾸지 않는다.
2. 사람이 고른 한 가지만 한다. 명령은 사람이 직접 치게 하거나, 사람이 «네, 해 주세요» 라고 한 그 한 줄만 돌린다. 한 번에 하나.
3. 고친 뒤에는 점검을 다시 돌려 그 칸이 OK 가 됐는지 보여 준다.
4. 하지 않는 것:
   - 토큰이나 `.env` 내용 보기(`cat .env` 금지) · 채팅으로 토큰 받기. 토큰은 사람이 `slackmod set-token` 으로만 넣는다.
   - 설정 파일(`~/.claude/settings.json`)을 사람이 고르기 전에 고치기 · 백업 없이 고치기.
   - 프로세스를 마음대로 끄기. `slackmod stop all` 을 사람이 안 골랐는데 돌리기.
   - Slack 앱 설정 화면에서 대신 눌러 주기(앱 승인 요청은 사람이 하거나, 사람이 허락한 방법으로만).

## 5. 답하는 꼴

- 첫 줄 = 결론 한 문장(예: «봇 두 개 중 alpha 이 채널에 초대되지 않아서 alpha 만 글을 못 받습니다»).
- 그다음 = 주의 · 실패 칸만, 칸마다 쉬운 말 한두 줄 + 고칠 길 번호. OK 칸은 «나머지 칸은 정상» 한 줄로 접는다. 건너뜀 칸은 이유가 중요할 때만 한 줄.
- 끝 = «할 일» 줄 그대로: 시험 채널에 봇을 부르는 글 하나 → 눈(👀) · 확인(✅) 반응이 붙고 답이 오면 끝.
- 점검 출력 원문은 사람이 원하면 그대로 붙여 준다(토큰 값은 들어 있지 않다).
