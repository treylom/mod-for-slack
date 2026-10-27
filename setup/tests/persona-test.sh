#!/usr/bin/env bash
# persona-test.sh — persona-fill + persona-check: bait that must be caught (each RED, then GREEN once fixed) and clean input that must pass.
#   bash setup/tests/persona-test.sh
#   PERSONA_CHECK=/path/to/mutant.py bash setup/tests/persona-test.sh     (the mutation runner swaps the checker)
# rc 0 = every case behaved · 1 = at least one did not. Writes only under a mktemp dir; HOME is a throwaway one.
# Secret-shaped and trace-shaped bait is assembled from pieces here, so this file never holds one whole.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CHECK="${PERSONA_CHECK:-$ROOT/setup/lib/persona-check.py}"
FILL="${PERSONA_FILL:-$ROOT/setup/lib/persona-fill.py}"
SCAN="$ROOT/port/scan-traces.sh"
TABLE="${PERSONA_TABLE:-$ROOT/port/lib/traces.tsv}"
PY="${PYTHON:-python3}"
T="$(mktemp -d "${TMPDIR:-/tmp}/persona-test.XXXXXX")"
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
export PERSONA_CHECK_TABLE="$TABLE"
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; [ -n "${FAILFAST:-}" ] && { printf '\n합계: PASS %d · FAIL %d (FAILFAST: stopped at the first failing case)\n' "$PASS" "$FAIL"; exit 1; }; return 0; }
OUT=""; RC=0
chk() { OUT="$("$PY" -I "$CHECK" "$@" 2>&1)"; RC=$?; }
has() { grep -qF -- "$1" <<<"$OUT"; }
# want <label> <rc> [fixed text that must appear] — judged on the last chk
want() {
  local label="$1" rc="$2" s; shift 2
  if [ "$RC" != "$rc" ]; then bad "$label (rc $RC, want $rc)"; printf '%s\n' "$OUT" | sed 's/^/        /'; return; fi
  for s in "$@"; do has "$s" || { bad "$label (output lacks: $s)"; printf '%s\n' "$OUT" | sed 's/^/        /'; return; }; done
  ok "$label"
}
absent() { # absent <label> <text> — judged on the last chk
  if has "$2"; then bad "$1 (text leaked into output)"; else ok "$1"; fi
}
repl() { # repl <file> <old> <new> — exact, once; the test fails loudly when <old> is not there
  "$PY" -I - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1:4]
s = open(p, encoding='utf-8').read()
if old not in s:
    sys.exit('repl: text not found: ' + old)
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
EOF
  [ $? -eq 0 ] || bad "setup: repl failed on $1"
}
addline() { printf '%s\n' "$2" >> "$1"; }
dropline() { grep -vF -- "$2" "$1" > "$1.tmp"; mv "$1.tmp" "$1"; }
fresh() { rm -rf "$T/case/$1"; mkdir -p "$T/case"; cp -R "$T/bots/$2" "$T/case/$1"; }

# ── 1. raw skeletons: stubs by design → rc 1, and only the placeholder column ───────────────────────────────────────
for r in lead watch research; do
  chk --require-table "$ROOT/setup/templates/roles/$r"
  want "raw skeleton $r → rc 1 자리표시자" 1 "걸림 · 자리표시자 · persona.md:" "<BOT_NAME>" "<TONE>"
  n="$(grep '^걸림' <<<"$OUT" | grep -vc '자리표시자')"
  [ "$n" = 0 ] && ok "raw skeleton $r: only 자리표시자" || bad "raw skeleton $r: a column other than 자리표시자 fired"
done
chk --require-table "$ROOT/setup/templates/custom"
want "raw skeleton custom → rc 1 (+ <ROLE_LINE>)" 1 "<ROLE_LINE>"

