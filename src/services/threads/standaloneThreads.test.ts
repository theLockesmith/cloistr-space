/**
 * @fileoverview Threads that stand alone: no project tag, or a project the
 * user is not in. The operator's ruling (2026-10-13) is that a thread is a
 * thread whether or not a project holds it. The fleet writes exactly these:
 * each message a standalone kind:1111, sealed to the thread's key, tags d
 * (thread name), K and thread (thread pubkey), h only sometimes
 * (thread_daemon.py). Space showed none of them anywhere.
 *
 * What may be shown is the whole question, so it is decided here, before
 * anything is stored: a sealed message only when its key is held AND it
 * opens; an unsealed one only when the user wrote it. Everything else is
 * dropped, tags and all.
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { ThreadKeyStore, encryptThreadContent } from './threadKeyStore';
import { bytesToHex } from 'nostr-tools/utils';
import { acceptStandalone, acceptWrapped, groupStandalone, type StandaloneMessage } from './standaloneThreads';
import { wrapThreadMessage, tryUnwrapMessage } from './giftWrap';

const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);
const otherThreadSk = generateSecretKey();
const otherThreadPk = getPublicKey(otherThreadSk);
const fleetSk = generateSecretKey();
const fleetPk = getPublicKey(fleetSk);
const meSk = generateSecretKey();
const me = getPublicKey(meSk);
const stranger = getPublicKey(generateSecretKey());

const keys = new ThreadKeyStore();
keys.set(threadPk, threadSk);

const envelope = (body: string, from = 'cloistr-orchestrator', thread = 'cloistr-group-wrap') =>
  JSON.stringify({ v: 'arbiter-fleet-msg-v1', body, task: null, role: 'cloistr-space', from, thread });

let n = 0;
function ev(over: { pubkey?: string; content?: string; tags?: string[][]; created_at?: number; kind?: number }) {
  n += 1;
  return {
    id: `ev${n}`.padEnd(64, '0'),
    kind: over.kind ?? 1111,
    pubkey: over.pubkey ?? fleetPk,
    created_at: over.created_at ?? 1_790_000_000 + n,
    content: over.content ?? '',
    tags: over.tags ?? [],
  };
}

/** A message exactly as thread_daemon.py writes it. */
function fleetMessage(body: string, opts: { sk?: Uint8Array; pk?: string; author?: string; d?: string; h?: string; at?: number } = {}) {
  const tpk = opts.pk ?? threadPk;
  const tsk = opts.sk ?? threadSk;
  const author = opts.author ?? fleetPk;
  const tags = [['d', opts.d ?? 'cloistr-group-wrap'], ['K', '1111'], ['thread', tpk]];
  if (opts.h) tags.push(['h', opts.h]);
  return ev({ pubkey: author, content: encryptThreadContent(envelope(body), tsk, author), tags, created_at: opts.at });
}

const ctx = { keyStore: keys, me, memberProjects: new Set(['devs']) };

describe('acceptStandalone: what may be shown', () => {
  it('a fleet-style sealed message whose key is held, with no project tag, is shown decrypted', () => {
    const msg = acceptStandalone(fleetMessage('the staging deploy is broken'), ctx);
    expect(msg).toMatchObject({
      threadKey: `sealed:${threadPk}`,
      title: 'cloistr-group-wrap',
      text: 'the staging deploy is broken',
      from: 'cloistr-orchestrator',
      sealed: true,
      projectId: null,
    });
  });

  it('the user’s own unsealed root with no project tag is shown', () => {
    const own = ev({ pubkey: me, content: 'hello, a thread of my own', tags: [['subject', 'My thread']] });
    expect(acceptStandalone(own, ctx)).toMatchObject({
      threadKey: `root:${own.id}`,
      title: 'My thread',
      text: 'hello, a thread of my own',
      sealed: false,
      projectId: null,
    });
  });

  it('the user’s own reply joins its root', () => {
    const reply = ev({ pubkey: me, content: 'and a follow-up', tags: [['E', 'r'.repeat(64), '', me]] });
    expect(acceptStandalone(reply, ctx)?.threadKey).toBe(`root:${'r'.repeat(64)}`);
  });

  it('a sealed message for a project the user is NOT in is shown, labelled with that project', () => {
    expect(acceptStandalone(fleetMessage('x', { h: 'conscience-g' }), ctx)?.projectId).toBe('conscience-g');
  });

  describe('dropped, so nothing about it is stored, shown or counted', () => {
    it('a sealed message for a key the user does NOT hold', () => {
      expect(acceptStandalone(fleetMessage('not yours', { sk: otherThreadSk, pk: otherThreadPk }), ctx)).toBeNull();
    });

    it('a message whose thread key is held but whose content does not open', () => {
      const forged = fleetMessage('x');
      forged.content = encryptThreadContent(envelope('x'), otherThreadSk, fleetPk);
      expect(acceptStandalone(forged, ctx)).toBeNull();
    });

    it('an unsealed message by someone else', () => {
      expect(acceptStandalone(ev({ pubkey: stranger, content: 'public spam' }), ctx)).toBeNull();
    });

    it('a sealed-looking message by someone else with no thread tag', () => {
      expect(acceptStandalone(ev({ pubkey: stranger, content: 'A'.repeat(60) }), ctx)).toBeNull();
    });

    it('a message tagged with a project the user IS in (the project view shows it already)', () => {
      expect(acceptStandalone(fleetMessage('x', { h: 'devs' }), ctx)).toBeNull();
      expect(acceptStandalone(ev({ pubkey: me, content: 'mine', tags: [['h', 'devs']] }), ctx)).toBeNull();
    });

    it('another kind', () => {
      expect(acceptStandalone(ev({ pubkey: me, kind: 1, content: 'a note' }), ctx)).toBeNull();
    });

    it('with no user signed in, nothing unsealed is the user’s', () => {
      expect(acceptStandalone(ev({ pubkey: me, content: 'mine' }), { ...ctx, me: null })).toBeNull();
    });
  });

  it('a body that is not a fleet envelope is shown as the plaintext itself', () => {
    const plain = ev({ pubkey: fleetPk, content: encryptThreadContent('just text', threadSk, fleetPk), tags: [['thread', threadPk]] });
    expect(acceptStandalone(plain, ctx)).toMatchObject({ text: 'just text', from: null, title: 'Sealed thread' });
  });
});

