/**
 * The operator signs in through the signer (NIP-46): the browser never holds
 * their raw key. These tests drive the REAL useBucketReader with a signer that
 * keeps the key to itself, against a fake relay, and require the kit's message
 * to render. Before 2026-09-28 the hand-off was found and silently dropped for
 * exactly this kind of user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { computeHandoffBucket, computeThreadBucket, ecdhHex, getWindowId } from './bucketCrypto';
import { wrapKeyHandoff, wrapKeyHandoffWithKey, wrapThreadMessage } from './giftWrap';
import { wrapSignerWithReauth } from '@cloistr/ui';
import type { SignerInterface } from '@/services/headless';

type Wrap = { id: string; pubkey: string; content: string; tags: string[][] };
const relay: { events: Wrap[]; holdEose?: boolean } = { events: [] };
const store = { current: new ThreadKeyStore() };
const auth: { signer: unknown } = { signer: null };

// ONE subscribe function, as the real NdkProvider gives: a new one per render
// restarted the reader on every render and hid the cold-reload bug below.
const subscribeFn = () => ({});
vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ subscribe: subscribeFn, isConnected: true }),
  subscribeStream: (_s: unknown, filters: Array<Record<string, string[]>>, handlers: { onEvent: (e: Wrap) => void; onEose?: () => void }) => {
    const wanted = new Set(filters[0]['#t']);
    let stopped = false;
    queueMicrotask(() => {
      for (const e of relay.events) {
        if (stopped) return;
        const b = e.tags.find((t) => t[0] === 't')?.[1];
        if (b && wanted.has(b)) handlers.onEvent(e);
      }
      if (!relay.holdEose) handlers.onEose?.();
    });
    return { stop: () => { stopped = true; } };
  },
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => ({ signer: auth.signer }) }));
vi.mock('./useThreadKeyStore', () => ({ useThreadKeyStore: () => store.current }));

import { useBucketReader } from './useBucketReader';
import { useAuthStore } from '@/stores/authStore';

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

  it('opens the hand-off through the signer and, once accepted, shows the thread message', async () => {
    const signer = remoteSigner(userSk);
    auth.signer = signer;
    const { result } = renderHook(() => useBucketReader(null, [granterPk]));
    // A hand-off cannot prove who sent it, so its key waits for the user.
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });
    act(() => result.current.acceptHandoff(result.current.pendingHandoffs[0].wrapId));
    await waitFor(() => expect(result.current.messages.map((m) => m.plaintext)).toContain('hello from the kit'), { timeout: 3000 });
    expect(result.current.handoffs).toHaveLength(1);
    expect(signer.nip44Decrypt).toHaveBeenCalled();
  });

  it('a key restored from storage AFTER the reader started still brings its messages (cold reload)', async () => {
    // Live #325 proof, 2026-10-19: after a reload the saved key arrives through
    // a signer round trip, after the reader has chosen its buckets. The
    // hand-off then matched a held key, so nothing restarted, and the wrap-mode
    // message vanished until the next day's window.
    auth.signer = remoteSigner(userSk);
    const { result } = renderHook(() => useBucketReader(null, [granterPk]));
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });
    act(() => store.current.importHex(getPublicKey(threadSk), bytesToHex(threadSk)));
    await waitFor(() => expect(result.current.messages.map((m) => m.plaintext)).toContain('hello from the kit'), { timeout: 3000 });
  });

  it('an offer for a key restored from storage after the reader started is withdrawn (accepted keys stay accepted across a reload)', async () => {
    // Operator report, 2026-10-28: after a reload every accepted offer was back.
    // The hand-off is seen before the saved key finishes its signer round
    // trip, so it is offered; the key then arrives and the offer must go.
    auth.signer = remoteSigner(userSk);
    const { result } = renderHook(() => useBucketReader(null, [granterPk]));
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });
    act(() => store.current.importHex(getPublicKey(threadSk), bytesToHex(threadSk)));
    await waitFor(() => expect(result.current.messages.map((m) => m.plaintext)).toContain('hello from the kit'), { timeout: 3000 });
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(0), { timeout: 3000 });
    expect(result.current.handoffs).toHaveLength(1);
  });

  /** What the user's saved entry for this thread decrypts to, or null. */
  function savedEntry(): string | null {
    const raw = localStorage.getItem('cloistr:thread-keys:' + getPublicKey(userSk));
    const blob = raw ? (JSON.parse(raw) as Record<string, string>)[getPublicKey(threadSk)] : undefined;
    if (!blob) return null;
    return nip44.v2.decrypt(blob, nip44.v2.utils.getConversationKey(userSk, getPublicKey(userSk)));
  }

  it('accepting a hand-off saves the thread name with the key, so the thread outlives the hand-off', async () => {
    auth.signer = remoteSigner(userSk);
    const { result } = renderHook(() => useBucketReader(null, [granterPk]));
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });
    act(() => result.current.acceptHandoff(result.current.pendingHandoffs[0].wrapId));
    expect(store.current.names().get(getPublicKey(threadSk))).toBe('cloistr-coord-wrap');
    await waitFor(() => expect(savedEntry()).not.toBeNull());
    expect(JSON.parse(savedEntry()!)).toEqual({ k: bytesToHex(threadSk), t: 'cloistr-coord-wrap' });
  });

  it('a key saved before names were kept is saved again with its name when its hand-off is next seen', async () => {
    store.current.importHex(getPublicKey(threadSk), bytesToHex(threadSk));
    auth.signer = remoteSigner(userSk);
    const { result } = renderHook(() => useBucketReader(null, [granterPk]));
    await waitFor(() => expect(result.current.handoffs).toHaveLength(1), { timeout: 3000 });
    expect(store.current.names().get(getPublicKey(threadSk))).toBe('cloistr-coord-wrap');
    await waitFor(() => expect(savedEntry()).not.toBeNull());
    expect(JSON.parse(savedEntry()!)).toEqual({ k: bytesToHex(threadSk), t: 'cloistr-coord-wrap' });
  });

  it('refuses a hand-off from a granter it was not told to expect', async () => {
    auth.signer = remoteSigner(userSk);
    const stranger = getPublicKey(generateSecretKey());
    const { result } = renderHook(() => useBucketReader(null, [stranger]));
    await new Promise((r) => setTimeout(r, 300));
    expect(result.current.handoffs).toHaveLength(0);
    expect(result.current.pendingHandoffs).toHaveLength(0);
    expect(result.current.messages).toHaveLength(0);
  });
});

