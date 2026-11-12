/**
 * @fileoverview useThreadKeyGrant: a signer-backed admin hands over a thread key.
 *
 * Until card #522 this hook published a kind 24242 key-wrap. That kind is
 * ephemeral, so the relay never stored one and an offline member could never
 * receive it. It now sends a bucketed hand-off through publishKeyHandoffViaSigner
 * (tested with real crypto in threadPublish.test.ts) and records the grant
 * for re-sending.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { ThreadKeyStore } from './threadKeyStore';
import { openHandoffGrants } from './handoffGrants';

const granterSk = generateSecretKey();
const granterPk = getPublicKey(granterSk);
const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);
const memberPk = getPublicKey(generateSecretKey());

const selfCk = nip44.v2.utils.getConversationKey(granterSk, granterPk);
const nip44Encrypt = async (_pk: string, pt: string) => nip44.v2.encrypt(pt, selfCk);
const nip44Decrypt = async (_pk: string, ct: string) => nip44.v2.decrypt(ct, selfCk);

const published = vi.hoisted(() => ({ calls: [] as unknown[][], fail: null as Error | null }));
vi.mock('./threadPublish', () => ({
  publishKeyHandoffViaSigner: async (...args: unknown[]) => {
    if (published.fail) throw published.fail;
    published.calls.push(args);
  },
}));

const testKeyStore = new ThreadKeyStore();
vi.mock('./useThreadKeyStore', () => ({ useThreadKeyStore: () => testKeyStore }));

const auth = vi.hoisted(() => ({ signer: null as unknown }));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => ({ signer: auth.signer }) }));
vi.mock('@/stores/authStore', () => {
  const state = { pubkey: '' };
  const useAuthStore = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  useAuthStore.getState = () => state;
  useAuthStore.state = state;
  return { useAuthStore };
});

const nip46Signer = {
  getPublicKey: async () => granterPk,
  signEvent: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  nip44Encrypt,
  nip44Decrypt,
  sendRequest: vi.fn(),
};
const extensionSigner: Partial<typeof nip46Signer> = { ...nip46Signer };
delete extensionSigner.sendRequest;

beforeEach(async () => {
  const { useAuthStore } = await import('@/stores/authStore');
  (useAuthStore as unknown as { state: { pubkey: string } }).state.pubkey = granterPk;
  auth.signer = nip46Signer;
  published.calls = [];
  published.fail = null;
  testKeyStore.clear();
  testKeyStore.set(threadPk, threadSk);
  testKeyStore.setName(threadPk, 'team-thread');
  localStorage.clear();
});

describe('useThreadKeyGrant', () => {
  it('sends the hand-off through the signer, with the thread id it was received under', async () => {
    const { useThreadKeyGrant } = await import('./useThreadKeyGrant');
    const { result } = renderHook(() => useThreadKeyGrant());
    expect(result.current.canGrant).toBe(true);

    await act(() => result.current.grantKey(threadPk, memberPk));

    expect(published.calls).toHaveLength(1);
    const [tid, secret, signer, member] = published.calls[0];
    expect(tid).toBe('team-thread');
    expect(secret).toBe(testKeyStore.exportHex(threadPk));
    expect(signer).toBe(nip46Signer);
    expect(member).toBe(memberPk);
  });

  it('records the grant so it is sent again on the following days', async () => {
    const { useThreadKeyGrant } = await import('./useThreadKeyGrant');
    const { result } = renderHook(() => useThreadKeyGrant());
    await act(() => result.current.grantKey(threadPk, memberPk));

    const grants = await openHandoffGrants(granterPk, { encrypt: nip44Encrypt, decrypt: nip44Decrypt }, () => true);
    const tomorrow = Math.floor(Date.now() / 1000 / 86400) + 1;
    expect(grants.due(tomorrow)).toMatchObject([{ thread: threadPk, member: memberPk, tid: 'team-thread' }]);
  });

  it('records nothing when the send failed', async () => {
    published.fail = new Error('no relay took it');
    const { useThreadKeyGrant } = await import('./useThreadKeyGrant');
    const { result } = renderHook(() => useThreadKeyGrant());

    await expect(result.current.grantKey(threadPk, memberPk)).rejects.toThrow(/no relay took it/);
    expect(localStorage.getItem('cloistr:handoff-grants:' + granterPk)).toBeNull();
  });

  it('cannot grant with a browser-extension signer, and says why', async () => {
    auth.signer = extensionSigner;
    const { useThreadKeyGrant } = await import('./useThreadKeyGrant');
    const { result } = renderHook(() => useThreadKeyGrant());

    expect(result.current.canGrant).toBe(false);
    await expect(result.current.grantKey(threadPk, memberPk)).rejects.toThrow(/cannot hand over thread keys/);
    expect(published.calls).toHaveLength(0);
  });

  it('refuses a thread whose key is not held', async () => {
    const { useThreadKeyGrant } = await import('./useThreadKeyGrant');
    const { result } = renderHook(() => useThreadKeyGrant());

    await expect(result.current.grantKey(getPublicKey(generateSecretKey()), memberPk)).rejects.toThrow(/do not hold/);
    expect(published.calls).toHaveLength(0);
  });
});
