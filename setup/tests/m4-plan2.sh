#!/usr/bin/env bash
# m4-plan2.sh — setup.json's new columns (plan.py) and how the installer carries them (slackmod_config.py · install.sh --plan).
#   ① defaults: a short file → --normalize fills bots[].effort '' · bots[].projects [] · history · interview · pending · recommend ·
#      memory_setup, in a fixed order (pinned text) · twice = same bytes · normalize(normalize(x)) == normalize(x)
#   ② outside memory (hindsight · kumiho) is saved only when its connection test passed: probe fail / not-run → rc 2 · --out writes
#      nothing · probe ok → rc 0 · «later» needs no probe
#   ③ projects: absolute paths only · not the bot's own folder · no repeats · 20 at most · «~/» made absolute · not «/» or HOME ·
#      a bot work_dir that holds ~/.slackmod (HOME · a folder above it) → rc 2 with the one-line reason
#   ④ pending: only the known column names · ⑤ recommend ids · interview · history shapes · ⑥ secret-shaped value / secret
#      column name → rc 2, the bait never printed · ⑦ starter on with no path → <home>/SlackModWiki · ⑧ effort words
#   ⑨ install --plan: projects → each bot's .claude/settings.json additionalDirectories (wiki first, projects sorted, no repeats) +
#      .claude/rules/slackmod-projects.md · a wiki folder wins over the starter notes folder · config keeps a hand-set effort when the
#      setup file has no effort column · validate refuses a bad effort / relative project
#   bash setup/tests/m4-plan2.sh          rc 0 = all PASS (throwaway HOMEs only)
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m4-plan2)"
trap 'rm -rf "$T"' EXIT

python3 -I - "$SETUP_DIR/lib/plan.py" "$T" <<'PY'
import copy, importlib.util, json, os, subprocess, sys
sys.dont_write_bytecode = True
plan_path, tmp = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location('plan_under_test', plan_path)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
HOME = os.path.normpath(tmp + '/home')
fail = 0
def ok(t): print('PASS ' + t)
def no(t):
    global fail
    print('FAIL ' + t); fail = 1
def cli(*args, st=None, name='s.json'):
    p = os.path.join(tmp, name)
    if st is not None:
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(st, f, ensure_ascii=False)
    return subprocess.run([sys.executable, '-I', plan_path, p] + list(args), capture_output=True, text=True)

SHORT = {'schema': 1, 'mode': 'full', 'slack': {'enabled': False},
         'bots': [{'name': 'lead', 'work_dir': HOME + '/bots/lead'}]}
# ① defaults — the new columns, pinned
r1 = cli('--normalize', '--home', HOME, st=SHORT); r2 = cli('--normalize', '--home', HOME, st=SHORT)
want_tail = '''  "history": {
    "read": true
  },
  "interview": {
    "when": "later"
  },
  "pending": [],
  "recommend": {
    "take": [],
    "declined": []
  },
  "memory_setup": {
    "starter": false,
    "starter_path": null,
    "external_probe": "not-run"
  }
}
'''
want_bot = '''      "persona_dir": "%s/bots/lead",
      "effort": "",
      "projects": []
    }''' % HOME
(ok if r1.returncode == 0 and r1.stdout.endswith(want_tail) and want_bot in r1.stdout else no)(
    '①a short file → normalize fills the new columns in a fixed order (pinned text: history · interview · pending · recommend · memory_setup · bot effort/projects)')
(ok if r1.stdout == r2.stdout and r1.stdout else no)('①b --normalize twice → same bytes')
norm = json.loads(r1.stdout)
(ok if m.check(norm, HOME) == [] and m.normalize(norm, HOME) == norm else no)('①c normalize(normalize(x)) == normalize(x) and it passes check()')
full = copy.deepcopy(SHORT)
full.update({'history': {'read': False}, 'interview': {'when': 'now'}, 'pending': ['work', 'models'],
             'recommend': {'take': ['knowledge-manager', 'code-review@claude-plugins-official'], 'declined': ['x.y_z-1']},
             'memory_setup': {'starter': False, 'starter_path': None, 'external_probe': 'not-run'}})
