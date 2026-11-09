# 규칙 (rules/)

봇 운영 규칙의 원본입니다. 규칙을 고칠 때는 여기를 먼저 고치고, 같은 파일을 쓰는 저장소로 옮깁니다.

| 폴더 | 무엇 | 사본이 있는 저장소 |
|---|---|---|
| `claude-code/` | Claude Code 봇 운영 규칙 14개 + `INDEX` · 채우기 안내(`FILL-IN-GUIDE`) | [ThisCode](https://github.com/treylom/ThisCode) `rules/` |
| `codex/` | Codex 봇 쪽 같은 이름의 규칙 14개(7개는 `claude-code/` 와 같은 글, 7개는 실행 방식에 맞춰 다름) + Codex 판 `INDEX` · 채우기 안내 | [ThisCodex](https://github.com/treylom/ThisCodex) `rules/` |
| `general/` | 특정 봇 이야기를 뺀 일반판 규칙 18개 + `INDEX` 예시 · `README`, 짧은 판 `compact/` 규칙 3개 + `README` | [tofu-harness](https://github.com/treylom/tofu-harness) `rules/` |

- 세 저장소는 자기 `rules/` 만으로도 쓸 수 있게 사본을 그대로 둡니다. 저장소 맨 위 안내 줄이 이곳을 가리킵니다.
- 폴더마다 `INDEX` 파일이 «이런 상황이면 이 규칙» 표입니다. `▶ Fill in` 표시가 붙은 칸은 쓰는 사람이 자기 환경 값으로 채웁니다.
- 규칙이 부르는 도구(`hooks/` · `scripts/` 아래 파일)는 이 저장소에 없고 사본 저장소에 있습니다 — 저장소마다 갖춘 도구가 다르고, 한 가지는 쓰는 사람이 자기 환경에 둡니다. 이 저장소의 `slackmod/hooks/` · `slackmod/app/mods-harness/hooks/` 는 키트 자체의 것입니다.
- 규칙 안의 `§` 숫자는 절 번호입니다. 앞에 다른 규칙 이름이 붙으면(예: `autonomy §2`) 그 파일의 절입니다.

## English

The source of the bot operating rules. Edit here first, then carry the change to the repositories that keep a copy:
`claude-code/` (14 rules + `INDEX` and a fill-in guide · copy in ThisCode), `codex/` (the same 14 for Codex bots, 7 identical and 7 adapted, + its own `INDEX` and fill-in guide · copy in ThisCodex),
`general/` (18 rules without bot-specific parts + an example `INDEX` and a `README`; 3 short ones + a `README` in `compact/` · copy in tofu-harness).
Tools the rules call (files under `hooks/` · `scripts/`) are not in this repository but in the copy repositories — each ships a different set, and one is left for you to provide in your own setup; this repository's `slackmod/hooks/` and `slackmod/app/mods-harness/hooks/` belong to the kit itself. Each folder's `INDEX` maps situations to rules; cells marked `▶ Fill in` take your own values; `§` numbers are sections — of that file, or of the rule named in front (e.g. `autonomy §2`).
