import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { openHandoffGrants, clearHandoffGrants, RESEND_WINDOWS } from './handoffGrants';
import { resendDueHandoffs } from './resendHandoffs';
import { ThreadKeyStore } from './threadKeyStore';
import { computeHandoffBucket, ecdhHex, WINDOW_SECONDS } from './bucketCrypto';
import { tryUnwrapHandoff } from './giftWrap';
import type { WrapConnection } from './wrapRelay';
import type { Event } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

const granterSk = generateSecretKey();
const granterPk = getPublicKey(granterSk);
const memberSk = generateSecretKey();
const memberPk = getPublicKey(memberSk);
const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);
const W = 20_400;

const selfCk = nip44.v2.utils.getConversationKey(granterSk, granterPk);
const crypt = {
  encrypt: async (_pk: string, pt: string) => nip44.v2.encrypt(pt, selfCk),
  decrypt: async (_pk: string, ct: string) => nip44.v2.decrypt(ct, selfCk),
};
const always = () => true;

/** The granter's signer: answers the mailbox tag, never hands out its key. */
const signer = {
  getPublicKey: async () => granterPk,
  signEvent: async () => {
    throw new Error('not used');
  },
  encrypt: async () => '',
  decrypt: async () => '',
  sendRequest: async (method: string, params: string[]) => {
    if (method !== 'cloistr_ecdh_tag') throw new Error('unsupported');
    return computeHandoffBucket(ecdhHex(granterSk, params[0]), Number(params[1]));
  },
};

function relay(opts: { down?: boolean } = {}) {
  const stored: Event[] = [];
  const open = async (): Promise<WrapConnection> => {
    if (opts.down) throw new Error('connection refused');
    return {
      publish: async (e: Event) => {
        stored.push(e);
        return '';
      },
      signIn: async () => {},
      close: () => {},
    };
  };
  return { stored, opts: { relayUrls: ['wss://relay.example'], open } };
}

beforeEach(() => localStorage.clear());

describe('handoff grant record', () => {
  it('is due from the next window until RESEND_WINDOWS windows after the first send', async () => {
    const grants = await openHandoffGrants(granterPk, crypt, always);
    await grants.record(threadPk, memberPk, 'team', W);

    expect(grants.due(W)).toHaveLength(0);
    expect(grants.due(W + 1)).toHaveLength(1);
    expect(grants.due(W + RESEND_WINDOWS - 1)).toHaveLength(1);
    expect(grants.due(W + RESEND_WINDOWS)).toHaveLength(0);
  });

  it('a re-send keeps the span; granting again restarts it', async () => {
    const grants = await openHandoffGrants(granterPk, crypt, always);
    await grants.record(threadPk, memberPk, 'team', W);
    await grants.record(threadPk, memberPk, 'team', W + 10, { resend: true });
    expect(grants.due(W + RESEND_WINDOWS)).toHaveLength(0);

    await grants.record(threadPk, memberPk, 'team', W + 10);
    expect(grants.due(W + RESEND_WINDOWS)).toHaveLength(1);
  });

  it('survives a reload, and is stored encrypted: no member or thread key in the clear', async () => {
    const grants = await openHandoffGrants(granterPk, crypt, always);
    await grants.record(threadPk, memberPk, 'team', W);

    const raw = localStorage.getItem('cloistr:handoff-grants:' + granterPk) ?? '';
    expect(raw).not.toContain(memberPk);
    expect(raw).not.toContain(threadPk);

    const reopened = await openHandoffGrants(granterPk, crypt, always);
    expect(reopened.due(W + 1)).toEqual([{ thread: threadPk, member: memberPk, tid: 'team', first: W, last: W }]);
  });

  it('a save after the account switched is dropped', async () => {
    let current = true;
    const grants = await openHandoffGrants(granterPk, crypt, () => current);
    current = false;
    await grants.record(threadPk, memberPk, 'team', W);
    expect(localStorage.getItem('cloistr:handoff-grants:' + granterPk)).toBeNull();
  });

  it('sign-out removes it', async () => {
    const grants = await openHandoffGrants(granterPk, crypt, always);
    await grants.record(threadPk, memberPk, 'team', W);
    clearHandoffGrants(granterPk);
    expect((await openHandoffGrants(granterPk, crypt, always)).due(W + 1)).toHaveLength(0);
  });
});

describe('resendDueHandoffs: a member away for days still gets the key', () => {
  const keyStore = () => {
    const s = new ThreadKeyStore();
    s.set(threadPk, threadSk);
    return s;
  };

  it('sends a due grant again, in that day’s mailbox, and not twice the same day', async () => {
    const grants = await openHandoffGrants(granterPk, crypt, always);
    await grants.record(threadPk, memberPk, 'team', W);
    const later = (W + 5) * WINDOW_SECONDS + 100;
    const { stored, opts } = relay();

    expect(await resendDueHandoffs(grants, keyStore(), signer, { ...opts, nowSec: later })).toBe(1);
    expect(await resendDueHandoffs(grants, keyStore(), signer, { ...opts, nowSec: later + 60 })).toBe(0);

    expect(stored).toHaveLength(1);
    expect(stored[0].tags).toContainEqual(['t', computeHandoffBucket(ecdhHex(memberSk, granterPk), W + 5)]);
    expect(tryUnwrapHandoff(stored[0], memberSk, [granterPk])).toMatchObject({ threadId: 'team', threadSecretHex: bytesToHex(threadSk) });
  });

  it('a grant whose key is not restored yet, or whose send failed, stays due', async () => {
    const grants = await openHandoffGrants(granterPk, crypt, always);
    await grants.record(threadPk, memberPk, 'team', W);
    const later = (W + 1) * WINDOW_SECONDS + 100;

    expect(await resendDueHandoffs(grants, new ThreadKeyStore(), signer, { ...relay().opts, nowSec: later })).toBe(0);
    expect(await resendDueHandoffs(grants, keyStore(), signer, { ...relay({ down: true }).opts, nowSec: later })).toBe(0);
    expect(grants.due(W + 1)).toHaveLength(1);
  });

  it('stops once the span is over', async () => {
    const grants = await openHandoffGrants(granterPk, crypt, always);
    await grants.record(threadPk, memberPk, 'team', W);
    const { stored, opts } = relay();
    await resendDueHandoffs(grants, keyStore(), signer, { ...opts, nowSec: (W + RESEND_WINDOWS) * WINDOW_SECONDS });
    expect(stored).toHaveLength(0);
  });
});
