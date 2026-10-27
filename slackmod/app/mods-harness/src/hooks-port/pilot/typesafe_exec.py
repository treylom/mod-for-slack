"""Disposable pinned-source host. Invoked only under runner process-group limits."""
import importlib.abc, importlib.util, io, json, os, pathlib, sys, types
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from typesafe_bridge import validate, MODULES
from rsync_safety import source

def main():
    req=json.load(sys.stdin);policy=req['policy'];event=req['event'];options=req['options']
    validate(policy,options)
    state=pathlib.Path(options['stateDir'])
    os.umask(0o077)
    credential=os.environ.get(options.get('judgeCredentialEnv','TYPESAFE_API_KEY'))
    for name in list(os.environ):
        if name.startswith('TYPESAFE_') or name in ('DISPATCH_FIELDS_HINT','DISCORD_STATE_DIR'):os.environ.pop(name,None)
    # Keep HOME intact. Every mutable policy store has an explicit destination.
    env={'TYPESAFE_BOT':options['bot'],'TYPESAFE_BOT_NAME':options['bot'],
         'TYPESAFE_DESTRUCTIVE_MODE':'enforce','TYPESAFE_GATE':'on','TYPESAFE_JUDGE':'on',
         'TYPESAFE_SIG_STATE':str(state/'sig-blocked.json'),'TYPESAFE_HUMAN_QUEUE':str(state/'human-queue.jsonl'),
         'TYPESAFE_GAP_STREAK_FILE':str(state/'gap.json'),'TYPESAFE_SCOPE_LOG':str(state/'scope.jsonl'),
         'TYPESAFE_LOG':str(state/'judge.jsonl'),'TYPESAFE_ALERT_ROOT':str(state/'alerts'),
         'TYPESAFE_ENDPOINT':'https://api.typesafe.ai/v1/systemone','TYPESAFE_TIMEOUT':'4',
         'TYPESAFE_ENV_FILE':options['judgeEnvFile'],'TYPESAFE_DESTR_TIMEOUT':'6','TYPESAFE_DESTR_BLOCK_P':'0.8',
         'TYPESAFE_APPROVAL_BUTTON_BOTS_FILE':options.get('buttonBotsFile',''),
         'DISPATCH_FIELDS_HINT':'1' if options.get('dispatchHint') is True else '0',
         'TYPESAFE_GAP_ALERT':'off' if options.get('alertMode','off')=='off' else 'on',
         'TYPESAFE_ALERT_V2':'on' if options.get('alertMode')=='v2' else 'off'}
    os.environ.update(env)
    if credential:os.environ['TYPESAFE_API_KEY']=credential
    if options.get('alertMode')=='v2':os.environ['TYPESAFE_ALERT_SENDER_ID']=json.dumps(options.get('alertSenderIdentity',{}))
    scripts=str(pathlib.Path(options['sourcePath']).parent.parent/'scripts')
    class Pinned(importlib.abc.MetaPathFinder,importlib.abc.Loader):
        tag='typesafe-own-modules';root=scripts
        def find_spec(self,name,path=None,target=None):
            if name in MODULES or name=='typesafe_approval_selftest':
                if name not in options['modules']:raise ImportError('unpinned TypeSafe module')
                return importlib.util.spec_from_loader(name,self)
        def create_module(self,spec):return None
        def exec_module(self,module):
            spec=options['modules'][module.__name__];module.__file__=spec['path']
            exec(compile(source(spec['path'],spec['sha256']),spec['path'],'exec'),module.__dict__)
            if module.__name__=='typesafe_approval_registry':
                module.ROOT=pathlib.Path(options['approvalRoot'])
                defaults=list(module.Registry.__init__.__defaults__);defaults[0]=module.ROOT
                module.Registry.__init__.__defaults__=tuple(defaults)
                module.ROSTER_FILE=options['rosterPath'];module.ROSTER_PATH=options['rosterPath']
    finder=Pinned();sys.meta_path.insert(0,finder)
    mod=types.ModuleType('mh_pinned_typesafe');mod.__file__=options['sourcePath']
    exec(compile(source(mod.__file__,options['sourceSha256']),mod.__file__,'exec'),mod.__dict__)
    # Dispatch originally infers BOT from an old Discord state directory.
    mod.BOT=options['bot']
    if policy=='typesafe-destructive':
        mod.VAULT_ROOT=pathlib.Path(options['vaultRoot']);mod.PRIVATE_REPOS=pathlib.Path(options['privateReposPath'])
        mod._supervise()
    sys.stdin=io.StringIO(json.dumps(event))
    return mod.main()

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        print('typesafe bridge execution error: '+type(exc).__name__,file=sys.stderr);sys.exit(1)