/**
 * The signer the app actually holds. @cloistr/ui's shared sign-in wraps the
 * NIP-46 signer for re-authentication and forwards only the standard methods,
 * so `sendRequest` is gone (live 2026-10-27: zero cloistr_ecdh_tag requests on
 * the signer, and the operator saw "No threads yet"). The fake above has
 * sendRequest, which is why these tests stayed green while that broke.
 */
function wrappedSigner(userSk: Uint8Array) {
  const signer: Partial<ReturnType<typeof remoteSigner>> = remoteSigner(userSk);
  delete signer.sendRequest;
  return signer;
}

describe('useBucketReader when the signer cannot locate hand-offs', () => {
  const userSk = generateSecretKey();
  const granterSk = generateSecretKey();
  const threadSk = generateSecretKey();

  beforeEach(() => {
    store.current = new ThreadKeyStore();
    try { localStorage.clear(); } catch { /* none */ }
    const now = Math.floor(Date.now() / 1000);
    relay.events = [
      wrapKeyHandoff('cloistr-coord-wrap', bytesToHex(threadSk), granterSk, getPublicKey(userSk), now) as unknown as Wrap,
    ];
  });

  it('says the lookup was unavailable instead of reporting no hand-offs', async () => {
    auth.signer = wrappedSigner(userSk);
    const { result } = renderHook(() => useBucketReader(null, [getPublicKey(granterSk)]));
    await waitFor(() => expect(result.current.handoffLookupUnavailable).toBe(true), { timeout: 3000 });
    expect(result.current.pendingHandoffs).toHaveLength(0);
  });

  it('does not claim that when the signer can locate them', async () => {
    auth.signer = remoteSigner(userSk);
    const { result } = renderHook(() => useBucketReader(null, [getPublicKey(granterSk)]));
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });
    expect(result.current.handoffLookupUnavailable).toBe(false);
  });
});

