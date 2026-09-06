/**
 * @vitest-environment node
 *
 * @fileoverview End-to-end proof that a Space user's own relay list routes
 * their notes.
 *
 * The unit tests next door assert the wiring. This asserts the PRODUCT
 * behaviour, against real WebSocket relays on loopback, through the real
 * NdkService and the real NDK -- no mocks. That distinction is the whole
 * point: the bug was two correct halves that never met, and a test double for
 * either half would have agreed with the broken build.
 *
 * Adapted from the probe that originally measured the defect
 * (conscience/cloistr-ops/probes/space_publish_probe.mjs), keeping its control:
 *
 *   the user's kind:10002 says "I write to the WIDER relay"
 *   Space stored that list on OUR relay, because that is where Space publishes
 *   the public indexer is up and has simply never seen it
 *
 * Before the fix the note stopped at our relay. Not by policy, and not because
 * anything refused it -- the lookup asked the indexer, got nothing, and fell
 * back to the one relay it already had.
 *
 * Everything here binds to 127.0.0.1. No outward traffic.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { NdkService } from './ndk';

interface StubRelay {
  url: string;
  events: Record<string, unknown>[];
  seed: (ev: Record<string, unknown>) => void;
  close: () => void;
}

/** A relay small enough to be obviously correct: store, serve REQ, ack EVENT. */
function startRelay(): Promise<StubRelay> {
  const events: Record<string, unknown>[] = [];
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
        seed: (ev) => events.push(ev),
        close: () => wss.close(),
      });
    });
  });
}

function matches(filter: Record<string, unknown>, ev: Record<string, unknown>): boolean {
  const kinds = filter.kinds as number[] | undefined;
  const authors = filter.authors as string[] | undefined;
  const ids = filter.ids as string[] | undefined;
  if (kinds && !kinds.includes(ev.kind as number)) return false;
  if (authors && !authors.includes(ev.pubkey as string)) return false;
  if (ids && !ids.includes(ev.id as string)) return false;
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const open: StubRelay[] = [];
afterEach(() => {
  for (const r of open.splice(0)) r.close();
});

/**
 * One pass of the Space publish path through the real NdkService.
 *
 * @param listOn  which stub relay holds the user's kind:10002.
 *                'ours' is the real world -- Space wrote it there.
 *                'indexer' is the control: an identity indexed publicly, which
 *                 worked even before the fix and must keep working.
 */
async function publishNote(listOn: 'ours' | 'indexer') {
  const ours = await startRelay();
  const wider = await startRelay();
  const indexer = await startRelay();
  open.push(ours, wider, indexer);

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  // The list the user curated on the Profile page: "I write to WIDER."
  const relayList = finalizeEvent(
    {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['r', wider.url, 'write']],
      content: '',
    },
    sk
  ) as unknown as Record<string, unknown>;

  (listOn === 'ours' ? ours : indexer).seed(relayList);

  const service = new NdkService({
    explicitRelayUrls: [ours.url],
    autoConnect: false,
    relayAuthEnabled: false,
    // The stand-in for purplepag.es/nos.lol. Pointed at loopback so a negative
    // can never be blamed on a third party being down or on blocked egress.
    outboxIndexerUrls: [indexer.url],
  });

  const ndk = service.getNdk();
  ndk.signer = new NDKPrivateKeySigner(Buffer.from(sk).toString('hex'));
  await service.connect();
  await sleep(600);

  const note = new NDKEvent(ndk);
  note.kind = 1;
  note.content = 'outbox routing regression test';
  try {
    await note.publish(undefined, 5000);
  } catch {
    // A partial publish still lands where it lands; the relays are the oracle.
  }
  await sleep(600);

  const landedOn = (relay: StubRelay) =>
    relay.events.some((e) => e.kind === 1 && e.pubkey === pk);

  return { onOurs: landedOn(ours), onWider: landedOn(wider) };
}

describe('a Space user publishes to the relays they curated', () => {
  it(
    'reaches the wider relay when the list is on OUR relay',
    async () => {
      // THE REGRESSION. This returned onWider=false before the fix, because the
      // outbox lookup asked an indexer that had never seen the list, and NDK
      // fell back to permanentAndConnectedRelays() -- our relay alone.
      const r = await publishNote('ours');

      expect(r.onOurs).toBe(true);
      expect(r.onWider).toBe(true);
    },
    20000
  );

  it(
    'still reaches the wider relay when the list is on a public indexer',
    async () => {
      // THE CONTROL, and it is what makes the first assertion mean something.
      // This path worked before the fix. If it had broken, the fix would have
      // traded one silent narrowing for another: a user who arrives with an
      // existing, publicly indexed Nostr identity must keep fanning out.
      const r = await publishNote('indexer');

      expect(r.onWider).toBe(true);
    },
    20000
  );
});
