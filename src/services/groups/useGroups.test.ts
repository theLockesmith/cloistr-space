/**
 * @fileoverview Tests for useGroups author-check on fetchGroupMetadata.
 *
 * fetchGroupMetadata fetches kind:39000 (group metadata) via subscribeOnce.
 * For pubkey-aware identifiers (those embedding an owner prefix), it must
 * reject events whose author does not match the prefix. Without this, anyone
 * can publish a kind:39000 with a matching d-tag and spoof a group's name,
 * description, and picture in the sidebar.
 *
 * Legacy identifiers carry no prefix and must still be accepted, because
 * there is no anchor to verify against.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** pubkey-aware identifier: slug, 16-hex owner prefix, 8-hex random suffix */
const OWNER_PUBKEY = 'a'.repeat(64);
const OWNED_ID = `my-project-${'a'.repeat(16)}-deadbeef`;
const LEGACY_ID = 'legacy-group';

const fakeRelaySet = { relays: new Set(['wss://relay.cloistr.xyz']), urls: ['wss://relay.cloistr.xyz'] };

const stop = vi.fn();

// Capture handlers passed to subscribeOnce and subscribeStream so we can
// fire events manually from inside the test.
type CapturedOnce = { filters: unknown[]; handlers: { onEvent: (e: unknown) => void } };
type CapturedStream = { filters: unknown[]; handlers: { onEvent: (e: unknown) => void; onEose?: () => void } };

let capturedOnce: CapturedOnce[] = [];
let capturedStream: CapturedStream | null = null;

const subscribe = vi.fn(
  (_filters: unknown[], _opts?: unknown, _handlers?: unknown) => ({
    stop,
    on: vi.fn(),
    start: vi.fn(),
  })
);

const mockService = {
  getOwnRelaySet: vi.fn(() => fakeRelaySet),
};

let connected = true;

vi.mock('@/services/nostr', async () => {
  return {
    useNdk: () => ({
      subscribe,
      service: mockService,
      isConnected: connected,
    }),
    subscribeOnce: (_sub: unknown, filters: unknown[], handlers: { onEvent: (e: unknown) => void }, _opts?: unknown) => {
      capturedOnce.push({ filters, handlers });
    },
    subscribeStream: (_sub: unknown, filters: unknown[], handlers: { onEvent: (e: unknown) => void; onEose?: () => void }, _opts?: unknown) => {
      capturedStream = { filters, handlers };
      return { stop };
    },
  };
});

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    pubkey: OWNER_PUBKEY,
    isAuthenticated: true,
  }),
}));

const { useGroups } = await import('./useGroups');

beforeEach(() => {
  vi.useFakeTimers();
  capturedOnce = [];
  capturedStream = null;
  stop.mockClear();
  subscribe.mockClear();
  mockService.getOwnRelaySet.mockClear();
  connected = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function memberEvent(groupId: string, memberPubkey: string, authorPubkey: string) {
  return {
    id: `mem-${groupId}`,
    pubkey: authorPubkey,
    kind: 39002,
    content: '',
    tags: [['d', groupId], ['p', memberPubkey]],
    created_at: 1000,
  };
}

function metadataEvent(groupId: string, authorPubkey: string, name: string) {
  return {
    id: `meta-${groupId}-${authorPubkey.slice(0, 4)}`,
    pubkey: authorPubkey,
    kind: 39000,
    content: '',
    tags: [['d', groupId], ['name', name]],
    created_at: 1000,
  };
}

// ---------------------------------------------------------------------------
// Author filter in fetchGroupMetadata
// ---------------------------------------------------------------------------

describe('useGroups fetchGroupMetadata author filter', () => {
  it('rejects a kind:39000 from a non-owner for a pubkey-aware identifier', async () => {
    const { result } = renderHook(() => useGroups({ autoSubscribe: true }));

    // Wait for the stream subscription to be set up.
    // startSubscription runs inside setTimeout(fn, 0), so advance timers.
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(capturedStream).not.toBeNull();

    // Simulate a membership event arriving for the pubkey-aware group. The
    // membership author must match the owner prefix (the sidebar subscription
    // has its own check), so use the owner's key.
    act(() => {
      capturedStream!.handlers.onEvent(memberEvent(OWNED_ID, OWNER_PUBKEY, OWNER_PUBKEY));
    });

    // That should trigger fetchGroupMetadata, which calls subscribeOnce.
    expect(capturedOnce.length).toBeGreaterThanOrEqual(1);

    const onceCaller = capturedOnce.find(
      (c) => JSON.stringify(c.filters).includes(OWNED_ID)
    );
    expect(onceCaller).toBeDefined();

    // Fire a metadata event from an ATTACKER (different pubkey).
    const attacker = 'b'.repeat(64);
    act(() => {
      onceCaller!.handlers.onEvent(metadataEvent(OWNED_ID, attacker, 'Spoofed Name'));
    });

    // The spoofed metadata must NOT appear in the groups list.
    expect(result.current.groups.find((g) => g.group.name === 'Spoofed Name')).toBeUndefined();
  });

  it('accepts a kind:39000 from the owner for a pubkey-aware identifier', async () => {
    const { result } = renderHook(() => useGroups({ autoSubscribe: true }));
    // startSubscription runs inside setTimeout(fn, 0), so advance timers.
    await act(async () => { vi.advanceTimersByTime(0); });

    act(() => {
      capturedStream!.handlers.onEvent(memberEvent(OWNED_ID, OWNER_PUBKEY, OWNER_PUBKEY));
    });

    const onceCaller = capturedOnce.find(
      (c) => JSON.stringify(c.filters).includes(OWNED_ID)
    );
    expect(onceCaller).toBeDefined();

    // Fire a metadata event from the REAL owner.
    act(() => {
      onceCaller!.handlers.onEvent(metadataEvent(OWNED_ID, OWNER_PUBKEY, 'Real Project'));
    });

    // The real metadata must appear.
    expect(result.current.groups.find((g) => g.group.name === 'Real Project')).toBeDefined();
  });

  it('accepts a kind:39000 from anyone for a legacy identifier', async () => {
    const { result } = renderHook(() => useGroups({ autoSubscribe: true }));
    // startSubscription runs inside setTimeout(fn, 0), so advance timers.
    await act(async () => { vi.advanceTimersByTime(0); });

    // Legacy identifier has no owner prefix, so the membership event is
    // accepted from anyone (the sidebar subscription also skips the check
    // for legacy ids).
    const someAuthor = 'c'.repeat(64);
    act(() => {
      capturedStream!.handlers.onEvent(memberEvent(LEGACY_ID, OWNER_PUBKEY, someAuthor));
    });

    const onceCaller = capturedOnce.find(
      (c) => JSON.stringify(c.filters).includes(LEGACY_ID)
    );
    expect(onceCaller).toBeDefined();

    // Fire a metadata event from a random pubkey. Legacy ids must be accepted.
    const randomAuthor = 'd'.repeat(64);
    act(() => {
      onceCaller!.handlers.onEvent(metadataEvent(LEGACY_ID, randomAuthor, 'Old Group'));
    });

    expect(result.current.groups.find((g) => g.group.name === 'Old Group')).toBeDefined();
  });
});
