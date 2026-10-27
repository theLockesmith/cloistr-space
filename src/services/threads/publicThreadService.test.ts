/**
 * @fileoverview Public thread writes go out as the standard events, through
 * the signer, and an archive by anyone but the author is refused before it is
 * signed.
 */

import { describe, it, expect, vi } from 'vitest';
import { THREAD_ROOT_KIND, STATUS_LABEL_KIND, STATUS_NAMESPACE } from '@cloistr/threads';
import type { Event } from 'nostr-tools';
import type { SignerInterface, RelayClient } from '../headless';
import { THREAD_KIND } from './threadEvents';
import { createPublicThread, replyToPublicThread, archivePublicThread } from './publicThreadService';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function setup(accepted = 1) {
  const published: Event[] = [];
  const signer = {
    getPublicKey: vi.fn(async () => ME),
    signEvent: vi.fn(async (t: Omit<Event, 'id' | 'sig'>) => ({ ...t, id: `id${published.length}`, sig: 's' }) as Event),
  } as unknown as SignerInterface;
  const relay: RelayClient = {
    publish: vi.fn(async (e: Event) => {
      published.push(e);
      return accepted;
    }),
    fetch: vi.fn(async () => []),
  };
  return { signer, relay, published };
}

describe('createPublicThread', () => {
  it('publishes a kind 11 root with a title and the group scope', async () => {
    const { signer, relay, published } = setup();
    await createPublicThread(signer, relay, { title: ' Plan ', body: ' hello ', groupId: 'devs' });
    expect(published[0]).toMatchObject({
      kind: THREAD_ROOT_KIND,
      pubkey: ME,
      content: 'hello',
      tags: [['h', 'devs'], ['title', 'Plan']],
    });
  });

  it('writes no group tag for a thread outside any project', async () => {
    const { signer, relay, published } = setup();
    await createPublicThread(signer, relay, { title: 'Plan', body: '' });
    expect(published[0].tags).toEqual([['title', 'Plan']]);
  });

  it('refuses a thread with no title, before signing', async () => {
    const { signer, relay } = setup();
    await expect(createPublicThread(signer, relay, { title: ' ', body: 'x' })).rejects.toThrow(/title/);
    expect(signer.signEvent).not.toHaveBeenCalled();
  });

  it('throws when no relay accepts it', async () => {
    const { signer, relay } = setup(0);
    await expect(createPublicThread(signer, relay, { title: 'Plan', body: '' })).rejects.toThrow(/No relay/);
  });
});

describe('replyToPublicThread', () => {
  it('publishes a NIP-22 reply naming the root kind', async () => {
    const { signer, relay, published } = setup();
    await replyToPublicThread(
      signer,
      relay,
      { rootId: 'r', rootPubkey: OTHER, rootKind: THREAD_KIND, parentId: 'r', parentPubkey: OTHER },
      ' yes ',
    );
    expect(published[0].kind).toBe(THREAD_KIND);
    expect(published[0].content).toBe('yes');
    // A legacy 1111 root keeps K = 1111.
    expect(published[0].tags).toContainEqual(['K', '1111']);
    expect(published[0].tags).toContainEqual(['E', 'r', '', OTHER]);
  });

  it('refuses an empty reply', async () => {
    const { signer, relay } = setup();
    await expect(
      replyToPublicThread(signer, relay, { rootId: 'r', rootPubkey: OTHER, parentId: 'r', parentPubkey: OTHER }, ' '),
    ).rejects.toThrow(/text/);
    expect(signer.signEvent).not.toHaveBeenCalled();
  });
});

describe('archivePublicThread', () => {
  it("publishes the author's archive label for the root", async () => {
    const { signer, relay, published } = setup();
    await archivePublicThread(signer, relay, { id: 'r', pubkey: ME });
    expect(published[0]).toMatchObject({
      kind: STATUS_LABEL_KIND,
      tags: [['L', STATUS_NAMESPACE], ['l', 'archived', STATUS_NAMESPACE], ['e', 'r']],
    });
  });

  it("refuses to archive someone else's thread, before signing", async () => {
    const { signer, relay } = setup();
    await expect(archivePublicThread(signer, relay, { id: 'r', pubkey: OTHER })).rejects.toThrow(/started/);
    expect(signer.signEvent).not.toHaveBeenCalled();
  });
});
