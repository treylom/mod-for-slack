# 지원 표 (미리보기)

> 아직 «확인»으로 채운 칸이 없습니다 — 직접 확인을 마치는 대로 채웁니다. «확인» = 그 환경에서 설치 → 봇 → Slack 왕복까지 직접 해 본 것. «미검증» = 아직 안 해 본 것.

| 환경 | 다중 창 도구 | 상태 | 비고 |
|---|---|---|---|
| macOS (쓰던 Mac) | tmux | 확인 예정 | 새 Mac 새 설치는 미검증 |
| macOS | cmux (안에서 tmux) | 확인 예정 | |
| macOS | herdr (안에서 tmux · 또는 herdr 탭 직접) | 확인 예정 | |
| WSL Ubuntu (Windows) | tmux | 확인 예정 | Desktop 앱의 WSL 세션에서 MOD 가 켜지는지는 확인 중입니다 — 터미널에서 실행하세요 |
| Windows + herdr | herdr 칸 → WSL → tmux | 시험 중 | |
| Linux | tmux | 컨테이너 시험 | |
| 어디서나 | Orca | 시험 중 · 따로 설정 | Orca 의 «가짜 tmux» 모드에서는 하위 창이 안 열립니다 |

- Claude Code 판: 설치기가 고정판과 다르면 경고만 하고 계속합니다.
- 로그인: 설치 끝에 열리는 터미널에서 `/login` 을 한 번 하세요(점검 표 «로그인» 칸).
- 처음 켤 때 봇 창의 확인 화면: ① 폴더 신뢰 ② 권한 건너뛰기 경고 — 둘 다 처음 한 번만 묻고, 커서가 «No, exit» 에 있어 그냥 Enter 하면 봇이 꺼집니다. `slackmod attach <봇 이름>` 으로 들어가 아래 화살표로 «Yes» → Enter. ③ 개발 채널 확인 — 켤 때마다 묻고, `slackmod start` 가 «로컬 개발 용도»로 대신 고릅니다(대신 고르지 않기: `SLACKMOD_NO_AUTO_DEVCHANNEL=1`). 봇 폴더에 직접 넣어 둔 MCP 서버(`.mcp.json`)가 있으면 «New MCP server found» 승인 화면도 뜹니다 — 쓰려면 위 화살표로 «Use this MCP server» → Enter(그냥 Enter = 그 서버 없이 계속). 마법사에서 고른 브라우저 서버(playwright)는 설치 때 미리 승인해 둡니다. 봇이 켜졌는데 답이 없으면 점검 표 «봇 켜짐» 칸이 이 경우를 알려 줍니다.
- 컴퓨터를 다시 켠 뒤: 봇은 저절로 안 켜집니다 — `slackmod start all` 한 번(꺼질 때 남은 다리 기록 파일은 키트가 치움). 그때 돌던 하위 세션은 끝나고 그 스레드의 새 글은 봇 본 창이 받습니다 · 세션 안에 걸어 둔 예약은 다시 걸어야 합니다.
- Slack·Discord 같은 채팅 연결(Claude Code «채널» 기능)은 **claude.ai 계정 로그인 또는 Console API 키**일 때만 켜집니다. Bedrock · Google Cloud(Vertex) · Foundry 로그인이나 대리 서버를 거치는 로그인에서는 봇이 채팅 글을 받지 못합니다. Team·Enterprise 조직은 조직 Owner 가 «Organization settings → Claude Code → Channels» 를 켜야 합니다. 점검 표 «채널 기능» 칸이 이 경우를 알려 줍니다.
