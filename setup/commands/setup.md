---
description: mod-for-slack 설치 마법사 — 기존 설정을 가져오고, 고르고, 한 번에 설치하고, 점검하고, 토큰 넣을 터미널을 열어 줍니다
argument-hint: [--answers FILE] [--section NAME]
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, Skill
---

설치 마법사를 시작합니다. 인자: `$ARGUMENTS`

1. `mods-setup:mods-setup` 스킬을 불러 그 흐름 그대로 진행합니다(스킬이 없다고 나오면 이 플러그인의 `skills/mods-setup/SKILL.md` 를 읽어 따릅니다).
2. 인자 읽는 법
   - `--answers FILE` — 묻지 않습니다. 그 파일의 답으로 설치까지 갑니다(`--section` 과 같이 쓰지 않습니다).
   - `--section NAME` — 그 칸 하나만 다시 고릅니다. NAME 은 `mux` · `slack` · `wiki` · `mcp` · `codex` · `doctor` · `browser` · `memory` · `children` · `router` · `bots` 중 하나. 이미 설치된 `~/.slackmod/setup.json` 이 있어야 합니다.
   - 인자가 없으면 처음부터 대화로 진행합니다(감지·가져오기 → 모드 → 고르는 칸 → 봇 → 요약 → 설치 → 점검 → 터미널).
3. 사용자에게 말할 때는 쉬운 우리말로, 명령 이름·경로는 꼭 필요할 때만 보여 줍니다. 토큰·비밀번호는 절대 묻지도 받지도 않습니다(그건 마지막에 열리는 터미널에서 직접 넣습니다).