# ── 2. fill from an answers file (what the interview skill does), then the check must pass ──────────────────────────
cat > "$T/answers.json" <<EOF
{"schema": 1,
 "anchors": {"A": "주 10시간 보고서 쓰기, 주 5시간 회의 정리", "B": "회의 녹취를 받아 요약하고 메일로 보냄", "C": "녹취를 손으로 옮겨 적는 일이 제일 지겹다",
             "D": "매주 월요일 주간 요약", "E": "폴더와 메모 앱에 흩어져 있어 못 찾아 다시 만든 적 있음", "F": "회의 뒤 요약이 알아서 올라와 있는 것"},
 "bots": [
  {"name": "chief", "role": "lead", "tone": "차분한 존댓말, 결론 먼저", "signature": "— chief", "boundary": ["결제와 관련된 일은 하지 않는다"], "dir": "$T/bots/chief"},
  {"name": "clock", "role": "watch", "tone": "", "dir": "$T/bots/clock"},
  {"name": "finder", "role": "research", "tone": "근거부터 말하는 존댓말", "dir": "$T/bots/finder"},
  {"name": "helper", "role": "custom", "role_line": "문서 정리를 돕는 봇이다.", "role_details": ["표 형식 맞추기", "제목 규칙 지키기"], "tone": "친근한 존댓말", "dir": "$T/bots/helper"}
 ]}
EOF
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/answers.json" 2>&1)"; RC=$?
want "fill: rc 0 · 9 writes (profile + 4 bots x 2)" 0 "결과: 바뀜 9 · 그대로 0 · 건너뜀 0"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/answers.json" 2>&1)"; RC=$?
want "fill again: 바뀜 0 (idempotent)" 0 "결과: 바뀜 0 · 그대로 9 · 건너뜀 0"
[ "$(stat -c %a "$HOME/.slackmod/USER-PROFILE.md" 2>/dev/null || stat -f %Lp "$HOME/.slackmod/USER-PROFILE.md")" = 600 ] && ok "profile file mode 600" || bad "profile file mode"
grep -q 'completeness: full' "$HOME/.slackmod/USER-PROFILE.md" && grep -q 'schema_version: user-profile-v1' "$HOME/.slackmod/USER-PROFILE.md" && ok "profile front matter" || bad "profile front matter"
for b in chief clock finder helper; do
  chk --require-table "$T/bots/$b"
  want "filled $b → rc 0" 0 "결과: 통과 · 점검한 파일 2개"
done
grep -q '## 사용자 컨텍스트' "$T/bots/chief/persona.md" && grep -q '녹취를 손으로 옮겨' "$T/bots/chief/persona.md" && ok "user context lines in persona" || bad "user context lines in persona"
grep -q -- '6. 끝 서명: — chief' "$T/bots/chief/persona.md" && ok "signature filled in the capsule (chief)" || bad "signature filled in the capsule"
grep -q -- '- 보고 · 완료 글 끝 서명: — chief' "$T/bots/chief/persona.md" && ok "signature filled in the voice section (chief)" || bad "signature filled in the voice section"
grep -q '끝 서명' "$T/bots/finder/persona.md" && bad "empty signature left a line (finder)" || ok "empty signature → no signature line"
grep -q '결제와 관련된 일은 하지 않는다' "$T/bots/chief/persona.md" && ok "extra boundary added" || bad "extra boundary added"
grep -q '시각과 숫자부터' "$T/bots/clock/persona.md" && ok "empty tone → role default (watch)" || bad "role default tone"
grep -q '표 형식 맞추기' "$T/bots/helper/persona.md" && grep -q '문서 정리를 돕는 봇이다' "$T/bots/helper/persona.md" && ok "custom role line + details" || bad "custom role line"
bash "$SCAN" "$T/bots" > "$T/scan.out"; rc=$?
[ "$rc" = 0 ] && ok "scan-traces on the filled bot folders = 0" || { bad "scan-traces on filled folders (rc $rc)"; cat "$T/scan.out"; }

