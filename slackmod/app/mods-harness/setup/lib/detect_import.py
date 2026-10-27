#!/usr/bin/env python3
"""detect_import.py — what the wizard offers to carry over from other agent setups, and the carrying itself.
(Called through detect.sh and import.sh; standard library only · python 3.8+.)

  detect [--home DIR]                                       READ ONLY. JSON on stdout: {"home", "items":[{id, kind, label, path, detail, files}], "skipped":[…]}
  import --from ID[,ID…] [--home DIR] [--to DIR] [--bot NAME:DIR]… [--map ITEMID=NAME]… [--dry-run]
                                                            COPIES the picked items — originals are only read.

Items (id = kind:name — the same ids go into setup.json import.from):
  claude-md:global       ~/.claude/CLAUDE.md          agent:<n> ~/.claude/agents/<n>.md        skill:<n> ~/.claude/skills/<n>/
  settings:permissions   ~/.claude/settings.json → ONLY the permissions allow / deny / ask lists (never env · hooks · tokens)
  codex-agents:global    ~/.codex/AGENTS.md           codex-config:global ~/.codex/config.toml (copy kept in the import folder only)
  bot:<n>                ~/.claude/channels/<n>/*.md (its persona files, same names)    slackmod-bot:<n>  a bot of an earlier ~/.slackmod/config.json (its work folder's CLAUDE.md · AGENTS.md · persona.md · .claude/)
  slackmod-config:previous  ~/.slackmod/config.json (reference copy)

Where a pick goes: every picked item is copied into the import folder (default ~/.slackmod/import/<time>/ · --to reuses one) and,
for each target bot (--bot NAME:DIR = its work folder), into the bot folder in PROJECT scope:
  CLAUDE.md / AGENTS.md → <DIR>/ (when absent; else <DIR>/.claude/imported/) · agents → <DIR>/.claude/agents/ · skills → <DIR>/.claude/skills/
  permissions → merged (union) into <DIR>/.claude/settings.json · a bot item → the target bot with the same NAME (or --map ITEMID=NAME)
Nothing is ever overwritten: a different file already there stays and is reported. Files shaped like secrets are refused (names:
.env* · credentials · token · key/pem files · auth.json · .netrc · ssh keys; contents: token / key shapes · private key headers)
and a settings entry that looks like a secret is dropped. After copying the originals' sha256 are compared with the ones taken
before: the last line says «원본 지문 전후: 같음» (rc 3 if not). rc 0 ok · 2 input problem / a target file unusable · 3 originals changed.
Nothing is written through a symlink either: if any part of a destination below the picked folder (the import folder / a bot's work
folder) is a symlink, that file is not written — one «오류» line, rc 2 (the picked folder itself may be reached through a link).
"""
import hashlib
import json
import os
import re
import secrets
import stat
import sys
import time

SECRET_SHAPE = re.compile(r'(?<![A-Za-z0-9])(xox[abprs]-|xapp-|sk-[A-Za-z0-9_-]{10,}|ghp_|gho_|ghs_|github_pat_|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10})|-----BEGIN [A-Z ]*PRIVATE KEY-----')
NAME_REFUSE = re.compile(r'(^\.env($|\.))|^\.netrc$|^auth\.json$|credential|secret|token|\.(pem|key|p12|pfx)$|^id_(rsa|ed25519|ecdsa|dsa)', re.I)
SKIP_DIRS = ('.git', 'node_modules', '__pycache__')
SKIP_FILES = ('.DS_Store',)
MAX_BYTES = 2 * 1024 * 1024
NAME_OK = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')
BOT_NAME = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
BOT_FILES = ('CLAUDE.md', 'AGENTS.md', 'persona.md')


def tilde(path, home):
    return '~' + path[len(home):] if path == home or path.startswith(home + os.sep) else path


def sha_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f), None
    except FileNotFoundError:
        return None, 'missing'
    except (ValueError, UnicodeDecodeError, OSError):
        return None, 'not valid JSON'


def walk_files(root):
    """(abs, rel) for every regular file under a dir (or the file itself) — symlinks and noise skipped, sorted."""
    if os.path.isfile(root) and not os.path.islink(root):
        return [(root, os.path.basename(root))]
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not os.path.islink(os.path.join(dirpath, d)))
        for fn in sorted(filenames):
            p = os.path.join(dirpath, fn)
            if fn in SKIP_FILES or os.path.islink(p) or not os.path.isfile(p):
                continue
            out.append((p, os.path.relpath(p, root)))
    return out


