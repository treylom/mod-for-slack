#!/usr/bin/env python3
"""slackmod_config.py — the one place that reads the SlackMod config and turns it into per-bot files.

Subcommands (all print to stdout; secret values are never printed):
  validate  --config FILE                         → rc 0 ok · 1 problems (one line each)
  plan      --config FILE --root DIR --python P --node N --claude C --sh S --pass-sha HEX
                                                  → JSON {files:[{path,mode,content}], env:{bot:{K:V}}, bots:[…], aliases:{…}, rc_block:"…"}
  tree-fp   DIR [--exclude NAME]… [--exclude-path REL]… → sha256 of a folder (paths · contents · exec bit · symlinks as links, folder links too)
  env-upsert --file F [--set K=V]… [--secrets-from FILE]
                                                  → writes non-secret keys (and the NAME=value lines of FILE: the secret-named
                                                    extra_env of plan-stage), keeps every other line · prints same|changed
  env-export --file F NAME…                       → NAME=value lines read from the .env (the bot window exports them at start)
  env-plain NAME=value…                           → the NAME=value words of a launch.sh that pass the plain rule (name + value shape)
                                                    again, one per line — the start path of an older launch.sh · others named on stderr
  env-status --file F                             → "bot_token=set|missing app_token=set|missing"
  env-set-tokens --file F                         → reads two lines on stdin (bot token, app token), writes them 0600
  app-id    --file F                              → short one-way id of the app token (to spot one app used twice) · "-" if unset
  from-setup --setup FILE [--base CONFIG] [--home DIR]
                                                  → config JSON (stdout) made from the wizard's setup.json · rc 2 = input problems
                                                    (one line each on stderr) · deterministic: same setup (+ same base) = same bytes
  (env-upsert also takes --drop KEY… : removes that key's lines — a stale «ALLOWED_SLACK_GUEST_IDS» goes away when the list is emptied)
  set-effort --config FILE --bot NAME|all --value low|medium|high|xhigh|max|default [--setup FILE]
                                                  → sets bots[].effort in the config («default» = the key removed) and the same bot's
                                                    effort in the setup file when given and present · rc 2 = unknown bot / value
  effort-list --config FILE                       → one line per bot: name and effort («(기본)» = account default)
  render-contract --config FILE --template T      → the main contract (stdout): T's bytes, except that with a children_open that is not the
                                                    default the text inside «» on the «하위 세션이 맡았어요» line is that text · rc 2 = bad
                                                    config / the template has no such line (nothing on stdout)

Optional keys written by hand in config.json (a config without them behaves exactly as before; from-setup carries them through):
  slack.allowed_bot_user_ids  [U…]       bots outside this config that may speak to every bot here (merged after the config's own bots)
  slack.channel_ids           [C…|"*"]   more channels for the bridge; «*» (once, never first) = every channel the bot is invited to
  children_open               "…"        the opening line the bot leaves in a thread it opened a child session in (1~80 characters · one line ·
                                         no «» · default «하위 세션이 맡았어요»; only contract.md line 9 changes, contract-solo.md never)
  bots[].extra_channels       ["server:x"|"plugin:x@y"]   more development channels the bot window loads (after server:slack-channel)
  bots[].effort               low|medium|high|xhigh|max   «생각 깊이» → launch.sh SM_EFFORT (the bot window's --effort) · absent = account default
  bots[].projects             ["/abs/folder", …]          «작업 폴더» (≤20) → the bot folder's .claude/settings.json additionalDirectories
                                                          (after the wiki · sorted) + .claude/rules/slackmod-projects.md
  memory_setup                {"starter": true, "starter_path": "/abs"}   the kit's notes folder (templates/starter-wiki): files made
                                                          only where missing · added like a wiki · per bot .claude/rules/slackmod-memory.md
                                                          (from-setup writes it only when the setup file has no wiki.path)
  bots[].extra_env            {"NAME": "value"}           env for the bot window — an ALLOW list (env_route): only ① the plain names in
                                                          ENV_PLAIN (timezone · locale · NO_COLOR), written into launch.sh (0600), with
                                                          a value of the name's shape (a zone name · a locale · a «:» list of locales ·
                                                          NO_COLOR = plain text) and no token/key-shaped value, and ② credential names ending in ENV_SECRET_SUFFIX
                                                          (…_TOKEN …_API_KEY …_SECRET …_PASSWORD …) without a reserved prefix (ENV_RESERVED*),
                                                          whose value goes only to the bot's own .env (0600) and is read at start. Every
                                                          other name is refused · screens show variable NAMES only
"""
import hashlib, json, os, re, shlex, stat, sys, unicodedata

