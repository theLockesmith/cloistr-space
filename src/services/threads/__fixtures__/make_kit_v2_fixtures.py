# Regenerates kitSealedV2.json with the kit's own seal-author-v2 code and fixed TEST keys.
# The kit change is on arbiter-client branch fix/seal-author-v2; extract it first:
#   git -C ~/Development/arbiter-client archive fix/seal-author-v2 hooks/lib | tar -x -C <dir>
#   KIT_V2_HOOKS=<dir>/hooks python3 src/services/threads/__fixtures__/make_kit_v2_fixtures.py \
#     > src/services/threads/__fixtures__/kitSealedV2.json
import json, os, sys, time
sys.path.insert(0, os.environ['KIT_V2_HOOKS']); sys.path.insert(0, '/home/forgemaster/.arbiter/scripts')
import nostr_sdk as sdk
from lib import thread_wrap, nostr_sign
import thread_daemon as td
# Fixed test keys only (no real fleet secrets).
thread = sdk.Keys.parse('11'*32)
role = sdk.Keys.parse('22'*32)        # the sending role's own key
member = sdk.Keys.parse('33'*32)      # the Space user
impostor_claim = sdk.Keys.parse('44'*32)  # fleet identity, claimed but not signed
unheld = sdk.Keys.parse('55'*32)
env = td.make_envelope(body='sealed v2 hello', to='cloistr-space', frm='cloistr-orchestrator', thread='cloistr-group-wrap')

# The real thing, exactly as the kit sends it.
wrap = thread_wrap.wrap_event(plaintext=env, author=role, thread_keys=thread, thread_secret_hex=thread.secret_key().to_hex())
wrap_unheld = thread_wrap.wrap_event(plaintext=env, author=role, thread_keys=unheld, thread_secret_hex=unheld.secret_key().to_hex())


def rewrap(seal):
    """Put an arbitrary seal in a wrap the same way wrap_event does."""
    now = int(time.time())
    rk = sdk.Keys.generate()
    enc = sdk.nip44_encrypt(rk.secret_key(), thread.public_key(), json.dumps(seal, separators=(',', ':')), sdk.Nip44Version.V2)
    b = (sdk.EventBuilder(sdk.Kind(1059), enc)
         .custom_created_at(sdk.Timestamp.from_secs(thread_wrap.jitter_ts(now)))
         .tags([sdk.Tag.parse(['t', thread_wrap.bucket(thread.secret_key().to_hex(), thread_wrap.window_for(now))]),
                sdk.Tag.parse(['expiration', str(thread_wrap.expiry_ts(now))])]))
    return rk.sign_event(b.finalize_unsigned(rk.public_key()))


def seal_of(rumor_pubkey_hex, signer):
    now = int(time.time())
    rumor = {'pubkey': rumor_pubkey_hex, 'created_at': now, 'kind': thread_wrap.RUMOR_KIND, 'tags': [], 'content': env}
    content = sdk.nip44_encrypt(signer.secret_key(), thread.public_key(), json.dumps(rumor, separators=(',', ':')), sdk.Nip44Version.V2)
    return nostr_sign.make_event(signer.secret_key().to_hex(), thread_wrap.SEAL_KIND, content, [], thread_wrap.seal_jitter_ts(now))


# Forged: the role signs a seal whose rumor claims to be the fleet identity.
impersonating = rewrap(seal_of(impostor_claim.public_key().to_hex(), role))
# Forged: a correctly-shaped seal whose signature was altered.
bad = seal_of(role.public_key().to_hex(), role)
bad['sig'] = ('0' if bad['sig'][0] != '0' else '1') + bad['sig'][1:]
bad_sig = rewrap(bad)

out = {n: json.loads(e.as_json()) for n, e in [('wrap', wrap), ('wrapUnheld', wrap_unheld), ('impersonating', impersonating), ('badSig', bad_sig)]}
out['keys'] = {'threadSk': thread.secret_key().to_hex(), 'threadPk': thread.public_key().to_hex(),
               'rolePk': role.public_key().to_hex(), 'claimedPk': impostor_claim.public_key().to_hex()}
print(json.dumps(out, indent=2))
