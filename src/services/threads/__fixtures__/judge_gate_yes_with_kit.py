# The kit's own merge gate, judging a reply Space built. Reads
#   {"request": <kit request event>, "wrap": <Space's kind 1059>, "operatorPk": hex,
#    "gate": ..., "repo": ..., "target": ..., "diff": ...}
# on stdin and prints {"accepted": bool, ...}. Runs the same path a live yes takes:
# the daemon opens the wrap, the signed store keeps its plaintext, and the gate's
# find_yes reads the store. Nothing here is a Space-side reimplementation.
import sys, os, json, tempfile
home = tempfile.mkdtemp(prefix='gate-judge-')
os.environ['ARBITER_HOME'] = home
sys.path.insert(0, '/home/forgemaster/.arbiter/hooks'); sys.path.insert(0, '/home/forgemaster/.arbiter/scripts')
import nostr_sdk as sdk
from lib import grant_request, signed_store
import thread_daemon as td

job = json.load(sys.stdin)
req = job['request']
key = grant_request.request_key(job['gate'], job['repo'], job['target'], job['diff'])
grant_request._write(grant_request.request_path(key), {'event': req, 'status': 'posted', 'key': key})

ev = sdk.Event.from_json(json.dumps(job['wrap']))
opened = td.open_wrapped(ev, sdk.Keys.parse('11'*32))
if opened is None:
    print(json.dumps({'accepted': False, 'why': 'the kit could not open the wrap'}))
    sys.exit(0)
signed_store.append(json.loads(ev.as_json()), opened['plaintext'])
got = grant_request.find_yes(job['gate'], job['repo'], job['diff'],
                             records=list(signed_store.iter_records()),
                             operator_keys=[job['operatorPk']], target=job['target'])
print(json.dumps({'accepted': got is not None,
                  'reason': got and got['reason'],
                  'plaintextHead': str(opened['plaintext'])[:40]}))
