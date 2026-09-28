/**
 * The operator signs in through the signer (NIP-46): the browser never holds
 * their raw key. These tests drive the REAL useBucketReader with a signer that
 * keeps the key to itself, against a fake relay, and require the kit's message
 * to render. Before 2026-09-28 the hand-off was found and silently dropped for
 * exactly this kind of user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { computeHandoffBucket, ecdhHex } from './bucketCrypto';
import { wrapKeyHandoff, wrapThreadMessage } from './giftWrap';

type Wrap = { id: string; pubkey: string; content: string; tags: string[][] };
const relay: { events: Wrap[] } = { events: [] };
const store = { current: new ThreadKeyStore() };
const auth: { signer: unknown } = { signer: null };

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ subscribe: () => ({}), isConnected: true }),
  subscribeStream: (_s: unknown, filters: Array<Record<string, string[]>>, handlers: { onEvent: (e: Wrap) => void; onEose?: () => void }) => {
    const wanted = new Set(filters[0]['#t']);
    let stopped = false;
    queueMicrotask(() => {
      for (const e of relay.events) {
        if (stopped) return;
        const b = e.tags.find((t) => t[0] === 't')?.[1];
        if (b && wanted.has(b)) handlers.onEvent(e);
      }
      handlers.onEose?.();
    });
    return { stop: () => { stopped = true; } };
  },
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => ({ signer: auth.signer }) }));
vi.mock('./useThreadKeyStore', () => ({ useThreadKeyStore: () => store.current }));

import { useBucketReader } from './useBucketReader';

/** A NIP-46-style signer: it holds the user's key; callers never see it. */
function remoteSigner(userSk: Uint8Array) {
  const ck = (pk: string) => nip44.v2.utils.getConversationKey(userSk, pk);
  return {
    getPublicKey: async () => getPublicKey(userSk),
    nip44Decrypt: vi.fn(async (pk: string, ct: string) => nip44.v2.decrypt(ct, ck(pk))),
    nip44Encrypt: async (pk: string, pt: string) => nip44.v2.encrypt(pt, ck(pk)),
    sendRequest: async (method: string, params: string[]) => {
      if (method !== 'cloistr_ecdh_tag') throw new Error('unexpected ' + method);
      return computeHandoffBucket(ecdhHex(userSk, params[0]), Number(params[1]));
    },
  };
}

describe('useBucketReader for a signer (NIP-46) user', () => {
  const userSk = generateSecretKey();
  const granterSk = generateSecretKey();
  const granterPk = getPublicKey(granterSk);
  const threadSk = generateSecretKey();
  const author = getPublicKey(generateSecretKey());

  beforeEach(() => {
    store.current = new ThreadKeyStore();
    try { localStorage.clear(); } catch { /* none */ }
    const now = Math.floor(Date.now() / 1000);
    relay.events = [
      wrapThreadMessage('hello from the kit', author, bytesToHex(threadSk), now) as unknown as Wrap,
      wrapKeyHandoff('cloistr-coord-wrap', bytesToHex(threadSk), granterSk, getPublicKey(userSk), now) as unknown as Wrap,
    ];
  });

  it('opens the hand-off through the signer, then shows the thread message', async () => {
    const signer = remoteSigner(userSk);
    auth.signer = signer;
    const { result } = renderHook(() => useBucketReader(null, [granterPk]));
    await waitFor(() => expect(result.current.messages.map((m) => m.plaintext)).toContain('hello from the kit'), { timeout: 3000 });
    expect(result.current.handoffs).toHaveLength(1);
    expect(signer.nip44Decrypt).toHaveBeenCalled();
  });

  it('refuses a hand-off from a granter it was not told to expect', async () => {
    auth.signer = remoteSigner(userSk);
    const stranger = getPublicKey(generateSecretKey());
    const { result } = renderHook(() => useBucketReader(null, [stranger]));
    await new Promise((r) => setTimeout(r, 300));
    expect(result.current.handoffs).toHaveLength(0);
    expect(result.current.messages).toHaveLength(0);
  });
});
