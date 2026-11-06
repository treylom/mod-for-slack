#!/usr/bin/env python3
"""record.py — one record per install run, so «방금 설치 하나» can be undone (python 3.8+ · standard library only).

  record.py begin  --root R [--watch DIR]… [--watch-file FILE]… [--stamp S]
        → makes R/state/installs/<stamp>/ (begin.json = each watch folder: relative path → sha256 · a copy of its files in pre/ ·
          the watch folder and its parents up to HOME that do not exist yet · each watch file: sha256 + a copy, or «absent»)
          and prints that folder's absolute path (one line) — hand it to install.sh as SLACKMOD_RECORD_DIR.
          A watch folder of more than 20000 files or 50 MB in all is marked «new-only» (no copy: only files that appear are undone).
          node_modules · .git · R itself (and all under it) · any file named slack/.env are skipped.
  record.py finish --root R --dir D [--config C]
        → reads D/install.tsv (written by install.sh: kind<TAB>path<TAB>backup<TAB>mode · kind = new | changed | tree | dir-new | rc),
          adds the watch folders' new / changed files, the folders made under them (dir-new) and the changed watch files, writes each
          path's fingerprint after the install (post) and its parent folder's real path into D/record.json, with the places undo may
          touch (HOME · R · the watch folders and files · the notes folder of C, default R/config.json · the rc files), and
          R/state/installs/last = <stamp>. No line at all → D is removed and «last» is left as it was (a run that changed nothing
          leaves no record).
  record.py undo   --root R [--yes]
        → the last record only. Nothing is changed and the paths are listed, rc 3, when: a path is outside the places above (or a
          backup outside D and R/backup) · a parent folder's real path differs from the recorded one (a folder swapped for a link) ·
          a path differs from its post fingerprint (a file edited by hand after the install) · a backup is gone.
          Otherwise: without --yes the plan is printed (nothing written · rc 0); with --yes new files go, changed files come back
          from the backup, a replaced folder comes back (node_modules kept), a new folder goes when empty (a folder with something
          in it stays and is named) → D is renamed <stamp>.undone, «last» is removed. No record → «되돌릴 설치가 없습니다» rc 0.
The bots' slack/.env (the tokens) is never recorded, so undo leaves it as it is.
"""
import hashlib
import json
import os
import shutil
import sys
import time

SKIP_NAMES = ('node_modules', '.git')
MAX_FILES = 20000
MAX_BYTES = 50 * 1024 * 1024
KINDS = ('new', 'changed', 'tree', 'dir-new', 'rc')
# the folder fingerprint install.sh uses for a copied tree (sync_tree): node_modules / __pycache__ are not part of what was
# shipped, and Claude Code writes its own type files into the harness plugin folder (install.sh ENGINE_MADE)
TREE_EXCLUDE = ('node_modules', '__pycache__')
TREE_EXCLUDE_PATHS = ('.claude-plugin/types', 'tsconfig.json')


def die(msg, rc=2):
    print('record.py: ' + msg, file=sys.stderr)
    sys.exit(rc)


def arg(argv, name, default=None, many=False):
    vals = [argv[i + 1] for i, a in enumerate(argv[:-1]) if a == name]
    if many:
        return vals
    return vals[-1] if vals else default