def refuse_reason(path):
    """None = fine to copy · else a short reason (never contains the secret)."""
    base = os.path.basename(path)
    if NAME_REFUSE.search(base):
        return '이름이 비밀 파일 꼴'
    try:
        size = os.path.getsize(path)
        if size > MAX_BYTES:
            return '2MB 초과'
        with open(path, 'rb') as f:
            data = f.read()
    except OSError:
        return '읽을 수 없음'
    if b'\0' not in data[:2048] and SECRET_SHAPE.search(data.decode('utf-8', 'ignore')):
        return '내용에 토큰·키 꼴이 있음'
    return None


def permissions_of(path):
    """→ ({'allow': […], 'deny': […], 'ask': […]}, dropped_count) from a settings.json — lists of plain strings only."""
    d, err = read_json(path)
    if err or not isinstance(d, dict) or not isinstance(d.get('permissions'), dict):
        return {}, 0
    out, dropped = {}, 0
    for k in ('allow', 'deny', 'ask'):
        v = d['permissions'].get(k)
        if not isinstance(v, list):
            continue
        keep = []
        for e in v:
            if isinstance(e, str) and len(e) <= 300 and not SECRET_SHAPE.search(e):
                if e not in keep:
                    keep.append(e)
            else:
                dropped += 1
        if keep:
            out[k] = keep
    return out, dropped


def detect(home):
    items, skipped = [], []

    def add(iid, kind, path, label, detail='', files=None):
        items.append({'id': iid, 'kind': kind, 'label': label, 'path': path, 'detail': detail, 'files': files or []})

    cl = os.path.join(home, '.claude')
    p = os.path.join(cl, 'CLAUDE.md')
    if os.path.isfile(p):
        add('claude-md:global', 'claude-md', p, '~/.claude/CLAUDE.md', '%d bytes' % os.path.getsize(p))
    ad = os.path.join(cl, 'agents')
    if os.path.isdir(ad):
        for fn in sorted(os.listdir(ad)):
            stem = fn[:-3]
            fp = os.path.join(ad, fn)
            if fn.endswith('.md') and os.path.isfile(fp):
                if NAME_OK.match(stem):
                    add('agent:' + stem, 'agent', fp, '~/.claude/agents/' + fn)
                else:
                    skipped.append({'path': tilde(fp, home), 'reason': 'name not usable as an id'})
    sd = os.path.join(cl, 'skills')
    if os.path.isdir(sd):
        for dn in sorted(os.listdir(sd)):
            dp = os.path.join(sd, dn)
            if os.path.isdir(dp) and not os.path.islink(dp) and os.path.isfile(os.path.join(dp, 'SKILL.md')):
                if NAME_OK.match(dn):
                    add('skill:' + dn, 'skill', dp, '~/.claude/skills/' + dn + '/', '%d files' % len(walk_files(dp)))
                else:
                    skipped.append({'path': tilde(dp, home), 'reason': 'name not usable as an id'})
    sp = os.path.join(cl, 'settings.json')
    if os.path.isfile(sp):
        perms, dropped = permissions_of(sp)
        _, err = read_json(sp)
        if err:
            skipped.append({'path': '~/.claude/settings.json', 'reason': err})
        elif perms:
            add('settings:permissions', 'settings', sp, '~/.claude/settings.json (허용 목록만)',
                ' · '.join('%s %d' % (k, len(v)) for k, v in perms.items()) + (' · 비밀 꼴 %d 제외' % dropped if dropped else ''))
    cx = os.path.join(home, '.codex')
    p = os.path.join(cx, 'AGENTS.md')
    if os.path.isfile(p):
        add('codex-agents:global', 'codex-agents', p, '~/.codex/AGENTS.md', '%d bytes' % os.path.getsize(p))
    p = os.path.join(cx, 'config.toml')
    if os.path.isfile(p):
        add('codex-config:global', 'codex-config', p, '~/.codex/config.toml (참고용 사본만)', '%d bytes' % os.path.getsize(p))
    chd = os.path.join(cl, 'channels')
    if os.path.isdir(chd):
        for dn in sorted(os.listdir(chd)):
            dp = os.path.join(chd, dn)
            # a bot of an older channel layout = a folder holding its persona file(s): the top-level *.md files (names are
            # whatever that tool called them — copied under the same names, never renamed)
            mds = sorted(f for f in os.listdir(dp) if f.endswith('.md') and os.path.isfile(os.path.join(dp, f)) and not os.path.islink(os.path.join(dp, f))) if os.path.isdir(dp) and not os.path.islink(dp) else []
            if mds:
                if NAME_OK.match(dn):
                    add('bot:' + dn, 'bot', dp, '~/.claude/channels/%s/ (성격 파일 %d개)' % (dn, len(mds)), '성격 파일 ' + ' · '.join(mds), mds)
                else:
                    skipped.append({'path': tilde(dp, home), 'reason': 'name not usable as an id'})
    sm = os.path.join(home, '.slackmod', 'config.json')
    if os.path.isfile(sm):
        cfg, err = read_json(sm)
        if err or not isinstance(cfg, dict):
            skipped.append({'path': '~/.slackmod/config.json', 'reason': err or 'not an object'})
        else:
            add('slackmod-config:previous', 'slackmod-config', sm, '~/.slackmod/config.json (이전 설정)', '봇 %d' % len(cfg.get('bots') or []))
            for b in cfg.get('bots') or []:
                if isinstance(b, dict) and isinstance(b.get('name'), str) and BOT_NAME.match(b['name']) and isinstance(b.get('work_dir'), str) and os.path.isdir(b['work_dir']):
                    wd = os.path.normpath(b['work_dir'])
                    files = [f for f in BOT_FILES if os.path.isfile(os.path.join(wd, f))]
                    if os.path.isdir(os.path.join(wd, '.claude')):
                        files.append('.claude')
                    if files:
                        add('slackmod-bot:' + b['name'], 'slackmod-bot', wd, '이전 봇 %s (%s)' % (b['name'], tilde(wd, home)), ' · '.join(files), files)
    return items, skipped