describe('groupStandalone: one conversation per thread', () => {
  it('groups by thread, oldest message first, newest conversation first', () => {
    const msgs = [
      fleetMessage('second', { at: 20 }),
      fleetMessage('first', { at: 10 }),
      fleetMessage('elsewhere', { sk: otherThreadSk, pk: otherThreadPk, d: 'other-thread', at: 30 }),
    ];
    const keysBoth = new ThreadKeyStore();
    keysBoth.set(threadPk, threadSk);
    keysBoth.set(otherThreadPk, otherThreadSk);
    const accepted = msgs
      .map((m) => acceptStandalone(m, { ...ctx, keyStore: keysBoth }))
      .filter((m): m is StandaloneMessage => m !== null);

    const threads = groupStandalone(accepted);
    expect(threads.map((t) => t.title)).toEqual(['other-thread', 'cloistr-group-wrap']);
    expect(threads[1].messages.map((m) => m.text)).toEqual(['first', 'second']);
    expect(threads[1].lastActivity).toBe(20);
  });

  it('the same event seen twice is one message', () => {
    const m = acceptStandalone(fleetMessage('once'), ctx)!;
    expect(groupStandalone([m, { ...m }])[0].messages).toHaveLength(1);
  });
});

describe('wrap-mode messages keep the order they were sent in', () => {
  const day = 1_790_006_400 - (1_790_006_400 % 86400);
  const threadIds = new Map([[threadPk, 'cloistr-group-wrap']]);
  const wrapCtx = { keyStore: keys, threadIds };

  it('orders by the time inside the seal, whatever the wraps’ randomised times say', () => {
    const secretHex = bytesToHex(threadSk);
    // Sent 1000s then 2000s into the day; the wraps' outer times say the reverse.
    const first = { ...wrapThreadMessage(envelope('first'), fleetPk, secretHex, day + 1000), created_at: day + 900 };
    const second = { ...wrapThreadMessage(envelope('second'), fleetPk, secretHex, day + 2000), created_at: day + 10 };
    const accepted = [second, first].map((w) => acceptWrapped(tryUnwrapMessage(w, keys)!, wrapCtx)!);

    const [thread] = groupStandalone(accepted);
    expect(thread.messages.map((m) => m.text)).toEqual(['first', 'second']);
    expect(thread.lastActivity).toBe(day + 2000);
    expect(thread.lastActivityApprox).toBe(false);
  });

  it('an untimed message never sorts above a timed one sent after it', () => {
    const secretHex = bytesToHex(threadSk);
    // Kit message, no ts: sent at some point today, wrap time randomised back to 10s in.
    const oneTime = generateSecretKey();
    const untimed = {
      id: 'k'.repeat(64),
      pubkey: getPublicKey(oneTime),
      tags: [],
      created_at: day + 10,
      content: nip44.v2.encrypt(JSON.stringify({ p: envelope('kit, untimed'), a: fleetPk }), nip44.v2.utils.getConversationKey(oneTime, threadPk)),
    };
    const timed = wrapThreadMessage(envelope('space, timed'), fleetPk, secretHex, day + 1000);
    const readAt = day + 2000;
    const accepted = [untimed, timed].map((w) => acceptWrapped(tryUnwrapMessage(w, keys, readAt)!, wrapCtx)!);

    const [thread] = groupStandalone(accepted);
    expect(thread.messages.map((m) => m.text)).toEqual(['space, timed', 'kit, untimed']);
  });

  it('a message whose time is only approximate stays marked so', () => {
    const msg = acceptWrapped(
      { plaintext: envelope('old kit'), authorHex: fleetPk, threadId: threadPk, wrapId: 'w1', createdAt: day + 5, approxTime: true },
      wrapCtx,
    )!;
    expect(msg.approxTime).toBe(true);
    expect(groupStandalone([msg])[0].lastActivityApprox).toBe(true);
  });
});