full['bots'][0].update({'effort': 'high', 'projects': [HOME + '/work/b', HOME + '/work/a']})
r = cli('--normalize', '--home', HOME, st=full)
n = json.loads(r.stdout) if r.returncode == 0 else {}
(ok if r.returncode == 0 and n['history'] == {'read': False} and n['interview'] == {'when': 'now'} and n['pending'] == ['work', 'models']
    and n['recommend']['take'] == ['knowledge-manager', 'code-review@claude-plugins-official'] and n['bots'][0]['effort'] == 'high'
    and n['bots'][0]['projects'] == [HOME + '/work/b', HOME + '/work/a'] else no)('①d every new column filled by hand → kept as given (rc %d)' % r.returncode)

def probs(st): return m.check(st, HOME)
def case(label, mut, want):
    st = copy.deepcopy(full); mut(st); got = probs(st)
    if want is None:
        (ok if got == [] else no)('%s → passes (got %s)' % (label, got))
    else:
        hit = [x for x in got if x.startswith(want)]
        (ok if hit and len(hit) == len(got) else no)('%s → refused, names %s (got %s)' % (label, want, got))
def put(path, v):
    def f(st):
        d = st
        for k in path[:-1]: d = d[k]
        d[path[-1]] = v
    return f

# ② outside memory needs a passed connection test
for mem in ('hindsight', 'kumiho'):
    for probe in ('fail', 'not-run'):
        st = copy.deepcopy(full); st['memory'] = mem; st['memory_setup']['external_probe'] = probe
        outp = os.path.join(tmp, 'out-%s-%s.json' % (mem, probe))
        r = cli('--out', outp, '--home', HOME, st=st, name='m.json')
        (ok if r.returncode == 2 and '연결 시험이 통과하지 않아 저장하지 않습니다' in r.stdout and not os.path.exists(outp) else no)(
            '②a memory %s + probe %s → rc 2 · «연결 시험이 통과하지 않아 저장하지 않습니다» · --out wrote nothing (rc %d)' % (mem, probe, r.returncode))
    st = copy.deepcopy(full); st['memory'] = mem; st['memory_setup']['external_probe'] = 'ok'
    r = cli('--home', HOME, st=st, name='m.json')
    (ok if r.returncode == 0 else no)('②b memory %s + probe ok → rc 0 (got %d %s)' % (mem, r.returncode, r.stdout.strip()[:120]))
st = copy.deepcopy(full); st['memory'] = 'hindsight'; del st['memory_setup']
r = cli('--home', HOME, st=st, name='m.json')
(ok if r.returncode == 2 and 'setup.memory' in r.stdout else no)('②c memory hindsight with no memory_setup column (= not-run) → rc 2')
case('②d memory later + probe fail', put(['memory_setup', 'external_probe'], 'fail'), None)
case('②e probe word «maybe»', put(['memory_setup', 'external_probe'], 'maybe'), 'setup.memory_setup.external_probe')
case('②f starter not a boolean', put(['memory_setup', 'starter'], 'yes'), 'setup.memory_setup.starter')
case('②g starter_path relative', put(['memory_setup', 'starter_path'], 'notes'), 'setup.memory_setup.starter_path')
case('②h memory_setup unknown key', put(['memory_setup', 'cloud'], True), 'setup.memory_setup.cloud')