def sha_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def tree_fp(d, exclude=TREE_EXCLUDE, exclude_paths=TREE_EXCLUDE_PATHS):
    """The same walk as slackmod_config.tree_fp (paths · contents · exec bit · links as links)."""
    skip = {os.path.normpath(x) for x in exclude_paths}
    h = hashlib.sha256()
    if os.path.islink(d):
        h.update(('L . %s\n' % os.readlink(d)).encode())
    for dirpath, dirnames, filenames in os.walk(d):
        keep = []
        for x in sorted(dirnames):
            p = os.path.join(dirpath, x)
            rel = os.path.relpath(p, d)
            if x in exclude or rel in skip:
                continue
            if os.path.islink(p):
                h.update(('L %s %s\n' % (rel, os.readlink(p))).encode())
                continue
            keep.append(x)
        dirnames[:] = keep
        for name in sorted(filenames):
            if name in exclude:
                continue
            p = os.path.join(dirpath, name)
            rel = os.path.relpath(p, d)
            if rel in skip:
                continue
            if os.path.islink(p):
                h.update(('L %s %s\n' % (rel, os.readlink(p))).encode())
                continue
            x = 'x' if os.stat(p).st_mode & 0o111 else '-'
            h.update(('F %s %s %s\n' % (rel, x, sha_file(p))).encode())
    return h.hexdigest()


def now_fp(kind, path):
    """The fingerprint of a recorded path as it is now."""
    if kind == 'dir-new':
        return 'dir' if os.path.isdir(path) and not os.path.islink(path) else 'absent'
    if kind == 'tree':
        return tree_fp(path) if os.path.isdir(path) else 'absent'
    if os.path.islink(path):
        return 'link'
    if os.path.isfile(path):
        return sha_file(path)
    return 'absent'


def under(p, top, same_ok=False):
    """p is below top (or top itself with same_ok) — plain path text, both normalized."""
    if not isinstance(p, str) or not isinstance(top, str) or not top:
        return False
    if p == top:
        return same_ok
    return p.startswith(top.rstrip('/') + '/')


def walk_files(d, skip_under=None):
    """→ sorted relative paths of the regular files under d (no links followed · node_modules / .git skipped · nothing in
    skip_under = the SlackMod folder, when a watch folder holds it · no file named slack/.env, the bots' tokens)."""
    out = []
    skip_real = os.path.realpath(skip_under) if skip_under else None
    if skip_real and under(os.path.realpath(d), skip_real, same_ok=True):
        return out
    for dirpath, dirnames, filenames in os.walk(d):
        dirnames[:] = sorted(x for x in dirnames if x not in SKIP_NAMES and not os.path.islink(os.path.join(dirpath, x))
                             and os.path.realpath(os.path.join(dirpath, x)) != skip_real)
        for name in sorted(filenames):
            p = os.path.join(dirpath, name)
            if name == '.env' and os.path.basename(dirpath) == 'slack':
                continue
            if os.path.isfile(p) and not os.path.islink(p):
                out.append(os.path.relpath(p, d))
    return sorted(out)


def missing_dirs(w, home):
    """→ the watch folder w and its parents that do not exist yet, outermost first — up to HOME (a folder outside HOME: itself only)."""
    out, x = [], w
    while not os.path.lexists(x):
        out.insert(0, x)
        parent = os.path.dirname(x)
        if parent == x or not under(parent, home):
            break
        x = parent
    return out


def abs_path_ok(p):
    return isinstance(p, str) and p.startswith('/') and '..' not in p.split('/') and '\n' not in p


def env_home():
    h = os.environ.get('HOME') or ''
    return os.path.normpath(h) if abs_path_ok(h) else ''


def installs_dir(root):
    return os.path.join(root, 'state', 'installs')


def write_text(path, text, mode=0o600):
    tmp = path + '.tmp-' + os.urandom(6).hex()
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), mode)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, path)


