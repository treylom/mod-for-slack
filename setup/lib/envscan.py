#!/usr/bin/env python3
"""envscan.py — look around this computer for the setup wizard (read only · prints one JSON object on stdout).

  python3 -I envscan.py --home H [--official PATH]

Output: {"schema":1,"os","wsl","shell","mux":[…],"claude":{"found","version"},"codex":{"found"},
         "memory":{"auto":"on|off|unknown","auto_dirs":n,"external":[{"name","via":"mcp|plugin"}]},
         "wiki":{"vaults":[{"path","notes"}]},"plugins":[…],"skills":[…],"mcp":[…],"official":{"path","count"}}
- Writes nothing. Secret values are never read out: from ~/.claude.json only server NAMES (keys) are used;
  any name shaped like a token is dropped.
- os = platform.system(), or the env var MODS_FAKE_UNAME (tests) — MINGW*/MSYS*/CYGWIN* count as Windows.
- Same input = same bytes (every list is sorted; no clock in the output).
rc 0 = scanned · 2 = usage (bad --home).
"""
import json
import os
import platform
import re
import shutil
import subprocess
import sys

SECRET_SHAPE = re.compile(r'(?<![A-Za-z0-9])(xox[abprs]-|xapp-|sk-[A-Za-z0-9_-]{10,}|ghp_|gho_|ghs_|github_pat_|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10})')
MEMORY_WORDS = ('hindsight', 'kumiho', 'mem0', 'memory')
MUX_NAMES = ('cmux', 'herdr', 'orca', 'tmux')
SKIP_DIRS = {'node_modules', '.git', 'Library', '.cache'}
WIKI_DEPTH = 3
WIKI_MAX_DIRS = 2000
NOTES_MAX = 100000
OFFICIAL_REL = ('.claude', 'plugins', 'marketplaces', 'claude-plugins-official', '.claude-plugin', 'marketplace.json')


def usage(msg):
    sys.stderr.write('envscan: %s\n' % msg)
    sys.stderr.write('usage: python3 -I envscan.py --home H [--official PATH]\n')
    sys.exit(2)


def parse_args(argv):
    a = {'home': None, 'official': None}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k in ('-h', '--help'):
            sys.stdout.write(__doc__)
            sys.exit(0)
        if k in ('--home', '--official'):
            if i + 1 >= len(argv):
                usage('%s needs a value' % k)
            a[k[2:]] = argv[i + 1]
            i += 2
            continue
        usage('unknown argument %s' % k)
    if not a['home']:
        usage('--home is required')
    if not os.path.isdir(a['home']):
        usage('--home is not a folder: %s' % a['home'])
    return a


def load_json(path):
    """→ (data, state) · state = 'ok' | 'missing' | 'broken'."""
    if not os.path.isfile(path):
        return None, 'missing'
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f), 'ok'
    except (OSError, ValueError):
        return None, 'broken'


def clean_name(s):
    return isinstance(s, str) and s != '' and not SECRET_SHAPE.search(s) and '\n' not in s


def os_name():
    fake = os.environ.get('MODS_FAKE_UNAME')
    raw = fake if fake else platform.system()
    up = raw.upper()
    if up.startswith('MINGW') or up.startswith('MSYS') or up.startswith('CYGWIN') or up == 'WINDOWS':
        return 'Windows'
    if raw in ('Darwin', 'Linux'):
        return raw
    return raw or 'unknown'


def is_wsl(osn):
    if osn != 'Linux':
        return False
    if os.environ.get('WSL_DISTRO_NAME'):
        return True
    try:
        with open('/proc/version', 'r', encoding='utf-8', errors='replace') as f:
            return 'microsoft' in f.read(4096).lower()
    except OSError:
        return False


def shell_name(osn):
    sh = os.environ.get('SHELL', '')
    if sh:
        return os.path.basename(sh) or 'unknown'
    if osn == 'Windows' and os.environ.get('PSModulePath'):
        return 'pwsh'
    return 'unknown'


