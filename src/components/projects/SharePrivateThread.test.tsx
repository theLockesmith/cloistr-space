import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { ThreadKeyStore } from '@/services/threads/threadKeyStore';
import { SharePrivateThread } from './SharePrivateThread';
import type { GroupMember } from '@/services/groups/useGroupMembers';

const store = new ThreadKeyStore();
vi.mock('@/services/threads/useThreadKeyStore', () => ({ useThreadKeyStore: () => store }));

const grant = vi.hoisted(() => ({ canGrant: true, grantKey: vi.fn() }));
vi.mock('@/services/threads/useThreadKeyGrant', () => ({ useThreadKeyGrant: () => grant }));

const me = 'a'.repeat(64);
const alice = 'b'.repeat(64);
const members = [
  { pubkey: me, isAdmin: true },
  { pubkey: alice, isAdmin: false },
] as GroupMember[];
const nameOf = (pk: string) => (pk === alice ? 'Alice' : 'Me');

const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);

beforeEach(() => {
  store.clear();
  grant.canGrant = true;
  grant.grantKey = vi.fn().mockResolvedValue(undefined);
});

describe('SharePrivateThread', () => {
  it('sends the chosen thread’s key to the chosen member and says when they get it', async () => {
    store.set(threadPk, threadSk);
    store.setName(threadPk, 'team-thread');
    render(<SharePrivateThread members={members} myPubkey={me} nameOf={nameOf} />);

    await userEvent.selectOptions(screen.getByLabelText('Thread'), 'team-thread');
    await userEvent.selectOptions(screen.getByLabelText('Member'), 'Alice');
    // Only other members are offered.
    expect(screen.queryByRole('option', { name: 'Me' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send key' }));

    expect(grant.grantKey).toHaveBeenCalledWith(threadPk, alice);
    expect(await screen.findByRole('status')).toHaveTextContent(/Alice gets the key the next time they open Threads/);
  });

  it('shows the reason when the key was not sent', async () => {
    store.set(threadPk, threadSk);
    store.setName(threadPk, 'team-thread');
    grant.grantKey = vi.fn().mockRejectedValue(new Error('The signer could not work out the hand-off mailbox, so the hand-off was not sent.'));
    render(<SharePrivateThread members={members} myPubkey={me} nameOf={nameOf} />);

    await userEvent.selectOptions(screen.getByLabelText('Thread'), 'team-thread');
    await userEvent.selectOptions(screen.getByLabelText('Member'), 'Alice');
    await userEvent.click(screen.getByRole('button', { name: 'Send key' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not work out the hand-off mailbox/);
  });

  it('a thread restored after first render appears in the list', async () => {
    render(<SharePrivateThread members={members} myPubkey={me} nameOf={nameOf} />);
    expect(screen.queryByText('Share a private thread')).toBeNull();

    store.set(threadPk, threadSk);
    store.setName(threadPk, 'team-thread');

    expect(await screen.findByRole('option', { name: 'team-thread' })).toBeInTheDocument();
  });

  it('with an extension sign-in, says sharing needs the signer instead of offering a dead button', () => {
    store.set(threadPk, threadSk);
    store.setName(threadPk, 'team-thread');
    grant.canGrant = false;
    render(<SharePrivateThread members={members} myPubkey={me} nameOf={nameOf} />);

    expect(screen.getByText(/needs sign-in through the Cloistr signer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send key' })).toBeNull();
  });
});