class Report:
    def __init__(self, home, dry):
        self.home, self.dry = home, dry
        self.copied, self.same, self.kept, self.refused, self.errors, self.notes = 0, 0, 0, 0, 0, 0
        self.manifest = []
        self.refused_set = set()
        self.roots = []          # the folders the person picked to write into (the import folder · each bot's work folder)
        self.escape_set = set()  # symlinks already reported (one 오류 line per link, however many files were going through it)

    def line(self, tag, text):
        print('%-6s %s' % (tag, text))


def symlink_on_the_way(dest, rep):
    """None = every part of dest below the folder it is going into (the import folder / a bot's work folder) is a real folder or file
    and it really lives under that folder · else the offending path. A symlink in between could carry the write outside the folder
    the person picked (the picked folder itself may be reached through a link — only what is below it is checked)."""
    ad = os.path.abspath(dest)
    roots = [r for r in rep.roots if ad.startswith(r.rstrip(os.sep) + os.sep)]
    if not roots:
        return ad
    root = max(roots, key=len)
    cur = root
    for part in os.path.relpath(ad, root).split(os.sep):
        cur = os.path.join(cur, part)
        if os.path.islink(cur):
            return cur
    real_root, real_dir = os.path.realpath(root), os.path.realpath(os.path.dirname(ad))
    if real_dir != real_root and not real_dir.startswith(real_root + os.sep):
        return os.path.dirname(ad)
    return None


def escapes(dest, rep):
    """True = do NOT write dest (reported as 오류, rc 2)."""
    bad = symlink_on_the_way(dest, rep)
    if bad is None:
        return False
    if bad not in rep.escape_set:
        rep.escape_set.add(bad)
        rep.errors += 1
        rep.line('오류', '%s 에 쓰지 않았습니다 — 가는 길의 %s 가 바로가기(심볼릭 링크)라 고른 폴더 밖으로 나갈 수 있습니다. 진짜 폴더로 바꾼 뒤 다시' % (tilde(dest, rep.home), tilde(bad, rep.home)))
    return True