def claude_info():
    exe = shutil.which('claude')
    if not exe:
        return {'found': False, 'version': None}
    ver = None
    try:
        p = subprocess.run([exe, '--version'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=15)
        m = re.search(r'\d+\.\d+(\.\d+)?', p.stdout.decode('utf-8', 'replace'))
        if m:
            ver = m.group(0)
    except (OSError, subprocess.SubprocessError):
        ver = None
    return {'found': True, 'version': ver}


def memory_auto(home):
    data, state = load_json(os.path.join(home, '.claude', 'settings.json'))
    if state == 'missing':
        return 'on'
    if state == 'broken' or not isinstance(data, dict):
        return 'unknown'
    if 'autoMemoryEnabled' not in data:
        return 'on'
    v = data['autoMemoryEnabled']
    if v is False:
        return 'off'
    if v is True:
        return 'on'
    return 'unknown'


def auto_dirs(home):
    base = os.path.join(home, '.claude', 'projects')
    n = 0
    try:
        names = sorted(os.listdir(base))
    except OSError:
        return 0
    for d in names:
        if os.path.isfile(os.path.join(base, d, 'memory', 'MEMORY.md')):
            n += 1
    return n


def mcp_names(home):
    """Server names (keys only) from ~/.claude.json: top-level mcpServers + projects[*].mcpServers."""
    data, state = load_json(os.path.join(home, '.claude.json'))
    out = set()
    if state != 'ok' or not isinstance(data, dict):
        return out
    top = data.get('mcpServers')
    if isinstance(top, dict):
        out.update(k for k in top.keys() if clean_name(k))
    projs = data.get('projects')
    if isinstance(projs, dict):
        for pv in projs.values():
            if isinstance(pv, dict) and isinstance(pv.get('mcpServers'), dict):
                out.update(k for k in pv['mcpServers'].keys() if clean_name(k))
    return out


def installed_plugins(home):
    """→ (sorted keys «name@market», list of install paths)."""
    data, state = load_json(os.path.join(home, '.claude', 'plugins', 'installed_plugins.json'))
    if state != 'ok' or not isinstance(data, dict) or not isinstance(data.get('plugins'), dict):
        return [], []
    keys = sorted(k for k in data['plugins'].keys() if clean_name(k))
    paths = []
    for k in keys:
        entries = data['plugins'][k]
        if not isinstance(entries, list):
            continue
        for e in entries:
            if isinstance(e, dict) and isinstance(e.get('installPath'), str) and os.path.isabs(e['installPath']):
                paths.append(e['installPath'])
    return keys, paths


def skill_names(home, install_paths):
    out = set()
    roots = [os.path.join(home, '.claude', 'skills')] + [os.path.join(p, 'skills') for p in install_paths]
    for r in roots:
        try:
            names = os.listdir(r)
        except OSError:
            continue
        for n in names:
            if clean_name(n) and os.path.isfile(os.path.join(r, n, 'SKILL.md')):
                out.add(n)
    return sorted(out)


def external_memory(mcps, plugin_keys):
    out = set()
    for n in mcps:
        if any(w in n.lower() for w in MEMORY_WORDS):
            out.add(('mcp', n))
    for k in plugin_keys:
        if any(w in k.lower() for w in MEMORY_WORDS):
            out.add(('plugin', k))
    return [{'name': n, 'via': v} for v, n in sorted(out)]


def count_notes(top):
    n = 0
    for dirpath, dirnames, filenames in os.walk(top, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and d != '.obsidian'
                             and not os.path.islink(os.path.join(dirpath, d)))
        for f in filenames:
            if f.lower().endswith('.md'):
                n += 1
                if n >= NOTES_MAX:
                    return NOTES_MAX
    return n


def find_vaults(home):
    """Folders at depth 0..3 under home holding a .obsidian folder · links not followed · ≤2000 folders looked at."""
    found = []
    queue = [(os.path.abspath(home), 0)]
    seen = 0
    while queue and seen < WIKI_MAX_DIRS:
        d, depth = queue.pop(0)
        seen += 1
        try:
            entries = sorted(os.scandir(d), key=lambda e: e.name)
        except OSError:
            continue
        has_ob = False
        for e in entries:
            try:
                if not e.is_dir(follow_symlinks=False):
                    continue
            except OSError:
                continue
            if e.name == '.obsidian':
                has_ob = True
                continue
            if e.name in SKIP_DIRS:
                continue
            if depth < WIKI_DEPTH:
                queue.append((e.path, depth + 1))
        if has_ob:
            found.append(d)
    return [{'path': p, 'notes': count_notes(p)} for p in sorted(found)]


def official(home, override):
    path = override if override else os.path.join(home, *OFFICIAL_REL)
    data, state = load_json(path)
    if state != 'ok' or not isinstance(data, dict) or not isinstance(data.get('plugins'), list):
        return {'path': None, 'count': 0}
    return {'path': os.path.abspath(path), 'count': len(data['plugins'])}


def main():
    a = parse_args(sys.argv[1:])
    home = os.path.abspath(a['home'])
    osn = os_name()
    mcps = mcp_names(home)
    pkeys, ppaths = installed_plugins(home)
    out = {
        'schema': 1,
        'os': osn,
        'wsl': is_wsl(osn),
        'shell': shell_name(osn),
        'mux': [m for m in MUX_NAMES if shutil.which(m)],
        'claude': claude_info(),
        'codex': {'found': bool(shutil.which('codex'))},
        'memory': {'auto': memory_auto(home), 'auto_dirs': auto_dirs(home), 'external': external_memory(mcps, pkeys)},
        'wiki': {'vaults': find_vaults(home)},
        'plugins': pkeys,
        'skills': skill_names(home, ppaths),
        'mcp': sorted(mcps),
        'official': official(home, a['official']),
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
