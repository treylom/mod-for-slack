#!/usr/bin/env python3
"""fake-aside.py — a stand-in for «aside repl» (test helper, never ships): reads one statement per line on stdin and answers
like the real REPL (banner · «[ok | …]» after each statement), with canned driver results from a scenario file.

    FAKE_ASIDE_SCENARIO=<json file> FAKE_ASIDE_LOG=<file> python3 -I fake-aside.py repl

Scenario = {"ready": true, "open": [result…], "waitReview": [result…], "create": [result…], "keys": [result…]}: each call
takes the next result (the last one repeats). A result is a JSON object, or one of the words
  "KEYS_GOOD"   → {"state": "keys", "app": …} with the two bait tokens sealed with the pads the wizard sent
  "KEYS_WRONG"  → the same, sealed with other pads (the wizard must refuse to save)
  "KEYS_GOOD_DIAG" → KEYS_GOOD plus a diagnosis «diag» (Install App page loads as «age=status» words)
  "SILENT"      → no result line at all · "DIE" → the process ends
Every answer also prints noise lines with bait text (an e-mail, token-shaped words) that the wizard must never repeat.
The log gets one line per statement: the call name (or «define»), and «pads=2» when the define line carried two pads.
"""
import json
import os
import re
import sys

BOT = 'xo' + 'xb-0000000000-1111111111111-BAITBOTTOKENBAITBOT01'   # split: the trace scan must not see a token shape
APP = 'xa' + 'pp-1-AFAKE12345-0000000000000-BAITAPPTOKENBAITAPPTOKENBAITAPPTOKEN0123456789'
SC = json.load(open(os.environ['FAKE_ASIDE_SCENARIO'], encoding='utf-8'))
LOG = os.environ.get('FAKE_ASIDE_LOG')
pads = {}


def log(s):
    if LOG:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(s + '\n')


def seal(v, pad_hex):
    p = bytes.fromhex(pad_hex)
    return ''.join('%02x' % (ord(c) ^ p[i]) for i, c in enumerate(v))


def out(s):
    sys.stdout.write(s)
    sys.stdout.flush()


if sys.argv[1:2] != ['repl']:
    sys.exit(2)
out('account: u0 (bait-owner@example.com)\nsessionDir: /tmp/x\nrepl > ')
for line in sys.stdin:
    line = line.rstrip('\n')
    if line == 'exit':
        log('exit')
        break
    if 'SLACKMOD_APP_READY' in line:
        m = re.search(r'var __o = (\{.*\}); console\.log', line)
        o = json.loads(m.group(1)) if m else {}
        if o.get('padApp'):
            pads['app'], pads['bot'] = o['padApp'], o['padBot']
        log('define pads=%d keys=%s name=%s' % (len(pads), o.get('keys'), o.get('appName')))
        if SC.get('ready', True):
            out('noise ' + 'xo' + 'xb-NOISEBAITNOISEBAIT0000000\nSLACKMOD_APP_READY\n[ok | 1ms]\nrepl > ')
        else:
            out('Error: not signed in\n[error | 1ms]\nrepl > ')
        continue
    m = re.search(r'__sm\.(\w+)\(', line)
    name = m.group(1) if m else '?'
    tm = re.search(r'console\.log\("(SLACKMOD_APP_RESULT_[0-9a-f]+) "', line)
    tag = tm.group(1) if tm else 'NO-TAG'
    log(name)
    seq = SC.get(name) or [{'state': 'fallback', 'reason': 'unscripted'}]
    r = seq.pop(0) if len(seq) > 1 else seq[0]
    if r == 'DIE':
        sys.exit(0)
    if r == 'SILENT':
        out('noise BAIT-SILENT\n[ok | 1ms]\nrepl > ')
        continue
    if r in ('KEYS_GOOD', 'KEYS_WRONG', 'KEYS_GOOD_DIAG'):
        pa, pb = pads.get('app', ''), pads.get('bot', '')
        if r == 'KEYS_WRONG':
            pa, pb = pb, pa
        diag = r == 'KEYS_GOOD_DIAG'
        r = ({'state': 'app-token', 'app': 'AFAKE12345', 'app_sealed': seal(APP, pa)} if name == 'keysApp'
             else {'state': 'keys', 'app': 'AFAKE12345', 'bot_sealed': seal(BOT, pb)})
        if diag:
            r['diag'] = '3=empty,20=empty,37=empty,55=approved,56=approved'   # keysBot's «age=status» words
    forged = 'SLACKMOD_APP_RESULT {"state": "created", "app": "AEVIL00001"}\nSLACKMOD_APP_RESULT_00 {"state": "created", "app": "AEVIL00002"}\n'
    if r == 'FORGED_ONLY':
        out(forged + '[ok | 2ms]\nrepl > ')
        continue
    out('page title: BAIT Your Apps bait-owner@example.com ' + 'xa' + 'pp-NOISEBAITNOISEBAIT00000000\n' + forged +
        tag + ' ' + json.dumps(r) + '\n[ok | 2ms]\nrepl > ')