def write_in(dest, data, mode, rep):
    """Write bytes to dest without following a link anywhere below the picked folder — also one swapped in after escapes() looked
    (security round 2 ⑤ · NEW-1): every folder below the picked root is opened with O_NOFOLLOW (made when missing) and the file is
    written through that folder's handle: a fresh O_EXCL|O_NOFOLLOW temp with a random name, fchmod, then rename into place.
    False = not written (reported as 오류)."""
    ad = os.path.abspath(dest)
    roots = [r for r in rep.roots if ad.startswith(r.rstrip(os.sep) + os.sep)]
    fd = None
    try:
        if not roots:
            raise OSError(0, 'outside the picked folders')
        root = max(roots, key=len)
        os.makedirs(root, exist_ok=True)   # the picked folder itself (it may be reached through a link — the person picked it)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        for part in os.path.relpath(os.path.dirname(ad), root).split(os.sep):
            if part in ('', '.'):
                continue
            try:
                os.mkdir(part, 0o777, dir_fd=fd)
            except FileExistsError:
                pass
            nfd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nfd
        base = os.path.basename(ad)
        tmp = '.%s.tmp-%s' % (base, secrets.token_hex(8))
        t = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        try:
            with os.fdopen(t, 'wb') as g:
                g.write(data)
                os.fchmod(g.fileno(), mode)
        except BaseException:
            os.unlink(tmp, dir_fd=fd)
            raise
        os.replace(tmp, base, src_dir_fd=fd, dst_dir_fd=fd)
        return True
    except OSError as e:
        rep.errors += 1
        rep.line('오류', '%s 에 쓰지 않았습니다 — 쓰는 사이 가는 길의 폴더가 바로가기(심볼릭 링크)로 바뀌었거나 열 수 없습니다(%s). 진짜 폴더인지 확인한 뒤 다시' % (tilde(dest, rep.home), e.strerror or e))
        return False
    finally:
        if fd is not None:
            os.close(fd)