# ③ projects
case('③a projects absolute', put(['bots', 0, 'projects'], [HOME + '/p1']), None)
case('③b projects «~/» path', put(['bots', 0, 'projects'], ['~/p1']), None)
case('③c projects relative', put(['bots', 0, 'projects'], ['work/p1']), 'setup.bots[0].projects')
case('③d projects = the bot folder', put(['bots', 0, 'projects'], [HOME + '/bots/lead']), 'setup.bots[0].projects')
case('③e projects repeated', put(['bots', 0, 'projects'], [HOME + '/p1', HOME + '/p1']), 'setup.bots[0].projects')
case('③f projects 21', put(['bots', 0, 'projects'], [HOME + '/p%02d' % i for i in range(21)]), 'setup.bots[0].projects')
case('③g projects 20', put(['bots', 0, 'projects'], [HOME + '/p%02d' % i for i in range(20)]), None)
case('③h projects with «..»', put(['bots', 0, 'projects'], [HOME + '/a/../b']), 'setup.bots[0].projects')
case('③i projects not a list', put(['bots', 0, 'projects'], HOME + '/p1'), 'setup.bots[0].projects')
st = copy.deepcopy(full); st['bots'][0]['projects'] = ['~/p1']
(ok if m.normalize(st, HOME)['bots'][0]['projects'] == [HOME + '/p1'] else no)('③j «~/p1» → normalized to %s/p1' % HOME)
# a bot folder that holds ~/.slackmod (HOME itself · a folder above it) is refused — its tokens would sit inside the bot's own
# folder · projects «/» and HOME itself are refused too (a folder inside them is fine — ③a)
case('③k work_dir = HOME', put(['bots', 0, 'work_dir'], HOME), 'setup.bots[0].work_dir')
case('③l work_dir = «/»', put(['bots', 0, 'work_dir'], '/'), 'setup.bots[0].work_dir')
case('③m work_dir = the folder above HOME', put(['bots', 0, 'work_dir'], os.path.dirname(HOME)), 'setup.bots[0].work_dir')
case('③n work_dir = a folder inside HOME (bait)', put(['bots', 0, 'work_dir'], HOME + '/work/lead'), None)
r = cli('--home', HOME, st=dict(copy.deepcopy(full), bots=[dict(full['bots'][0], work_dir=HOME)]), name='wd-home.json')
(ok if r.returncode == 2 and '봇 작업 폴더를 홈 폴더 전체로 둘 수 없습니다 — 그 안의 폴더 하나를 고르세요' in r.stdout else no)(
    '③o work_dir = HOME on the command line → rc 2 · «봇 작업 폴더를 홈 폴더 전체로 둘 수 없습니다 — 그 안의 폴더 하나를 고르세요» (rc %d)' % r.returncode)
case('③p projects [«/»]', put(['bots', 0, 'projects'], ['/']), 'setup.bots[0].projects')
case('③q projects [HOME]', put(['bots', 0, 'projects'], [HOME]), 'setup.bots[0].projects')
case('③r projects [«~/»] (= HOME)', put(['bots', 0, 'projects'], ['~/']), 'setup.bots[0].projects')
# ④ pending
case('④a pending every known name', put(['pending'], ['work', 'projects', 'recommend', 'models', 'memory', 'slack', 'effort']), None)
case('④b pending unknown name', put(['pending'], ['work', 'weather']), 'setup.pending')
case('④c pending repeated', put(['pending'], ['work', 'work']), 'setup.pending')
case('④d pending not a list', put(['pending'], 'work'), 'setup.pending')
# ⑤ recommend · interview · history
case('⑤a recommend id with a space', put(['recommend', 'take'], ['Bad Id']), 'setup.recommend.take')
case('⑤b recommend declined upper case', put(['recommend', 'declined'], ['Upper']), 'setup.recommend.declined')
case('⑤c recommend unknown key', put(['recommend', 'later'], []), 'setup.recommend.later')
case('⑤d interview «tomorrow»', put(['interview', 'when'], 'tomorrow'), 'setup.interview.when')
for w in ('now', 'later', 'skip'):
    case('⑤e interview ' + w, put(['interview', 'when'], w), None)
case('⑤f history read «yes»', put(['history', 'read'], 'yes'), 'setup.history.read')
case('⑤g history not an object', put(['history'], True), 'setup.history')
# ⑥ secrets stay refused (the new columns are walked too) · the bait never printed
BAIT = 'sk-' + 'BAITBAITBAITBAITBAIT42'
st = copy.deepcopy(full); st['recommend']['take'] = [BAIT]
r = cli('--home', HOME, st=st, name='sec.json')
(ok if r.returncode == 2 and 'BAITBAIT' not in r.stdout + r.stderr and 'looks like a secret' in r.stdout else no)('⑥a token-shaped recommend id → rc 2 · bait printed 0×')
st = copy.deepcopy(full); st['history']['api_key'] = 'x'
r = cli('--home', HOME, st=st, name='sec.json')
(ok if r.returncode == 2 and 'setup.history.api_key' in r.stdout else no)('⑥b secret-named column inside history → rc 2 · names it')
st = copy.deepcopy(full); st['bots'][0]['projects'] = ['/x/' + BAIT]
r = cli('--home', HOME, st=st, name='sec.json')
(ok if r.returncode == 2 and 'BAITBAIT' not in r.stdout + r.stderr else no)('⑥c token-shaped project path → rc 2 · bait printed 0×')
# ⑦ starter notes folder default
st = copy.deepcopy(full); st['memory_setup'] = {'starter': True}
nm = m.normalize(st, HOME)['memory_setup']
(ok if probs(st) == [] and nm == {'starter': True, 'starter_path': HOME + '/SlackModWiki', 'external_probe': 'not-run'} else no)('⑦a starter true, no path → starter_path = <home>/SlackModWiki (got %s)' % nm)
st['memory_setup']['starter_path'] = '~/notes'
(ok if m.normalize(st, HOME)['memory_setup']['starter_path'] == HOME + '/notes' else no)('⑦b starter_path «~/notes» → made absolute')
# ⑧ effort words (the same list as slackmod_config EFFORTS)
for e in ('', 'low', 'medium', 'high', 'xhigh', 'max'):
    case('⑧a effort %r' % e, put(['bots', 0, 'effort'], e), None)
