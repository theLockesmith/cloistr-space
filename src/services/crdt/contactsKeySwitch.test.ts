/**
 * Sweep item #4 (2026-10-09): a kind:33000 is the user's whole contact list, so
 * it must only ever be published by the key that owns it, from a list that was
 * actually read for that key.
 *
 * (a) A key switch used to clear the visible contacts but not the CRDT entries
 *     or pending changes, so key B's next sync published key A's follows under
 *     B -- corrupting B's list and publicly linking the two identities.
 * (b) importFromKind3 merged a kind:3 and published without reading the
 *     current kind:33000, so it could resurrect unfollows or replace the list.
 * (c) A read in which no relay answered looked the same as "this user has no
 *     list", so local changes were published over the real list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Event } from 'nostr-tools';
import { ContactsSyncService } from './contactsSync';
import { NIP0A_KIND } from './nip0a';
import { useContactsStore } from '@/stores/contactsStore';
import type { NdkService } from '@/services/nostr';

const ALICE = 'a1'.repeat(32);
const BOB = 'b0'.repeat(32);
const CAROL = 'c0'.repeat(32);
const DAVE = 'd0'.repeat(32);

/** A kind:33000 by `owner` following `follows`. */
function listEvent(owner: string, follows: string[], created_at = 1000) {
  return {
    id: `${owner.slice(0, 8)}-${created_at}`,
    kind: NIP0A_KIND,
    pubkey: owner,
    created_at,
    content: '',
    tags: [['d', 'contacts'], ...follows.map((p) => ['p', p, '', '', String(created_at)])],
    rawEvent() {
      return this;
    },
  };
}

interface FakeOptions {
  /** Pubkey the NDK signer signs as. */
  signerPubkey: string;
  /** Lists the own relays hold, keyed by author. */
  lists?: Map<string, ReturnType<typeof listEvent>>;
  /** How many relays sent end-of-results. 0 means nobody answered. */
  answeredBy?: number;
  /** Make the read throw. */
  readFails?: boolean;
  kind3?: { pubkey: string; tags: string[][]; created_at: number } | null;
}

function fakeNdk(opts: FakeOptions) {
  const published: Event[] = [];
  const service = {
    getNdk: () => ({
      signer: { user: async () => ({ pubkey: opts.signerPubkey }) },
    }),
    readFromOwnRelays: vi.fn(async (filters: { authors?: string[] } | Array<{ authors?: string[] }>) => {
      if (opts.readFails) throw new Error('relay unreachable');
      const filter = Array.isArray(filters) ? filters[0] : filters;
      const author = filter?.authors?.[0];
      const event = author ? opts.lists?.get(author) : undefined;
      return { events: event ? [event] : [], answeredBy: opts.answeredBy ?? 1 };
    }),
    fetchFromOwnRelays: vi.fn(async () => {
      throw new Error('contacts must read through readFromOwnRelays');
    }),
    fetchEvents: vi.fn(async () => new Set(opts.kind3 ? [{ ...opts.kind3, kind: 3, content: '' }] : [])),
    createEvent: () => {
      const event: Record<string, unknown> = {};
      return Object.assign(event, {
        sign: async () => {
          event.id = 'signed';
          event.sig = 'sig';
          event.pubkey = opts.signerPubkey;
        },
        rawEvent: () => ({ ...event }),
      });
    },
    publish: vi.fn(async (event: Record<string, unknown>) => {
      published.push({ ...event, pubkey: opts.signerPubkey } as unknown as Event);
      return new Set([{}]);
    }),
    subscribe: vi.fn(),
  };
  return { service: service as unknown as NdkService, published, raw: service };
}

const followsIn = (event: Event) => event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);

beforeEach(() => {
  useContactsStore.setState(useContactsStore.getInitialState());
});

