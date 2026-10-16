/**
 * @fileoverview The repair checks the relays NDK would publish the member
 * list to, and then publishes to exactly those.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { Event, UnsignedEvent } from 'nostr-tools';
import { GROUP_METADATA_KIND, GROUP_MEMBERS_KIND } from '@/types/groups';

const OWNER = '1234567890abcdef'.repeat(4);
const GROUP = `my-project-${OWNER.slice(0, 16)}-0a0b0c0d`;
const PUBLISH_SET = ['wss://outbox.example', 'wss://dropped-but-routed.example'];

const metadata = { id: '1'.repeat(64), kind: GROUP_METADATA_KIND, pubkey: OWNER, created_at: 1, content: '', sig: '', tags: [['d', GROUP]] };

const env = vi.hoisted(() => ({
  probed: [] as string[][],
  publishedTo: [] as string[][],
  plannedFor: [] as { kind: number; tags: string[][]; pubkey: string }[],
}));

vi.mock('@/services/nostr', () => {
  const service = {
    publishRelayUrls: async (template: { kind: number; tags: string[][]; pubkey: string }) => {
      env.plannedFor.push(template);
      return PUBLISH_SET;
    },
    getRelaySetFor: (urls: string[]) => ({ urls }),
    probeRelays: async (urls: string[]) => {
      env.probed.push(urls);
      return urls.map((url) => ({ url, status: 'answered', events: [metadata] }));
    },
    publish: async (_e: unknown, relaySet: { urls: string[] }) => {
      env.publishedTo.push(relaySet.urls);
      return new Set([{}]);
    },
    createEvent: () => ({}),
  };
  const signer = {
    getPublicKey: async () => OWNER,
    signEvent: async (u: UnsignedEvent): Promise<Event> => ({ ...u, id: 'e'.repeat(64), sig: 'f'.repeat(128) }),
  };
  const ndk = { isConnected: true, service };
  return { useNdk: () => ndk, useHeadlessAdapters: () => ({ signer, relay: null }) };
});
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: OWNER }),
}));

const { useProjectSetup } = await import('./useProjectSetup');

beforeEach(() => {
  env.probed = [];
  env.publishedTo = [];
  env.plannedFor = [];
});

describe('useProjectSetup relay set', () => {
  it("plans the set from the member list it would publish, and checks and publishes to that same set", async () => {
    const { result } = renderHook(() => useProjectSetup(GROUP));
    await waitFor(() => expect(result.current.check?.status).toBe('unfinished'));

    expect(env.plannedFor[0]).toMatchObject({ kind: GROUP_MEMBERS_KIND, pubkey: OWNER });
    expect(env.probed[0]).toEqual(PUBLISH_SET);

    await act(async () => {
      await result.current.finish();
    });
    // Re-checked at click time against the same set, then published only there.
    expect(env.probed.every((u) => u === PUBLISH_SET || JSON.stringify(u) === JSON.stringify(PUBLISH_SET))).toBe(true);
    expect(env.publishedTo.length).toBeGreaterThan(0);
    for (const urls of env.publishedTo) expect(urls).toEqual(PUBLISH_SET);
  });
});
