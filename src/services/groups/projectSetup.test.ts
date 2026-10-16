/**
 * @fileoverview Finishing a project that creation left half-made.
 *
 * Creation is three publishes (39000, 39001, 39002) that cannot be atomic. A
 * project left with a 39000 and no 39002 now refuses every member edit, which
 * is right, because "no member list read" may mean "the read missed it". The
 * repair publishes an owner-only 39002, which REPLACES whatever list exists, so
 * it is offered only when every one of the owner's relays answered and none
 * holds one. One relay that did not answer is "can't tell", never "absent".
 */

import { describe, it, expect } from 'vitest';
import type { Event, UnsignedEvent } from 'nostr-tools';
import type { SignerInterface, RelayClient, RelayAnswer, RelayProbe } from '../headless';
import { GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND } from '@/types/groups';
import { checkProjectSetup, finishProjectSetup } from './projectSetup';
import { creationAdminsTemplate, creationMembersTemplate } from './groupService';

const OWNER = '1234567890abcdef'.repeat(4);
const MALLORY = 'dd'.repeat(32);
const CAROL = 'cc'.repeat(32);
const GROUP = `my-project-${OWNER.slice(0, 16)}-0a0b0c0d`;
const LEGACY_GROUP = 'my-project-t9mn5b1';

const signerFor = (pubkey: string): SignerInterface => ({
  getPublicKey: async () => pubkey,
  signEvent: async (u: UnsignedEvent): Promise<Event> => ({ ...u, id: 'ee'.repeat(32), sig: 'ff'.repeat(64) }),
  encrypt: async () => '',
  decrypt: async () => '',
});
const signer = signerFor(OWNER);

function publishingRelay(): RelayClient & { published: Event[] } {
  const published: Event[] = [];
  return {
    published,
    publish: async (e: Event) => {
      published.push(e);
      return 1;
    },
    fetch: async () => [],
  };
}

let n = 0;
const ev = (kind: number, tags: string[][], pubkey = OWNER, d = GROUP): Event =>
  ({
    id: (++n).toString(16).padStart(64, '0'),
    kind,
    pubkey,
    created_at: 1000,
    content: '',
    sig: '',
    tags: [['d', d], ...tags],
  }) as Event;

const metadata = ev(GROUP_METADATA_KIND, [['name', 'My project'], ['private'], ['closed']]);
const ownerAdmins = ev(GROUP_ADMINS_KIND, [['p', OWNER, 'add-user', 'remove-user']]);
const realMembers = ev(GROUP_MEMBERS_KIND, [['p', OWNER], ['p', CAROL]]);

const answered = (url: string, events: Event[]): RelayAnswer => ({ url, status: 'answered', events });
const failed = (url: string): RelayAnswer => ({ url, status: 'failed', reason: 'timed out' });

/** A probe that answers from a fixed list each time, recording each call. */
function probeOf(...rounds: RelayAnswer[][]): RelayProbe & { calls: number } {
  const probe = Object.assign(
    async () => rounds[Math.min(probe.calls++, rounds.length - 1)],
    { calls: 0 },
  );
  return probe;
}

const template = (e: Event) => ({ kind: e.kind, content: e.content, tags: e.tags });

