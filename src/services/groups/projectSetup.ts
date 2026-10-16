/**
 * @fileoverview Finish a project that creation left half-made.
 *
 * Creation is three publishes that cannot be atomic (see createGroup). Within
 * one session a failure resumes from the PendingGroup; after a reload nothing
 * remembers it, and a project with a 39000 but no 39002 refuses every member
 * edit, correctly, because "no member list read" may be "the read missed it".
 *
 * The repair publishes an owner-only kind:39002. That REPLACES any member list
 * the owner already has, so from the client "half-made" and "the read missed
 * the real list" must be told apart, and only one rule does it: every one of
 * the owner's relays answered (EOSE) and none of them holds a 39002. A relay
 * that timed out, refused, or was not connected is "can't tell", which offers
 * nothing. A 39002 from ANY author blocks it: the cost of that is a missing
 * button, the cost of the opposite is a wiped member list.
 *
 * The repair publishes what creation would have published and nothing else,
 * through the same templates. The default 39001 is skipped when the owner's
 * own 39001 already landed, because publishing it would replace any admins
 * added since.
 */

import { signAndPublish, type SignerInterface, type RelayClient, type RelayProbe } from '../headless';
import { GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND } from '@/types/groups';
import { resolveOwnership } from './ownership';
import { creationAdminsTemplate, creationMembersTemplate } from './groupService';

export type ProjectSetupCheck =
  /** A member list exists on at least one relay: nothing to finish. */
  | { status: 'complete' }
  /** Every relay answered, none holds a member list, and the caller owns it. */
  | { status: 'unfinished'; needsAdmins: boolean }
  /** At least one relay did not answer, so a member list may exist unseen. */
  | { status: 'unchecked' }
  /** The caller is not the verifiable owner, or the project was not found. */
  | { status: 'not-owner' };

export async function checkProjectSetup(
  me: string,
  probe: RelayProbe,
  groupId: string,
): Promise<ProjectSetupCheck> {
  let answers;
  try {
    answers = await probe({
      kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND],
      '#d': [groupId],
    });
  } catch {
    return { status: 'unchecked' };
  }

  const events = answers.flatMap((a) => (a.status === 'answered' ? a.events : []));
  // A member list anywhere settles it, whichever relays failed.
  if (events.some((e) => e.kind === GROUP_MEMBERS_KIND)) return { status: 'complete' };

  if (answers.length === 0 || answers.some((a) => a.status === 'failed')) {
    return { status: 'unchecked' };
  }

  // Safe cast: resolveOwnership reads only pubkey, tags, created_at and id.
  const ownership = resolveOwnership(
    groupId,
    events.filter((e) => e.kind === GROUP_METADATA_KIND) as unknown as Parameters<typeof resolveOwnership>[1],
  );
  if (ownership.status !== 'owner' || ownership.ownerPubkey !== me) return { status: 'not-owner' };

  const ownerAdmins = events.some((e) => e.kind === GROUP_ADMINS_KIND && e.pubkey === me);
  return { status: 'unfinished', needsAdmins: !ownerAdmins };
}

/**
 * Check again, then publish the missing creation steps. The check is repeated
 * here rather than trusted from when the button appeared, because a member
 * list can arrive, or a relay drop, in between.
 */
export async function finishProjectSetup(
  signer: SignerInterface,
  relay: RelayClient,
  probe: RelayProbe,
  groupId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await signer.getPublicKey();
  const check = await checkProjectSetup(me, probe, groupId);

  if (check.status === 'complete') {
    return { ok: false, reason: 'This project already has a member list, so nothing was changed. Reload to see it.' };
  }
  if (check.status === 'unchecked') {
    return { ok: false, reason: "Not all of your relays answered, so the project can't be checked right now. Nothing was changed." };
  }
  if (check.status === 'not-owner') {
    return { ok: false, reason: 'Only the project owner can finish setting it up. Nothing was changed.' };
  }

  if (check.needsAdmins) await signAndPublish(signer, relay, creationAdminsTemplate(groupId, me));
  await signAndPublish(signer, relay, creationMembersTemplate(groupId, me));
  return { ok: true };
}