def read_own(path):
    """The old text of a file this tool keeps in the picked folder (MANIFEST.txt) — '' when it is absent, a link, not a regular
    file, or a file with a second name (a hard link planted to a file outside): never read through, never merged (review 10-26).
    O_NONBLOCK: a FIFO planted there opens at once (then fstat says «not a regular file») instead of waiting for a writer (r4)."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return ''
    with os.fdopen(fd, encoding='utf-8') as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            return ''
        return f.read()


def write_manifest(to, lines, rep):
    """MANIFEST.txt = the union of every run into this folder (no times — a re-run that adds nothing leaves the file alone).
    Read with read_own · written through write_in: a planted link or hard link is replaced, never written through."""
    mp = os.path.join(to, 'MANIFEST.txt')
    old_text = read_own(mp)
    merged = sorted(set(lines) | set(l for l in old_text.split('\n') if l))
    text = '\n'.join(merged) + '\n'
    if text != old_text and not escapes(mp, rep):
        write_in(mp, text.encode('utf-8'), 0o644, rep)


def put_file(src, dest, rep, rel_label):
    """Copy one file if the destination is absent. Same bytes there = fine · different bytes = keep theirs and say so."""
    why = refuse_reason(src)
    if why:
        if src not in rep.refused_set:   # one report per source file, however many places it was going to
            rep.refused_set.add(src)
            rep.refused += 1
            rep.line('거부', '%s (%s)' % (tilde(src, rep.home), why))
            rep.manifest.append('refused %s (%s)' % (tilde(src, rep.home), why))
        return
    if os.path.lexists(dest):
        try:
            if os.path.isfile(dest) and sha_file(dest) == sha_file(src):
                rep.same += 1
                return
        except OSError:
            pass
        rep.kept += 1
        rep.line('그대로', '%s (이미 다른 파일이 있어 덮어쓰지 않음)' % tilde(dest, rep.home))
        return
    if escapes(dest, rep):   # (only a NEW write can leave the folder — an existing file is never touched)
        return
    rep.copied += 1
    rep.line('사본' if not rep.dry else '할 일', '%s → %s' % (rel_label, tilde(dest, rep.home)))
    rep.manifest.append('copied %s' % tilde(dest, rep.home))
    if rep.dry:
        return
    with open(src, 'rb') as f:
        data = f.read()
    if not write_in(dest, data, 0o755 if os.stat(src).st_mode & 0o111 else 0o644, rep):
        rep.copied -= 1
        rep.manifest.pop()


def put_tree(src_root, dest_root, rep):
    for ap, rel in walk_files(src_root):
        put_file(ap, os.path.join(dest_root, rel), rep, rel)


def put_text(dest, text, rep, label):
    """Write generated text if absent / same (used for the permissions copy)."""
    if os.path.lexists(dest):
        try:
            with open(dest, encoding='utf-8') as f:
                if f.read() == text:
                    rep.same += 1
                    return
        except (OSError, UnicodeDecodeError):
            pass
        rep.kept += 1
        rep.line('그대로', '%s (이미 다른 파일이 있어 덮어쓰지 않음)' % tilde(dest, rep.home))
        return
    if escapes(dest, rep):
        return
    rep.copied += 1
    rep.line('사본' if not rep.dry else '할 일', '%s → %s' % (label, tilde(dest, rep.home)))
    rep.manifest.append('copied %s' % tilde(dest, rep.home))
    if rep.dry:
        return
    if not write_in(dest, text.encode('utf-8'), 0o644, rep):
        rep.copied -= 1
        rep.manifest.pop()


def merge_permissions(dest, perms, rep):
    """Union the imported allow/deny/ask entries into a bot folder's .claude/settings.json (other keys kept). Broken file = error, untouched."""
    if not perms:
        return
    d, err = read_json(dest)
    if err == 'not valid JSON' or (err is None and not isinstance(d, dict)):
        rep.errors += 1
        rep.line('오류', '%s 가 JSON 객체가 아니라 손대지 않았습니다 — 고친 뒤 다시' % tilde(dest, rep.home))
        return
    d = d if isinstance(d, dict) else {}
    pm = d.get('permissions', {})
    if not isinstance(pm, dict):
        rep.errors += 1
        rep.line('오류', '%s 의 permissions 가 객체가 아니라 손대지 않았습니다' % tilde(dest, rep.home))
        return
    changed = False
    for k, v in perms.items():
        cur = pm.get(k, [])
        if not isinstance(cur, list):
            rep.errors += 1
            rep.line('오류', '%s 의 permissions.%s 가 목록이 아니라 손대지 않았습니다' % (tilde(dest, rep.home), k))
            return
        add = [e for e in v if e not in cur]
        if add:
            pm[k] = cur + add
            changed = True
    if not changed:
        rep.same += 1
        return
    if escapes(dest, rep):
        return
    d['permissions'] = pm
    rep.copied += 1
    rep.line('사본' if not rep.dry else '할 일', '허용 목록 합침 → %s' % tilde(dest, rep.home))
    rep.manifest.append('merged permissions %s' % tilde(dest, rep.home))
    if rep.dry:
        return
    mode = os.lstat(dest).st_mode & 0o777 if os.path.isfile(dest) and not os.path.islink(dest) else 0o644
    if not write_in(dest, (json.dumps(d, indent=2, ensure_ascii=False) + '\n').encode('utf-8'), mode, rep):
        rep.copied -= 1
        rep.manifest.pop()


def source_files(it):
    """Every source file of an item (what the fingerprint covers) — (abs path) list."""
    k = it['kind']
    if k in ('claude-md', 'settings', 'codex-agents', 'codex-config', 'slackmod-config', 'agent'):
        return [it['path']]
    if k == 'skill':
        return [a for a, _ in walk_files(it['path'])]
    if k in ('bot', 'slackmod-bot'):
        out = []
        for f in it['files']:
            p = os.path.join(it['path'], f)
            out.extend([a for a, _ in walk_files(p)] if os.path.isdir(p) else ([p] if os.path.isfile(p) else []))
        return out
    return []


def fingerprint(paths):
    h = hashlib.sha256()
    n = 0
    for p in sorted(set(paths)):
        try:
            h.update(('%s %s\n' % (p, sha_file(p))).encode())
            n += 1
        except OSError:
            h.update(('%s unreadable\n' % p).encode())
    return h.hexdigest(), n


