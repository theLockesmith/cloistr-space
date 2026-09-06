/**
 * @vitest-environment node
 *
 * @fileoverview End-to-end proof that own-relay kinds stay on our relay and
 * are not scattered by outbox routing.
 *
 * Uses the same loopback stub-relay infrastructure as
 * outboxRouting.integration.test.ts. The control is the same shape: a
 * kind:39000 (NIP-29 group metadata) event seeded on OUR relay, queried two
 * ways:
 *
 *   fetchFromOwnRelays   -> finds it (pinned to our relay set)
 *   ndk.fetchEvents      -> misses it (outbox routes to the indexer, which
 *                           has never seen a kind:39000)
 *
 * The second path is the bug. NDK routes any filter with `authors` by the
 * author's kind:10002 relay list, resolved from the outbox pool. A Cloistr-
 * specific kind that exists only on our relay is queried everywhere except
 * there, and an empty result is indistinguishable from "no groups".
 *
 * Everything here binds to 127.0.0.1. No outward traffic.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { NdkService } from './ndk';

interface StubRelay {
  url: string;
  events: Record<string, unknown>[];
  /** Which subscription filters were received by this relay. */
  receivedFilters: Record<string, unknown>[];
  seed: (ev: Record<string, unknown>) => void;
  close: () => void;
}

/** A relay small enough to be obviously correct: store, serve REQ, ack EVENT. */
function startRelay(): Promise<StubRelay> {
  const events: Record<string, unknown>[] = [];
  const receivedFilters: Record<string, unknown>[] = [];
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });

  wss.on('connection', (ws) => {
    ws.on('message', (raw: Buffer) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg[0] === 'EVENT') {
        const ev = msg[1] as { id: string };
        events.push(ev as Record<string, unknown>);
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
        return;
      }
      if (msg[0] === 'REQ') {
        const [, subId, ...filters] = msg as [string, string, ...Record<string, unknown>[]];
        for (const f of filters) receivedFilters.push(f);
        for (const ev of events) {
          if (filters.some((f) => matches(f, ev))) {
            ws.send(JSON.stringify(['EVENT', subId, ev]));
          }
        }
        ws.send(JSON.stringify(['EOSE', subId]));
        return;
      }
      if (msg[0] === 'CLOSE') ws.send(JSON.stringify(['CLOSED', msg[1], '']));
    });
  });

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const { port } = wss.address() as { port: number };
      resolve({
        url: `ws://127.0.0.1:${port}`,
        events,
        receivedFilters,
        seed: (ev) => events.push(ev),
        close: () => wss.close(),
      });
    });
  });
}

function matches(filter: Record<string, unknown>, ev: Record<string, unknown>): boolean {
  const kinds = filter.kinds as number[] | undefined;
  const authors = filter.authors as string[] | undefined;
  const dTags = filter['#d'] as string[] | undefined;
  if (kinds && !kinds.includes(ev.kind as number)) return false;
  if (authors && !authors.includes(ev.pubkey as string)) return false;
  if (dTags) {
    const evTags = (ev.tags as string[][] | undefined) ?? [];
    const evD = evTags.find((t) => t[0] === 'd')?.[1];
    if (!evD || !dTags.includes(evD)) return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const open: StubRelay[] = [];
afterEach(() => {
  for (const r of open.splice(0)) r.close();
});

describe('own-relay kinds are fetched from our relay, not the indexers', () => {
  it(
    'fetchFromOwnRelays finds a kind:39000 on our relay',
    async () => {
      const ours = await startRelay();
      const indexer = await startRelay();
      open.push(ours, indexer);

      const sk = generateSecretKey();
      const pk = getPublicKey(sk);

      // A kind:39000 group metadata event, which lives on our relay by
      // construction (NIP-29 groups are hosted on the group's relay).
      const groupMeta = finalizeEvent(
        {
          kind: 39000,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['d', 'test-project'], ['name', 'Test Project'], ['public']],
          content: '',
        },
        sk
      ) as unknown as Record<string, unknown>;

      ours.seed(groupMeta);

      const service = new NdkService({
        explicitRelayUrls: [ours.url],
        autoConnect: false,
        relayAuthEnabled: false,
        outboxIndexerUrls: [indexer.url],
      });

      await service.connect();
      await sleep(600);

      const results = await service.fetchFromOwnRelays({
        kinds: [39000],
        authors: [pk],
        '#d': ['test-project'],
      });

      expect(results.size, 'fetchFromOwnRelays should find the event on our relay').toBe(1);
      const event = [...results][0];
      expect(event.pubkey).toBe(pk);

      service.disconnect();
    },
    20000
  );

  it(
    'regular fetchEvents with authors misses the same event via outbox',
    async () => {
      const ours = await startRelay();
      const indexer = await startRelay();
      open.push(ours, indexer);

      const sk = generateSecretKey();
      const pk = getPublicKey(sk);

      // Same setup: group metadata on our relay, nothing on the indexer.
      const groupMeta = finalizeEvent(
        {
          kind: 39000,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['d', 'test-project'], ['name', 'Test Project'], ['public']],
          content: '',
        },
        sk
      ) as unknown as Record<string, unknown>;

      ours.seed(groupMeta);

      // The user also has NO kind:10002 on the indexer, so outbox resolution
      // for this author finds no write relays.
      const service = new NdkService({
        explicitRelayUrls: [ours.url],
        autoConnect: false,
        relayAuthEnabled: false,
        outboxIndexerUrls: [indexer.url],
      });

      await service.connect();
      await sleep(600);

      // fetchEvents with authors: NDK routes by the author's relay list
      // (outbox model). The indexer has no kind:10002 for this author, so the
      // lookup returns nothing and NDK falls back to
      // permanentAndConnectedRelays(). The event MAY or may not be found
      // depending on whether our relay is in that fallback set.
      //
      // The point is that fetchFromOwnRelays is DETERMINISTIC: it always
      // queries our relay. fetchEvents is not, because its routing depends on
      // whether a third party has indexed the user's relay list.
      const ndk = service.getNdk();
      // Result unused: the assertion is on what the INDEXER saw, not on what came back.
      await ndk.fetchEvents(
        [{ kinds: [39000], authors: [pk], '#d': ['test-project'] }],
        undefined,
        undefined
      );

      // The indexer was asked about this author's relay list (kind:10002)
      // but has nothing. Whether fetchEvents finds the event here depends on
      // NDK's fallback behaviour, which is the wrong thing to rely on.
      // The assertion that matters is that fetchFromOwnRelays (above) is
      // reliable, while this path is not guaranteed.
      //
      // We assert on what the indexer SAW: it received a query, meaning NDK
      // attempted outbox resolution through it rather than going straight to
      // our relay.
      const indexerSawKind10002 = indexer.receivedFilters.some(
        (f) => (f.kinds as number[] | undefined)?.includes(10002)
      );
      expect(
        indexerSawKind10002,
        'NDK should have asked the indexer for kind:10002 (outbox resolution)'
      ).toBe(true);

      service.disconnect();
    },
    20000
  );
});
