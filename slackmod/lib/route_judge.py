#!/usr/bin/env python3
"""route_judge.py — the example judge of the «하위 라우터(판정 모델이 고름)» (harness key session.jev_route).

The bot's harness runs this program when the owner writes to the bot while the bot's child sessions work in other threads:
  stdin  = one JSON request {v, boundary, body, dm, criteria: {label: what that label stands for}, timeout_s}
           labels = «부모» (the bot itself) + «하위 A», «하위 B», … (one per child session)
  stdout = one JSON line {"ok": true, "probs": {label: p, …}} — every label, each p between 0 and 1
           or {"ok": false, "reason": <code>} — codes: no-key · bad-request · http-<status> · net-error · timeout · bad-answer
It always exits 0 and writes nothing to stderr (the harness keeps a failed answer's reason in its record, so a reason is one of
the fixed codes above — never an exception text, a header or the key).

The key = the first line of the file named by --key-file <path>, read at each call, nothing else — no environment variable
(sec r6 ⓑ2: the key is not in the bot's environment). The file must be this account's own regular file, not a link, readable
by no one else (0600) — anything else = no-key. «slackmod set-judge-key <bot>» writes it (the bot's slack folder ·
route-judge.key). One HTTPS call to the Claude API per judged message (model claude-haiku-5-5 · a few hundred tokens): what
the owner wrote to the bot (up to 4000 characters) and the child sessions' descriptions go to that API.
Standard library only · python 3.8+.
"""
import json
import os
import signal
import socket
import stat
import sys
import urllib.error
import urllib.request

API_URL = 'https://api.anthropic.com/v1/messages'
API_VERSION = '2026-10-21'
MODEL = 'claude-haiku-5-5'
KEY_FILE_FLAG = '--key-file'
PARENT = '부모'
MAX_LABELS = 9          # 부모 + up to 8 children (the harness's max_candidates cap)
MAX_BODY = 4000         # characters of the message sent to the model
MAX_CRITERION = 600


class Deadline(Exception):
    pass


def answer(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()
    return 0


def fail(code):
    return answer({'ok': False, 'reason': code})


def read_request(raw):
    """→ (body, {label: criterion}, timeout_s) or None."""
    try:
        req = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(req, dict):
        return None
    body, crit = req.get('body'), req.get('criteria')
    if not isinstance(body, str) or not body.strip() or not isinstance(crit, dict) or not 2 <= len(crit) <= MAX_LABELS or PARENT not in crit:
        return None
    for k, v in crit.items():
        if not isinstance(k, str) or not 0 < len(k) <= 20 or any(c in k for c in '\n\r"') or not isinstance(v, str):
            return None
    t = req.get('timeout_s')
    t = float(t) if isinstance(t, (int, float)) and not isinstance(t, bool) and t > 0 else 1.0
    return body[:MAX_BODY], {k: v[:MAX_CRITERION] for k, v in crit.items()}, min(t, 30.0)


def prompt(body, crit):
    rows = '\n'.join('- %s: %s' % (k, ' '.join(v.split())) for k, v in crit.items())
    example = ', '.join('"%s": %s' % (k, '0.9' if k == PARENT else '0.1' if i == 1 else '0') for i, k in enumerate(crit))
    return (
        'A Slack bot got the message below from its owner. The bot itself is the label «%s». It also has helper sessions, each '
        'working on its own task in another thread — one label each. Decide whose work the message is about.\n\n'
        'Labels:\n%s\n\n'
        'Message (between the lines):\n-----\n%s\n-----\n\n'
        'Give, for EVERY label, the probability (0 to 1, together about 1) that the message is meant for that label\'s work. '
        'When the message alone does not show which helper it is for, put most of the weight on «%s».\n'
        'Answer with one JSON object only, label to probability, like {%s}.' % (PARENT, rows, body, PARENT, example))


def parse_probs(text, labels):
    s, e = text.find('{'), text.rfind('}')
    if s < 0 or e <= s:
        return None
    try:
        got = json.loads(text[s:e + 1])
    except ValueError:
        return None
    if not isinstance(got, dict):
        return None
    out = {}
    for label in labels:
        p = got.get(label)
        if isinstance(p, bool) or not isinstance(p, (int, float)) or not 0 <= p <= 1:
            return None
        out[label] = round(float(p), 4)
    return out


def on_deadline(signum, frame):
    raise Deadline()


def key_file_arg(argv):
    for i, a in enumerate(argv):
        if a == KEY_FILE_FLAG and i + 1 < len(argv):
            return argv[i + 1]
    return ''


def read_key(path):
    # the key file, opened now (each call): this account's own regular file, not a link, no group / other bits — else no key
    if not path:
        return ''
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0))
    except OSError:
        return ''
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
            return ''
        return os.read(fd, 4096).decode('utf-8', 'replace').split('\n')[0].strip()
    except OSError:
        return ''
    finally:
        os.close(fd)


def ask(body, crit, wait, key_file):
    key = read_key(key_file)
    if not key:
        return fail('no-key')
    payload = {'model': MODEL, 'max_tokens': 300, 'thinking': {'type': 'disabled'}, 'output_config': {'effort': 'low'},
               'messages': [{'role': 'user', 'content': prompt(body, crit)}]}
    req = urllib.request.Request(API_URL, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), method='POST',
                                 headers={'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION})
    key = ''
    if hasattr(signal, 'setitimer'):   # one deadline for the whole call (urlopen's timeout is per socket step)
        signal.signal(signal.SIGALRM, on_deadline)
        signal.setitimer(signal.ITIMER_REAL, wait)
    try:
        with urllib.request.urlopen(req, timeout=wait) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Deadline:
        return fail('timeout')
    except urllib.error.HTTPError as exc:
        return fail('http-%d' % exc.code if isinstance(exc.code, int) else 'net-error')
    except urllib.error.URLError as exc:
        return fail('timeout' if isinstance(getattr(exc, 'reason', None), (socket.timeout, TimeoutError)) else 'net-error')
    except (socket.timeout, TimeoutError):
        return fail('timeout')
    except ValueError:
        return fail('bad-answer')
    except OSError:
        return fail('net-error')
    finally:
        if hasattr(signal, 'setitimer'):
            signal.setitimer(signal.ITIMER_REAL, 0)
    blocks = data.get('content') if isinstance(data, dict) else None
    text = ''.join(b.get('text', '') for b in blocks if isinstance(b, dict) and b.get('type') == 'text') if isinstance(blocks, list) else ''
    probs = parse_probs(text, list(crit))
    return answer({'ok': True, 'probs': probs}) if probs else fail('bad-answer')


def main(argv=None):
    try:
        key_file = key_file_arg(sys.argv[1:] if argv is None else argv)
        got = read_request(sys.stdin.read())
        if got is None:
            return fail('bad-request')
        body, crit, timeout_s = got
        return ask(body, crit, max(0.1, timeout_s - 0.3), key_file)   # answer before the harness stops the program
    except Deadline:
        return fail('timeout')
    except Exception:   # never a traceback: its text would land in the harness's record
        return fail('net-error')


if __name__ == '__main__':
    sys.exit(main())
