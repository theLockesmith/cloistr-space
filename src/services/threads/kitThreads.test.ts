/**
 * @fileoverview Fleet threads as the kit ACTUALLY writes them, from fixtures
 * produced by the kit's own code (thread_daemon.py + thread_wrap.py) with fixed
 * test keys; see __fixtures__/kitThreadEvents.json.
 *
 * Two facts the first version of this missed (cloistr-pr, 2026-10-19):
 *  - the kit signs with each ROLE's own key, not the fleet key, so a fetch by
 *    the fleet's author never sees a real message;
 *  - the live kit runs in wrap mode: messages are kind 1059 under a one-time
 *    key, with the role key named only inside the encryption.
 */

import { describe, it, expect } from 'vitest';
import { hexToBytes } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { tryUnwrapMessage, tryUnwrapHandoff } from './giftWrap';
import { acceptStandalone, acceptWrapped, groupStandalone, threadIdsFromHandoffs } from './standaloneThreads';
import kit from './__fixtures__/kitThreadEvents.json';

const THREAD_SK = hexToBytes('11'.repeat(32));
const MEMBER_SK = hexToBytes('33'.repeat(32));
const { threadPk, rolePk, granterPk, unheldPk } = kit.keys;

function heldStore() {
  const s = new ThreadKeyStore();
  s.set(threadPk, THREAD_SK);
  return s;
}

describe('kit fixtures: who signs', () => {
  it('a kit kind:1111 is signed by the role key, not the fleet key', () => {
    expect(kit.legacy1111.pubkey).toBe(rolePk);
    expect(kit.legacy1111.pubkey).not.toBe(granterPk);
  });

  it('a wrap-mode message is signed by neither: a one-time key', () => {
    expect([rolePk, granterPk]).not.toContain(kit.wrap.pubkey);
  });
});

describe('the role-key kind:1111', () => {
  it('opens and is shown when the thread key is held', () => {
    const msg = acceptStandalone(kit.legacy1111, { keyStore: heldStore(), me: null, memberProjects: new Set() });
    expect(msg).toMatchObject({
      threadKey: `sealed:${threadPk}`,
      title: 'cloistr-group-wrap',
      text: 'legacy hello',
      from: 'cloistr-orchestrator',
      sealed: true,
    });
  });
});

describe('the wrap-mode kind:1059', () => {
  it('opens with the held thread key and keeps the wrap’s time', () => {
    const unwrapped = tryUnwrapMessage(kit.wrap, heldStore());
    expect(unwrapped).toMatchObject({ authorHex: rolePk, threadId: threadPk, createdAt: kit.wrap.created_at });
  });

  it('is admitted as a sealed message in the thread’s conversation, named by its hand-off', () => {
    const store = heldStore();
    const ids = new Map([[threadPk, 'cloistr-group-wrap']]);
    const msg = acceptWrapped(tryUnwrapMessage(kit.wrap, store)!, { keyStore: store, threadIds: ids });
    expect(msg).toMatchObject({
      id: kit.wrap.id,
      threadKey: `sealed:${threadPk}`,
      title: 'cloistr-group-wrap',
      text: 'wrap-mode hello',
      from: 'cloistr-orchestrator',
      sealed: true,
      projectId: null,
      createdAt: kit.wrap.created_at,
    });
  });

  it('joins the same conversation as the kind:1111 of that thread', () => {
    const store = heldStore();
    const a = acceptStandalone(kit.legacy1111, { keyStore: store, me: null, memberProjects: new Set() })!;
    const b = acceptWrapped(tryUnwrapMessage(kit.wrap, store)!, { keyStore: store, threadIds: new Map() })!;
    const threads = groupStandalone([a, b]);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m) => m.text).sort()).toEqual(['legacy hello', 'wrap-mode hello']);
  });

  it('for a key the user does NOT hold, never opens', () => {
    expect(tryUnwrapMessage(kit.wrapUnheld, heldStore())).toBeNull();
  });

  it('is dropped once its key is no longer held (signed out, or another key)', () => {
    const store = heldStore();
    const unwrapped = tryUnwrapMessage(kit.wrap, store)!;
    store.clear();
    expect(acceptWrapped(unwrapped, { keyStore: store, threadIds: new Map() })).toBeNull();
  });
});

describe('the hand-off gives the thread id', () => {
  it('maps the thread pubkey to the kit’s thread id', () => {
    const handoff = tryUnwrapHandoff(kit.handoff, MEMBER_SK, [granterPk]);
    expect(handoff).not.toBeNull();
    expect(threadIdsFromHandoffs([handoff!])).toEqual(new Map([[threadPk, 'cloistr-group-wrap']]));
  });

  it('never names a thread from a hand-off by a granter we do not expect', () => {
    expect(tryUnwrapHandoff(kit.handoff, MEMBER_SK, [unheldPk])).toBeNull();
  });
});