# fill: a file that is not ours stays; --force saves a copy first
mkdir -p "$T/foreign"; printf 'my own notes\n' > "$T/foreign/CLAUDE.md"
cat > "$T/ans-one.json" <<EOF
{"schema": 1, "bots": [{"name": "solo", "role": "lead", "dir": "$T/foreign"}]}
EOF
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/ans-one.json" 2>&1)"; RC=$?
want "fill: foreign CLAUDE.md left alone → rc 3" 3 "건너뜀(이미 있는 파일이고 이 도구가 만든 것이 아님" "결과: 바뀜 1 · 그대로 1 · 건너뜀 1"
[ "$(cat "$T/foreign/CLAUDE.md")" = "my own notes" ] && ok "foreign file untouched" || bad "foreign file untouched"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/ans-one.json" --force 2>&1)"; RC=$?
want "fill --force → rc 0" 0 "결과: 바뀜 1 · 그대로 2 · 건너뜀 0"
ls "$T/foreign" | grep -q '^CLAUDE.md.bak-' && ok "--force kept a .bak copy" || bad "--force .bak copy"
# fill: input errors → rc 2
printf '{"schema": 1, "bots": [{"name": "Bad_Name", "role": "lead", "dir": "%s/x1"}]}\n' "$T" > "$T/bad1.json"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/bad1.json" 2>&1)"; RC=$?; want "fill: bad name → rc 2" 2 "bots[0].name"
printf '{"schema": 1, "bots": [{"name": "okbot", "role": "boss", "dir": "%s/x1"}]}\n' "$T" > "$T/bad2.json"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/bad2.json" 2>&1)"; RC=$?; want "fill: bad role → rc 2" 2 "bots[0].role"
printf '{"schema": 1, "bots": [{"name": "twin", "role": "lead", "dir": "%s/x1"}, {"name": "twin", "role": "watch", "dir": "%s/x3"}]}\n' "$T" "$T" > "$T/bad6.json"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/bad6.json" 2>&1)"; RC=$?; want "fill: two bots with one name → rc 2" 2 "이름이 겹침"
printf '{"schema": 1, "bots": [{"name": "okbot", "role": "custom", "dir": "%s/x1"}]}\n' "$T" > "$T/bad3.json"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/bad3.json" 2>&1)"; RC=$?; want "fill: custom without role_line → rc 2" 2 "role_line"
[ ! -e "$T/x1" ] && ok "fill: nothing written on input error" || bad "fill: wrote on input error"
printf '{"schema": 1, "bots": [{"name": "okbot", "role": "lead", "tone": "a\\u0007b", "dir": "%s/x1"}]}\n' "$T" > "$T/bad4.json"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/bad4.json" 2>&1)"; RC=$?; want "fill: control character in an answer → rc 2" 2 "제어 문자"
"$PY" -I -c 'import json,sys; print(json.dumps({"schema":1,"bots":[{"name":"okbot","role":"lead","tone":"가"*300,"dir":sys.argv[1]+"/x1"}]}))' "$T" > "$T/bad5.json"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/bad5.json" 2>&1)"; RC=$?; want "fill: over-long tone → rc 2" 2 "상한"
printf '{"schema": 1, "bots": [{"name": "okbot", "role": "lead", "tone": "<TONE> <BOT_NAME>", "dir": "%s/x2"}]}\n' "$T" > "$T/ans-inj.json"
OUT="$("$PY" -I "$FILL" --templates "$ROOT/setup/templates" --answers "$T/ans-inj.json" 2>&1)"; RC=$?; want "fill: answer text that looks like a placeholder is written as it is" 0
chk --require-table "$T/x2"; want "… and the check catches it afterwards (rc 1)" 1 "걸림 · 자리표시자"

