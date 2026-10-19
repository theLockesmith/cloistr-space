# Regenerates kitThreadEvents.json with the kit's own code and fixed TEST keys:
#   python3 src/services/threads/__fixtures__/make_kit_fixtures.py > src/services/threads/__fixtures__/kitThreadEvents.json
import sys, json
sys.path.insert(0, '/home/forgemaster/.arbiter/hooks'); sys.path.insert(0, '/home/forgemaster/.arbiter/scripts')
import nostr_sdk as sdk
from lib import thread_wrap
import thread_daemon as td
# Fixed test keys only (no real fleet secrets).
thread = sdk.Keys.parse('11'*32)
role = sdk.Keys.parse('22'*32)        # a role's own key, as _signer_for returns
member = sdk.Keys.parse('33'*32)      # the Space user
granter = sdk.Keys.parse('44'*32)     # fleet identity
unheld = sdk.Keys.parse('55'*32)
env = td.make_envelope(body='wrap-mode hello', to='cloistr-space', frm='cloistr-orchestrator', thread='cloistr-group-wrap')
wrap = thread_wrap.wrap_event(plaintext=env, author=role, thread_keys=thread, thread_secret_hex=thread.secret_key().to_hex())
wrap_unheld = thread_wrap.wrap_event(plaintext=env.replace('hello','secret'), author=role, thread_keys=unheld, thread_secret_hex=unheld.secret_key().to_hex())
ho = thread_wrap.wrap_handoff(granter=granter, member_pk=member.public_key(), thread_id='cloistr-group-wrap', thread_secret_hex=thread.secret_key().to_hex())
tcfg = {'id':'cloistr-group-wrap'}
env2 = td.make_envelope(body='legacy hello', to='cloistr-space', frm='cloistr-orchestrator', thread='cloistr-group-wrap')
content = td.seal(env2, author=role, thread_pk=thread.public_key())
tags = td.build_tags(tcfg, thread.public_key().to_hex())
b = sdk.EventBuilder(sdk.Kind(1111), content).tags([sdk.Tag.parse(t) for t in tags])
legacy = role.sign_event(b.finalize_unsigned(role.public_key()))
out = {n: json.loads(e.as_json()) for n, e in [('wrap', wrap), ('wrapUnheld', wrap_unheld), ('handoff', ho), ('legacy1111', legacy)]}
out['keys'] = {'threadPk': thread.public_key().to_hex(), 'rolePk': role.public_key().to_hex(), 'memberPk': member.public_key().to_hex(), 'granterPk': granter.public_key().to_hex(), 'unheldPk': unheld.public_key().to_hex()}
print(json.dumps(out, indent=2))