NAME = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
CHAN = re.compile(r'^[CG][A-Z0-9]{8,12}$')
USER = re.compile(r'^[UW][A-Z0-9]{8,12}$')
GUEST = re.compile(r'^U[A-Z0-9]{8,}$')   # guests: member IDs only (a «W» enterprise ID or a bot is not a guest)
BACKENDS = ('tmux', 'herdr')   # window_backend values the harness reads · absent = auto
# extra development channels a bot's main window loads besides the Slack bridge (--dangerously-load-development-channels … <these>)
EXTRA_CHANNEL = re.compile(r'^(server|plugin):[A-Za-z0-9][A-Za-z0-9._@:/-]{0,99}$')
ENV_NAME = re.compile(r'^[A-Z][A-Z0-9_]*$')
# bots[].extra_env — sec ④ round 2 (re-review 10-26): an ALLOW list. Rule: no name whose value a program in the bot window reads
# as a path, a program, a config file, a library folder, a proxy or a trust store. So the plain route takes only these exact names,
ENV_PLAIN = ('TZ', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_COLLATE', 'LC_MESSAGES', 'LC_MONETARY', 'LC_NUMERIC', 'LC_TIME', 'NO_COLOR')
# and the .env route only credential names (a value a tool sends, never loads) — the ending decides, a reserved prefix still refuses
ENV_SECRET_SUFFIX = ('_TOKEN', '_API_KEY', '_APIKEY', '_SECRET', '_SECRET_KEY', '_PASSWORD', '_PASSWD', '_ACCESS_KEY_ID', '_SECRET_ACCESS_KEY', '_PAT')
# names that can never be set from the config even when the ending fits, one reason per group (round 1 table · kept for the message):
ENV_RESERVED = (
    'PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'PWD', 'OLDPWD', 'TERM', 'TMPDIR', 'DISABLE_AUTOUPDATER',   # the launcher / the OS own these
    'IFS', 'BASH_ENV', 'ENV', 'PS0', 'PS1', 'PS2', 'PS3', 'PS4', 'SHELLOPTS', 'BASHOPTS', 'CDPATH',        # a shell reads these at start or at every prompt and runs what they hold
    'NODE_OPTIONS', 'NODE_PATH', 'PERL5OPT', 'RUBYOPT', 'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME',       # a language runtime loads code or switches from these
    'EDITOR', 'VISUAL', 'PAGER', 'MANPAGER', 'LESSOPEN', 'LESSCLOSE', 'SSH_ASKPASS', 'SUDO_ASKPASS')        # the program a tool starts on your behalf
ENV_RESERVED_PREFIX = (
    'LD_', 'DYLD_',                    # the dynamic loader (preload / inject a library)
    'GIT_',                            # every Git variable (external diff · ssh command · askpass · config injection)
    'BASH_', 'PROMPT_',                # bash start-up switches · the prompt hooks (PROMPT_COMMAND)
    'PYTHON',                          # every Python start-up switch
    'MODS_HARNESS_', 'SM_', 'SLACK_', 'ALLOWED_SLACK_', 'ANTHROPIC_', 'CLAUDE_')   # the harness · the launcher · the Slack bridge · Claude itself own these
    # (CLAUDE_ whole, round 2: CLAUDE_CODE_OAUTH_TOKEN ends like a credential and would swap the bot's Claude account)
ENV_RESERVED_SUFFIX = ('_COMMAND', '_OPTIONS')   # «run this» / «extra switches» variables of tools we do not know
MODES = ('quick', 'full', 'blank')
# a value that looks like a credential never goes into a setup file or a config (setup.json has no secret columns)
SECRET_SHAPE = re.compile(r'(?<![A-Za-z0-9])(xox[abprs]-|xapp-|sk-[A-Za-z0-9_-]{10,}|ghp_|gho_|ghs_|github_pat_|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10}'
                          r'|[Bb]earer\s+(?=\S*\d)[A-Za-z0-9._~+/=-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)')
SECRET_KEY = re.compile(r'token|secret|passw|credential|api[_-]?key|private[_-]?key|auth', re.I)
MODEL = re.compile(r'^[A-Za-z0-9._\[\]-]{1,60}$')
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')
SECRET_KEYS = ('SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN')
PLACEHOLDER = ('XXXX', 'YOUR-', 'REPLACE')
RC_BEGIN = '# >>> slackmod >>>'
RC_END = '# <<< slackmod <<<'


def die(msg, rc=2):
    print('slackmod: ' + msg, file=sys.stderr)
    sys.exit(rc)


def arg(argv, name, default=None, many=False):
    vals = [argv[i + 1] for i, a in enumerate(argv[:-1]) if a == name]
    if many:
        return vals
    return vals[-1] if vals else default


def load(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        die('config not found: ' + path)
    except ValueError as exc:
        die('config is not valid JSON (%s line %s)' % (type(exc).__name__, getattr(exc, 'lineno', '?')))


def placeholder(v):
    return isinstance(v, str) and any(p in v for p in PLACEHOLDER)


def env_reserved(k):
    return k in ENV_RESERVED or k.startswith(ENV_RESERVED_PREFIX) or k.endswith(ENV_RESERVED_SUFFIX)


def env_route(k):
    """bots[].extra_env name → 'plain' (into launch.sh) · 'secret' (value only in the bot's .env) · None (refused). The one rule for
    validate, plan, env-upsert --secrets-from and env-export (sec ④ round 2)."""
    if not isinstance(k, str) or not ENV_NAME.fullmatch(k) or env_reserved(k):
        return None
    if k in ENV_PLAIN:
        return 'plain'
    return 'secret' if k.endswith(ENV_SECRET_SUFFIX) else None


# sec ④ round 4 (security review r3 F-④): a plain value has its name's shape — glibc reads TZ=/path and TZ=:path as a zone FILE (security review
# r3 · Linux), and a locale value is a name, never a path. TZ = a zone name: parts of letters, digits, _ + - joined by «/» (so no leading
# / or :, no «.» at all and no «..») · LANG / LC_* = C · C.charset · POSIX · ll(_TT)(.charset)(@variant) · LANGUAGE = such names joined
# by «:» · NO_COLOR = one line of plain text as before. The one check for validate, plan and env-plain (the start path).
TZ_VALUE = re.compile(r'[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)*')
LOCALE_VALUE = re.compile(r'C(\.[A-Za-z0-9_-]+)?|POSIX|[a-z]{2,3}(_([A-Z]{2}|[0-9]{3}))?(\.[A-Za-z0-9_-]+)?(@[A-Za-z0-9_-]+)?')
PLAIN_TEXT_SAYS = 'the value must be one line of plain text (no token or key shapes · no placeholder)'


def plain_value_ok(k, v):
    if not isinstance(v, str) or len(v) > 500 or any(c in v for c in '\n\r\0') or SECRET_SHAPE.search(v) or placeholder(v):
        return False
    if k == 'TZ':
        return bool(TZ_VALUE.fullmatch(v))
    if k == 'LANGUAGE':
        return all(LOCALE_VALUE.fullmatch(x) for x in v.split(':'))
    if k == 'LANG' or k.startswith('LC_'):
        return bool(LOCALE_VALUE.fullmatch(v))
    return True


def plain_value_says(k):
    if k == 'TZ':
        return 'the value must be a zone name like Asia/Seoul or UTC (letters, digits, _ + - in parts joined by /; no leading / or :, no dots)'
    if k == 'LANGUAGE':
        return 'the value must be locale names joined by «:» like en_US:en (no path)'
    if k == 'LANG' or k.startswith('LC_'):
        return 'the value must be a locale name like ko_KR.UTF-8, C or POSIX (no path)'
    return PLAIN_TEXT_SAYS


MAX_PROJECTS = 20


def abs_dir_ok(p):
    return (isinstance(p, str) and p.startswith('/') and not placeholder(p) and not any(c in p for c in '\n\r\t\'"$`\\')
            and '..' not in p.split('/') and not SECRET_SHAPE.search(p))


def problems(cfg):
    out = []
    if not isinstance(cfg, dict) or cfg.get('schema') != 1:
        return ['schema must be 1']
    s = cfg.get('slack') or {}
    # slack.enabled (absent = true): false = «Slack 연결은 나중에» — the two IDs may then be empty (still checked when given)
    enabled = s.get('enabled', True)
    if not isinstance(enabled, bool):
        out.append('slack.enabled: true or false')
        enabled = True
    ch, owner = s.get('channel_id'), s.get('owner_user_id')
    # slack.channel_ids (list): more channels than the one primary channel_id; «*» = every channel the bot is invited to (the bridge's
    # own form «C…,*») — never the first entry overall. With no channel_id, the list's first entry is the primary channel.
    chs = s.get('channel_ids')
    ids_first_ok = False
    if chs is not None:
        if (not isinstance(chs, list) or len(chs) > 50 or len(set(map(str, chs))) != len(chs)
                or any(not isinstance(x, str) or not (x == '*' or (CHAN.fullmatch(x) and not placeholder(x))) for x in chs)):
            out.append('slack.channel_ids: a list of channel IDs (start with C or G, no repeats); one «*» may stand for every channel the bot is invited to')
        else:
            first = ch if isinstance(ch, str) and ch else (chs[0] if chs else '')
            if first == '*':
                out.append('slack.channel_ids: the first channel must be a real channel ID, not «*» (put it in channel_id, or list it first)')
            elif chs.count('*') > 1:
                out.append('slack.channel_ids: «*» only once')
            ids_first_ok = bool(chs) and chs[0] != '*' and not (isinstance(ch, str) and ch)
    if enabled or ch not in ('', None):
        if not (ch in ('', None) and ids_first_ok):
            if not isinstance(ch, str) or not CHAN.fullmatch(ch) or placeholder(ch):
                out.append('slack.channel_id: put the real channel ID (starts with C, e.g. from channel details)')
    if 'allowed_bot_user_ids' in s:
        ab = s['allowed_bot_user_ids']
        if not isinstance(ab, list) or len(ab) > 50 or len(set(map(str, ab))) != len(ab) or any(not isinstance(x, str) or not USER.fullmatch(x) or placeholder(x) for x in ab):
            out.append('slack.allowed_bot_user_ids: a list of other bots\' Slack member IDs (start with U), no repeats — they may speak to every bot here')
        elif isinstance(owner, str) and owner in ab:
            out.append('slack.allowed_bot_user_ids: the owner (slack.owner_user_id) is a person, not a bot')
    if enabled or owner not in ('', None):
        if not isinstance(owner, str) or not USER.fullmatch(owner) or placeholder(owner):
            out.append('slack.owner_user_id: put the real Slack member ID of the person who talks to the bots (starts with U)')
    for k in ('drop_notice', 'drop_notice_no_mention'):
        if k in s and not isinstance(s[k], bool):
            out.append('slack.%s: true or false' % k)
    if 'guests' in s:
        g = s['guests']
        if not isinstance(g, list) or len(g) > 50 or any(not isinstance(x, str) or not GUEST.fullmatch(x) for x in g) or len(set(g)) != len(g):
            out.append('slack.guests: a list of Slack member IDs (start with U), no repeats — empty list = nobody')
        elif isinstance(owner, str) and owner in g:
            out.append('slack.guests: the owner (slack.owner_user_id) is not a guest')
    if 'window_backend' in cfg and cfg['window_backend'] not in BACKENDS:
        out.append('window_backend: tmux or herdr (leave it out = automatic)')
    w = cfg.get('wiki')
    if w is not None:
        wp = w.get('path') if isinstance(w, dict) else 0
        if not isinstance(w, dict) or (wp not in (None, '') and (not isinstance(wp, str) or not wp.startswith('/') or any(c in wp for c in '\n\r\t\'"$`\\'))):
            out.append('wiki.path: the wiki folder as an absolute path, or null (no wiki)')
    if 'browser' in cfg and cfg['browser'] not in BROWSERS:
        out.append('browser: playwright, aside or none')
    ms = cfg.get('memory_setup')
    if ms is not None and (not isinstance(ms, dict) or set(ms) - {'starter', 'starter_path'} or not isinstance(ms.get('starter'), bool)
                           or (ms.get('starter') and not abs_dir_ok(ms.get('starter_path')))):
        out.append('memory_setup: {"starter": true, "starter_path": "/absolute/notes/folder"} (the kit\'s notes folder) or leave it out')
    if 'help_skill' in cfg and not isinstance(cfg['help_skill'], bool):
        out.append('help_skill: true or false (the kit\'s «무엇을 쓰면 되나요?» skill in each bot folder)')
    mode = cfg.get('mode', 'full')
    if mode not in MODES:
        out.append('mode: quick, full or blank')
    bots = cfg.get('bots')
    # «blank» = install only, no bot yet (mode written by the setup wizard) — only then may the list be empty
    if not isinstance(bots, list) or not (0 if mode == 'blank' else 1) <= len(bots) <= 4:
        out.append('bots: ' + ('0 to 4 bots' if mode == 'blank' else '1 to 4 bots'))
        bots = []
    names = []
    for i, b in enumerate(bots):
        where = 'bots[%d]' % i
        if not isinstance(b, dict):
            out.append(where + ': must be an object')
            continue
        n = b.get('name')
        if not isinstance(n, str) or not NAME.fullmatch(n):
            out.append(where + '.name: lowercase letters, digits, - (1-32 chars, starts with a letter)')
        elif n in names:
            out.append(where + '.name: used twice')
        else:
            names.append(n)
        wd = b.get('work_dir')
        if not isinstance(wd, str) or not wd.startswith('/') or placeholder(wd) or any(ch in wd for ch in '\n\t\'"$`\\'):
            out.append(where + '.work_dir: absolute WSL path of this bot\'s folder (e.g. /home/<you>/bots/<name>)')
        sid = b.get('slack_bot_user_id', '')
        if sid not in ('', None) and (not isinstance(sid, str) or not USER.fullmatch(sid) or placeholder(sid)):
            out.append(where + '.slack_bot_user_id: empty, or the bot\'s Slack member ID (starts with U)')
        m = b.get('model', '')
        if m not in ('', None) and (not isinstance(m, str) or not MODEL.fullmatch(m)):
            out.append(where + '.model: empty (account default) or a model name like sonnet / opus')
        e = b.get('effort', '')
        if e not in ('', None) and e not in EFFORTS:
            out.append(where + '.effort: empty (account default) or one of ' + ', '.join(EFFORTS))
        if 'projects' in b:
            pj = b['projects']
            if (not isinstance(pj, list) or len(pj) > MAX_PROJECTS or any(not abs_dir_ok(x) for x in pj)
                    or len(set(os.path.normpath(x) for x in pj)) != len(pj)
                    or (isinstance(wd, str) and os.path.normpath(wd) in [os.path.normpath(x) for x in pj])):
                out.append(where + '.projects: a list (up to %d) of absolute folders the bot works in — no repeats, not its own work_dir' % MAX_PROJECTS)
        ec = b.get('extra_channels')
        if ec is not None and (not isinstance(ec, list) or len(ec) > 8 or len(set(map(str, ec))) != len(ec) or 'server:slack-channel' in ec
                               or any(not isinstance(x, str) or not EXTRA_CHANNEL.fullmatch(x) for x in ec)):
            out.append(where + '.extra_channels: a list (up to 8) of channels the bot window also loads — «server:<name>» or «plugin:<name>@<source>», no spaces, no repeats')
        ee = b.get('extra_env')
        if ee is not None:
            if not isinstance(ee, dict) or len(ee) > 20:
                out.append(where + '.extra_env: an object of NAME: value (up to 20)')
            else:
                for k, v in ee.items():
                    kk = k if isinstance(k, str) and not SECRET_SHAPE.search(k) else '<name>'
                    if not isinstance(k, str) or not ENV_NAME.fullmatch(k):
                        out.append(where + '.extra_env: «%s» is not a variable name (capital letters, digits, _ — starts with a letter)' % kk)
                    elif env_reserved(k):
                        out.append(where + '.extra_env.%s: reserved name (the launcher, the system, a shell, Git, the loader or the Slack bridge owns it)' % kk)
                    elif env_route(k) is None:
                        out.append(where + '.extra_env.%s: not an allowed name — plain values: %s · credentials: a name ending in %s (kept in the bot\'s .env)'
                                   % (kk, ' '.join(ENV_PLAIN), ' '.join(ENV_SECRET_SUFFIX)))
                    elif env_route(k) == 'secret':
                        # the secret itself: one clean line · it is kept only in the bot's .env (0600), never in launch.sh
                        if not isinstance(v, str) or not v or len(v) > 500 or any(c in v for c in '\n\r\0') or placeholder(v):
                            out.append(where + '.extra_env.%s: the value must be one non-empty line (up to 500 characters · no placeholder)' % kk)
                    elif not plain_value_ok(k, v):   # sec ④ round 4: the value has its name's shape (TZ · locale · locale list · text)
                        out.append(where + '.extra_env.%s: %s' % (kk, plain_value_says(k)))
    if isinstance(owner, str) and owner:
        for i, b in enumerate(bots):
            if isinstance(b, dict) and b.get('slack_bot_user_id') == owner:
                out.append('slack.owner_user_id: same as bots[%d].slack_bot_user_id — put the person\'s member ID, not a bot\'s' % i)
    al = cfg.get('aliases') or {}
    for k in ('all', 'all_stop'):
        v = al.get(k)
        if not isinstance(v, str) or not NAME.fullmatch(v):
            out.append('aliases.%s: lowercase letters, digits, -' % k)
    taken = set(names) | {n + '-stop' for n in names} | {'slackmod'}
    for k in ('all', 'all_stop'):
        if al.get(k) in taken:
            out.append('aliases.%s: same as a bot name' % k)
    if al.get('all') == al.get('all_stop'):
        out.append('aliases: all and all_stop must differ')
    if cfg.get('permission', 'skip') not in ('skip', 'ask'):
        out.append('permission: skip or ask')
    if 'children' in cfg and not isinstance(cfg['children'], bool):
        out.append('children: true or false («하위 세션 쓰기»)')
    if 'router' in cfg:
        out += router_problems(cfg['router'])
    if 'children_open' in cfg:
        why = children_open_problem(cfg['children_open'])
        if why:
            out.append('children_open: ' + why + ' («하위 세션 쓰기» 켬일 때 스레드에 남기는 여는 말)')
    if 'owner_tag' in cfg and not isinstance(cfg['owner_tag'], bool):
        out.append('owner_tag: true or false (the owner tag at the start of a thread reply in the owner\'s DM)')
    c = cfg.get('child') or {}
    if not isinstance(c.get('model'), str) or not MODEL.fullmatch(c.get('model', '')):
        out.append('child.model: a model name like sonnet')
    if c.get('effort') not in EFFORTS:
        out.append('child.effort: one of ' + ', '.join(EFFORTS))
    for k, lo, hi in (('min_disk_free_gb', 1, 1000), ('min_free_mem_pct', 1, 90)):
        v = c.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            out.append('child.%s: a number from %d to %d' % (k, lo, hi))
    return out


BROWSERS = ('playwright', 'aside', 'none')
# the one browser server «playwright» writes into a bot folder's .mcp.json (version pinned · an existing «playwright» entry is left alone)
PLAYWRIGHT_MCP = {'command': 'npx', 'args': ['-y', '@playwright/mcp@0.0.83']}


class MergeError(Exception):
    """An existing project file we would merge into is unusable (not JSON · wrong shape) — nothing is written."""


def read_json_obj(path):
    """→ (dict | None, text | None). None = the file does not exist. Raises MergeError if it exists but is not a JSON object."""
    try:
        with open(path, encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        return None, None
    except (OSError, UnicodeDecodeError) as exc:
        raise MergeError('%s: cannot be read (%s) — left untouched' % (path, type(exc).__name__))
    try:
        d = json.loads(text)
    except ValueError:
        raise MergeError('%s: is not valid JSON — left untouched; fix or remove it, then run again' % path)
    if not isinstance(d, dict):
        raise MergeError('%s: the top level must be a JSON object — left untouched' % path)
    return d, text


def merge_settings(path, wiki=None, approve=None):
    """Project settings, ONE merge for every wizard column that lands here (two separate merges would overwrite each other):
    wiki (one folder or a list, in order: the wiki / notes folder, then the bot's projects) → permissions.additionalDirectories · approve → enabledMcpjsonServers (the .mcp.json server the kit itself added —
    a fresh Claude Code otherwise stops at «New MCP server found in this project» on the bot's first launch, cursor on
    «Continue without», measured 2026-10-25). A name in disabledMcpjsonServers stays off. No duplicates · other keys kept.
    → new file text, or None when nothing needs to change."""
    d, _ = read_json_obj(path)
    d = d if d is not None else {}
    changed = False
    want = [wiki] if isinstance(wiki, str) else list(wiki or [])
    if want:
        perms = d.get('permissions', {})
        if not isinstance(perms, dict):
            raise MergeError('%s: «permissions» must be an object — left untouched' % path)
        dirs = perms.get('additionalDirectories', [])
        if not isinstance(dirs, list):
            raise MergeError('%s: «permissions.additionalDirectories» must be a list — left untouched' % path)
        add = []
        for x in want:
            if x not in dirs and x not in add:
                add.append(x)
        if add:
            perms['additionalDirectories'] = dirs + add
            d['permissions'] = perms
            changed = True
    if approve:
        on, off = d.get('enabledMcpjsonServers', []), d.get('disabledMcpjsonServers', [])
        for key, val in (('enabledMcpjsonServers', on), ('disabledMcpjsonServers', off)):
            if not isinstance(val, list):
                raise MergeError('%s: «%s» must be a list — left untouched' % (path, key))
        if approve not in on and approve not in off:
            d['enabledMcpjsonServers'] = on + [approve]
            changed = True
    return json.dumps(d, indent=2, ensure_ascii=False) + '\n' if changed else None


def merge_settings_dirs(path, wiki):
    """Project settings: the wiki folder into permissions.additionalDirectories only (kept for callers · = merge_settings)."""
    return merge_settings(path, wiki=wiki)


def kit_playwright_entry(mcp_text, path):
    """True when the «playwright» entry of this .mcp.json text (or file, when text is None) is the kit's own pinned one."""
    if mcp_text is None:
        d, _ = read_json_obj(path)
    else:
        d = json.loads(mcp_text)
    e = ((d or {}).get('mcpServers') or {}).get('playwright')
    return isinstance(e, dict) and e.get('command') == PLAYWRIGHT_MCP['command'] and e.get('args') == PLAYWRIGHT_MCP['args']


def merge_mcp_playwright(path):
    """Project .mcp.json: add the pinned playwright server unless a «playwright» entry already exists. → new text or None."""
    d, _ = read_json_obj(path)
    d = d if d is not None else {}
    servers = d.get('mcpServers', {})
    if not isinstance(servers, dict):
        raise MergeError('%s: «mcpServers» must be an object — left untouched' % path)
    if 'playwright' in servers:
        return None
    servers['playwright'] = {'command': PLAYWRIGHT_MCP['command'], 'args': list(PLAYWRIGHT_MCP['args'])}
    d['mcpServers'] = servers
    return json.dumps(d, indent=2, ensure_ascii=False) + '\n'


def bot_folder_file(work_dir, rel):
    """<work_dir>/<rel> for a file the kit merges into a bot folder. A bot folder is often a cloned repository and a
    repository can commit symbolic links, so no link may sit on the way (the file itself included) — a write through one
    would land outside the folder."""
    p = os.path.normpath(work_dir)
    for part in rel.split('/'):
        p += '/' + part
        if os.path.islink(p):
            raise MergeError('%s: is a symbolic link — the installer does not write through links inside a bot folder; '
                             'replace it with a plain file or folder (or remove it), then run again' % p)
    return p


def existing_mode(path):
    try:
        return '%o' % stat.S_IMODE(os.stat(path).st_mode)
    except OSError:
        return '644'


MUX_VALUES = ('auto', 'tmux', 'cmux', 'herdr', 'orca')
# the wizard's window-tool choice → the harness' window_backend (cmux = the multiplexer inside a cmux window; orca / auto = not pinned)
MUX_TO_BACKEND = {'tmux': 'tmux', 'cmux': 'tmux', 'herdr': 'herdr'}
DEFAULT_ALIASES = {'all': 'allbots', 'all_stop': 'allbots-stop'}
DEFAULT_CHILD = {'model': 'sonnet', 'effort': 'medium', 'min_disk_free_gb': 20, 'min_free_mem_pct': 15}
# the wizard's «하위 라우터(판정 모델이 고름)» column → the harness key session.jev_route (lib/jevroute.js · its words off/shadow/on)
ROUTER_MODES = ('off', 'shadow', 'on')
CHILDREN_OPEN_DEFAULT = '하위 세션이 맡았어요'   # the text inside «» on main-contract.md line 9 (the same words as setup/lib/plan.py)
CHILDREN_OPEN_MAX = 80


def children_open_problem(v):
    """→ None when usable, else the reason (never the value: it may be token-shaped). The same rule as setup/lib/plan.py."""
    if not isinstance(v, str):
        return 'a string — the opening line, one line of 1~%d characters' % CHILDREN_OPEN_MAX
    if not 1 <= len(v) <= CHILDREN_OPEN_MAX or not v.strip():
        return 'must be 1~%d characters and not only spaces' % CHILDREN_OPEN_MAX
    if any(unicodedata.category(c) in ('Cc', 'Zl', 'Zp') for c in v):
        return 'one line only — no line break, tab or other control character'
    if '«' in v or '»' in v:
        return 'no « or » (they mark where the text sits in the contract)'
    if SECRET_SHAPE.search(v):
        return 'looks like a secret — never write a key or token here'
    return None


def render_contract(cfg, template):
    """main-contract.md bytes + config → the contract to install. children_open absent or the default = the template, byte for byte;
    else only the text inside «» on the opening-line row is swapped (ValueError when the template has no such row exactly once)."""
    val = cfg.get('children_open')
    if val is None or val == CHILDREN_OPEN_DEFAULT:
        return template
    old = '«' + CHILDREN_OPEN_DEFAULT + '»'
    text = template.decode('utf-8')
    if text.count(old) != 1:
        raise ValueError('the contract template has no single «%s» row — children_open cannot be applied' % CHILDREN_OPEN_DEFAULT)
    return text.replace(old, '«' + val + '»', 1).encode('utf-8')
BUNDLED_JUDGE = 'bundled'                   # the example judge this kit installs: <root>/lib/route_judge.py
# its key (sec r6 ⓑ2 · 10-26): one 0600 file in the bot's slack folder (slackmod set-judge-key) that the judge reads at each call
# (--key-file on its argv) — never in the bot's environment, so the bot's Bash, its child sessions and `env` do not carry it.
# Programs of the same account can still read the file: use a judge-only key with a spend limit.
JUDGE_KEY_FILE = 'route-judge.key'
BUNDLED_JUDGE_TIMEOUT_MS = 5000             # the harness's cap: a network judge needs more than the 1500 ms default
# the fix line for a pass.sh that no longer matches its pin (harness.json policyOptions → the runner's block message · doctor [13]) ·
# names the folder holding MANIFEST.txt: the unzipped bundle itself, or slackmod/ inside the public repo (its top install.sh is
# the setup wizard, which does not re-pin) — VM 10-26 measured the repo shape
REPIN_HINT = 'slackmod 키트 폴더(MANIFEST.txt 있는 곳 · 공개 저장소면 그 안 slackmod/)에서 bash install.sh — 원본으로 되돌리고 확인 값을 새로 씀(고친 파일은 백업 폴더에)'


def judge_words_ok(j):
    # a judge command = 1~16 words, each one line of 1~300 characters, the first not an option (the harness runs it without a shell)
    return (isinstance(j, list) and 1 <= len(j) <= 16 and all(isinstance(x, str) and 0 < len(x) <= 300 and not any(c in x for c in '\n\r\t\0') for x in j)
            and not j[0].startswith('-'))


def router_problems(rt):
    if not isinstance(rt, dict):
        return ['router: an object like {"mode": "off"} («하위 라우터»)']
    out = ['router.%s: unknown key' % (k if isinstance(k, str) and not SECRET_SHAPE.search(k) else '<name>') for k in rt if k not in ('mode', 'judge')]
    mode = rt.get('mode', 'off')
    if mode not in ROUTER_MODES:
        out.append('router.mode: off, shadow or on («끔 · 기록만 · 켬»)')
    j = rt.get('judge')
    if j is not None and j != BUNDLED_JUDGE and not judge_words_ok(j):
        out.append('router.judge: "bundled" (the example judge) or the judge command as a list of words (1~16 · one line each · the first is the program)')
    elif isinstance(j, list) and any(SECRET_SHAPE.search(x) for x in j):
        out.append('router.judge: looks like a secret — never a key in the judge command (the bundled judge reads its own from a file: «slackmod set-judge-key <bot>»)')
    elif j is None and mode in ('shadow', 'on'):
        out.append('router.judge: shadow and on need a judge — "bundled" or a command')
    return out


def router_route(cfg, root, py, key_file):
    """config → the harness's session.jev_route, or None (off · no judge · children off = nothing written, same bytes as before).
    key_file = this bot's judge key file (the bundled judge's --key-file · sec r6 ⓑ2)."""
    rt = cfg.get('router')
    if cfg.get('children') is False or not isinstance(rt, dict) or rt.get('mode') not in ('shadow', 'on') or router_problems(rt):
        return None
    if rt.get('judge') == BUNDLED_JUDGE:
        return {'mode': rt['mode'], 'argv': [py, '-I', root + '/lib/route_judge.py', '--key-file', key_file], 'timeout_ms': BUNDLED_JUDGE_TIMEOUT_MS}
    return {'mode': rt['mode'], 'argv': list(rt['judge'])}


def secret_findings(node, where='setup.json'):
    """Every place a credential-shaped key name or value sits in a loaded JSON value (names the place, never the value)."""
    out = []
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and SECRET_KEY.search(k):
                out.append('%s.%s: no secret columns — tokens go in only through «slackmod set-token» in the terminal' % (where, k))
            out.extend(secret_findings(v, '%s.%s' % (where, k)))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out.extend(secret_findings(v, '%s[%d]' % (where, i)))
    elif isinstance(node, str) and SECRET_SHAPE.search(node):
        out.append('%s: looks like a secret (token / key shape) — never put it here' % where)
    return out


def setup_to_config(st, base, home):
    """setup.json (dict) [+ the config already installed] → (config dict | None, problems list)."""
    if not isinstance(st, dict) or st.get('schema') != 1:
        return None, ['setup.json schema must be 1']
    probs = secret_findings(st)
    mode = st.get('mode', 'quick')
    if mode not in MODES:
        probs.append('mode: quick, full or blank')
    mux = st.get('mux', 'auto')
    if mux not in MUX_VALUES:
        probs.append('mux: one of ' + ', '.join(MUX_VALUES))
    sl = st.get('slack')
    sl = sl if isinstance(sl, dict) else {}
    if 'slack' in st and not isinstance(st['slack'], dict):
        probs.append('slack: must be an object')
    sbots = st.get('bots', [])
    if not isinstance(sbots, list):
        probs.append('bots: must be a list')
        sbots = []
    if probs:
        return None, probs
    base = base if isinstance(base, dict) else {}
    bslack = base.get('slack') if isinstance(base.get('slack'), dict) else {}
    bchild = base.get('child') if isinstance(base.get('child'), dict) else {}
    baliases = base.get('aliases') if isinstance(base.get('aliases'), dict) else {}
    bbots = {b.get('name'): b for b in (base.get('bots') or []) if isinstance(b, dict)}
    slack = {'enabled': sl.get('enabled', True), 'channel_id': sl.get('channel_id') or '',
             'owner_user_id': sl.get('owner_user_id') or '', 'guests': sl.get('guests', []),
             'drop_notice': bslack.get('drop_notice', True), 'drop_notice_no_mention': bslack.get('drop_notice_no_mention', True)}
    # hand-written keys the setup file has no column for stay as they were (a re-plan must not wipe them)
    for k in ('allowed_bot_user_ids', 'channel_ids'):
        if k in bslack:
            slack[k] = bslack[k]
    bots = []
    for b in sbots:
        if not isinstance(b, dict):
            bots.append(b)   # problems() names it
            continue
        n = b.get('name')
        wd = b.get('work_dir')
        if wd in (None, '') and isinstance(n, str):
            wd = home + '/bots/' + n
        if isinstance(wd, str) and wd.startswith('~/'):
            wd = home + wd[1:]
        old = bbots.get(n, {}) if isinstance(n, str) else {}
        row = {'name': n, 'work_dir': wd,
               'slack_bot_user_id': b.get('slack_bot_user_id', old.get('slack_bot_user_id', '')),
               'model': b.get('model', old.get('model', ''))}
        # effort · projects: the setup file's column wins, a setup file without it keeps the config's (like model) — written
        # only when not empty, so a config without them stays the same bytes
        eff = b['effort'] if 'effort' in b else old.get('effort', '')
        if eff:
            row['effort'] = eff
        pj = b['projects'] if 'projects' in b else old.get('projects', [])
        if isinstance(pj, list):
            pj = [home + x[1:] if isinstance(x, str) and x.startswith('~/') else x for x in pj]
        if pj:
            row['projects'] = pj
        for k in ('extra_channels', 'extra_env'):
            if k in old:
                row[k] = old[k]
        bots.append(row)
    cfg = {'schema': 1, 'mode': mode, 'slack': slack, 'bots': bots,
           'aliases': {'all': baliases.get('all', DEFAULT_ALIASES['all']), 'all_stop': baliases.get('all_stop', DEFAULT_ALIASES['all_stop'])},
           'permission': base.get('permission', 'skip'),
           'child': dict((k, bchild.get(k, v)) for k, v in DEFAULT_CHILD.items())}
    if mux in MUX_TO_BACKEND:
        cfg['window_backend'] = MUX_TO_BACKEND[mux]
    # wizard columns the installer applies to the bot folders (see plan()) — wiki folder · browser server
    wk = st.get('wiki')
    wk = wk.get('path') if isinstance(wk, dict) else None
    if isinstance(wk, str) and wk.startswith('~/'):
        wk = home + wk[1:]
    cfg['wiki'] = {'path': wk or None}
    # the kit's notes folder (memory_setup.starter) — only when there is no wiki already (that wiki is used instead)
    ms = st.get('memory_setup')
    if isinstance(ms, dict) and ms.get('starter') is True and not wk:
        sp = ms.get('starter_path') or home + '/SlackModWiki'
        if isinstance(sp, str) and sp.startswith('~/'):
            sp = home + sp[1:]
        cfg['memory_setup'] = {'starter': True, 'starter_path': sp}
    if isinstance(st.get('recommend'), dict):   # stage-1 wizard: the base layer's help skill goes into every bot folder
        cfg['help_skill'] = True
    elif 'help_skill' in base:
        cfg['help_skill'] = base['help_skill']
    cfg['browser'] = st.get('browser', 'playwright')
    cfg['children'] = st.get('children', True)     # 10-26 «하위 세션 쓰기» (absent = on, as before the column)
    # 11-03 «여는 말»: the setup file's column wins · a setup file without it keeps what the config had · neither = no key (the default text)
    co = st['children_open'] if 'children_open' in st else base.get('children_open')
    if co is not None or 'children_open' in st:
        cfg['children_open'] = co   # problems() names a bad one
    # «하위 라우터»: the setup file's column wins · a setup file written before the column keeps what the config had
    rt = st.get('router') if 'router' in st else base.get('router')
    if isinstance(rt, dict):
        cfg['router'] = {'mode': rt.get('mode', 'off'), 'judge': rt.get('judge')}
    elif rt is not None:
        cfg['router'] = rt   # problems() names it
    if 'owner_tag' in base:   # hand-written (no setup column) — a re-plan keeps it
        cfg['owner_tag'] = base['owner_tag']
    return cfg, problems(cfg)


def q(v):
    return shlex.quote(str(v))


STARTER_TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'templates', 'starter-wiki')
PROJECTS_RULE = '.claude/rules/slackmod-projects.md'
MEMORY_RULE = '.claude/rules/slackmod-memory.md'
HELP_SKILL = '.claude/skills/slackmod-help/SKILL.md'
HELP_TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'templates', 'skills', 'slackmod-help', 'SKILL.md')


def starter_files(template, dest):
    """The kit's notes folder template → [(target path, content)] for the files not yet at dest (a file already there — edited or
    not — is never touched). No link may sit on the way inside dest (the same rule as a bot folder)."""
    if not os.path.isdir(template):
        raise MergeError('%s: the notes folder template is missing from this kit (templates/starter-wiki) — get the kit again' % template)
    out = []
    for dirpath, dirnames, filenames in os.walk(template):
        dirnames.sort()
        for name in sorted(filenames):
            src = os.path.join(dirpath, name)
            rel = os.path.relpath(src, template).replace(os.sep, '/')
            target = bot_folder_file(dest, rel)
            if os.path.lexists(target):
                continue
            with open(src, encoding='utf-8') as f:
                out.append((target, f.read()))
    return sorted(out)


def plan(cfg, root, py, node, claude, sh, pass_sha, starter_template=None):
    s, c, al = cfg['slack'], cfg['child'], cfg['aliases']
    bots = cfg['bots']
    owner = s.get('owner_user_id')
    owner = owner if isinstance(owner, str) and owner else ''
    files, env, env_drop, secret_out = [], {}, {}, {}
    # channels the bridge listens to, in the bridge's own «C…,C…,*» form (first = primary): channel_id first, then channel_ids, no repeats
    channel_ids = []
    for x in ([s.get('channel_id')] if s.get('channel_id') else []) + list(s.get('channel_ids') or []):
        if x and x not in channel_ids:
            channel_ids.append(x)
    app = root + '/app'
    # Claude Code's own memory on this machine: auto memory (~/.claude/projects/<folder>/memory), the user CLAUDE.md, and
    # each bot folder's CLAUDE.md. The harness refuses a 하위 session's own write there (memory guard, «하위 기억 쓰기 막기»)
    # — a sub-session reports in its result file and the bot decides what to keep. The bot's own session writes as before.
    home = os.path.normpath(os.path.expanduser('~'))
    # the kit's notes folder (memory_setup.starter) — a wiki folder, when there is one, is used instead
    ms = cfg.get('memory_setup') if isinstance(cfg.get('memory_setup'), dict) else {}
    starter = None
    if ms.get('starter') is True and not (cfg.get('wiki') or {}).get('path'):
        if not abs_dir_ok(ms.get('starter_path')):
            die('memory_setup.starter_path: not usable — run validate')
        starter = os.path.normpath(ms['starter_path'])
    mem_roots = [home + '/.claude/projects', home + '/.claude/CLAUDE.md'] + \
                sorted({os.path.normpath(x['work_dir']) + '/CLAUDE.md' for x in bots})
    for b in bots:
        n = b['name']
        bd = '%s/bots/%s' % (root, n)
        harness = {
            'schemaVersion': 1,
            'bots': [{'name': n, 'migrated': True, 'tmux_session': n, 'slack_user_id': b.get('slack_bot_user_id') or ''}],
            'slack': {'home_channel': channel_ids[0] if channel_ids else ''},
            'paths': {
                'vault_root': b['work_dir'], 'room_root': b['work_dir'],
                'nodeExecutable': node, 'pythonExecutable': py,
                'hookRunner': app + '/mods-harness/src/hooks-port/runner.py',
                'readinessRoot': '%s/state/%s/readiness' % (root, n), 'runtimeRoot': '%s/state/%s/runtime' % (root, n),
            },
            'hooks': {
                'strategy': 'isolated-settings',
                'requiredGateIds': ['slackmod-pass:PreToolUse'],
                'childPolicyReviewed': True,
                'entries': [{'id': 'slackmod-pass:PreToolUse', 'event': 'PreToolUse', 'matcher': '.*',
                             'nativePolicy': 'pinned-legacy', 'blocking': True, 'timeoutMs': 7000,
                             'disposition': 'native-group2'}],
                # timeouts (10-26): a gate past its time refuses the tool call (runner Refusal → deny), and this one gate
                # matches every call — on a very busy Mac 3000 ms refused calls while pass.sh itself only passes. 7000 = the
                # runner's per-entry cap (budget DEFAULT_ENTRY_TIMEOUT_MS); the policy's own sh run gets 6000 so it ends first.
                # repinHint = the one fix line the runner puts in its block message when pass.sh no longer matches its pin
                # («확인 값이 안 맞음: pass.sh · 다시 맞추기 = …») — never automatic: re-running install.sh restores the kit's own
                # pass.sh (an edited one goes to the backup folder) and writes its sha here again
                'policyOptions': {'pinned-legacy': {'sourcePath': root + '/hooks/pass.sh', 'sourceSha256': pass_sha,
                                                    'interpreter': 'sh', 'interpreterPath': sh, 'timeoutMs': 6000,
                                                    'repinHint': REPIN_HINT}},
            },
            'memory': {'recall': {'enabled': False}, 'feedback': {'enabled': False}, 'project': {'enabled': False},
                       'guard': {'writeRoots': mem_roots, 'python': py}},
            'session': {
                'default_model': c['model'], 'default_effort': c['effort'],
                'min_disk_free_gb': c['min_disk_free_gb'], 'min_free_mem_pct': c['min_free_mem_pct'],
                'inherit_env_extra': ['DISABLE_AUTOUPDATER'],
                # the person who talks to the bots (slack.owner_user_id) · empty or null → [] (nothing made up)
                'owner_ids': [owner] if owner else [],
            },
            'ui': {'system_name': 'SlackMod'},
        }
        # the 3rd-message nudge asks the owner to reply «하위로», but a hand-off needs session.child_mcp_config (children
        # post in the thread through it) and the kit writes none → without it the nudge is turned off (handoff.nudge_at 0)
        if not harness['session'].get('child_mcp_config'):
            harness['session']['handoff'] = {'nudge_at': 0}
        # 10-26 wizard «하위 세션 쓰기 = 끔» → no child tools in the bot's session (src/session core DEFAULTS children) · on = no key
        if cfg.get('children') is False:
            harness['session']['children'] = False
        # 10-26 owner lane (src/owner): the owner's id known → a thread reply in the owner's DM starts with <@owner> (already there =
        # left alone). The DM is learned at run time ("auto": a D channel the owner wrote in during that session) — the installer
        # does not know DM ids. Only the tag: the promise / reply-first devices stay off · no log folder. owner_tag false = no key.
        if owner and cfg.get('owner_tag', True) is not False:
            harness['owner'] = {'enabled': True, 'slack_user_id': owner, 'slack_dm_channels': 'auto',
                                'promise': {'enabled': False}, 'replyFirst': {'mode': 'off'}, 'threadTag': {'enabled': True}, 'logDir': None}
        # 10-26 wizard «하위 라우터(판정 모델이 고름)» = shadow / on with a judge → session.jev_route · off = no key (same bytes)
        if 'router' in cfg and router_problems(cfg['router']):   # plan() never trusts that validate ran
            die('router: not usable — run validate')
        jroute = router_route(cfg, root, py, bd + '/slack/' + JUDGE_KEY_FILE)
        if jroute:
            harness['session']['jev_route'] = jroute
        # window tool the person pinned in the wizard (tmux · herdr) → read by the window adapter · absent = automatic
        if cfg.get('window_backend') in BACKENDS:
            harness['window_backend'] = cfg['window_backend']
        mcp = {'mcpServers': {'slack-channel': {'command': node, 'args': [app + '/channel-server/dist/mcp.js'],
                                                'env': {'CLAUDE_CHANNEL_SLACK_DIR': bd + '/slack'}}}}
        # only a bot that asks for them gets these lines (a config without the keys makes the same launch file as before)
        extra_launch = []
        if b.get('extra_channels'):
            extra_launch.append('SM_EXTRA_CHANNELS=' + q(' '.join(b['extra_channels'])))
        ee = b.get('extra_env') or {}
        if any(env_route(k) is None for k in ee):   # plan() never trusts that validate ran (sec ④ round 2)
            die('bots[].extra_env: a name outside the allow list — run validate')
        if any(env_route(k) == 'plain' and not plain_value_ok(k, v) for k, v in ee.items()):   # round 4: nor that the values have their shape
            die('bots[].extra_env: a plain value without its name\'s shape — run validate')
        plain_env = {k: v for k, v in ee.items() if env_route(k) == 'plain'}
        secret_env = {k: v for k, v in ee.items() if env_route(k) == 'secret'}
        if plain_env:
            extra_launch.append('SM_EXTRA_ENV=(' + ' '.join(q('%s=%s' % (k, plain_env[k])) for k in sorted(plain_env)) + ')')
        # names only: the values go to the bot's .env (plan-stage → env-upsert --secrets-from) and are read at start · the bundled
        # judge's key is not one of them (sec r6 ⓑ2): it stays in its own file, read by the judge at each call (router_route)
        dotenv_names = set(secret_env)
        if dotenv_names:
            extra_launch.append('SM_EXTRA_ENV_DOTENV=(' + ' '.join(q(k) for k in sorted(dotenv_names)) + ')')
        if secret_env:
            secret_out[n] = secret_env
        launch = '\n'.join([
            '# generated by install.sh — do not edit (change ~/.slackmod/config.json and run install.sh again)',
            'SM_BOT=' + q(n),
            'SM_WORK_DIR=' + q(b['work_dir']),
            'SM_MODEL=' + q(b.get('model') or ''),
        ] + (['SM_EFFORT=' + q(b['effort'])] if b.get('effort') else []) + [   # «생각 깊이» · empty = no line (same bytes as before)
            'SM_PERMISSION=' + q(cfg.get('permission', 'skip')),
            'SM_HARNESS_CONFIG=' + q(bd + '/harness.json'),
            'SM_MCP_CONFIG=' + q(bd + '/mcp.json'),
            'SM_SLACK_DIR=' + q(bd + '/slack'),
            'SM_CLAUDE=' + q(claude),
            'SM_NODE=' + q(node),
            'SM_PLUGIN_DIR=' + q(app + '/mods-harness'),
            'SM_SERVER_JS=' + q(app + '/channel-server/dist/server.js'),
            'SM_CONTRACT=' + q(root + ('/contract-solo.md' if cfg.get('children') is False else '/contract.md')),
        ] + extra_launch + [''])
        files.append({'path': bd + '/harness.json', 'mode': '644', 'content': json.dumps(harness, indent=2, ensure_ascii=False) + '\n'})
        files.append({'path': bd + '/mcp.json', 'mode': '644', 'content': json.dumps(mcp, indent=2) + '\n'})
        files.append({'path': bd + '/launch.sh', 'mode': '600', 'content': launch})   # owner-only: bin/slackmod sources it, nothing else reads it
        # wizard columns that really change the bot folder (merged into what is there · nothing written when nothing changes):
        #  wiki → <work_dir>/.claude/settings.json permissions.additionalDirectories · browser playwright → <work_dir>/.mcp.json
        #  + the same settings.json enabledMcpjsonServers [playwright] when that entry is the kit's own (K19b · a user's own
        #  «playwright» entry is not pre-approved — that consent stays theirs)
        wiki_path = (cfg.get('wiki') or {}).get('path')
        if b.get('effort') and b['effort'] not in EFFORTS:   # plan() never trusts that validate ran
            die('bots[].effort: not one of ' + ', '.join(EFFORTS) + ' — run validate')
        # folders the bot may open besides its own: the wiki (or the kit's notes folder when there is no wiki) first, then its
        # projects («작업 폴더») sorted · no repeats
        extra_dirs = [os.path.normpath(wiki_path)] if wiki_path else ([starter] if starter else [])
        for x in sorted(os.path.normpath(y) for y in (b.get('projects') or [])):
            if x not in extra_dirs:
                extra_dirs.append(x)
        approve = None
        if cfg.get('browser') == 'playwright':
            mp = bot_folder_file(b['work_dir'], '.mcp.json')
            mtext = merge_mcp_playwright(mp)
            if mtext is not None:
                files.append({'path': mp, 'mode': existing_mode(mp), 'content': mtext})
            if kit_playwright_entry(mtext, mp):
                approve = 'playwright'
        if extra_dirs or approve:
            sp = bot_folder_file(b['work_dir'], '.claude/settings.json')
            text = merge_settings(sp, wiki=extra_dirs, approve=approve)
            if text is not None:
                files.append({'path': sp, 'mode': existing_mode(sp), 'content': text})
        if b.get('projects'):
            rp = bot_folder_file(b['work_dir'], PROJECTS_RULE)
            files.append({'path': rp, 'mode': existing_mode(rp), 'content': '\n'.join(
                ['# 작업 폴더 (SlackMod 설치기가 만듦 — 바꾸려면 설치 마법사에서 작업 폴더를 다시 고르세요)', '',
                 '이 폴더들 안에서 일하고, 밖은 열지 않습니다.', '']
                + ['- ' + x for x in sorted(os.path.normpath(y) for y in b['projects'])] + [''])})
        if cfg.get('help_skill') is True:
            try:
                with open(HELP_TEMPLATE, encoding='utf-8') as hf:
                    help_text = hf.read()
            except OSError:
                raise MergeError('%s: the help skill template is missing from this kit (templates/skills/slackmod-help) — get the kit again' % HELP_TEMPLATE)
            hp = bot_folder_file(b['work_dir'], HELP_SKILL)
            files.append({'path': hp, 'mode': existing_mode(hp), 'content': help_text})
        if starter:
            mp = bot_folder_file(b['work_dir'], MEMORY_RULE)
            files.append({'path': mp, 'mode': existing_mode(mp), 'content': '\n'.join(
                ['# 기억 (SlackMod 설치기가 만듦)', '',
                 '기억할 것은 %s/기억/%s.md 에 적고, 찾을 땐 이 폴더부터 봅니다.' % (starter, n), ''])})
        # who may speak to this bot: the other bots of this config, then slack.allowed_bot_user_ids (bots outside this config) — no repeats, never itself
        own = b.get('slack_bot_user_id') or ''
        peer_ids = []
        for x in [y.get('slack_bot_user_id') for y in bots if y is not b] + list(s.get('allowed_bot_user_ids') or []):
            if x and x != own and x not in peer_ids:
                peer_ids.append(x)
        peers = ','.join(peer_ids)
        # drop notices (bridge 10-22): '1' = on · '' = written as a commented line = off
        env[n] = {'ALLOWED_SLACK_USER_ID': owner, 'SLACK_CHANNEL_ID': ','.join(channel_ids),
                  'ALLOWED_SLACK_BOT_USER_IDS': peers,
                  'SLACK_DROP_NOTICE': '1' if s.get('drop_notice', True) else '',
                  'SLACK_DROP_NOTICE_NO_MENTION': '1' if s.get('drop_notice_no_mention', True) else ''}
        # guests (slack.guests → the bridge's ALLOWED_SLACK_GUEST_IDS, comma-separated): only a non-empty list writes the key;
        # an empty list drops a stale line (env_drop) so «nobody» really means nobody · key absent in the config = untouched
        if s.get('guests'):
            env[n]['ALLOWED_SLACK_GUEST_IDS'] = ','.join(s['guests'])
        elif 'guests' in s:
            env_drop.setdefault(n, []).append('ALLOWED_SLACK_GUEST_IDS')
    if starter:   # made once, before the list of bots (only the files that are not there yet)
        for target, text in starter_files(starter_template or STARTER_TEMPLATE, starter):
            files.append({'path': target, 'mode': '644', 'content': text})
    files.append({'path': root + '/bots.list', 'mode': '644', 'content': ''.join(b['name'] + '\n' for b in bots)})
    lines = [RC_BEGIN,
             '# SlackMod 켜기 이름 — install.sh 가 관리합니다(고치려면 ~/.slackmod/config.json 을 고친 뒤 install.sh 다시 실행)',
             'case ":$PATH:" in *":%s/bin:"*) ;; *) export PATH="%s/bin:$PATH" ;; esac' % (root, root)]
    for b in bots:
        lines.append("alias %s='slackmod open %s'" % (b['name'], b['name']))   # end the running session → new conversation → attach
        lines.append("alias %s-stop='slackmod stop %s'" % (b['name'], b['name']))
    alias_names = [b['name'] for b in bots] + [b['name'] + '-stop' for b in bots]
    if bots:   # «all» names mean nothing with no bot (blank mode): PATH only
        lines.append("alias %s='slackmod start all'" % al['all'])
        lines.append("alias %s='slackmod stop all'" % al['all_stop'])
        alias_names += [al['all'], al['all_stop']]
    lines.append(RC_END)
    out = {'files': files, 'env': env, 'env_drop': env_drop, 'bots': [b['name'] for b in bots],
           'work_dirs': {b['name']: b['work_dir'] for b in bots},
           'aliases': alias_names, 'rc_block': '\n'.join(lines) + '\n'}
    if secret_out:   # {bot: {NAME: value}} — the CLI prints names only (main: plan) and writes values only to 0600 stage files (plan-stage)
        out['secret_env'] = secret_out
    return out


def tree_fp(d, exclude, exclude_paths=()):
    # exclude = names skipped at any depth · exclude_paths = exact paths from d (a file, or a folder and all under it)
    skip = {os.path.normpath(x) for x in exclude_paths}
    h = hashlib.sha256()
    if os.path.islink(d):   # the folder itself is a link (planted where the tree should be): not the same as the real folder
        h.update(('L . %s\n' % os.readlink(d)).encode())
    for dirpath, dirnames, filenames in os.walk(d):
        keep = []
        for x in sorted(dirnames):
            p = os.path.join(dirpath, x)
            rel = os.path.relpath(p, d)
            if x in exclude or rel in skip:
                continue
            if os.path.islink(p):   # a folder symlink (os.walk lists it but never follows it): hashed as a link · a planted commands -> dir shows
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
            with open(p, 'rb') as f:
                fh = hashlib.sha256(f.read()).hexdigest()
            x = 'x' if os.stat(p).st_mode & 0o111 else '-'
            h.update(('F %s %s %s\n' % (rel, x, fh)).encode())
    return h.hexdigest()


def read_env(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read().split('\n')
    except FileNotFoundError:
        return None


def write_private(path, lines):
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o700, exist_ok=True)
    os.chmod(d, 0o700)
    # sec r6 (10-26 · the same form as the session lane's writeAtomic fix): a random tmp name created new (O_EXCL|O_NOFOLLOW) —
    # a link or file planted beside the target is never written through · any failure removes the tmp
    tmp = path + '.tmp-' + os.urandom(8).hex()
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines).rstrip('\n') + '\n')
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_json_keep_mode(path, data):
    """Replace a JSON file in one step, keeping its mode (a config with secret-named values is 0600)."""
    mode = stat.S_IMODE(os.stat(path).st_mode) if os.path.exists(path) else 0o644
    tmp = path + '.tmp-' + os.urandom(8).hex()
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def upsert(lines, key, value):
    out, done = [], False
    for ln in lines:
        if re.match(r'^\s*#?\s*%s=' % re.escape(key), ln):
            if not done:
                out.append('%s=%s' % (key, value) if value != '' else '#%s=' % key)
                done = True
            continue
        out.append(ln)
    if not done:
        out.append('%s=%s' % (key, value) if value != '' else '#%s=' % key)
    return out