# ── 3. the three bait kinds from the brief: each RED, then GREEN after the fix ───────────────────────────────────────
# 3a. placeholder
fresh ph chief; repl "$T/case/ph/persona.md" "차분한 존댓말, 결론 먼저" "<TONE>"
chk --require-table "$T/case/ph"; want "bait placeholder → rc 1" 1 "걸림 · 자리표시자" "<TONE>" "말투 칸만 다시 묻고"
repl "$T/case/ph/persona.md" "<TONE>" "짧게 말한다"
chk --require-table "$T/case/ph"; want "bait placeholder fixed → rc 0" 0
fresh ph2 chief; addline "$T/case/ph2/CLAUDE.md" "- 담당자: <담당자 이름>"
chk --require-table "$T/case/ph2"; want "bait generic stub <담당자 이름> → rc 1" 1 "걸림 · 자리표시자 · CLAUDE.md:"
# 3b. secret shapes (assembled): value never printed
i=0
for s in "xo""xb-1234567890-ABCDEFGHIJKL" "xa""pp-1-A0123456789-abcdefghijkl" "sk-""ant-api03-abcdefghijklmnop" "sk-""ant-abcdefghijk" "sk-""abcdefghijklmnopqrstuvwx" "gh""p_abcdefghijklmnopqrstuvwxyz0123" "AK""IAABCDEFGHIJKLMNOP" "-----BEGIN RSA PRIV""ATE KEY-----" "github""_pat_abcdefghijklmnopqrstuvwxyz" "AI""zaSyA-abcdefghijklmnopqrstuvwxyz0123456"; do
  i=$((i + 1)); fresh sec$i chief; addline "$T/case/sec$i/persona.md" "메모: $s"
  chk --require-table "$T/case/sec$i"; want "bait secret shape #$i → rc 1 비밀값" 1 "걸림 · 비밀값 · persona.md:"
  absent "bait secret shape #$i: value not printed" "$s"
  # the same bait with no trace table at all: the built-in shapes alone must catch it (the bundle ships without the table)
  OUT="$(PERSONA_CHECK_TABLE="$T/none.tsv" "$PY" -I "$CHECK" "$T/case/sec$i" 2>&1)"; RC=$?
  want "bait secret shape #$i without any table → rc 1 비밀값" 1 "걸림 · 비밀값 · persona.md:"
  dropline "$T/case/sec$i/persona.md" "메모: $s"
  chk --require-table "$T/case/sec$i"; want "bait secret shape #$i fixed → rc 0" 0
done
fresh sec-claude chief; addline "$T/case/sec-claude/CLAUDE.md" "xo""xb-9876543210-ZYXWVUTSRQPO"
chk --require-table "$T/case/sec-claude"; want "bait secret in CLAUDE.md → rc 1" 1 "걸림 · 비밀값 · CLAUDE.md:"
# 3c. trace shape — real table (generic shapes assembled), then a synthetic table (class flags i / R)
fresh tr1 chief; addline "$T/case/tr1/persona.md" "채널 C0""ABCDEF123 에서 받는다"
chk --require-table "$T/case/tr1"; want "bait trace (id shape, real table) → rc 1" 1 "걸림 · 흔적 · persona.md:" "SLACKID"
absent "bait trace: matched text not printed" "C0""ABCDEF123"
dropline "$T/case/tr1/persona.md" "ABCDEF123"
chk --require-table "$T/case/tr1"; want "bait trace fixed → rc 0" 0
fresh tr2 chief; addline "$T/case/tr2/persona.md" "ts 17926""28169.376549 기준"
chk --require-table "$T/case/tr2"; want "bait trace (message number shape) → rc 1" 1 "걸림 · 흔적 ·"
printf 'ZTEST\ti\tzq-trace-[0-9]+\tx\nZSEC\tR\tzq-secret-[0-9]+\tx\n' > "$T/fake.tsv"
fresh tr3 chief; addline "$T/case/tr3/persona.md" "see ZQ-Trace-42 here"
chk --table "$T/fake.tsv" "$T/case/tr3"; want "synthetic table row (flag i) → rc 1 흔적 ZTEST" 1 "걸림 · 흔적 ·" "ZTEST"
fresh tr4 chief; addline "$T/case/tr4/persona.md" "see zq-secret-777 here"
chk --table "$T/fake.tsv" "$T/case/tr4"; want "synthetic table R row → rc 1 비밀값" 1 "걸림 · 비밀값 ·"
absent "synthetic R row: value not printed" "zq-secret-777"
fresh tr5 chief
chk --table "$T/fake.tsv" "$T/case/tr5"; want "synthetic table, clean bot → rc 0" 0

