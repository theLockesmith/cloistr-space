/**
 * A create that fails partway must be finished, not repeated: submitting again
 * passes the same PendingGroup back, so the retry completes the first group
 * instead of minting a second one beside it. groupService.test.ts proves the
 * service resumes; this proves the form actually hands it the same group.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingGroup } from '@/services/groups/groupService';

const beginGroupCreation = vi.fn();
const createGroup = vi.fn();

vi.mock('@/services/groups/useGroupActions', () => ({
  useGroupActions: () => ({ beginGroupCreation, createGroup, canAct: true }),
}));

vi.mock('@/components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const { CreateGroupModal } = await import('./CreateGroupModal');

function pendingGroup(identifier: string): PendingGroup {
  return { identifier, owner: 'aa'.repeat(32), published: new Set() };
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Create Group' }));
}

beforeEach(() => {
  beginGroupCreation.mockReset();
  createGroup.mockReset();
});

describe('CreateGroupModal', () => {
  it('a retry after a partial failure finishes the same group', async () => {
    const user = userEvent.setup();
    const pending = pendingGroup('first');
    beginGroupCreation.mockResolvedValueOnce(pending).mockResolvedValueOnce(pendingGroup('second'));
    createGroup
      .mockImplementationOnce(async (_opts: unknown, p: PendingGroup) => {
        p.published.add('metadata');
        throw new Error('No relay accepted it.');
      })
      .mockResolvedValueOnce('first');
    const onGroupCreated = vi.fn();

    render(<CreateGroupModal isOpen onClose={vi.fn()} onGroupCreated={onGroupCreated} />);
    await user.type(screen.getByLabelText(/name/i), 'Test Group');

    await submit(user);
    expect(await screen.findByText(/partly created; submit again with the same name to finish it/)).toBeTruthy();

    await submit(user);
    await waitFor(() => expect(onGroupCreated).toHaveBeenCalledWith('first'));

    expect(beginGroupCreation).toHaveBeenCalledTimes(1);
    expect(createGroup).toHaveBeenCalledTimes(2);
    expect(createGroup.mock.calls[1][1]).toBe(pending);
  });

  it('after closing a partly made group, a different name starts a new group, not the old one', async () => {
    const user = userEvent.setup();
    const first = pendingGroup('first');
    const second = pendingGroup('second');
    beginGroupCreation.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    createGroup
      .mockImplementationOnce(async (_opts: unknown, p: PendingGroup) => {
        p.published.add('metadata');
        throw new Error('No relay accepted it.');
      })
      .mockResolvedValueOnce('second');
    const onGroupCreated = vi.fn();

    const { rerender } = render(<CreateGroupModal isOpen onClose={vi.fn()} onGroupCreated={onGroupCreated} />);
    await user.type(screen.getByLabelText(/name/i), 'Group A');
    await submit(user);
    await screen.findByText(/partly created/);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    rerender(<CreateGroupModal isOpen={false} onClose={vi.fn()} onGroupCreated={onGroupCreated} />);
    rerender(<CreateGroupModal isOpen onClose={vi.fn()} onGroupCreated={onGroupCreated} />);

    await user.type(screen.getByLabelText(/name/i), 'Group B');
    await submit(user);
    await waitFor(() => expect(onGroupCreated).toHaveBeenCalledWith('second'));
    expect(createGroup.mock.calls[1][1]).toBe(second);
  });

  it('after closing a partly made group, the same name finishes it', async () => {
    const user = userEvent.setup();
    const first = pendingGroup('first');
    beginGroupCreation.mockResolvedValueOnce(first).mockResolvedValueOnce(pendingGroup('second'));
    createGroup
      .mockImplementationOnce(async (_opts: unknown, p: PendingGroup) => {
        p.published.add('metadata');
        throw new Error('No relay accepted it.');
      })
      .mockResolvedValueOnce('first');
    const onGroupCreated = vi.fn();

    const { rerender } = render(<CreateGroupModal isOpen onClose={vi.fn()} onGroupCreated={onGroupCreated} />);
    await user.type(screen.getByLabelText(/name/i), 'Group A');
    await submit(user);
    await screen.findByText(/partly created/);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    rerender(<CreateGroupModal isOpen={false} onClose={vi.fn()} onGroupCreated={onGroupCreated} />);
    rerender(<CreateGroupModal isOpen onClose={vi.fn()} onGroupCreated={onGroupCreated} />);

    await user.type(screen.getByLabelText(/name/i), 'Group A');
    await submit(user);
    await waitFor(() => expect(onGroupCreated).toHaveBeenCalledWith('first'));
    expect(createGroup.mock.calls[1][1]).toBe(first);
  });

  it('starts a fresh group after a successful create', async () => {
    const user = userEvent.setup();
    beginGroupCreation.mockResolvedValueOnce(pendingGroup('first')).mockResolvedValueOnce(pendingGroup('second'));
    createGroup.mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const onGroupCreated = vi.fn();

    render(<CreateGroupModal isOpen onClose={vi.fn()} onGroupCreated={onGroupCreated} />);
    await user.type(screen.getByLabelText(/name/i), 'One');
    await submit(user);
    await waitFor(() => expect(onGroupCreated).toHaveBeenCalledWith('first'));

    await user.type(screen.getByLabelText(/name/i), 'Two');
    await submit(user);
    await waitFor(() => expect(onGroupCreated).toHaveBeenCalledWith('second'));

    expect(beginGroupCreation).toHaveBeenCalledTimes(2);
  });
});
