#!/usr/bin/env python3
"""Build a private migration inventory; never executes hooks or activates a bot."""
import hashlib, json, pathlib

def collect(sources, classifications=None):
    entries=[]; signatures={}; coverage=[]; classifications=classifications or {}
    for label, path in sources:
        p=pathlib.Path(path); raw=p.read_bytes(); settings=json.loads(raw)
        source={'scope':label,'sha256':hashlib.sha256(raw).hexdigest(),'registrations':0,'direct':0,'wrapper':0}
        for event, groups in settings.get('hooks',{}).items():
            for gi,group in enumerate(groups):
                for hi,hook in enumerate(group.get('hooks',[])):
                    if hook.get('type')!='command':raise ValueError('non-command source requires separate adapter')
                    cmd=hook['command'];matcher=group.get('matcher','');sid=f'{label}:{event}:{gi:02}:{hi:02}'
                    source['registrations']+=1;source['wrapper' if 'vault-scope-run.sh' in cmd else 'direct']+=1
                    key=(event,matcher,cmd)
                    if key in signatures:
                        signatures[key]['sourceIds'].append(sid);continue
                    evidence=classifications.get(sid,{}); known=evidence.get('blocking',{}).get('is_blocking')
                    blocking=known is not False  # unknown cannot weaken a gate
                    parent_only=str(evidence.get('parentOnly',{}).get('value')).lower()=='true'
                    entry={'id':sid,'event':event,'matcher':matcher,'command':cmd,'blocking':blocking,
                           'timeoutMs':min(7000,int(hook.get('timeout',7)*1000)),
                           'disposition':'mod-handler-fail-closed' if blocking else 'mod-handler',
                           'requires':['jq','python3'] if blocking else [],'parentOnly':parent_only,
                           'sourceIds':[sid],'sourceTimeoutSeconds':hook.get('timeout'),
                           'sourceAsync':hook.get('async',False),'classification':'static' if known is not None else 'conservative-unreviewed'}
                    signatures[key]=entry;entries.append(entry)
        coverage.append(source)
    return {'strategy':'isolated-settings','requiredGateIds':[e['id'] for e in entries if e['blocking']],
            'entries':entries,'coverage':coverage,'childPolicyReviewed':False,
            'activationStatus':'blocked-classic-policy-and-runtime-review',
            'registrationCount':sum(s['registrations'] for s in coverage),
            'deduplicated':sum(s['registrations'] for s in coverage)-len(entries)}