describe('useBucketReader through the real shared sign-in wrapper', () => {
  const userSk = generateSecretKey();
  const granterSk = generateSecretKey();
  const threadSk = generateSecretKey();

  beforeEach(() => {
    store.current = new ThreadKeyStore();
    try { localStorage.clear(); } catch { /* none */ }
    relay.events = [
      wrapKeyHandoff('cloistr-coord-wrap', bytesToHex(threadSk), granterSk, getPublicKey(userSk), Math.floor(Date.now() / 1000)) as unknown as Wrap,
    ];
  });

  it('still finds the hand-off once @cloistr/ui has wrapped the signer (needs @cloistr/ui >= 0.50.8)', async () => {
    const inner = remoteSigner(userSk) as unknown as SignerInterface;
    auth.signer = wrapSignerWithReauth(inner, {
      probe: async () => 'healthy',
      remint: async () => inner,
      requestReauth: async () => {},
    });
    const { result } = renderHook(() => useBucketReader(null, [getPublicKey(granterSk)]));
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });
    expect(result.current.handoffLookupUnavailable).toBe(false);
  });
});

describe('accepting a key offered more than once', () => {
  const userSk = generateSecretKey();
  const granterSk = generateSecretKey();
  const threadSk = generateSecretKey();
  const author = getPublicKey(generateSecretKey());

  beforeEach(() => {
    store.current = new ThreadKeyStore();
    try { localStorage.clear(); } catch { /* none */ }
    const now = Math.floor(Date.now() / 1000);
    // The kit re-sends a thread's hand-off, so one thread arrives as several
    // offers with different wrap ids.
    relay.events = [
      wrapThreadMessage('hello from the kit', author, bytesToHex(threadSk), now) as unknown as Wrap,
      wrapKeyHandoff('cloistr-coord-wrap', bytesToHex(threadSk), granterSk, getPublicKey(userSk), now - 60) as unknown as Wrap,
      wrapKeyHandoff('cloistr-coord-wrap', bytesToHex(threadSk), granterSk, getPublicKey(userSk), now - 30) as unknown as Wrap,
      wrapKeyHandoff('cloistr-coord-wrap', bytesToHex(threadSk), granterSk, getPublicKey(userSk), now) as unknown as Wrap,
    ];
  });

  it('shows one offer per thread, and accepting it clears the offer and opens the thread', async () => {
    auth.signer = remoteSigner(userSk);
    const { result } = renderHook(() => useBucketReader(null, [getPublicKey(granterSk)]));
    await waitFor(() => expect(result.current.pendingHandoffs.length).toBeGreaterThan(0), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current.pendingHandoffs).toHaveLength(1);
    act(() => result.current.acceptHandoff(result.current.pendingHandoffs[0].wrapId));
    await waitFor(() => expect(result.current.messages.map((m) => m.plaintext)).toContain('hello from the kit'), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current.pendingHandoffs).toHaveLength(0);
  });
});


