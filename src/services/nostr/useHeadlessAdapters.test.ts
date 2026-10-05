import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Event } from 'nostr-tools';

const ME = 'aa'.repeat(32);

/** Minimal stand-in for NDKEvent: sign() fills id/sig, rawEvent() reads back. */
class FakeNdkEvent {
  kind = 0;
  content = '';
  tags: string[][] = [];
  created_at = 0;
  pubkey = '';
  id = '';
  sig = '';
  sign = vi.fn(async () => {
    this.id = 'bb'.repeat(32);
    this.sig = 'cc'.repeat(64);
    return this.sig;
  });
  rawEvent() {
    const { kind, content, tags, created_at, pubkey, id, sig } = this;
    return { kind, content, tags, created_at, pubkey, id, sig };
  }
}

const publish = vi.fn();
const fetchFromOwnRelays = vi.fn();
let lastCreated: FakeNdkEvent | null = null;

vi.mock('./NdkProvider', () => ({
  useNdk: () => ({
    createEvent: () => {
      lastCreated = new FakeNdkEvent();
      return lastCreated;
    },
    publish,
    fetchFromOwnRelays,
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: ME }),
}));

const { useHeadlessAdapters } = await import('./useHeadlessAdapters');

describe('useHeadlessAdapters', () => {
  beforeEach(() => {
    publish.mockReset();
    fetchFromOwnRelays.mockReset();
    lastCreated = null;
  });

  it('signEvent signs without publishing', async () => {
    const { result } = renderHook(() => useHeadlessAdapters());
    const signed = await result.current.signer!.signEvent({
      kind: 1,
      content: 'hi',
      tags: [],
      created_at: 100,
      pubkey: ME,
    });

    expect(lastCreated!.sign).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(signed).toMatchObject({ kind: 1, content: 'hi', id: 'bb'.repeat(32), sig: 'cc'.repeat(64) });
  });

  it('relay.publish reports the real acceptance count, including zero', async () => {
    const { result } = renderHook(() => useHeadlessAdapters());
    const raw = { kind: 1, content: 'x', tags: [], created_at: 1, pubkey: ME, id: 'dd'.repeat(32), sig: 'ee'.repeat(64) } as Event;

    publish.mockResolvedValueOnce(new Set(['r1', 'r2']));
    expect(await result.current.relay!.publish(raw)).toBe(2);

    publish.mockResolvedValueOnce(new Set());
    expect(await result.current.relay!.publish(raw)).toBe(0);
  });

  it('relay.publish sends the event already signed, so NDK does not re-sign it', async () => {
    const { result } = renderHook(() => useHeadlessAdapters());
    const raw = { kind: 1, content: 'x', tags: [], created_at: 1, pubkey: ME, id: 'dd'.repeat(32), sig: 'ee'.repeat(64) } as Event;
    publish.mockResolvedValueOnce(new Set(['r1']));

    await result.current.relay!.publish(raw);

    const sent = publish.mock.calls[0][0] as FakeNdkEvent;
    expect(sent.id).toBe(raw.id);
    expect(sent.sig).toBe(raw.sig);
    expect(sent.sign).not.toHaveBeenCalled();
  });

  it('relay.fetch returns plain events from own relays', async () => {
    const { result } = renderHook(() => useHeadlessAdapters());
    const e = new FakeNdkEvent();
    e.kind = 39002;
    fetchFromOwnRelays.mockResolvedValueOnce(new Set([e]));

    const events = await result.current.relay!.fetch({ kinds: [39002] });

    expect(events).toEqual([e.rawEvent()]);
  });
});
