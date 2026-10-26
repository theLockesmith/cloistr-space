/**
 * Space reads the kit's seal-author-v2 messages (arbiter-client
 * fix/seal-author-v2): wrap -> kind 13 seal signed by the author -> unsigned
 * kind 14 rumor carrying the envelope. The fixtures are made by the kit's own
 * code (make_kit_v2_fixtures.py), and the kit's own reader accepts `wrap` and
 * refuses `impersonating` and `badSig`; Space must agree on all three.
 */

import { describe, it, expect } from 'vitest';
import { hexToBytes } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { tryUnwrapMessage, wrapThreadMessage } from './giftWrap';
import { parseFleetEnvelope } from './fleetEnvelope';
import kit from './__fixtures__/kitSealedV2.json';

function holding(skHex: string) {
  const store = new ThreadKeyStore();
  store.importHex(kit.keys.threadPk, skHex);
  return store;
}

describe('kit seal-author-v2 messages', () => {
  it('opens a v2 message, with the seal signer as a verified author and the signed send time', () => {
    const msg = tryUnwrapMessage(kit.wrap, holding(kit.keys.threadSk));

    expect(msg).not.toBeNull();
    expect(parseFleetEnvelope(msg!.plaintext)?.body).toBe('sealed v2 hello');
    expect(msg!.authorHex).toBe(kit.keys.rolePk);
    expect(msg!.verified).toBe(true);
    expect(msg!.threadId).toBe(kit.keys.threadPk);
    expect(msg!.approxTime).toBe(false);
    expect(msg!.createdAt).toBeGreaterThanOrEqual(kit.wrap.created_at);
  });

  it('refuses a seal whose message claims a different author than the one who signed it', () => {
    expect(tryUnwrapMessage(kit.impersonating, holding(kit.keys.threadSk))).toBeNull();
  });

  it('refuses a seal whose signature does not verify', () => {
    expect(tryUnwrapMessage(kit.badSig, holding(kit.keys.threadSk))).toBeNull();
  });

  it('opens nothing for a thread whose key is not held', () => {
    expect(tryUnwrapMessage(kit.wrapUnheld, holding(kit.keys.threadSk))).toBeNull();
  });

  it('still reads the old {p, a} shape, marked unverified', () => {
    const sk = kit.keys.threadSk;
    const old = wrapThreadMessage('old hello', kit.keys.claimedPk, sk);
    const msg = tryUnwrapMessage(old, holding(sk));

    expect(msg?.plaintext).toBe('old hello');
    expect(msg?.authorHex).toBe(kit.keys.claimedPk);
    expect(msg?.verified).toBe(false);
    expect(hexToBytes(sk)).toHaveLength(32);
  });
});
