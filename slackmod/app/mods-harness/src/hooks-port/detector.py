#!/usr/bin/env python3
"""The sole external command hook: missing/stale/failed mod means deny."""
import argparse, json, os, sys
from protocol import Refusal, load, consume, registry_current
READ_ONLY=frozenset(('Read','Glob','Grep'))
def check(config_path, session, bot_name, event):
    try:
        cfg,bot,required,config_hash=load(config_path,session,bot_name)
        if event.get('tool_name') in READ_ONLY:return {'allow':True,'reason':'read-only'}
        # --session is the immutable launch UUID. A changed current UUID needs
        # a fresh native permit bound to BOTH identities, never a blanket rebind.
        current=event.get('session_id')
        if not current:raise Refusal('detector-session-missing')
        registry_current(cfg,bot_name,current)
        consume(cfg,current,event,config_hash,required,session)
        return {'allow':True,'reason':'permit-consumed'}
    except Exception as exc:
        return {'allow':False,'reason':str(exc) if isinstance(exc,Refusal) else 'detector-error:'+type(exc).__name__}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--config',required=True);ap.add_argument('--session',required=True);ap.add_argument('--bot',default=os.environ.get('MODS_HARNESS_BOT'));a=ap.parse_args()
    try:event=json.load(sys.stdin)
    except Exception:event={}
    result=check(a.config,a.session,a.bot,event)
    if result['allow']:return 0
    reason='[mods-harness ALARM] '+result['reason']
    print(reason,file=sys.stderr)
    print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','permissionDecisionReason':reason}}))
    return 0
if __name__=='__main__':sys.exit(main())