case('⑧b effort «turbo»', put(['bots', 0, 'effort'], 'turbo'), 'setup.bots[0].effort')
case('⑧c effort number', put(['bots', 0, 'effort'], 3), 'setup.bots[0].effort')
sys.exit(fail)
PY
[ $? -eq 0 ] || FAIL=1

# ⑨ install --plan carries the columns into the bot folders (throwaway HOME · a bundle with the starter notes template)
B="$T/bundle"; make_bundle "$B"
cp "$PORT_DIR/lib/record.py" "$B/lib/"; cp -R "$PORT_DIR/templates/starter-wiki" "$B/templates/"
. "$SETUP_TESTS_DIR/plan-lib.sh"
inst() { local f="$1"; shift; OUT="$( export SHELL=/bin/zsh HOME="$H"; "$BASHX" "$B/install.sh" --no-npm --plan "$f" "$@" 2>&1 )"; RC=$?; }
jget() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2" 2>&1; }
new_home; mk_setup "$T/p9.json" "d['wiki'] = {'path': h + '/wiki'}; d['browser'] = 'none'; d['bots'][0]['projects'] = [h + '/work/zeta', h + '/work/alpha', h + '/wiki']"
inst "$T/p9.json"
S9="$H/bots/lead/.claude/settings.json"; R9="$H/bots/lead/.claude/rules/slackmod-projects.md"
[ $RC -eq 0 ] && [ "$(jget "$S9" "d['permissions']['additionalDirectories']")" = "['$H/wiki', '$H/work/alpha', '$H/work/zeta']" ] \
  && ok "⑨a projects → lead settings.json additionalDirectories = [wiki, projects sorted] · the wiki listed once" || { no "⑨a rc=$RC $(jget "$S9" "d['permissions']['additionalDirectories']")"; printf '%s\n' "$OUT" | tail -4; }
[ -f "$R9" ] && grep -qx -- "- $H/work/alpha" "$R9" && grep -q '이 폴더들 안에서 일하고, 밖은 열지 않습니다' "$R9" && [ ! -e "$H/bots/watch/.claude/rules/slackmod-projects.md" ] \
  && ok "⑨b .claude/rules/slackmod-projects.md: the folder list + «이 폴더들 안에서 일하고, 밖은 열지 않습니다» · the bot with no projects gets none" || no "⑨b rules file"
[ "$(cfg "d['bots'][0].get('projects')")" = "['$H/work/zeta', '$H/work/alpha', '$H/wiki']" ] && [ "$(cfg "'projects' in d['bots'][1]")" = False ] \
  && ok "⑨c config.json: bots[0].projects carried · bots[1] without projects has no key (same bytes as before)" || no "⑨c config $(cfg "d['bots'][0].get('projects')")"
inst "$T/p9.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && ok "⑨d same setup again → 바뀜 0" || no "⑨d rc=$RC $(count0 "$OUT")"
# a wiki folder wins over the starter notes folder
new_home; mk_setup "$T/p9e.json" "d['wiki'] = {'path': h + '/wiki'}; d['memory_setup'] = {'starter': True, 'starter_path': None, 'external_probe': 'not-run'}"
inst "$T/p9e.json"
[ $RC -eq 0 ] && [ ! -e "$H/SlackModWiki" ] && [ ! -e "$H/bots/lead/.claude/rules/slackmod-memory.md" ] && [ "$(cfg "'memory_setup' in d")" = False ] \
  && ok "⑨e wiki.path set + starter on → the wiki is used: no SlackModWiki folder · no memory rules file · no memory_setup in config" || no "⑨e rc=$RC"
