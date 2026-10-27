#!/usr/bin/env python3
"""Closed policy entrypoint: JSON in, decision out; unknown/error always deny."""
import json, re, sys
import intake, open_rows, memory_index
from catalog import EVENTS

def main():
    try:
        policy=sys.argv[1];request=json.load(sys.stdin)
        event=request['event'];options=request['options']
        if not isinstance(event,dict) or not isinstance(options,dict):raise ValueError('invalid request')
        if event.get('hook_event_name') not in EVENTS.get(policy,[]):raise ValueError('unsupported policy/event')
        if policy in ('typesafe-destructive','typesafe-dispatch','typesafe-signature'):
            import typesafe_bridge
            result=typesafe_bridge.handle(policy,event,options)
        elif policy=='directives-intake':result=intake.handle(event,options)
        elif policy=='directives-open-rows':result=open_rows.handle(event,options)
        elif policy=='memory-index':result=memory_index.handle(event,options)
        elif policy=='aside-web':
            import aside_web
            result=aside_web.handle(event,options)
        elif policy=='rsync-safety':
            import rsync_safety
            result=rsync_safety.handle(event,options)
        elif policy=='api-spend':
            import api_spend
            result=api_spend.handle(event,options)
        elif policy=='pinned-legacy':
            import pinned_legacy
            result=pinned_legacy.handle(event,options)
        elif policy=='feedback-h2':
            import feedback
            result=feedback.handle(event,options)
        else:raise ValueError('unknown policy')
        print(json.dumps(result or {},ensure_ascii=False));return 0
    except Exception as exc:
        # Do not leak paths, private policy fields, input text or account data. A pinned file that cannot be trusted
        # (rsync_safety.PinError) adds its base name and the kind — the runner then says which file and how to fix it.
        out={'nativePolicyError':type(exc).__name__}
        pin,kind=getattr(exc,'pin',None),getattr(exc,'kind',None)
        if isinstance(pin,str) and re.fullmatch(r'[A-Za-z0-9._-]{1,80}',pin) and kind in ('changed','mode','missing'):out.update(pinFile=pin,pinKind=kind)
        print(json.dumps(out));return 0
if __name__=='__main__':sys.exit(main())
