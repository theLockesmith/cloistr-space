/**
 * Hand-offs this user has sent, kept so they can be sent again.
 *
 * A hand-off expires two windows after it is sent, and a member's reader only
 * looks at the current and previous window, so a member away for more than
 * about two days never sees a single send. Space re-sends each grant once per
 * window for RESEND_WINDOWS windows, whenever the granter has Space open.
 * Nothing tells the granter that the member took the key; this is a bounded
 * retry, not delivery tracking.
 *
 * Stored NIP-44 encrypted to the granter, like the thread keys themselves:
 * the list says who was given which thread.
 */

import type { SelfCrypt } from './triedWraps';

const PREFIX = 'cloistr:handoff-grants:';

/** How many windows (days) a grant keeps being re-sent, counting the first. */
export const RESEND_WINDOWS = 14;

export interface HandoffGrant {
  /** The thread's public key: what the key store is keyed by. */
  thread: string;
  member: string;
  /** The thread id carried in the hand-off. */
  tid: string;
  /** Window of the first send; the re-send span counts from here. */
  first: number;
  /** Window of the latest send. */
  last: number;
}

export interface HandoffGrants {
  /** Grants not yet sent in `windowId` and still inside their re-send span. */
  due(windowId: number): HandoffGrant[];
  /** A grant sent in `windowId`. A grant made again restarts its span. */
  record(thread: string, member: string, tid: string, windowId: number, opts?: { resend?: boolean }): Promise<void>;
}

const grantKey = (g: Pick<HandoffGrant, 'thread' | 'member'>) => `${g.thread}:${g.member}`;

function isGrant(v: unknown): v is HandoffGrant {
  const g = v as HandoffGrant;
  return (
    !!g &&
    typeof g.thread === 'string' &&
    typeof g.member === 'string' &&
    typeof g.tid === 'string' &&
    Number.isSafeInteger(g.first) &&
    Number.isSafeInteger(g.last)
  );
}

/**
 * Read the granter's list (one signer decrypt when one is stored). A list
 * that cannot be read starts empty, and the grants in it are not re-sent.
 */
export async function openHandoffGrants(
  granterPk: string,
  crypt: SelfCrypt,
  /** Checked before every write: a save for an account that has since switched is dropped. */
  isCurrentUser: () => boolean,
): Promise<HandoffGrants> {
  const grants = new Map<string, HandoffGrant>();
  try {
    const blob = localStorage.getItem(PREFIX + granterPk);
    if (blob) {
      const stored = JSON.parse(await crypt.decrypt(granterPk, blob)) as unknown;
      if (Array.isArray(stored)) for (const g of stored) if (isGrant(g)) grants.set(grantKey(g), g);
    }
  } catch {
    // Unreadable or storage blocked: start empty.
  }

  let writing: Promise<void> = Promise.resolve();
  const save = (windowId: number) => {
    for (const [k, g] of grants) if (windowId - g.first >= RESEND_WINDOWS) grants.delete(k);
    const snapshot = JSON.stringify([...grants.values()]);
    writing = writing.then(async () => {
      if (!isCurrentUser()) return;
      try {
        const blob = await crypt.encrypt(granterPk, snapshot);
        if (isCurrentUser()) localStorage.setItem(PREFIX + granterPk, blob);
      } catch {
        // Signer or storage unavailable: the grant is simply not re-sent.
      }
    });
    return writing;
  };

  return {
    due: (windowId) =>
      [...grants.values()].filter((g) => g.last < windowId && windowId - g.first < RESEND_WINDOWS),
    record: (thread, member, tid, windowId, opts = {}) => {
      const prev = grants.get(grantKey({ thread, member }));
      const first = opts.resend && prev ? prev.first : windowId;
      grants.set(grantKey({ thread, member }), { thread, member, tid, first, last: windowId });
      return save(windowId);
    },
  };
}

/** On sign-out: the list says who was given which thread, so it goes with the keys. */
export function clearHandoffGrants(granterPk: string): void {
  try {
    localStorage.removeItem(PREFIX + granterPk);
  } catch {
    // Storage unavailable: nothing was kept.
  }
}