# starter on, no wiki → the notes folder + per-bot memory rules + additionalDirectories
new_home; mk_setup "$T/p9f.json" "d['browser'] = 'none'; d['memory_setup'] = {'starter': True, 'starter_path': None, 'external_probe': 'not-run'}"
inst "$T/p9f.json"
M9="$H/bots/watch/.claude/rules/slackmod-memory.md"
[ $RC -eq 0 ] && [ -f "$H/SlackModWiki/README.md" ] && [ -f "$H/SlackModWiki/00-시작/시작.md" ] && [ -f "$H/SlackModWiki/받은 것/README.md" ] && [ -f "$H/SlackModWiki/.obsidian/app.json" ] \
  && grep -q "$H/SlackModWiki/기억/watch.md" "$M9" && [ "$(jget "$H/bots/lead/.claude/settings.json" "d['permissions']['additionalDirectories']")" = "['$H/SlackModWiki']" ] \
  && ok "⑨f starter on → <home>/SlackModWiki made from the template (README · 00-시작 · 받은 것 · .obsidian) · watch's slackmod-memory.md names SlackModWiki/기억/watch.md · additionalDirectories" \
  || { no "⑨f rc=$RC"; printf '%s\n' "$OUT" | tail -4; }
printf 'my own note\n' > "$H/SlackModWiki/README.md"
inst "$T/p9f.json"
[ $RC -eq 0 ] && [ "$(cat "$H/SlackModWiki/README.md")" = "my own note" ] && [ "$(count0 "$OUT")" = "바뀜 0" ] \
  && ok "⑨g a notes file edited by hand is never touched again (only files that are missing are made) · 바뀜 0" || no "⑨g rc=$RC $(count0 "$OUT")"
# config: a hand-set effort survives a re-plan whose setup file has no effort column · validate refuses bad values
new_home; mk_setup "$T/p9h.json"; inst "$T/p9h.json"
python3 -I - "$H/.slackmod/config.json" <<'PY2'
import json, sys
p = sys.argv[1]; c = json.load(open(p)); c['bots'][0]['effort'] = 'xhigh'; json.dump(c, open(p, 'w'), indent=2, ensure_ascii=False)
PY2
inst "$T/p9h.json"
[ $RC -eq 0 ] && [ "$(cfg "d['bots'][0].get('effort')")" = xhigh ] && grep -qx 'SM_EFFORT=xhigh' "$H/.slackmod/bots/lead/launch.sh" \
  && ok "⑨h re-plan with no effort column keeps the config's xhigh (like model) · launch.sh SM_EFFORT=xhigh" || no "⑨h rc=$RC effort $(cfg "d['bots'][0].get('effort')")"
CFGPY="$PORT_DIR/lib/slackmod_config.py"
python3 -I - "$H/.slackmod/config.json" "$T/v1.json" "$T/v2.json" <<'PY3'
import json, sys
c = json.load(open(sys.argv[1]))
a = json.loads(json.dumps(c)); a['bots'][0]['effort'] = 'turbo'; json.dump(a, open(sys.argv[2], 'w'))
b = json.loads(json.dumps(c)); b['bots'][1]['projects'] = ['rel/dir']; json.dump(b, open(sys.argv[3], 'w'))
PY3
V1="$(python3 -I "$CFGPY" validate --config "$T/v1.json")"; V1RC=$?
V2="$(python3 -I "$CFGPY" validate --config "$T/v2.json")"; V2RC=$?
[ $V1RC -eq 1 ] && printf '%s' "$V1" | grep -q 'bots\[0\].effort' && [ $V2RC -eq 1 ] && printf '%s' "$V2" | grep -q 'bots\[1\].projects' \
  && ok "⑨i config validate: effort «turbo» → names bots[0].effort · relative project → names bots[1].projects" || no "⑨i validate $V1RC/$V2RC: $V1 / $V2"
finish