# ── 4. table missing: visible note (rc 0) vs --require-table (rc 1) ─────────────────────────────────────────────────
fresh nt chief
OUT="$(PERSONA_CHECK_TABLE="$T/none.tsv" "$PY" -I "$CHECK" "$T/case/nt" 2>&1)"; RC=$?
want "no table: rc 0 + 참고 line" 0 "참고 · 흔적 점검표(traces.tsv)가 없어 흔적 칸은 건너뜀"
OUT="$(PERSONA_CHECK_TABLE="$T/none.tsv" "$PY" -I "$CHECK" --require-table "$T/case/nt" 2>&1)"; RC=$?
want "no table + --require-table: rc 1 흔적" 1 "걸림 · 흔적 · 흔적 점검표(traces.tsv)를 못 읽음"
chk --table "$T/none.tsv" "$T/case/nt"; want "explicit --table that does not exist: rc 2" 2 "점검표를 못 찾음"
printf 'BAD\t-\t[unclosed\tx\n' > "$T/broken.tsv"
chk --table "$T/broken.tsv" "$T/case/nt"; want "table with a broken pattern: rc 2" 2 "패턴을 읽을 수 없음"

# ── 5. required fields ───────────────────────────────────────────────────────────────────────────────────────────────
fresh rq1 chief; rm "$T/case/rq1/persona.md"
chk --require-table "$T/case/rq1"; want "no persona.md → rc 1 파일" 1 "걸림 · 파일 · persona.md 가 없음"
fresh rq2 chief; "$PY" -I - "$T/case/rq2/persona.md" <<'EOF'
import re, sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
s = re.sub(r'## 말투\n.*?\n## ', '## ', s, count=1, flags=re.S)
open(p, 'w', encoding='utf-8').write(s)
EOF
chk --require-table "$T/case/rq2"; want "## 말투 section gone → rc 1 말투" 1 "걸림 · 말투 · ## 말투 절이 없음"
fresh rq3 chief; "$PY" -I - "$T/case/rq3/persona.md" <<'EOF'
import re, sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
s = re.sub(r'## 경계\n.*', '## 경계\n\n', s, count=1, flags=re.S)
open(p, 'w', encoding='utf-8').write(s)
EOF
chk --require-table "$T/case/rq3"; want "## 경계 section empty → rc 1 경계" 1 "걸림 · 경계 · ## 경계 절이 비어 있음"
fresh rq4 chief; repl "$T/case/rq4/persona.md" "name: chief" "name: Chief_Bot"
chk --require-table "$T/case/rq4"; want "bad name shape → rc 1 이름" 1 "걸림 · 이름 · 이름이 규칙"
fresh rq5 chief; repl "$T/case/rq5/persona.md" "name: chief" "name:"
chk --require-table "$T/case/rq5"; want "name missing → rc 1 이름" 1 "걸림 · 이름 · persona.md 머리말(맨 위 --- 두 줄 사이)에 name 이 없음"
fresh rq6 chief; repl "$T/case/rq6/persona.md" "role: lead" "role:"
chk --require-table "$T/case/rq6"; want "role missing → rc 1 역할" 1 "걸림 · 역할 · "
fresh rq7 chief; "$PY" -I - "$T/case/rq7/persona.md" <<'EOF'
import re, sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
s = re.sub(r'## 역할\n.*?\n## ', '## 역할\n\n## ', s, count=1, flags=re.S)
open(p, 'w', encoding='utf-8').write(s)
EOF
chk --require-table "$T/case/rq7"; want "## 역할 section empty → rc 1 역할" 1 "걸림 · 역할 · ## 역할 절이 없거나 비어 있음"
fresh rq8 chief; repl "$T/case/rq8/CLAUDE.md" "@persona.md" "persona.md 를 읽어라"
chk --require-table "$T/case/rq8"; want "CLAUDE.md without @persona.md → rc 1 연결" 1 "걸림 · 연결 · CLAUDE.md 가 persona.md 를 부르지 않음"
fresh rq9 chief; rm "$T/case/rq9/CLAUDE.md"
chk --require-table "$T/case/rq9"; want "no CLAUDE.md → rc 1 파일" 1 "걸림 · 파일 · CLAUDE.md 가 없음"
fresh rq10 chief; repl "$T/case/rq10/persona.md" "role: lead" "role: <ROLE>"
chk --require-table "$T/case/rq10"; want "role stub reported once, as placeholder (no double 역할 line)" 1 "걸림 · 자리표시자 ·"
has '걸림 · 역할' && bad "role stub double-reported" || ok "role stub not double-reported"
# imported bot, other layout: --skip required
mkdir -p "$T/case/imp"; printf '# my bot\nI help with taxes.\n' > "$T/case/imp/CLAUDE.md"
chk --require-table "$T/case/imp"; want "imported layout without --skip → rc 1" 1 "걸림 · 파일 · persona.md 가 없음"
chk --require-table --skip required "$T/case/imp"; want "imported layout with --skip required → rc 0" 0 "결과: 통과 · 점검한 파일 1개"
# older file name other tools use (built from pieces)
L="so""ul.md"
fresh leg chief; mv "$T/case/leg/persona.md" "$T/case/leg/$L"; repl "$T/case/leg/CLAUDE.md" "@persona.md" "@$L"
chk --require-table --skip trace "$T/case/leg"; want "older persona file name accepted → rc 0" 0 "결과: 통과"

