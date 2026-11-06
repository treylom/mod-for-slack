#!/usr/bin/env python3
"""models.py — model names this computer can use, and (with --probe) whether each one really answers (JSON on stdout).

  python3 -I models.py --home H [--probe] [--claude BIN] [--codex BIN] [--timeout 60]

Output: {"schema":1,"models":[{"name","from":"alias|settings|codex-config","named":true,"probe":"ok|no-answer|not-run",
                              "status":"확인됨|확인 안 됨|이름만"}]}
- Names = Claude Code aliases haiku · sonnet · opus + the «model» value of H/.claude/settings.json (when it differs)
  + when a codex program is there: the «model = "…"» line of H/.codex/config.toml (or the name «codex»).
- Without --probe nothing is run: probe = not-run, status = 이름만.
- With --probe: claude names → [BIN,-p,--model,name,--max-turns,1,--output-format,json,"Reply with OK"] · a JSON result
  line counts as an answer only when the end code is 0 AND it is a JSON object with type result · subtype success /
  error_max_turns · is_error the boolean false (a login error / unknown model = rc 1 + is_error true; a missing key, the
  text "true", a JSON list or broken JSON are no answer);
  codex → [BIN,exec,--skip-git-repo-check,"Reply with OK"] rc 0 = answer. Time-out · no JSON · error = no-answer.
- The probe's own output is never printed. Nothing is written.
rc 0 = done · 2 = usage.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys

ALIASES = ('haiku', 'sonnet', 'opus')
NAME_SHAPE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:\[\]/-]{0,80}$')
SECRET_SHAPE = re.compile(r'(?<![A-Za-z0-9])(xox[abprs]-|xapp-|sk-[A-Za-z0-9_-]{10,}|ghp_|gho_|ghs_|github_pat_|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10})')
TOML_MODEL = re.compile(r'^\s*model\s*=\s*"([^"]*)"\s*(#.*)?$')
STATUS = {'ok': '확인됨', 'no-answer': '확인 안 됨', 'not-run': '이름만'}
PROMPT = 'Reply with OK'


def usage(msg):
    sys.stderr.write('models: %s\n' % msg)
    sys.stderr.write('usage: python3 -I models.py --home H [--probe] [--claude BIN] [--codex BIN] [--timeout 60]\n')
    sys.exit(2)


def parse_args(argv):
    a = {'home': None, 'probe': False, 'claude': None, 'codex': None, 'timeout': '60'}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k in ('-h', '--help'):
            sys.stdout.write(__doc__)
            sys.exit(0)
        if k == '--probe':
            a['probe'] = True
            i += 1
            continue
        if k in ('--home', '--claude', '--codex', '--timeout'):
            if i + 1 >= len(argv):
                usage('%s needs a value' % k)
            a[k[2:]] = argv[i + 1]
            i += 2
            continue
        usage('unknown argument %s' % k)
    if not a['home'] or not os.path.isdir(a['home']):
        usage('--home must be a folder')
    try:
        a['timeout'] = float(a['timeout'])
    except ValueError:
        usage('--timeout must be a number of seconds')
    if not 0 < a['timeout'] <= 600:
        usage('--timeout must be 1..600 seconds')
    return a


def good_name(s):
    return isinstance(s, str) and bool(NAME_SHAPE.match(s)) and not SECRET_SHAPE.search(s)


def program(given, name):
    if given:
        return given if os.path.isfile(given) and os.access(given, os.X_OK) else None
    return shutil.which(name)


def settings_model(home):
    try:
        with open(os.path.join(home, '.claude', 'settings.json'), 'r', encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    m = d.get('model') if isinstance(d, dict) else None
    return m if good_name(m) else None


def codex_model(home):
    try:
        with open(os.path.join(home, '.codex', 'config.toml'), 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                if line.lstrip().startswith('['):
                    break   # only the top-level table names the default model
                m = TOML_MODEL.match(line.rstrip('\n'))
                if m and good_name(m.group(1)):
                    return m.group(1)
    except OSError:
        return None
    return None


def run(cmd, timeout):
    """→ (rc or None on time-out, stdout text). The child gets its own process group so a time-out ends its children too."""
    kw = {'stdin': subprocess.DEVNULL, 'stdout': subprocess.PIPE, 'stderr': subprocess.DEVNULL}
    if os.name == 'posix':
        kw['start_new_session'] = True
    try:
        p = subprocess.Popen(cmd, **kw)
    except OSError:
        return 127, ''
    try:
        out, _ = p.communicate(timeout=timeout)
        return p.returncode, out.decode('utf-8', 'replace')
    except subprocess.TimeoutExpired:
        if hasattr(os, 'killpg'):
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except OSError:
                pass
        else:
            p.kill()
        try:
            p.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        return None, ''


def result_json(text):
    try:
        d = json.loads(text)
        if isinstance(d, dict):
            return d
    except ValueError:
        pass
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line.startswith('{'):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if isinstance(d, dict) and d.get('type') == 'result':
            return d
    return None


def probe_claude(bin_, name, timeout):
    if not bin_:
        return 'no-answer'
    rc, out = run([bin_, '-p', '--model', name, '--max-turns', '1', '--output-format', 'json', PROMPT], timeout)
    if rc != 0:   # a time-out (None) or an error end code
        return 'no-answer'
    d = result_json(out)
    if not d or d.get('type') != 'result':
        return 'no-answer'
    if d.get('subtype') not in ('success', 'error_max_turns'):
        return 'no-answer'
    if d.get('is_error') is not False:   # only the JSON boolean false (not a missing key · not the text "false")
        return 'no-answer'
    return 'ok'


def probe_codex(bin_, timeout):
    rc, _ = run([bin_, 'exec', '--skip-git-repo-check', PROMPT], timeout)
    return 'ok' if rc == 0 else 'no-answer'


def main():
    a = parse_args(sys.argv[1:])
    home = os.path.abspath(a['home'])
    claude = program(a['claude'], 'claude')
    codex = program(a['codex'], 'codex')
    rows = [(n, 'alias') for n in ALIASES]
    sm = settings_model(home)
    if sm and sm not in ALIASES:
        rows.append((sm, 'settings'))
    out = []
    for n, src in rows:
        pr = probe_claude(claude, n, a['timeout']) if a['probe'] else 'not-run'
        out.append({'name': n, 'from': src, 'named': True, 'probe': pr, 'status': STATUS[pr]})
    if codex:
        cn = codex_model(home) or 'codex'
        pr = probe_codex(codex, a['timeout']) if a['probe'] else 'not-run'
        out.append({'name': cn, 'from': 'codex-config', 'named': True, 'probe': pr, 'status': STATUS[pr]})
    sys.stdout.write(json.dumps({'schema': 1, 'models': out}, ensure_ascii=False, indent=1) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
