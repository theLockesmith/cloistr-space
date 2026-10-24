# Regenerates kitGateRequest.json: a merge-gate request exactly as the kit posts
# it (lib/grant_request.py builds it, thread_daemon.make_envelope attaches it,
# thread_wrap.wrap_event seals it), on the same fixed TEST thread key as
# kitThreadEvents.json:
#   python3 src/services/threads/__fixtures__/make_gate_request_fixture.py > src/services/threads/__fixtures__/kitGateRequest.json
import sys, json
sys.path.insert(0, '/home/forgemaster/.arbiter/hooks'); sys.path.insert(0, '/home/forgemaster/.arbiter/scripts')
import nostr_sdk as sdk
from lib import thread_wrap, grant_request
import thread_daemon as td
thread = sdk.Keys.parse('11'*32)
role = sdk.Keys.parse('22'*32)
req = grant_request.build_request('merge', 'aegis/arbiter-client', 'main', 'ab'*32,
                                  kind='kit-change', unmet=['council review'],
                                  why='adds council config to the protected list')
env = td.make_envelope(body=grant_request.describe(req), to='operator', frm='conscience-orch',
                       thread='cloistr-group-wrap', kind='question',
                       attach={'grant_request': req})
wrap = thread_wrap.wrap_event(plaintext=env, author=role, thread_keys=thread,
                              thread_secret_hex=thread.secret_key().to_hex())
print(json.dumps({'request': req, 'wrap': json.loads(wrap.as_json()),
                  'keys': {'threadPk': thread.public_key().to_hex()}}, indent=2))