def do_import(args):
    home = os.path.normpath(os.path.expanduser('~'))
    picks, to, bots, maps, dry = [], None, [], {}, False
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--home' and i + 1 < len(args):
            home = os.path.normpath(args[i + 1]); i += 1
        elif a == '--from' and i + 1 < len(args):
            picks += [x for x in args[i + 1].split(',') if x]; i += 1
        elif a == '--to' and i + 1 < len(args):
            to = os.path.normpath(args[i + 1]); i += 1
        elif a == '--bot' and i + 1 < len(args):
            n, _, d = args[i + 1].partition(':')
            if not BOT_NAME.match(n) or not d.startswith('/'):
                print('입력 오류: --bot NAME:DIR (NAME 은 소문자 영문으로 시작, DIR 은 절대 경로) — %s' % args[i + 1].split(':')[0], file=sys.stderr)
                return 2
            bots.append((n, os.path.normpath(d))); i += 1
        elif a == '--map' and i + 1 < len(args):
            k, _, v = args[i + 1].partition('=')
            maps[k] = v; i += 1
        elif a == '--dry-run':
            dry = True
        else:
            print('입력 오류: 모르는 옵션 ' + a, file=sys.stderr)
            return 2
        i += 1
    if not picks:
        print('입력 오류: --from ID[,ID…] 가 필요합니다(detect.sh 가 알려 준 id)', file=sys.stderr)
        return 2
    items, _ = detect(home)
    by_id = {it['id']: it for it in items}
    bad = [p for p in picks if p not in by_id]
    if bad:
        print('입력 오류: 찾을 수 없는 항목 %s — detect.sh 로 다시 확인하세요' % ', '.join(bad), file=sys.stderr)
        return 2
    names = [n for n, _ in bots]
    if len(set(names)) != len(names):
        print('입력 오류: --bot 이름이 겹칩니다', file=sys.stderr)
        return 2
    picks = list(dict.fromkeys(picks))
    stamp = time.strftime('%Y%m%d-%H%M%S')
    to = to or os.path.join(home, '.slackmod', 'import', stamp)
    chosen = [by_id[p] for p in picks]
    before, nfiles = fingerprint([f for it in chosen for f in source_files(it)])
    rep = Report(home, dry)
    rep.roots = [os.path.abspath(r) for r in [to] + [wd for _, wd in bots]]
    print('가져오기%s — 원본 %d개 항목(읽기만) → 사본 폴더 %s' % (' (미리 보기 · 쓰기 0)' if dry else '', len(chosen), tilde(to, home)))

    def target_for(it):
        if it['kind'] not in ('bot', 'slackmod-bot'):
            return None
        nm = maps.get(it['id']) or it['id'].split(':', 1)[1]
        return dict(bots).get(nm)

    # 1) the import folder: every pick, filtered
    for it in chosen:
        k, p = it['kind'], it['path']
        if k == 'claude-md':
            put_file(p, os.path.join(to, 'claude', 'CLAUDE.md'), rep, '~/.claude/CLAUDE.md')
        elif k == 'agent':
            put_file(p, os.path.join(to, 'claude', 'agents', os.path.basename(p)), rep, it['label'])
        elif k == 'skill':
            put_tree(p, os.path.join(to, 'claude', 'skills', os.path.basename(p)), rep)
        elif k == 'settings':
            perms, dropped = permissions_of(p)
            if dropped:
                rep.line('제외', '허용 목록 %d줄이 비밀 꼴이라 뺐습니다' % dropped)
            put_text(os.path.join(to, 'claude', 'settings.permissions.json'), json.dumps({'permissions': perms}, indent=2, ensure_ascii=False) + '\n', rep, '허용 목록')
        elif k == 'codex-agents':
            put_file(p, os.path.join(to, 'codex', 'AGENTS.md'), rep, '~/.codex/AGENTS.md')
        elif k == 'codex-config':
            put_file(p, os.path.join(to, 'codex', 'config.toml'), rep, '~/.codex/config.toml')
        elif k == 'slackmod-config':
            put_file(p, os.path.join(to, 'slackmod', 'config.json'), rep, '~/.slackmod/config.json')
        elif k in ('bot', 'slackmod-bot'):
            nm = it['id'].split(':', 1)[1]
            for f in it['files']:
                fp = os.path.join(p, f)
                if os.path.isdir(fp):
                    for ap, rel in walk_files(fp):
                        if f == '.claude' and rel == 'settings.json':   # never the raw file (it may hold env tokens) — the permissions only
                            perms, dropped = permissions_of(ap)
                            if perms:
                                put_text(os.path.join(to, 'bots', nm, '.claude', 'settings.permissions.json'),
                                         json.dumps({'permissions': perms}, indent=2, ensure_ascii=False) + '\n', rep, '이전 봇 허용 목록')
                        else:
                            put_file(ap, os.path.join(to, 'bots', nm, f, rel), rep, f + '/' + rel)
                else:
                    put_file(fp, os.path.join(to, 'bots', nm, f), rep, f)
    # 2) the bot folders (project scope): the bot's own items first, then the shared ones
    for nm, wd in bots:
        mine = [it for it in chosen if it['kind'] in ('bot', 'slackmod-bot') and target_for(it) == wd]
        shared = [it for it in chosen if it['kind'] in ('claude-md', 'agent', 'skill', 'settings', 'codex-agents')]
        for it in mine:
            for f in it['files']:
                fp = os.path.join(it['path'], f)
                if f == '.claude' and os.path.isdir(fp):
                    for ap, rel in walk_files(fp):
                        if rel == 'settings.json':
                            merge_permissions(os.path.join(wd, '.claude', 'settings.json'), permissions_of(ap)[0], rep)
                        else:
                            put_file(ap, os.path.join(wd, '.claude', rel), rep, '.claude/' + rel)
                else:
                    put_file(fp, os.path.join(wd, f), rep, f)
        for it in shared:
            k, p = it['kind'], it['path']
            if k in ('claude-md', 'codex-agents'):
                name = 'CLAUDE.md' if k == 'claude-md' else 'AGENTS.md'
                dest = os.path.join(wd, name)
                # a different file already there (the bot's own) stays; ours goes beside it in .claude/imported/ (same bytes there = done)
                if os.path.lexists(dest) and not (os.path.isfile(dest) and refuse_reason(p) is None and sha_file(dest) == sha_file(p)):
                    dest = os.path.join(wd, '.claude', 'imported', name)
                put_file(p, dest, rep, name)
            elif k == 'agent':
                put_file(p, os.path.join(wd, '.claude', 'agents', os.path.basename(p)), rep, it['label'])
            elif k == 'skill':
                put_tree(p, os.path.join(wd, '.claude', 'skills', os.path.basename(p)), rep)
            elif k == 'settings':
                merge_permissions(os.path.join(wd, '.claude', 'settings.json'), permissions_of(p)[0], rep)
    for it in chosen:
        if it['kind'] in ('bot', 'slackmod-bot') and target_for(it) is None:
            rep.notes += 1
            rep.line('안내', '%s 는 짝이 되는 봇(--bot %s:…)이 없어 사본 폴더에만 담았습니다' % (it['id'], it['id'].split(':', 1)[1]))
    # 3) manifest = the union of every run into this folder (no times — a re-run that adds nothing leaves the file alone)
    if not dry and os.path.isdir(to):
        lines = set(rep.manifest)
        lines.add('originals (read only): ' + ', '.join(sorted(tilde(it['path'], home) for it in chosen)))
        write_manifest(to, lines, rep)
    after, _ = fingerprint([f for it in chosen for f in source_files(it)])
    print('결과: 사본 %d · 그대로 %d · 이미 있어 안 덮음 %d · 거부 %d%s' % (rep.copied, rep.same, rep.kept, rep.refused, (' · 오류 %d' % rep.errors) if rep.errors else ''))
    if before == after:
        print('원본 지문 전후: 같음 (파일 %d개 · %s)' % (nfiles, before[:16]))
    else:
        print('원본 지문 전후: 달라짐 (%s → %s) — 원본이 바뀌었습니다, 멈추세요' % (before[:16], after[:16]))
        return 3
    return 2 if rep.errors else 0


def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__.strip())
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == 'detect':
        home = os.path.normpath(os.path.expanduser('~'))
        if '--home' in rest and rest.index('--home') + 1 < len(rest):
            home = os.path.normpath(rest[rest.index('--home') + 1])
        items, skipped = detect(home)
        out = {'home': home, 'count': len(items), 'items': [{k: (tilde(v, home) if k == 'path' else v) for k, v in it.items()} for it in items], 'skipped': skipped}
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0
    if cmd == 'import':
        return do_import(rest)
    print('detect_import.py: 모르는 명령 ' + cmd, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
