---
name: slackmod-help
description: 사용자가 «무엇을 쓰면 되나요?», «이 봇이 뭘 할 수 있어?», «어떤 기능(스킬)이 있어?», «이럴 땐 뭘 써?» 처럼 쓸 기능을 물을 때 — 이 봇에 실제로 들어 있는 기능만 찾아 쉬운 말로 골라 줍니다. 일을 대신 하지 않고 «다음에 칠 말» 한 줄을 건넵니다.
---

# 무엇을 쓰면 되나요? (mod-for-slack 도움말)

이 스킬은 길잡이입니다. 사용자가 하고 싶은 일에 맞는 기능을 **이 봇에 실제로 있는 것 중에서** 골라 알려 줍니다.

## 순서
1. 하고 싶은 일이 또렷하지 않으면 보기 2~4개를 주고 하나만 묻습니다(예: «글 쓰기 · 자료 찾기 · 코드 · 표 계산 중 어느 쪽인가요?»).
2. 이 봇이 가진 기능을 **직접 확인**합니다 — 짐작으로 말하지 않습니다.
   - 이 봇 폴더의 `.claude/skills/*/SKILL.md` 와 사용자 폴더 `~/.claude/skills/*/SKILL.md` 의 맨 위 `name`·`description` 줄
   - 깔린 추가 기능(플러그인): `~/.claude/plugins/installed_plugins.json` 의 이름 목록
   - 이 봇 폴더 `.claude/rules/` 의 mod-for-slack 안내 파일(작업 폴더 · 기억)
3. 맞는 것을 1~3개만 고릅니다. 줄마다 «이름 — 무엇을 해 주나 한 줄 — 다음에 칠 말» 꼴로.
4. 맞는 것이 없으면 «지금 이 봇에는 그 일에 맞는 기능이 없습니다»라고 말하고, 설치 마법사의 추천 칸을 다시 여는 법을 알려 줍니다: 터미널에서 `bash install.sh --section recommend`(저장소 폴더) 또는 Claude Code 에서 `/mods-setup:setup --section recommend`.

## mod-for-slack 자체에 대해 물으면
- 봇 상태: 터미널 `slackmod status`
- 설치 점검 표: Claude Code 에서 `/mods-setup:setup --section doctor` 또는 설치 마법사의 점검 단계
- 방금 설치 되돌리기: `slackmod undo`(먼저 보여 줌) → `slackmod undo --yes` · 설치 뒤 손으로 고친 파일이 있으면 멈춥니다 · Slack 토큰은 그대로
- 봇 생각 깊이: `slackmod effort`(지금 값) · `slackmod set-effort <봇|all> <low|medium|high|xhigh|max|default>` → 그 봇을 껐다 켜면 적용
- 미뤄 둔 설치 칸 이어 하기: 저장소 폴더에서 `bash install.sh --resume`
- 웹 현황판(이 컴퓨터 브라우저 전용): `slackmod board start` → 처음 열 주소는 사용자가 터미널에서 `slackmod board url`(열쇠가 든 주소 — 채팅·Slack 에 옮기지 않음) · 끄기 `slackmod board stop`
- 프로젝트 방 · 작업 그래프: `slackmod room new <이름> --goal "목표 한 줄" --step "다음 일"` → `~/.slackmod/rooms/<날짜>-<이름>/01-spec.md` 의 «의존 그래프»가 현황판에 그려집니다. 일이 움직이면 그 그래프의 노드 글 맨 앞 상태(✅ 끝 · 🔄 하는 중 · ⏳ 기다림 · ❌ 막힘 · ❓ 사람 판단)를 고치고 노드(`X["⏳ 할 일"]`)·화살표(`A --> X`)를 더합니다 · 목록 `slackmod room list`

## 하지 않는 것
- 사용자가 고르지 않은 기능을 깔거나 켜지 않습니다.
- 없는 기능을 있다고 말하지 않습니다 — 확인한 파일에서 이름을 찾은 것만 말합니다.
- 토큰·비밀번호를 묻지 않습니다.