describe('checkProjectSetup', () => {
  it('reports unfinished when every relay answered with the project and no member list', async () => {
    const probe = probeOf([answered('wss://a', [metadata]), answered('wss://b', [metadata])]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'unfinished', needsAdmins: true });
  });

  it('CONTROL: one relay holding the real member list means there is nothing to finish', async () => {
    const probe = probeOf([answered('wss://a', [metadata]), answered('wss://b', [metadata, ownerAdmins, realMembers])]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'complete' });
  });

  it('a member list from anyone at all blocks the repair', async () => {
    // Fails safe: the cost is a missing button, never a replaced list.
    const stray = ev(GROUP_MEMBERS_KIND, [['p', MALLORY]], MALLORY);
    const probe = probeOf([answered('wss://a', [metadata, stray])]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'complete' });
  });

  it("one relay that did not answer makes it uncheckable, even when the others found nothing", async () => {
    const probe = probeOf([answered('wss://a', [metadata]), failed('wss://b')]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'unchecked' });
  });

  it('a relay that failed does not hide a member list another relay returned', async () => {
    const probe = probeOf([answered('wss://a', [metadata, realMembers]), failed('wss://b')]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'complete' });
  });

  it('offers nothing to someone who is not the owner', async () => {
    const probe = probeOf([answered('wss://a', [metadata])]);
    expect(await checkProjectSetup(MALLORY, probe, GROUP)).toEqual({ status: 'not-owner' });
  });

  it('offers nothing for a legacy identifier, whose owner cannot be established', async () => {
    const legacy = ev(GROUP_METADATA_KIND, [['name', 'Old']], OWNER, LEGACY_GROUP);
    const probe = probeOf([answered('wss://a', [legacy])]);
    expect(await checkProjectSetup(OWNER, probe, LEGACY_GROUP)).toEqual({ status: 'not-owner' });
  });

  it('offers nothing when no relay returned the project itself', async () => {
    const probe = probeOf([answered('wss://a', [])]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'not-owner' });
  });

  it('with no relays to ask, it is uncheckable rather than unfinished', async () => {
    const probe = probeOf([]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'unchecked' });
  });

  it("keeps the owner's admin list when it landed and only the member list is missing", async () => {
    const probe = probeOf([answered('wss://a', [metadata, ownerAdmins])]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'unfinished', needsAdmins: false });
  });

  it("an admin list signed by someone else does not count as the owner's", async () => {
    const forged = ev(GROUP_ADMINS_KIND, [['p', MALLORY, 'add-user']], MALLORY);
    const probe = probeOf([answered('wss://a', [metadata, forged])]);
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'unfinished', needsAdmins: true });
  });

  it('a probe that throws is uncheckable', async () => {
    const probe: RelayProbe = async () => {
      throw new Error('Not connected');
    };
    expect(await checkProjectSetup(OWNER, probe, GROUP)).toEqual({ status: 'unchecked' });
  });
});

describe('finishProjectSetup', () => {
  it('publishes exactly what creation would have: the default admin list, then the owner-only member list', async () => {
    const relay = publishingRelay();
    const probe = probeOf([answered('wss://a', [metadata])]);
    expect(await finishProjectSetup(signer, relay, probe, GROUP)).toEqual({ ok: true });
    expect(relay.published.map(template)).toEqual([
      creationAdminsTemplate(GROUP, OWNER),
      creationMembersTemplate(GROUP, OWNER),
    ]);
  });

  it("publishes only the member list when the owner's admin list exists, so it is not replaced", async () => {
    const relay = publishingRelay();
    const probe = probeOf([answered('wss://a', [metadata, ownerAdmins])]);
    expect(await finishProjectSetup(signer, relay, probe, GROUP)).toEqual({ ok: true });
    expect(relay.published.map(template)).toEqual([creationMembersTemplate(GROUP, OWNER)]);
  });

  it('checks again at click time: a member list that appeared since publishes nothing', async () => {
    const relay = publishingRelay();
    const probe = probeOf(
      [answered('wss://a', [metadata])],
      [answered('wss://a', [metadata, realMembers])],
    );
    expect((await checkProjectSetup(OWNER, probe, GROUP)).status).toBe('unfinished');
    const result = await finishProjectSetup(signer, relay, probe, GROUP);
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
  });

  it('publishes nothing when a relay does not answer at click time', async () => {
    const relay = publishingRelay();
    const probe = probeOf([answered('wss://a', [metadata]), failed('wss://b')]);
    const result = await finishProjectSetup(signer, relay, probe, GROUP);
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
  });

  it('publishes nothing for someone who is not the owner', async () => {
    const relay = publishingRelay();
    const probe = probeOf([answered('wss://a', [metadata])]);
    const result = await finishProjectSetup(signerFor(MALLORY), relay, probe, GROUP);
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
  });
});
