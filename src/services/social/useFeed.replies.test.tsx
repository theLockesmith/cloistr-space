/**
 * @fileoverview A reply must not appear as its own post in the main feed.
 *
 * Reported by the operator: "I'm seeing every reply as if it were its own
 * post in my feed. I expect to see posts in my feed, click on them, and be
 * taken to the conversation."
 *
 * ROOT CAUSE: useFeed's main subscription handler parsed `replyTo`/`rootEvent`
 * off every kind:1 event but never used either to decide whether the note
 * belonged in the feed -- every kind:1, reply or not, went straight into
 * `notes` via upsertNote. A second, subtler gap: even if that result HAD been
 * checked, a direct reply to a thread's root (carrying only an `e` tag marked
 * "root", which is exactly what buildReplyTags emits for that case) left
 * `replyTo` undefined, so the common case of replying straight to a
 * top-level post would still have leaked through.
 *
 * NIP-10: a kind:1 is a reply when it carries any `e` tag not marked
 * "mention" -- marked "root"/"reply", or the deprecated positional form
 * (unmarked). An `e` tag marked "mention" (quote-reposts, QuoteComposer) is
 * not a reply and must stay in the feed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const ME = 'ab'.repeat(32);
const AUTHOR = 'cd'.repeat(32);

interface FakeHandlers {
  onEvent: (event: unknown) => void;
  onEose?: () => void;
}

/** Every call to the mocked `subscribe`, so a test can pick out the one it needs. */
const subscribe = vi.fn((_filters: unknown, _opts: unknown, _handlers: FakeHandlers) => ({
  stop: vi.fn(),
}));

vi.mock('@/services/nostr', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/services/nostr');
  return {
    ...actual,
    useNdk: () => ({
      subscribe,
      isConnected: true,
      relayStatuses: new Map(),
      service: { getRelaySetFor: (urls: string[]) => ({ urls }) },
    }),
    // Mirrors the real subscribeStream's call shape: subscribe(filters, opts, handlers).
    subscribeStream: (
      _sub: unknown,
      filters: unknown,
      handlers: FakeHandlers,
      opts: unknown
    ) => subscribe(filters, opts, handlers),
  };
});

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: ME }),
}));

vi.mock('@/stores/contactsStore', () => ({
  useContactsStore: () => ({
    contacts: new Map([[AUTHOR, { pubkey: AUTHOR, isFollowing: true }]]),
  }),
}));

const { useFeed } = await import('./useFeed');

function hexId(seed: string): string {
  return seed.padEnd(64, '0');
}

const TOP_ID = hexId('top');
const ROOT_ID = hexId('root');
const MARKED_REPLY_ID = hexId('markedreply');
const ROOT_ONLY_REPLY_ID = hexId('rootonlyreply');
const POSITIONAL_REPLY_ID = hexId('positionalreply');
const QUOTE_ID = hexId('quote');

function kind1(id: string, tags: string[][] = []) {
  return {
    id,
    pubkey: AUTHOR,
    kind: 1,
    content: `note ${id}`,
    created_at: 1_700_000_000,
    tags,
  };
}

/** The first subscribe call is the main note feed; later calls are engagement. */
function mainFeedHandlers(): FakeHandlers {
  return subscribe.mock.calls[0][2] as FakeHandlers;
}

beforeEach(() => {
  subscribe.mockClear();
});

describe('useFeed excludes replies from the main feed', () => {
  it('shows a top-level note but hides a reply posted alongside it', async () => {
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    const handlers = mainFeedHandlers();

    const top = kind1(TOP_ID);
    // A standard NIP-10 reply: both markers present.
    const reply = kind1(MARKED_REPLY_ID, [
      ['e', ROOT_ID, '', 'root'],
      ['e', TOP_ID, '', 'reply'],
    ]);

    act(() => {
      handlers.onEvent(top);
      handlers.onEvent(reply);
    });

    await waitFor(() => expect(result.current.notes.length).toBeGreaterThan(0));

    // This is the fail-first assertion: before the fix, both land in notes.
    expect(result.current.notes.map((n) => n.id)).toEqual([TOP_ID]);
  });

  it('hides a direct reply to a root carrying only the "root" marker', async () => {
    // buildReplyTags emits ONLY a root marker for a direct reply to the root
    // (no separate "reply" marker, since it would just repeat the root id).
    // This is the common case, not an edge case.
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    const handlers = mainFeedHandlers();

    const rootOnlyReply = kind1(ROOT_ONLY_REPLY_ID, [['e', ROOT_ID, '', 'root']]);

    act(() => {
      handlers.onEvent(rootOnlyReply);
    });

    // Give any (incorrect) async add a chance to land before asserting absence.
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.notes.map((n) => n.id)).not.toContain(ROOT_ONLY_REPLY_ID);
  });

  it('hides the deprecated positional reply form (unmarked e tag)', async () => {
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    const handlers = mainFeedHandlers();

    const positional = kind1(POSITIONAL_REPLY_ID, [['e', ROOT_ID]]);

    act(() => {
      handlers.onEvent(positional);
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.notes.map((n) => n.id)).not.toContain(POSITIONAL_REPLY_ID);
  });

  it('keeps a note whose only e tag is marked "mention" (a quote, not a reply)', async () => {
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    const handlers = mainFeedHandlers();

    const quote = kind1(QUOTE_ID, [['e', ROOT_ID, '', 'mention']]);

    act(() => {
      handlers.onEvent(quote);
    });

    await waitFor(() => expect(result.current.notes.map((n) => n.id)).toContain(QUOTE_ID));
  });
});