# ── begin ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def cmd_begin(rest):
    root = arg(rest, '--root')
    if not root or not abs_path_ok(root):
        die('begin needs --root DIR (absolute)')
    root = os.path.normpath(root)
    stamp = arg(rest, '--stamp') or time.strftime('%Y%m%d-%H%M%S')
    if not stamp.replace('-', '').isalnum():
        die('--stamp: letters, digits, -')
    base = installs_dir(root)
    os.makedirs(base, mode=0o755, exist_ok=True)
    d, n = os.path.join(base, stamp), 1
    while True:   # two runs in the same second: the second gets <stamp>-2
        try:
            os.mkdir(d, 0o700)
            break
        except FileExistsError:
            n += 1
            d = os.path.join(base, '%s-%d' % (stamp, n))
    watch, wfiles, home = [], [], env_home()
    for i, w in enumerate(arg(rest, '--watch', many=True)):
        if not abs_path_ok(w):
            die('--watch: an absolute folder path')
        w = os.path.normpath(w)
        files = walk_files(w, root) if os.path.isdir(w) and not os.path.islink(w) else []
        size = 0
        for rel in files:
            try:
                size += os.lstat(os.path.join(w, rel)).st_size
            except OSError:
                pass
        mode = 'new-only' if len(files) > MAX_FILES or size > MAX_BYTES else 'full'
        entry = {'dir': w, 'mode': mode, 'pre': 'pre/w%d' % i, 'files': {}, 'missing': missing_dirs(w, home)}
        for rel in files:
            p = os.path.join(w, rel)
            if mode == 'full':
                entry['files'][rel] = sha_file(p)
                dst = os.path.join(d, entry['pre'], rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(p, dst)
            else:
                entry['files'][rel] = ''
        watch.append(entry)
    for i, f in enumerate(arg(rest, '--watch-file', many=True)):   # one file (a setting the caller is about to change)
        if not abs_path_ok(f):
            die('--watch-file: an absolute file path')
        f = os.path.normpath(f)
        entry = {'path': f, 'sha': '', 'pre': 'pre/f%d' % i, 'mode': ''}
        if os.path.isfile(f) and not os.path.islink(f):
            entry['sha'] = sha_file(f)
            entry['mode'] = '%o' % (os.stat(f).st_mode & 0o7777)
            dst = os.path.join(d, entry['pre'])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(f, dst)
        elif os.path.lexists(f):
            die('--watch-file: not a plain file: ' + f)
        wfiles.append(entry)
    write_text(os.path.join(d, 'begin.json'), json.dumps({'schema': 1, 'stamp': os.path.basename(d), 'watch': watch,
                                                          'watch_files': wfiles, 'home': home},
                                                          indent=2, ensure_ascii=False, sort_keys=True) + '\n')
    print(d)
    return 0


# ── finish ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def read_tsv(path):
    rows = []
    try:
        with open(path, encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        return rows
    for ln in text.split('\n'):
        if not ln:
            continue
        parts = (ln.split('\t') + ['', '', '', ''])[:4]
        kind, p, backup, mode = parts
        if kind in KINDS and abs_path_ok(p):
            rows.append({'kind': kind, 'path': os.path.normpath(p), 'backup': backup, 'mode': mode})
    return rows


def starter_of(config):
    """→ the kit's notes folder named in the config (memory_setup.starter_path when starter is on) · '' when none."""
    try:
        with open(config, encoding='utf-8') as f:
            ms = (json.load(f) or {}).get('memory_setup') or {}
    except (OSError, ValueError, AttributeError):
        return ''
    sp = ms.get('starter_path') if isinstance(ms, dict) and ms.get('starter') is True else None
    return os.path.normpath(sp) if abs_path_ok(sp) else ''


def cmd_finish(rest):
    root, d = arg(rest, '--root'), arg(rest, '--dir')
    if not root or not d or not abs_path_ok(root) or not abs_path_ok(d):
        die('finish needs --root DIR --dir RECORD_DIR (absolute)')
    root, d = os.path.normpath(root), os.path.normpath(d)
    if os.path.dirname(d) != installs_dir(root) or not os.path.isdir(d):
        die('finish: --dir must be a record folder under ' + installs_dir(root))
    rows, seen = [], {}
    for r in read_tsv(os.path.join(d, 'install.tsv')):
        if r['path'] in seen:   # first line per path wins: its backup is the state before this run
            continue
        seen[r['path']] = r
        rows.append(r)
    try:
        with open(os.path.join(d, 'begin.json'), encoding='utf-8') as f:
            begin = json.load(f)
    except (OSError, ValueError):
        begin = {'watch': []}
    stamp = begin.get('stamp') or os.path.basename(d)
    unrestorable, made = [], []
    for w in begin.get('watch', []):
        wd, before = w['dir'], w.get('files', {})
        # folders that were not there at begin and are now (the wizard made them before the install) → removed when empty
        for x in w.get('missing', []):
            if abs_path_ok(x) and x not in seen and os.path.isdir(x) and not os.path.islink(x):
                r = {'kind': 'dir-new', 'path': x, 'backup': '', 'mode': ''}
                seen[x] = r
                made.append(r)
        now = walk_files(wd, root) if os.path.isdir(wd) and not os.path.islink(wd) else []
        for rel in now:
            p = os.path.join(wd, rel)
            pre = os.path.join(d, w['pre'], rel)
            if rel not in before:
                if p in seen:   # made in this run before install.sh touched it → undo removes it
                    seen[p].update({'kind': 'new', 'backup': '', 'mode': ''})
                else:
                    r = {'kind': 'new', 'path': p, 'backup': '', 'mode': ''}
                    seen[p] = r
                    rows.append(r)
            elif w.get('mode') == 'full' and before[rel] != sha_file(p):
                mode = '%o' % (os.stat(pre).st_mode & 0o7777) if os.path.isfile(pre) else ''
                if p in seen:   # the copy taken at begin is older than install.sh's backup → the earliest state wins
                    if seen[p]['kind'] in ('changed', 'rc'):
                        seen[p].update({'backup': pre, 'mode': mode})
                else:
                    r = {'kind': 'changed', 'path': p, 'backup': pre, 'mode': mode}
                    seen[p] = r
                    rows.append(r)
            elif w.get('mode') != 'full' and p not in seen:
                pass   # new-only folder: an edited file cannot be restored (no copy) — named in record.json
        if w.get('mode') != 'full':
            unrestorable.append(wd)
    rows = made + rows   # outermost first, before everything: undo goes last line first, so they go after the files in them
    for wf in begin.get('watch_files', []):
        p = wf.get('path')
        if not abs_path_ok(p):
            continue
        now = sha_file(p) if os.path.isfile(p) and not os.path.islink(p) else ''
        if now == wf.get('sha', ''):
            continue
        if not wf.get('sha'):
            if now and p not in seen:   # made after begin
                r = {'kind': 'new', 'path': p, 'backup': '', 'mode': ''}
                seen[p] = r
                rows.append(r)
            continue
        pre = os.path.join(d, wf['pre'])
        if p in seen:   # the copy taken at begin is older than install.sh's backup → the earliest state wins
            if seen[p]['kind'] in ('changed', 'rc'):
                seen[p].update({'backup': pre, 'mode': wf.get('mode', '')})
        else:
            r = {'kind': 'changed', 'path': p, 'backup': pre, 'mode': wf.get('mode', '')}
            seen[p] = r
            rows.append(r)
    if not rows:
        shutil.rmtree(d, ignore_errors=True)
        print('기록 없음 — 이번 실행이 고친 것이 없어 되돌리기 기록을 남기지 않았습니다')
        return 0
    for r in rows:
        r['post'] = now_fp(r['kind'], r['path'])
        r['parent_real'] = os.path.realpath(os.path.dirname(r['path']))   # a parent swapped for a link later → undo stops
    config = arg(rest, '--config') or os.path.join(root, 'config.json')
    places = {'home': begin.get('home') or env_home(), 'root': root,
              'watch': [w['dir'] for w in begin.get('watch', []) if abs_path_ok(w.get('dir'))],
              'watch_files': [wf['path'] for wf in begin.get('watch_files', []) if abs_path_ok(wf.get('path'))],
              'starter': starter_of(config) if abs_path_ok(config) else '',
              'rc': [r['path'] for r in rows if r['kind'] == 'rc']}
    rec = {'schema': 1, 'stamp': stamp, 'lines': rows, 'new_only_watch': unrestorable, 'places': places}
    write_text(os.path.join(d, 'record.json'), json.dumps(rec, indent=2, ensure_ascii=False) + '\n')
    write_text(os.path.join(installs_dir(root), 'last'), os.path.basename(d) + '\n', 0o644)
    print('되돌리기 기록: %s (%d줄)' % (d, len(rows)))
    return 0


# ── undo ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
def say_line(r):
    k, p = r['kind'], r['path']
    if k == 'new' or (k == 'rc' and not r['backup']):
        return '  지움       %s' % p
    if k in ('changed', 'rc'):
        return '  되돌림     %s (설치 전 파일로)' % p
    if k == 'tree':
        return ('  폴더 되돌림 %s (설치 전 폴더로)' % p) if r['backup'] else ('  폴더 지움  %s' % p)
    return '  폴더 지움  %s (비어 있을 때만)' % p


def restore_file(src, dst, mode):
    tmp = dst + '.slackmod-undo-' + os.urandom(6).hex()
    shutil.copyfile(src, tmp)
    m = int(mode, 8) if mode else (os.stat(src).st_mode & 0o7777)
    os.chmod(tmp, m)
    os.replace(tmp, dst)


def rm_path(p):
    if os.path.islink(p) or os.path.isfile(p):
        os.unlink(p)
    elif os.path.isdir(p):
        shutil.rmtree(p)


def undo_one(r):
    """→ True when something was put back / removed · False when left as it is."""
    k, p, b = r['kind'], r['path'], r['backup']
    if k == 'new' or (k == 'rc' and not b):
        if os.path.lexists(p):
            rm_path(p)
            return True
        return False
    if k in ('changed', 'rc'):
        restore_file(b, p, r.get('mode') or '')
        return True
    if k == 'tree':
        keep = None
        if b and os.path.isdir(os.path.join(p, 'node_modules')):   # the installed dependencies are kept (moved back in)
            keep = p + '.slackmod-undo-nm'
            rm_path(keep)
            os.rename(os.path.join(p, 'node_modules'), keep)
        rm_path(p)
        if b:
            shutil.move(b, p)
            if keep:
                if os.path.lexists(os.path.join(p, 'node_modules')):
                    rm_path(keep)
                else:
                    os.rename(keep, os.path.join(p, 'node_modules'))
        return True
    if k == 'dir-new':
        try:
            os.rmdir(p)   # only an empty folder (anything someone put there stays)
            return True
        except OSError:
            return False
    return False


def outside_places(rec, rows, root, d):
    """→ the recorded paths / backups that are not where this install writes (nothing → [])."""
    pl = rec.get('places')
    if not isinstance(pl, dict) or not abs_path_ok(pl.get('home')):
        return ['(기록에 설치 자리 목록이 없습니다 — 이 기록은 되돌리지 않습니다)']
    lists = lambda k: [os.path.normpath(x) for x in (pl.get(k) or []) if abs_path_ok(x)] if isinstance(pl.get(k), list) else []
    home = os.path.normpath(pl['home'])
    tops = [root] + lists('watch') + ([os.path.normpath(pl['starter'])] if abs_path_ok(pl.get('starter')) else [])
    exact = lists('watch_files') + lists('rc')
    bad = []
    for r in rows:
        p, k, b = os.path.normpath(r['path']), r['kind'], r.get('backup') or ''
        ok = (under(p, home) or any(under(p, t, same_ok=(k == 'dir-new')) for t in tops)
              or (p in exact and k in ('changed', 'rc', 'new')))
        if not ok:
            bad.append(p)
        if b and not (abs_path_ok(b) and (under(os.path.normpath(b), d) or under(os.path.normpath(b), os.path.join(root, 'backup')))):
            bad.append(b)
    return bad


def cmd_undo(rest):
    root = arg(rest, '--root')
    if not root or not abs_path_ok(root):
        die('undo needs --root DIR (absolute)')
    root = os.path.normpath(root)
    yes = '--yes' in rest
    base = installs_dir(root)
    try:
        with open(os.path.join(base, 'last'), encoding='utf-8') as f:
            stamp = f.read().strip()
    except FileNotFoundError:
        stamp = ''
    d = os.path.join(base, stamp) if stamp and '/' not in stamp and stamp not in ('.', '..') else ''
    try:
        with open(os.path.join(d, 'record.json'), encoding='utf-8') as f:
            rec = json.load(f)
    except (OSError, ValueError):
        rec = None
    if not d or not rec:
        print('되돌릴 설치가 없습니다')
        return 0
    rows = [r for r in rec.get('lines', []) if r.get('kind') in KINDS and abs_path_ok(r.get('path'))]
    outside = outside_places(rec, rows, root, d)
    if outside:
        print('기록이 이 설치가 쓰는 곳 밖을 가리켜 아무것도 바꾸지 않았습니다(기록 파일이 손으로 고쳐졌을 수 있습니다):')
        for p in outside:
            print('  ' + p)
        return 3
    swapped = [r['path'] for r in rows if os.path.realpath(os.path.dirname(r['path'])) != r.get('parent_real')]
    if swapped:
        print('설치 뒤 폴더 자리가 바뀌어(링크 등) 아무것도 바꾸지 않았습니다:')
        for p in swapped:
            print('  ' + p)
        print('옮긴 폴더를 제자리에 두거나 직접 정리하세요.')
        return 3
    edited = [r['path'] for r in rows if r['kind'] != 'dir-new' and now_fp(r['kind'], r['path']) != r.get('post')]
    if edited:
        print('설치 뒤 손으로 고친 파일이 있어 아무것도 바꾸지 않았습니다:')
        for p in edited:
            print('  ' + p)
        print('그 파일을 설치 직후대로 두거나(백업 폴더에 설치 전 파일이 있습니다) 직접 정리하세요.')
        return 3
    lost = [r['path'] for r in rows if r['kind'] in ('changed', 'rc', 'tree') and r['backup'] and not os.path.lexists(r['backup'])]
    if lost:
        print('설치 전 백업이 없어져 아무것도 바꾸지 않았습니다:')
        for p in lost:
            print('  ' + p)
        return 3
    print('되돌릴 설치: %s (%d줄 · 봇 slack/.env 의 토큰은 그대로 둡니다)' % (rec.get('stamp', stamp), len(rows)))
    if not yes:
        for r in reversed(rows):
            print(say_line(r))
        print('실제로 되돌리려면: slackmod undo --yes')
        return 0
    done = same = 0
    for r in reversed(rows):   # last written first: a file goes before the folder made for it
        if undo_one(r):
            done += 1
        else:
            same += 1
            if r['kind'] == 'dir-new' and os.path.isdir(r['path']) and not os.path.islink(r['path']):
                print('  남김       %s (비어 있지 않아 그대로 둡니다)' % r['path'])
    target, n = d + '.undone', 1
    while os.path.lexists(target):
        n += 1
        target = '%s.undone-%d' % (d, n)
    os.rename(d, target)
    try:
        os.unlink(os.path.join(base, 'last'))
    except FileNotFoundError:
        pass
    print('봇 slack/.env(토큰)는 그대로 두었습니다 — 봇을 다시 쓰려면 설치기를 다시 실행하세요.')
    print('결과: 되돌림 %d · 그대로 %d' % (done, same))
    return 0


def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__.strip())
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == 'begin':
        return cmd_begin(rest)
    if cmd == 'finish':
        return cmd_finish(rest)
    if cmd == 'undo':
        return cmd_undo(rest)
    die('unknown subcommand ' + cmd)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
