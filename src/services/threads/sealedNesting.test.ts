/**
 * Private threads nest like public ones (architecture/threads.md section 2):
 * the rumor inside a v2 seal carries NIP-22 `e` (parent) and `E` (root) tags,
 * and parent pointers are RUMOR ids, which the relay never sees.
 */

import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, nip44 } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { tryUnwrapMessage, wrapThreadMessage, GIFT_WRAP_KIND, SEAL_KIND } from './giftWrap';
import { acceptWrapped, type StandaloneMessage } from './standaloneThreads';
import { nestMessages, type MessageNode } from './sealedNesting';

const threadSk = generateSecretKey();
const threadSkHex = bytesToHex(threadSk);
const threadPk = getPublicKey(threadSk);
const authorSk = generateSecretKey();
const authorPk = getPublicKey(authorSk);
const NOW = Math.floor(Date.now() / 1000);

function store() {
  const s = new ThreadKeyStore();
  s.importHex(threadPk, threadSkHex);
  return s;
}

/** A v2 wrap: one-time key -> seal signed by the author -> unsigned rumor. */
function sealedWrap(content: string, tags: string[][], createdAt = NOW, claimedId?: string) {
  const rumor = { pubkey: authorPk, created_at: createdAt, kind: 1111, tags, content };
  const rumorId = getEventHash(rumor);
  const seal = finalizeEvent(
    {
      kind: SEAL_KIND,
      created_at: createdAt,
      tags: [],
      content: nip44.v2.encrypt(JSON.stringify({ ...rumor, id: claimedId ?? rumorId }), nip44.v2.utils.getConversationKey(authorSk, threadPk)),
    },
    authorSk,
  );
  const oneTime = generateSecretKey();
  const wrap = finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      created_at: createdAt,
      tags: [],
      content: nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(oneTime, threadPk)),
    },
    oneTime,
  );
  return { wrap, rumorId };
}

describe('tryUnwrapMessage reads the nesting tags inside a v2 seal', () => {
  it('reports the rumor id, computed rather than trusted, and the parent and root it points at', () => {
    const { wrap, rumorId } = sealedWrap('a reply', [
      ['E', 'c'.repeat(64), '', authorPk],
      ['e', 'b'.repeat(64), '', authorPk],
    ]);
    const msg = tryUnwrapMessage(wrap, store());

    expect(msg?.rumorId).toBe(rumorId);
    expect(msg?.parentId).toBe('b'.repeat(64));
    expect(msg?.rootId).toBe('c'.repeat(64));
  });

  it('ignores the id a rumor claims for itself, so a sender cannot pose as another message', () => {
    const { wrap, rumorId } = sealedWrap('impostor', [], NOW, 'd'.repeat(64));

    expect(tryUnwrapMessage(wrap, store())?.rumorId).toBe(rumorId);
  });

  it('a top-level message has a rumor id and no parent', () => {
    const { wrap, rumorId } = sealedWrap('top', []);
    const msg = tryUnwrapMessage(wrap, store());

    expect(msg?.rumorId).toBe(rumorId);
    expect(msg?.parentId).toBeUndefined();
  });

  it('a v1 {p, a} message has neither: nothing in it can be pointed at', () => {
    const msg = tryUnwrapMessage(wrapThreadMessage('old', authorPk, threadSkHex), store());

    expect(msg?.rumorId).toBeUndefined();
    expect(msg?.parentId).toBeUndefined();
  });

  it('acceptWrapped carries the rumor id and parent through to the shown message', () => {
    const { wrap, rumorId } = sealedWrap('reply', [['e', 'b'.repeat(64), '', authorPk]]);
    const shown = acceptWrapped(tryUnwrapMessage(wrap, store())!, { keyStore: store(), threadIds: new Map() });

    expect(shown?.rumorId).toBe(rumorId);
    expect(shown?.parentId).toBe('b'.repeat(64));
  });
});

function msg(id: string, createdAt: number, parentId?: string, rumorId: string | undefined = `rumor-${id}`): StandaloneMessage {
  return {
    id,
    rumorId,
    parentId,
    pubkey: authorPk,
    createdAt,
    threadKey: 'sealed:x',
    title: 't',
    text: id,
    from: null,
    sealed: true,
    projectId: null,
  };
}

/** Flatten to [id, depth] in render order, which is what the screen shows. */
function shape(nodes: MessageNode[]): [string, number][] {
  return nodes.flatMap((n) => [[n.id, n.depth] as [string, number], ...shape(n.replies)]);
}

describe('nestMessages', () => {
  it('puts a reply under the message it answers, siblings oldest first', () => {
    const tree = nestMessages([msg('a', 1), msg('b', 2, 'rumor-a'), msg('c', 3), msg('d', 4, 'rumor-a'), msg('e', 5, 'rumor-b')]);

    expect(shape(tree)).toEqual([
      ['a', 0],
      ['b', 1],
      ['e', 2],
      ['d', 1],
      ['c', 0],
    ]);
  });

  it('a reply whose parent is not here is shown at the top level, never dropped', () => {
    expect(shape(nestMessages([msg('a', 1), msg('b', 2, 'rumor-gone')]))).toEqual([
      ['a', 0],
      ['b', 0],
    ]);
  });

  it('v1 messages, which have no rumor id, sit at the top level in time order', () => {
    const tree = nestMessages([msg('a', 1, undefined, undefined), msg('b', 2), msg('c', 3, 'rumor-b')]);

    expect(shape(tree)).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 1],
    ]);
  });

  it('a cycle neither hangs nor loses messages', () => {
    const tree = nestMessages([msg('a', 1, 'rumor-b'), msg('b', 2, 'rumor-a')]);

    expect(shape(tree).map(([id]) => id).sort()).toEqual(['a', 'b']);
  });

  it('caps the tree at depth 8 and flattens deeper replies onto the deepest shown ancestor', () => {
    const chain = Array.from({ length: 12 }, (_, i) => msg(`m${i}`, i, i === 0 ? undefined : `rumor-m${i - 1}`));
    const flat = shape(nestMessages(chain));

    expect(flat).toHaveLength(12);
    expect(Math.max(...flat.map(([, d]) => d))).toBe(8);
  });

  it('the same rumor seen in two wraps is one message', () => {
    const tree = nestMessages([msg('w1', 1, undefined, 'rumor-x'), msg('w2', 1, undefined, 'rumor-x')]);

    expect(shape(tree)).toHaveLength(1);
  });
});
