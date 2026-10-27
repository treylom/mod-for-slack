#!/usr/bin/env python3
"""fake-slack-server.py — a local stand-in for the two Slack read calls the doctor makes (test helper, never ships to users).

    python3 -I fake-slack-server.py <port file> <log file> <mode file>

Binds 127.0.0.1 on a free port, writes the port number to <port file>, and answers GET /auth.test and /conversations.history.
Every request is logged as «<path> auth=<ok|bad>» (the bearer value is compared with the expected one in the mode file,
never written). The mode file holds one word, re-read on every request:
    ok · channel_not_found · not_in_channel · invalid_auth · missing_scope
The expected bearer value is the second line of the mode file. Stops when the file «<mode file>.stop» appears.
"""
import http.server
import json
import os
import sys

PORT_FILE, LOG_FILE, MODE_FILE = sys.argv[1:4]


def mode():
    with open(MODE_FILE, encoding='utf-8') as f:
        lines = f.read().split('\n')
    return lines[0].strip(), (lines[1].strip() if len(lines) > 1 else '')


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        m, want = mode()
        got = self.headers.get('Authorization', '')
        path, _, query = self.path.partition('?')
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write('%s auth=%s%s\n' % (path, 'ok' if got == 'Bearer ' + want else 'bad', ' limit1' if 'limit=1' in query.split('&') else ''))
        if m == 'invalid_auth' or got != 'Bearer ' + want:
            body = {'ok': False, 'error': 'invalid_auth'}
        elif path == '/auth.test':
            body = {'ok': True, 'team_id': 'TTEST', 'user': 'bot'}
        elif m == 'channel_not_found':
            body = {'ok': False, 'error': 'channel_not_found'}
        elif m == 'not_in_channel':
            body = {'ok': False, 'error': 'not_in_channel'}
        elif m == 'missing_scope':
            body = {'ok': False, 'error': 'missing_scope'}
        elif path == '/conversations.info':
            body = {'ok': False, 'error': 'missing_scope'}   # the manifest has no channels:read — the doctor must not rely on this call
        else:
            body = {'ok': True, 'messages': []}
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


srv = http.server.HTTPServer(('127.0.0.1', 0), H)
srv.timeout = 0.5
with open(PORT_FILE + '.tmp', 'w') as f:
    f.write(str(srv.server_address[1]))
os.replace(PORT_FILE + '.tmp', PORT_FILE)
while not os.path.exists(MODE_FILE + '.stop'):
    srv.handle_request()