def env_value(lines, key):
    for ln in lines or []:
        m = re.match(r'^\s*%s=(.*)$' % re.escape(key), ln)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    return ''


def token_ok(v, prefix):
    return v.startswith(prefix) and len(v) > len(prefix) + 10 and 'REPLACE' not in v


def main(argv):
    if not argv:
        die('subcommand needed')
    cmd, rest = argv[0], argv[1:]
    if cmd == 'from-setup':
        # setup.json → config.json text on stdout (nothing written here · the caller decides). rc 2 = the setup file is not usable.
        sp = arg(rest, '--setup')
        if not sp:
            die('from-setup needs --setup FILE')
        try:
            with open(sp, encoding='utf-8') as f:
                st = json.load(f)
        except FileNotFoundError:
            die('setup file not found: ' + sp)
        except ValueError as exc:
            die('setup file is not valid JSON (%s line %s)' % (type(exc).__name__, getattr(exc, 'lineno', '?')))
        base = None
        bp = arg(rest, '--base')
        if bp and os.path.isfile(bp):
            try:
                with open(bp, encoding='utf-8') as f:
                    base = json.load(f)
            except ValueError:
                base = None   # a broken old config is simply replaced (the installer backs it up first)
        home = os.path.normpath(arg(rest, '--home') or os.path.expanduser('~'))
        cfg, errs = setup_to_config(st, base, home)
        if errs:
            for e in errs:
                print('  - ' + e, file=sys.stderr)
            return 2
        sys.stdout.write(json.dumps(cfg, indent=2, ensure_ascii=False) + '\n')
        return 0
    if cmd == 'render-contract':
        # render-contract --config F --template T → the contract text on stdout (nothing written here · the installer puts it in place)
        cp, tp = arg(rest, '--config'), arg(rest, '--template')
        if not cp or not tp:
            die('render-contract needs --config FILE --template FILE')
        cfg = load(cp)
        errs = [e for e in problems(cfg) if e.startswith('children_open')]
        if errs:
            for e in errs:
                print('  - ' + e, file=sys.stderr)
            return 2
        try:
            with open(tp, 'rb') as f:
                tpl = f.read()
            out = render_contract(cfg, tpl)
        except (OSError, ValueError) as exc:
            die('render-contract: ' + str(exc))
        sys.stdout.buffer.write(out)
        sys.stdout.buffer.flush()
        return 0
    if cmd == 'set-effort':
        # set-effort --config F --bot NAME|all --value WORD [--setup S] → the config (and the setup file, so the next wizard run
        # does not put the old value back) · «default» = the key removed (account default) · nothing written on a bad bot / value
        cp, who, val, sp = arg(rest, '--config'), arg(rest, '--bot'), arg(rest, '--value'), arg(rest, '--setup')
        if not cp or not who or val is None:
            die('set-effort needs --config FILE --bot NAME|all --value WORD')
        if val not in EFFORTS + ('default',):
            die('생각 깊이는 %s 또는 default(계정 기본) 중 하나입니다 — 아무것도 바꾸지 않았습니다' % ', '.join(EFFORTS))
        cfg = load(cp)
        names = [b.get('name') for b in (cfg.get('bots') or []) if isinstance(b, dict)]
        targets = names if who == 'all' else [who]
        if who != 'all' and who not in names:
            die('모르는 봇: %s (있는 봇: %s) — 아무것도 바꾸지 않았습니다' % (who, ' '.join(map(str, names)) or '없음'))
        st = None
        if sp and os.path.isfile(sp):
            try:
                with open(sp, encoding='utf-8') as f:
                    st = json.load(f)
            except ValueError:
                print('slackmod: %s is not valid JSON — left as it is (the config is changed)' % os.path.basename(sp), file=sys.stderr)
                st = None
        for b in cfg.get('bots') or []:
            if isinstance(b, dict) and b.get('name') in targets:
                if val == 'default':
                    b.pop('effort', None)
                else:
                    b['effort'] = val
        write_json_keep_mode(cp, cfg)
        if isinstance(st, dict) and isinstance(st.get('bots'), list):
            for b in st['bots']:
                if isinstance(b, dict) and b.get('name') in targets:
                    b['effort'] = '' if val == 'default' else val
            write_json_keep_mode(sp, st)
        for n in targets:
            print('%s: %s' % (n, '(기본)' if val == 'default' else val))
        return 0
    if cmd == 'effort-list':
        cfg = load(arg(rest, '--config'))
        print('%-14s %s' % ('봇', '생각 깊이'))
        for b in cfg.get('bots') or []:
            if isinstance(b, dict):
                print('%-14s %s' % (b.get('name'), b.get('effort') or '(기본)'))
        return 0
    if cmd == 'validate':
        errs = problems(load(arg(rest, '--config')))
        for e in errs:
            print('  - ' + e)
        return 1 if errs else 0
    if cmd == 'plan':
        cfg = load(arg(rest, '--config'))
        errs = problems(cfg)
        if errs:
            for e in errs:
                print('  - ' + e, file=sys.stderr)
            return 1
        need = ['--root', '--python', '--node', '--claude', '--sh', '--pass-sha']
        vals = [arg(rest, k) for k in need]
        if any(v is None for v in vals):
            die('plan needs ' + ' '.join(need))
        try:
            p = plan(cfg, *vals)
        except MergeError as exc:
            print('  - ' + str(exc), file=sys.stderr)
            return 3
        if 'secret_env' in p:   # a screen shows variable NAMES only
            p['secret_env'] = {bot: sorted(kv) for bot, kv in p['secret_env'].items()}
        print(json.dumps(p, ensure_ascii=False))
        return 0
    if cmd == 'plan-stage':
        # same as plan, but writes each file into --stage and prints TSV records for the bash installer:
        # FILE<TAB>target<TAB>mode<TAB>staged · ENV<TAB>bot<TAB>KEY<TAB>value · BOT<TAB>name<TAB>work_dir · ALIAS<TAB>name · RC<TAB>staged
        cfg = load(arg(rest, '--config'))
        errs = problems(cfg)
        if errs:
            for e in errs:
                print('  - ' + e, file=sys.stderr)
            return 1
        stage = arg(rest, '--stage')
        need = ['--root', '--python', '--node', '--claude', '--sh', '--pass-sha']
        vals = [arg(rest, k) for k in need]
        if not stage or any(v is None for v in vals):
            die('plan-stage needs --stage ' + ' '.join(need))
        try:
            p = plan(cfg, *vals)
        except MergeError as exc:
            print('  - ' + str(exc), file=sys.stderr)
            return 3
        for i, f in enumerate(p['files']):
            sp = os.path.join(stage, 'f%03d' % i)
            with open(sp, 'w', encoding='utf-8') as fh:
                fh.write(f['content'])
            print('FILE\t%s\t%s\t%s' % (f['path'], f['mode'], sp))
        for bot, kv in p['env'].items():
            for k, v in kv.items():
                print('ENV\t%s\t%s\t%s' % (bot, k, v))
        for bot, keys in p['env_drop'].items():
            for k in keys:
                print('ENVDROP\t%s\t%s' % (bot, k))
        for bot, kv in p.get('secret_env', {}).items():
            # secret-named extra_env: the values go into a 0600 stage file, never onto this output · ENVSEC<TAB>bot<TAB>stage file
            sp = os.path.join(stage, 'sec-' + bot)
            fd = os.open(sp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as fh:
                fh.write(''.join('%s=%s\n' % (k, kv[k]) for k in sorted(kv)))
            print('ENVSEC\t%s\t%s' % (bot, sp))
        for n in p['bots']:
            print('BOT\t%s\t%s' % (n, p['work_dirs'][n]))
        for a in p['aliases']:
            print('ALIAS\t%s' % a)
        rp = os.path.join(stage, 'rc-block')
        with open(rp, 'w', encoding='utf-8') as fh:
            fh.write(p['rc_block'])
        print('RC\t%s' % rp)
        return 0
    if cmd == 'rc-merge':
        # rc-merge --rc FILE --block FILE --out FILE [--alias NAME]… → prints same|changed · rc 1 = an alias is already
        # defined outside the managed block (refuse rather than shadow it)
        rcp, bp, outp = arg(rest, '--rc'), arg(rest, '--block'), arg(rest, '--out')
        try:
            with open(rcp, encoding='utf-8') as f:
                old = f.read()
        except FileNotFoundError:
            old = ''
        with open(bp, encoding='utf-8') as f:
            block = f.read()
        pat = re.compile(re.escape(RC_BEGIN) + r'.*?' + re.escape(RC_END) + r'\n?', re.S)
        if old.count(RC_BEGIN) != old.count(RC_END) or old.count(RC_BEGIN) > 1:
            die('rc-merge: the managed block markers in %s are broken — fix by hand' % os.path.basename(rcp), 1)
        outside = pat.sub('', old)
        for a in arg(rest, '--alias', many=True):
            if re.search(r'(^|\n)\s*alias\s+%s=' % re.escape(a), outside):
                die('rc-merge: alias «%s» is already defined in %s outside the SlackMod block' % (a, os.path.basename(rcp)), 1)
        if RC_BEGIN in old:
            new = pat.sub(lambda m: block, old, count=1)
        else:
            new = old + ('' if not old or old.endswith('\n') else '\n') + ('\n' if old else '') + block
        with open(outp, 'w', encoding='utf-8') as f:
            f.write(new)
        print('same' if new == old else 'changed')
        return 0
    if cmd == 'tree-fp':
        if not rest or not os.path.isdir(rest[0]):
            die('tree-fp DIR')
        print(tree_fp(rest[0], set(arg(rest[1:], '--exclude', many=True)), arg(rest[1:], '--exclude-path', many=True)))
        return 0
    if cmd == 'env-plain':
        # env-plain NAME=value… → the SM_EXTRA_ENV words of a launch.sh, checked again at start: an OLDER launch.sh (before the allow list
        # · sec ④ round 3, or before the value shapes · round 4) may still carry a refused word, and install then refuses and leaves the
        # file. Passing words print as they are, one per line · any other word is named on stderr, never its value.
        for kv in rest:
            k, eq, v = kv.partition('=')
            kk = k if ENV_NAME.fullmatch(k) and not SECRET_SHAPE.search(k) else '<name>'
            if not eq or env_route(k) != 'plain':
                print('slackmod: extra variable «%s» not set — not on the allow list (fix ~/.slackmod/config.json, then install.sh again)' % kk,
                      file=sys.stderr)
            elif not plain_value_ok(k, v):
                print('slackmod: extra variable «%s» not set — %s (fix ~/.slackmod/config.json, then install.sh again)' % (kk, plain_value_says(k)),
                      file=sys.stderr)
            else:
                print(kv)
        return 0
    path = arg(rest, '--file')
    if not path:
        die('--file needed')
    if cmd == 'env-upsert':
        dry = '--dry-run' in rest   # dry-run = no write and no chmod (the file is left exactly as it was)
        lines = read_env(path)
        fresh = lines is None
        if fresh:
            lines = ['# Slack connection for one bot — tokens: run «slackmod set-token <bot>» (never paste them in chat)',
                     'SLACK_BOT_TOKEN=xoxb-REPLACE-ME', 'SLACK_APP_TOKEN=xapp-REPLACE-ME']
        new = list(lines)
        for kv in arg(rest, '--set', many=True):
            k, _, v = kv.partition('=')
            if k in SECRET_KEYS or not re.fullmatch(r'^[A-Z_]{3,40}$', k):
                die('env-upsert: refused key')
            new = upsert(new, k, v)
        sf = arg(rest, '--secrets-from')   # NAME=value lines of the secret-named extra_env (a 0600 stage file · never on argv)
        if sf:
            try:
                with open(sf, encoding='utf-8') as fh:
                    pairs = [ln.partition('=') for ln in fh.read().split('\n') if ln]
            except OSError:
                die('env-upsert: cannot read the secrets file')
            for k, _, v in pairs:
                if env_route(k) != 'secret' or not v:
                    die('env-upsert: refused key')
            for k, _, v in pairs:
                new = upsert(new, k, v)
        for k in arg(rest, '--drop', many=True):
            if k in SECRET_KEYS or not re.fullmatch(r'^[A-Z_]{3,40}$', k):
                die('env-upsert: refused key')
            new = [ln for ln in new if not re.match(r'^\s*#?\s*%s=' % re.escape(k), ln)]
        if new == lines and not fresh:
            mode = stat.S_IMODE(os.stat(path).st_mode)
            if mode != 0o600:
                if not dry:
                    os.chmod(path, 0o600)
                print('changed')
                return 0
            print('same')
            return 0
        if dry:
            print('changed')
            return 0
        write_private(path, new)
        print('changed')
        return 0
    if cmd == 'env-status':
        lines = read_env(path)
        bt = env_value(lines, 'SLACK_BOT_TOKEN')
        at = env_value(lines, 'SLACK_APP_TOKEN')
        print('bot_token=%s app_token=%s' % ('set' if token_ok(bt, 'xoxb-') else 'missing',
                                             'set' if token_ok(at, 'xapp-') else 'missing'))
        return 0
    if cmd == 'env-export':
        # env-export --file F NAME… → «NAME=value» lines (value exactly as in the file) for the secret-named extra_env the bot window
        # exports at start · a missing or refused name is named on stderr, never its value
        names = [a for i, a in enumerate(rest) if a != '--file' and (i == 0 or rest[i - 1] != '--file')]
        lines = read_env(path) or []
        for k in names:
            if env_route(k) != 'secret':
                print('slackmod: extra variable «%s» refused (not an allowed credential name)' % k, file=sys.stderr)
                continue
            vals = [m.group(1).rstrip('\r') for m in (re.match(r'^%s=(.*)$' % re.escape(k), ln) for ln in lines) if m]
            if not vals:
                print('slackmod: extra variable «%s» is not in %s — the bot starts without it' % (k, os.path.basename(path)), file=sys.stderr)
                continue
            print('%s=%s' % (k, vals[-1]))
        return 0
    if cmd == 'app-id':
        at = env_value(read_env(path), 'SLACK_APP_TOKEN')
        print(hashlib.sha256(at.encode()).hexdigest()[:12] if token_ok(at, 'xapp-') else '-')
        return 0
    if cmd == 'key-file-set':
        # key-file-set --file F ← one value on stdin (the terminal's hidden input · never on argv) → F holds that one line (0600) ·
        # the bundled judge's key file (sec r6 ⓑ2 · not the .env, so the bot's environment never gets it) · F's folder must
        # already exist (install.sh made it) · the value is never printed
        got = [x for x in sys.stdin.read().split('\n')]
        v = (got[0] if got else '').strip()
        if not v or len(v) > 500 or any(c in v for c in ' \t\r\0') or placeholder(v) or any(x.strip() for x in got[1:]):
            die('the value must be one line without spaces — nothing saved', 1)
        if not os.path.isdir(os.path.dirname(path)):
            die('run install.sh first (no ' + os.path.basename(os.path.dirname(path)) + ' folder yet)', 1)
        write_private(path, [v])
        v = ''
        print('saved (value not shown)')
        return 0
    if cmd == 'env-set-tokens':
        got = sys.stdin.read().split('\n')
        bt = (got[0] if got else '').strip()
        at = (got[1] if len(got) > 1 else '').strip()
        if not token_ok(bt, 'xoxb-'):
            die('the first value must be the Bot User OAuth Token (starts with xoxb-) — nothing saved', 1)
        if not token_ok(at, 'xapp-'):
            die('the second value must be the App-Level Token (starts with xapp-) — nothing saved', 1)
        lines = read_env(path)
        if lines is None:
            die('run install.sh first (no ' + os.path.basename(path) + ' yet)', 1)
        new = [ln for ln in lines if not re.match(r'^\s*#?\s*SLACK_(BOT|APP)_TOKEN=', ln)]
        new[1:1] = ['SLACK_BOT_TOKEN=' + bt, 'SLACK_APP_TOKEN=' + at]
        write_private(path, new)
        print('saved (values not shown)')
        return 0
    die('unknown subcommand ' + cmd)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
