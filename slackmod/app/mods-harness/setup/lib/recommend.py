#!/usr/bin/env python3
"""recommend.py — what to suggest, from the scan results and a catalog (read only · JSON on stdout).

  python3 -I recommend.py --env env.json [--history h.json] [--answers a.json] --catalog recommend.tsv [--declined FILE]

Output: {"schema":1,"base":[id…],"add":[{"id","source":"ours|official","title","why","how"}],
         "skip":[{"id","why":"이미 있음|겹침:<id>|전에 거절|목록에 없음"}]}
- catalog columns: id · layer(base|add) · source(ours|official) · when · title · why · how · overlaps (tab separated · # = comment).
- when = words joined by «,», all must hold: always · wiki (≥1 vault) · nowiki · kind:<code|writing|research|data>
  (history kinds ≥ 5, or the word in answers.work) · codex · os:<name> · mcp:<name> · a leading «!» negates a word.
  A row whose «when» does not hold is left out (neither add nor skip).
- add rows are checked in this order: 이미 있음 (id or an overlaps word = an installed plugin / skill name) → 전에 거절 (id in
  --declined) → 목록에 없음 (official row not in env.official's marketplace list) → 겹침:<id> (shares an overlaps word with an
  earlier suggested row). {market} in how → claude-plugins-official.
- Order = catalog order. Same input = same bytes.
rc 0 = done · 2 = usage / unreadable input / bad catalog row.
"""
import json
import os
import re
import sys

KIND_MIN = 5
KINDS = ('code', 'writing', 'research', 'data')
MARKET = 'claude-plugins-official'
ID_SHAPE = re.compile(r'^[a-z0-9][a-z0-9@._-]{0,80}$')


def usage(msg):
    sys.stderr.write('recommend: %s\n' % msg)
    sys.exit(2)


def parse_args(argv):
    a = {'env': None, 'history': None, 'answers': None, 'catalog': None, 'declined': None}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k in ('-h', '--help'):
            sys.stdout.write(__doc__)
            sys.exit(0)
        if k in ('--env', '--history', '--answers', '--catalog', '--declined'):
            if i + 1 >= len(argv):
                usage('%s needs a value' % k)
            a[k[2:]] = argv[i + 1]
            i += 2
            continue
        usage('unknown argument %s' % k)
    if not a['env'] or not a['catalog']:
        usage('--env and --catalog are required')
    return a


def load(path, what):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        usage('%s not readable as JSON: %s' % (what, path))


def read_catalog(path):
    rows = []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            lines = f.read().split('\n')
    except OSError:
        usage('catalog not readable: %s' % path)
    for n, line in enumerate(lines, 1):
        if not line.strip() or line.startswith('#'):
            continue
        c = line.split('\t')
        if len(c) == 7:
            c.append('')
        if len(c) != 8:
            usage('catalog line %d: want 8 tab-separated columns, got %d' % (n, len(c)))
        rid, layer, source, when, title, why, how, overlaps = c
        if not ID_SHAPE.match(rid) or layer not in ('base', 'add') or source not in ('ours', 'official') or not when:
            usage('catalog line %d: bad id / layer / source / when' % n)
        rows.append({'n': n, 'id': rid, 'layer': layer, 'source': source, 'when': [w.strip() for w in when.split(',') if w.strip()],
                     'title': title, 'why': why, 'how': how,
                     'overlaps': [w.strip() for w in overlaps.split(',') if w.strip()]})
    return rows


def work_words(answers):
    if not isinstance(answers, dict):
        return set()
    w = answers.get('work')
    if isinstance(w, str):
        return {x.lower() for x in re.split(r'[\s,]+', w) if x}
    if isinstance(w, list):
        return {x.strip().lower() for x in w if isinstance(x, str) and x.strip()}
    return set()


def official_names(env):
    o = env.get('official') if isinstance(env, dict) else None
    p = o.get('path') if isinstance(o, dict) else None
    if not isinstance(p, str) or not p:
        return set()
    try:
        with open(p, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return {x['name'] for x in d.get('plugins', []) if isinstance(x, dict) and isinstance(x.get('name'), str)}
    except (OSError, ValueError, AttributeError):
        return set()


def make_test(env, hist, answers):
    vaults = ((env.get('wiki') or {}).get('vaults') or []) if isinstance(env, dict) else []
    kinds = (hist.get('kinds') or {}) if isinstance(hist, dict) else {}
    work = work_words(answers)
    mcp = set(env.get('mcp') or [])
    codex = bool((env.get('codex') or {}).get('found'))
    osn = env.get('os')

    def one(word, n):
        neg = word.startswith('!')
        w = word[1:] if neg else word
        if w == 'always':
            v = True
        elif w == 'wiki':
            v = len(vaults) >= 1
        elif w == 'nowiki':
            v = len(vaults) == 0
        elif w == 'codex':
            v = codex
        elif w.startswith('kind:') and w[5:] in KINDS:
            k = w[5:]
            v = (isinstance(kinds.get(k), int) and kinds.get(k) >= KIND_MIN) or k in work
        elif w.startswith('os:') and w[3:]:
            v = osn == w[3:]
        elif w.startswith('mcp:') and w[4:]:
            v = w[4:] in mcp
        else:
            usage('catalog line %d: unknown when word «%s»' % (n, word))
        return (not v) if neg else v

    return lambda row: all(one(w, row['n']) for w in row['when'])


def main():
    a = parse_args(sys.argv[1:])
    env = load(a['env'], 'env')
    if not isinstance(env, dict):
        usage('env is not a JSON object')
    hist = load(a['history'], 'history') if a['history'] else {}
    answers = load(a['answers'], 'answers') if a['answers'] else {}
    declined = set()
    if a['declined']:
        d = load(a['declined'], 'declined')
        if not isinstance(d, list):
            usage('declined must be a JSON list of ids')
        declined = {x for x in d if isinstance(x, str)}
    rows = read_catalog(a['catalog'])
    holds = make_test(env, hist, answers)
    official = official_names(env)
    have = set(env.get('skills') or [])
    for k in env.get('plugins') or []:
        if isinstance(k, str):
            have.add(k.split('@', 1)[0])
    base, add, skip = [], [], []
    taken = []   # (id, words) of suggested add rows, in order
    for r in rows:
        if not holds(r):
            continue
        if r['layer'] == 'base':
            base.append(r['id'])
            continue
        words = [r['id']] + r['overlaps']
        if any(w in have for w in words):
            skip.append({'id': r['id'], 'why': '이미 있음'})
            continue
        if r['id'] in declined:
            skip.append({'id': r['id'], 'why': '전에 거절'})
            continue
        if r['source'] == 'official' and r['id'] not in official:
            skip.append({'id': r['id'], 'why': '목록에 없음'})
            continue
        clash = next((tid for tid, tw in taken if set(r['overlaps']) & tw), None)
        if clash:
            skip.append({'id': r['id'], 'why': '겹침:%s' % clash})
            continue
        taken.append((r['id'], set(words)))
        add.append({'id': r['id'], 'source': r['source'], 'title': r['title'], 'why': r['why'],
                    'how': r['how'].replace('{market}', MARKET)})
    out = {'schema': 1, 'base': base, 'add': add, 'skip': skip}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