# ── 6. things that look like stubs but are not ──────────────────────────────────────────────────────────────────────
fresh fp chief
cat >> "$T/case/fp/CLAUDE.md" <<'EOF'

## 예시
<!-- 이 줄은 주석 -->
멘션은 <@U12345678> 꼴이고 채널은 <#C12345678|general> 꼴이다. 링크는 <https://example.org/a?b=1> 꼴.
줄바꿈 <br> 과 <details> 같은 HTML 은 자리표시자가 아니다. 부등호 a <= b, x < y and y > z, 화살표 <-- 와 <-> 도 아니다.
`<코드 안의 꺾쇠>` 도 자리표시자가 아니다.
<!-- 주석 안의 <BOT_NAME> 은 봐준다 -->
<!--
여러 줄 주석 안의 <TONE> 도 봐준다
-->```
<fenced code stub> 는 코드 블록 안이라 봐준다
```
EOF
chk --require-table "$T/case/fp"; want "look-alikes (comment · mention · link · html tag · code) → rc 0" 0
fresh fp2 chief; addline "$T/case/fp2/CLAUDE.md" "- 담당: <CODE_NAME> 로 부른다"
chk --require-table "$T/case/fp2"; want "UPPER stub inside prose → rc 1" 1 "<CODE_NAME>"

# ── 7. length ────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh ln1 chief; "$PY" -I - "$T/case/ln1/persona.md" <<'EOF'
import sys
p = sys.argv[1]
open(p, 'a', encoding='utf-8').write('\n' + ''.join('- 확인 없이는 하지 않는 일 %d 번째 항목이다.\n' % i for i in range(400)))
EOF
chk --require-table "$T/case/ln1"; want "persona.md over 6000 chars → rc 1 길이" 1 "걸림 · 길이 · persona.md 가"
fresh ln2 chief; repl "$T/case/ln2/persona.md" "<!-- CAPSULE-END -->" "6. 여섯째
7. 일곱째
8. 여덟째
<!-- CAPSULE-END -->"
chk --require-table "$T/case/ln2"; want "capsule over 6 lines → rc 1 길이" 1 "걸림 · 길이 · 캡슐이"
fresh ln3 chief; "$PY" -I - "$T/case/ln3/CLAUDE.md" <<'EOF'
import sys
p = sys.argv[1]
open(p, 'a', encoding='utf-8').write('\n' + ''.join('- 예절 %d 번째 줄이다 가나다라마바사.\n' % i for i in range(300)))
EOF
chk --require-table "$T/case/ln3"; want "CLAUDE.md over 4000 chars → rc 1 길이" 1 "걸림 · 길이 · CLAUDE.md 가"
chk --require-table --skip length "$T/case/ln3"; want "--skip length silences it → rc 0" 0

# ── 8. usage ─────────────────────────────────────────────────────────────────────────────────────────────────────────
chk "$T/no-such-folder"; want "no such folder → rc 2" 2 "폴더가 없음"
chk --nope "$T/bots/chief"; want "unknown option → rc 2" 2 "모르는 옵션"
chk --skip bogus "$T/bots/chief"; want "bad --skip name → rc 2" 2 "--skip 이름은"

printf '\n합계: PASS %d · FAIL %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