describe('(a) key switch', () => {
  it("key B's sync never publishes key A's follows", async () => {
    // Key A loads its list and follows someone locally (pending change).
    const a = fakeNdk({ signerPubkey: ALICE, lists: new Map([[ALICE, listEvent(ALICE, [BOB])]]) });
    await new ContactsSyncService(a.service).sync(ALICE);
    useContactsStore.getState().addContact(CAROL);

    // Switch to key B, which has its own list.
    useContactsStore.getState().resetFor(DAVE);
    const b = fakeNdk({ signerPubkey: DAVE, lists: new Map([[DAVE, listEvent(DAVE, [ALICE])]]) });
    const svc = new ContactsSyncService(b.service);
    await svc.sync(DAVE);
    useContactsStore.getState().addContact(BOB);
    await svc.sync(DAVE);

    expect(b.published).toHaveLength(1);
    expect(followsIn(b.published[0]).sort()).toEqual([ALICE, BOB].sort());
    expect(followsIn(b.published[0])).not.toContain(CAROL);
  });

  it('sync for a different pubkey starts from an empty list even without an explicit reset', async () => {
    // Header sign-in can change the key without the provider's switch path.
    const a = fakeNdk({ signerPubkey: ALICE, lists: new Map([[ALICE, listEvent(ALICE, [BOB])]]) });
    await new ContactsSyncService(a.service).sync(ALICE);
    useContactsStore.getState().addContact(CAROL);

    const b = fakeNdk({ signerPubkey: DAVE, lists: new Map() });
    await new ContactsSyncService(b.service).sync(DAVE);

    expect(useContactsStore.getState().crdt.entries.size).toBe(0);
    expect(useContactsStore.getState().crdt.pendingChanges).toEqual([]);
    expect(b.published).toHaveLength(0);
  });

  it("refuses to publish when the signer is not the key the list belongs to", async () => {
    const a = fakeNdk({ signerPubkey: ALICE, lists: new Map([[ALICE, listEvent(ALICE, [BOB])]]) });
    await new ContactsSyncService(a.service).sync(ALICE);
    useContactsStore.getState().addContact(CAROL);

    // NDK's signer already points at key B while the store still holds A's list.
    const b = fakeNdk({ signerPubkey: DAVE });
    await expect(new ContactsSyncService(b.service).publishContacts()).rejects.toThrow();
    expect(b.published).toHaveLength(0);
  });

  it('the live update stream does not merge the previous key into the new one', () => {
    const a = fakeNdk({ signerPubkey: ALICE });
    let deliver!: (event: unknown) => void;
    a.raw.subscribe.mockImplementation((_f: unknown, _o: unknown, handlers: { onEvent: (e: unknown) => void }) => {
      deliver = handlers.onEvent;
      return { stop: vi.fn() };
    });
    useContactsStore.getState().resetFor(ALICE);
    const onUpdate = vi.fn();
    new ContactsSyncService(a.service).subscribeToUpdates(ALICE, onUpdate);

    useContactsStore.getState().resetFor(DAVE);
    deliver(listEvent(ALICE, [BOB]));

    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('(b) importFromKind3', () => {
  it('reads the current kind:33000 first and keeps its entries in what it publishes', async () => {
    const n = fakeNdk({
      signerPubkey: ALICE,
      lists: new Map([[ALICE, listEvent(ALICE, [BOB])]]),
      kind3: { pubkey: ALICE, tags: [['p', CAROL]], created_at: 900 },
    });
    const result = await new ContactsSyncService(n.service).importFromKind3(ALICE);

    expect(result.success).toBe(true);
    expect(n.raw.readFromOwnRelays).toHaveBeenCalled();
    expect(followsIn(n.published[0]).sort()).toEqual([BOB, CAROL].sort());
  });

  it('publishes nothing when the current kind:33000 could not be read', async () => {
    const n = fakeNdk({
      signerPubkey: ALICE,
      readFails: true,
      kind3: { pubkey: ALICE, tags: [['p', CAROL]], created_at: 900 },
    });
    const result = await new ContactsSyncService(n.service).importFromKind3(ALICE);

    expect(result.success).toBe(false);
    expect(n.published).toHaveLength(0);
  });
});

describe('(c) a read nobody answered', () => {
  it('is an error, and local changes are not published over the real list', async () => {
    useContactsStore.getState().resetFor(ALICE);
    useContactsStore.getState().addContact(CAROL);
    const n = fakeNdk({ signerPubkey: ALICE, answeredBy: 0 });

    const result = await new ContactsSyncService(n.service).sync(ALICE);

    expect(result.success).toBe(false);
    expect(n.published).toHaveLength(0);
    expect(useContactsStore.getState().crdt.pendingChanges).toHaveLength(1);
  });

  it('a relay that answered with no list lets a new user publish their first one', async () => {
    useContactsStore.getState().resetFor(ALICE);
    useContactsStore.getState().addContact(CAROL);
    const n = fakeNdk({ signerPubkey: ALICE, answeredBy: 1, lists: new Map() });

    const result = await new ContactsSyncService(n.service).sync(ALICE);

    expect(result.success).toBe(true);
    expect(n.published).toHaveLength(1);
    expect(followsIn(n.published[0])).toEqual([CAROL]);
  });
});

describe('a read that finishes after a key switch', () => {
  /** A fake whose reads wait until released, so a switch can happen mid-read. */
  function deferredRead(signerPubkey: string, lists: Map<string, ReturnType<typeof listEvent>>) {
    const n = fakeNdk({ signerPubkey, lists });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = n.raw.readFromOwnRelays.getMockImplementation()!;
    n.raw.readFromOwnRelays.mockImplementation(async (filters) => {
      await gate;
      return original(filters);
    });
    return { ...n, release };
  }

  it("sync does not merge key A's list into key B's store", async () => {
    const a = deferredRead(ALICE, new Map([[ALICE, listEvent(ALICE, [BOB, CAROL])]]));
    const pending = new ContactsSyncService(a.service).sync(ALICE);

    useContactsStore.getState().resetFor(DAVE);
    a.release();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(useContactsStore.getState().owner).toBe(DAVE);
    expect(useContactsStore.getState().crdt.entries.size).toBe(0);
    expect(useContactsStore.getState().lastError).toBeNull();
    expect(a.published).toHaveLength(0);
  });

  it("importFromKind3 does not merge key A's list into key B's store", async () => {
    const a = deferredRead(ALICE, new Map([[ALICE, listEvent(ALICE, [BOB])]]));
    const pending = new ContactsSyncService(a.service).importFromKind3(ALICE);

    useContactsStore.getState().resetFor(DAVE);
    a.release();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(useContactsStore.getState().crdt.entries.size).toBe(0);
    expect(a.published).toHaveLength(0);
  });

  it("a recovery found for key A is not applied to key B's list", async () => {
    const n = fakeNdk({ signerPubkey: DAVE });
    useContactsStore.getState().resetFor(DAVE);
    const candidate = { createdAt: 1000, state: { entries: new Map([[BOB, { pubkey: BOB, timestamp: 1000, deleted: false }]]) } };

    await expect(
      new ContactsSyncService(n.service).applyRecovery(candidate as never, ALICE),
    ).rejects.toThrow(/key changed/);
    expect(useContactsStore.getState().crdt.entries.size).toBe(0);
  });
});

describe('the same sync service across a key switch', () => {
  it("a read still running for key A does not turn away key B's first sync", async () => {
    const lists = new Map([[ALICE, listEvent(ALICE, [BOB])], [DAVE, listEvent(DAVE, [CAROL])]]);
    const n = fakeNdk({ signerPubkey: DAVE, lists });
    let releaseAlice!: () => void;
    const aliceGate = new Promise<void>((r) => { releaseAlice = r; });
    const original = n.raw.readFromOwnRelays.getMockImplementation()!;
    n.raw.readFromOwnRelays.mockImplementation(async (filters) => {
      const filter = Array.isArray(filters) ? filters[0] : filters;
      if (filter?.authors?.[0] === ALICE) await aliceGate;
      return original(filters);
    });
    const svc = new ContactsSyncService(n.service);

    const aliceSync = svc.sync(ALICE);
    useContactsStore.getState().resetFor(DAVE);
    const daveResult = await svc.sync(DAVE);
    releaseAlice();
    await aliceSync;

    expect(daveResult.success).toBe(true);
    expect(useContactsStore.getState().loadedFor).toBe(DAVE);
    expect([...useContactsStore.getState().crdt.entries.keys()]).toEqual([CAROL]);
    expect(useContactsStore.getState().isSyncing).toBe(false);
  });
});

describe('the client id published in the list', () => {
  it('is different for each key, so two keys on one device are not linked', () => {
    useContactsStore.getState().resetFor(ALICE);
    const aliceId = useContactsStore.getState().crdt.clientId;
    useContactsStore.getState().resetFor(DAVE);
    const daveId = useContactsStore.getState().crdt.clientId;
    useContactsStore.getState().resetFor(ALICE);

    expect(daveId).not.toBe(aliceId);
    expect(useContactsStore.getState().crdt.clientId).toBe(aliceId);
  });
});
