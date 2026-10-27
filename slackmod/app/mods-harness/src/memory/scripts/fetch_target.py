#!/usr/bin/env python3
"""Memory fetch guard: does this non-GET $.http.fetch reach a guarded memory host? (stdlib only · no connection made)

봇 10-18 (same class as 봇's link bypass): the string check compared «host:port» text, so the guarded
127.0.0.1:8888 was missed as localhost:8888 or [::1]:8888. The lane first compares canonical literals (JS); this
resolves names: the target host and every guarded host go through getaddrinfo, loopback/unspecified addresses
collapse to one «loopback» class, and a shared address on a matching port is a hit.

Input = the host and port the engine's URL parser produced (no second URL parser here).
Not covered (said, not hidden): a redirect answered by the first host; a DNS answer that changes between this
check and the connection; a proxy that resolves names itself.

stdout: one JSON line {"hit": <guard entry or "">, "addrs": [...], "error": <"" or reason>}. Any error = refuse.
"""
import argparse
import ipaddress
import json
import socket
import sys


def canon(addr):
    ip = ipaddress.ip_address(addr.split('%', 1)[0])
    mapped = getattr(ip, 'ipv4_mapped', None)
    if mapped is not None:
        ip = mapped
    if ip.is_loopback or ip.is_unspecified:
        return 'loopback'
    return str(ip)


def addrs(host):
    h = host.strip('[]').rstrip('.')
    try:
        return {canon(h)}
    except ValueError:
        pass
    return {canon(ai[4][0]) for ai in socket.getaddrinfo(h, None, proto=socket.IPPROTO_TCP)}


def entry(e):
    e = e.strip().lower()
    if e.startswith('['):
        host, _, rest = e[1:].partition(']')
        port = rest[1:] if rest.startswith(':') else ''
    elif e.count(':') == 1:
        host, port = e.split(':')
    else:
        host, port = e, ''
    return host, (int(port) if port else None)


def judge(host, port, guards):
    out = {'hit': '', 'addrs': [], 'error': '', 'unresolved': []}
    try:
        mine = addrs(host)
    except Exception as exc:  # the target cannot be resolved = cannot tell = refuse
        out['error'] = type(exc).__name__ + ': ' + str(exc)[:160]
        return out
    out['addrs'] = sorted(mine)
    for g in guards:
        try:
            gh, gp = entry(g)
            if gp is not None and gp != port:
                continue
            theirs = addrs(gh)
        except Exception:
            # a guarded name this machine cannot resolve: its spelling was already compared by the lane; noted
            out['unresolved'].append(g)
            continue
        if mine & theirs:
            out['hit'] = g
            return out
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', required=True)
    ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--guard', action='append', default=[])
    a = ap.parse_args(argv)
    sys.stdout.write(json.dumps(judge(a.host, a.port, a.guard)) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