describe('the loading state', () => {
  const heldSk = generateSecretKey();
  const strangerSk = generateSecretKey();

  beforeEach(() => {
    store.current = new ThreadKeyStore();
    store.current.set(getPublicKey(heldSk), heldSk);
    auth.signer = null;
    // A wrap in the reader's own bucket that none of its keys open: a decoy,
    // or another thread's message sharing the bucket.
    const now = Math.floor(Date.now() / 1000);
    const wrap = wrapThreadMessage('not for you', getPublicKey(strangerSk), bytesToHex(strangerSk), now) as unknown as Wrap;
    wrap.tags = [['t', computeThreadBucket(bytesToHex(heldSk), getWindowId(now))]];
    relay.events = [wrap];
  });

  it('stays loading when an unopenable wrap arrives before the relay has finished', async () => {
    // Operator report, 2026-10-28: 'No threads yet' showed while threads were
    // still arriving, because the first event of ANY kind ended loading.
    relay.holdEose = true;
    try {
      const { result } = renderHook(() => useBucketReader(null, []));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(result.current.messages).toHaveLength(0);
      expect(result.current.isLoading).toBe(true);
    } finally {
      relay.holdEose = false;
    }
  });

  it('stops loading once the relay has sent everything it holds', async () => {
    const { result } = renderHook(() => useBucketReader(null, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toHaveLength(0);
  });
});

describe('which keys a wrap is tried against', () => {
  it('tries only the keys whose bucket the wrap is tagged with, not every held key', async () => {
    // Trying every key on every wrap (decoys included) froze the Threads page
    // for a user holding fifteen keys. A wrap is placed in its thread's bucket,
    // so only that bucket's keys can open it.
    const aSk = generateSecretKey();
    const bSk = generateSecretKey();
    store.current = new ThreadKeyStore();
    store.current.set(getPublicKey(aSk), aSk);
    store.current.set(getPublicKey(bSk), bSk);
    auth.signer = null;
    const now = Math.floor(Date.now() / 1000);
    const misfiled = wrapThreadMessage('opens with A, filed under B', getPublicKey(aSk), bytesToHex(aSk), now) as unknown as Wrap;
    misfiled.tags = [['t', computeThreadBucket(bytesToHex(bSk), getWindowId(now))]];
    const filed = wrapThreadMessage('filed under B', getPublicKey(bSk), bytesToHex(bSk), now) as unknown as Wrap;
    relay.events = [misfiled, filed];
    const { result } = renderHook(() => useBucketReader(null, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages.map((m) => m.plaintext)).toEqual(['filed under B']);
  });
});

/**
 * Hand-off buckets are one byte, so the user's bucket also carries other
 * people's hand-offs, and a signer user can only learn that one is not theirs
 * by a signer round trip. Live 2026-10-28: 18 of the Threads page's 20 signer
 * requests were these, asked again on every load.
 */
describe('hand-offs the signer already said are not ours', () => {
  const userSk = generateSecretKey();
  const userPk = getPublicKey(userSk);
  const granterSk = generateSecretKey();
  const granterPk = getPublicKey(granterSk);
  const threadSk = generateSecretKey();

  /** Another member's hand-off, filed in OUR hand-off bucket as a collision would be. */
  function foreignWrapInOurBucket(now: number): Wrap {
    const { event, oneTimeSk } = wrapKeyHandoffWithKey('someone-elses', bytesToHex(generateSecretKey()), granterSk, getPublicKey(generateSecretKey()), now);
    const ours = computeHandoffBucket(ecdhHex(userSk, granterPk), getWindowId(now));
    // Re-signed with the new tag, as the wrap's sender would have published it.
    const tags = event.tags.map((t) => (t[0] === 't' ? ['t', ours] : t));
    return finalizeEvent({ kind: event.kind, content: event.content, tags, created_at: event.created_at }, oneTimeSk) as unknown as Wrap;
  }

  /** The real signer's wording: cloistr-signer wraps go-nostr's error, @cloistr/auth wraps that. */
  function signerWithRealErrors(fail?: () => Error) {
    const base = remoteSigner(userSk);
    return {
      ...base,
      nip44Decrypt: vi.fn(async (pk: string, ct: string) => {
        if (fail) throw fail();
        try {
          return await base.nip44Decrypt(pk, ct);
        } catch {
          throw new Error('Failed to nip44-decrypt message: decryption failed: invalid hmac');
        }
      }),
    };
  }

  let foreign: Wrap;
  beforeEach(() => {
    store.current = new ThreadKeyStore();
    try { localStorage.clear(); } catch { /* none */ }
    const now = Math.floor(Date.now() / 1000);
    foreign = foreignWrapInOurBucket(now);
    relay.events = [foreign];
  });

  const triedFor = (signer: { nip44Decrypt: { mock: { calls: unknown[][] } } }, w: Wrap) =>
    signer.nip44Decrypt.mock.calls.filter((c) => c[1] === w.content).length;

  /** `switchTo`: another account signs in once the read settles, before the list's save. */
  async function load(signer: unknown, switchTo?: string) {
    auth.signer = signer;
    // The tried list saves only while its user is the one signed in.
    useAuthStore.setState({ pubkey: await (signer as { getPublicKey(): Promise<string> }).getPublicKey() });
    const { result, unmount } = renderHook(() => useBucketReader(null, [granterPk]));
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 3000 });
    if (switchTo) useAuthStore.setState({ pubkey: switchTo });
    // Past the tried list's write delay, so the next load reads what this one learned.
    await new Promise((r) => setTimeout(r, 400));
    unmount();
    return result;
  }

  it('a second load does not ask the signer about a wrap it already said is not ours', async () => {
    const first = signerWithRealErrors();
    await load(first);
    expect(triedFor(first, foreign)).toBe(1);

    const second = signerWithRealErrors();
    await load(second);
    expect(triedFor(second, foreign)).toBe(0);
  });

  it('a signer timeout is not remembered: the next load asks again', async () => {
    const timedOut = signerWithRealErrors(() => new Error('Failed to nip44-decrypt message: Request timed out after 30000ms'));
    await load(timedOut);
    expect(triedFor(timedOut, foreign)).toBe(1);

    const next = signerWithRealErrors();
    await load(next);
    expect(triedFor(next, foreign)).toBe(1);
  });

  it('our own hand-off is never remembered as tried: it is offered again on the next load', async () => {
    const now = Math.floor(Date.now() / 1000);
    relay.events = [foreign, wrapKeyHandoff('ours', bytesToHex(threadSk), granterSk, userPk, now) as unknown as Wrap];
    const first = await load(signerWithRealErrors());
    expect(first.current.pendingHandoffs).toHaveLength(1);
    const second = await load(signerWithRealErrors());
    expect(second.current.pendingHandoffs).toHaveLength(1);
  });

  it('a damaged copy of our own hand-off, under its id, does not hide the real one', async () => {
    // cloistr-audit on !262: a relay can send our hand-off with its content
    // altered and the id and signature kept. It fails the MAC like a stranger's
    // wrap, and if remembered the real one is skipped until it expires.
    const now = Math.floor(Date.now() / 1000);
    const real = wrapKeyHandoff('ours', bytesToHex(threadSk), granterSk, userPk, now) as unknown as Wrap;
    const c = real.content;
    const damaged = { ...real, content: c.slice(0, 10) + (c[10] === 'A' ? 'B' : 'A') + c.slice(11) };

    relay.events = [damaged];
    const first = await load(signerWithRealErrors());
    expect(first.current.pendingHandoffs).toHaveLength(0);

    relay.events = [real];
    const second = await load(signerWithRealErrors());
    expect(second.current.pendingHandoffs).toHaveLength(1);
  });

  // cloistr-audit on !266: switching account clears nothing, so a save the
  // previous account started must notice the switch itself.
  it('switching account before the list saves writes nothing to this browser', async () => {
    const first = signerWithRealErrors();
    await load(first, getPublicKey(generateSecretKey()));
    expect(triedFor(first, foreign)).toBe(1);
    expect(localStorage.getItem('cloistr:tried-wraps:' + userPk)).toBeNull();
  });

  it('another user signing in on this browser asks about the wrap themselves', async () => {
    await load(signerWithRealErrors());
    expect(localStorage.getItem('cloistr:tried-wraps:' + userPk)).not.toBeNull();
    const otherSk = generateSecretKey();
    const other = { ...signerWithRealErrors(), getPublicKey: async () => getPublicKey(otherSk) };
    await load(other);
    expect(localStorage.getItem('cloistr:tried-wraps:' + userPk)).toBeNull();
  });
});
