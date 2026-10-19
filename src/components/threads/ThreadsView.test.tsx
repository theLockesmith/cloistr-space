/**
 * @fileoverview Tests for sealed thread indicators in ThreadsView.
 *
 * ThreadsView is the cross-group thread listing. These tests verify that
 * sealed threads show a lock emoji and hide ciphertext from the preview.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

let allThreadFixtures: ReturnType<typeof makeThreadWithGroup>[] = [];
let groupFixtures: { id: string; name: string }[] = [];
let standaloneFixtures: import('@/services/threads').StandaloneThread[] = [];

vi.mock('@/services/threads', () => ({
  useAllThreads: () => ({
    threads: allThreadFixtures,
    groups: groupFixtures,
    allAdminPubkeys: [],
    standalone: standaloneFixtures,
    isLoading: false,
    error: null,
  }),
  useThreads: () => ({
    threads: [],
    isLoading: false,
    error: null,
    createThread: vi.fn(),
    reply: vi.fn(),
    refresh: vi.fn(),
  }),
  useThreadKeyStore: () => new Map(),
  useThreadKeyLoader: () => ({ loaded: true, keyCount: 0 }),
  useBucketReader: () => ({
    messages: [],
    handoffs: [],
    pendingHandoffs: [],
    acceptHandoff: vi.fn(),
    dismissHandoff: vi.fn(),
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
  useBucketWriter: () => ({ sendMessage: vi.fn(), canPublish: false }),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ signer: null }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: 'aabbcc' }),
}));

vi.mock('@/services/groups/useGroupMembers', () => ({
  useGroupMembers: () => ({ members: [], isLoading: false, error: null, unverifiable: false, refresh: vi.fn() }),
}));

vi.mock('@/services/profile', () => ({
  useAuthorProfiles: () => new Map(),
}));

vi.mock('@/config/environment', () => ({
  config: {
    threadGranters: ['3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4'],
  },
}));

const { ThreadsView } = await import('./ThreadsView');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_CIPHERTEXT =
  'AjVFteIntVbdTFXdTNjkF3rhMN6by0ncWMOLabcdefghijk';

function makeThreadWithGroup(opts: {
  id: string;
  content: string;
  subject?: string;
  sealed?: boolean;
  groupId: string;
  groupName: string;
}) {
  return {
    thread: {
      root: {
        id: opts.id,
        pubkey: 'b'.repeat(64),
        groupId: opts.groupId,
        content: opts.content,
        createdAt: Math.floor(Date.now() / 1000),
        subject: opts.subject,
        sealed: opts.sealed,
      },
      replies: [],
      replyCount: 0,
      lastActivity: Math.floor(Date.now() / 1000),
    },
    groupId: opts.groupId,
    groupName: opts.groupName,
  };
}

beforeEach(() => {
  allThreadFixtures = [];
  groupFixtures = [];
  standaloneFixtures = [];
  mockNavigate.mockReset();
});

// ---------------------------------------------------------------------------
// Cross-group listing sealed indicators
// ---------------------------------------------------------------------------

describe('ThreadsView sealed messages section', () => {
  it('renders SealedMessages on the top-level Threads page without requiring a group', () => {
    groupFixtures = [];
    allThreadFixtures = [];

    render(<ThreadsView />);

    expect(screen.getByText('Sealed Messages')).toBeInTheDocument();
  });
});

describe('ThreadsView sealed indicators', () => {
  it('shows lock emoji on sealed threads', () => {
    groupFixtures = [{ id: 'devs', name: 'Developers' }];
    allThreadFixtures = [
      makeThreadWithGroup({
        id: 'sealed-xgroup',
        content: 'Decrypted content',
        subject: 'Private discussion',
        sealed: true,
        groupId: 'devs',
        groupName: 'Developers',
      }),
    ];

    render(<ThreadsView />);

    expect(screen.getByTitle('Encrypted thread')).toBeInTheDocument();
    expect(screen.getByText('Private discussion')).toBeInTheDocument();
  });

  it('shows "Encrypted thread" when sealed and content is ciphertext with no subject', () => {
    groupFixtures = [{ id: 'devs', name: 'Developers' }];
    allThreadFixtures = [
      makeThreadWithGroup({
        id: 'sealed-no-subject',
        content: FAKE_CIPHERTEXT,
        sealed: true,
        groupId: 'devs',
        groupName: 'Developers',
      }),
    ];

    render(<ThreadsView />);

    expect(screen.getByText('Encrypted thread')).toBeInTheDocument();
    expect(screen.queryByText(FAKE_CIPHERTEXT)).not.toBeInTheDocument();
  });

  it('shows subject when sealed with ciphertext body but subject exists', () => {
    groupFixtures = [{ id: 'devs', name: 'Developers' }];
    allThreadFixtures = [
      makeThreadWithGroup({
        id: 'sealed-with-subject',
        content: FAKE_CIPHERTEXT,
        subject: 'Sprint retro',
        sealed: true,
        groupId: 'devs',
        groupName: 'Developers',
      }),
    ];

    render(<ThreadsView />);

    expect(screen.getByText('Sprint retro')).toBeInTheDocument();
    expect(screen.queryByText(FAKE_CIPHERTEXT)).not.toBeInTheDocument();
  });

  it('shows normal preview for unsealed threads', () => {
    groupFixtures = [{ id: 'devs', name: 'Developers' }];
    allThreadFixtures = [
      makeThreadWithGroup({
        id: 'plain-xgroup',
        content: 'Lunch plans for Friday',
        groupId: 'devs',
        groupName: 'Developers',
      }),
    ];

    render(<ThreadsView />);

    expect(screen.getByText(/Lunch plans for Friday/)).toBeInTheDocument();
    expect(screen.queryByTitle('Encrypted thread')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Standalone threads: no project, or a project the user is not in
// ---------------------------------------------------------------------------

function standaloneThread(over: Partial<import('@/services/threads').StandaloneThread> = {}) {
  const base = {
    threadKey: 'sealed:' + 'f'.repeat(64),
    title: 'cloistr-group-wrap',
    sealed: true,
    projectId: null,
    lastActivity: 1_790_000_200,
    messages: [
      { id: 'm1', pubkey: 'a'.repeat(64), createdAt: 1_790_000_100, threadKey: 'sealed:' + 'f'.repeat(64), title: 'cloistr-group-wrap', text: 'staging deploy is broken', from: 'cloistr-orchestrator', sealed: true, projectId: null },
      { id: 'm2', pubkey: 'b'.repeat(64), createdAt: 1_790_000_200, threadKey: 'sealed:' + 'f'.repeat(64), title: 'cloistr-group-wrap', text: 'fixed in !229', from: 'cloistr-space', sealed: true, projectId: null },
    ],
  };
  return { ...base, ...over };
}

describe('ThreadsView standalone threads', () => {
  it('lists a fleet thread with no project, and opens it in place', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    standaloneFixtures = [standaloneThread()];
    render(<ThreadsView />);

    const row = screen.getByRole('button', { name: /cloistr-group-wrap/ });
    expect(row).toHaveTextContent('No project');
    expect(row).toHaveTextContent('2 messages');
    expect(screen.queryByText('staging deploy is broken')).not.toBeInTheDocument();

    await userEvent.click(row);
    expect(screen.getByText('staging deploy is broken')).toBeInTheDocument();
    expect(screen.getByText('fixed in !229')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not say "not in any projects" when standalone threads exist', () => {
    standaloneFixtures = [standaloneThread()];
    render(<ThreadsView />);
    expect(screen.queryByText(/not in any projects/)).not.toBeInTheDocument();
    expect(screen.getByText('cloistr-group-wrap')).toBeInTheDocument();
  });

  it('the project is a filter chip, and filters both kinds of thread', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    groupFixtures = [{ id: 'devs', name: 'Developers' }];
    allThreadFixtures = [makeThreadWithGroup({ id: 'p1', groupId: 'devs', groupName: 'Developers', content: 'Release checklist' })];
    standaloneFixtures = [standaloneThread(), standaloneThread({ threadKey: 'sealed:' + 'e'.repeat(64), title: 'conscience thread', projectId: 'conscience-g' })];
    render(<ThreadsView />);

    const chips = screen.getByRole('group', { name: 'Filter by project' });
    expect(chips).toHaveTextContent('All');
    expect(chips).toHaveTextContent('Developers');
    expect(chips).toHaveTextContent('conscience-g');
    expect(chips).toHaveTextContent('No project');

    await userEvent.click(screen.getByRole('button', { name: 'No project' }));
    expect(screen.getByText('cloistr-group-wrap')).toBeInTheDocument();
    expect(screen.queryByText('conscience thread')).not.toBeInTheDocument();
    expect(screen.queryByText(/Release checklist/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Developers' }));
    expect(screen.getByText(/Release checklist/)).toBeInTheDocument();
    expect(screen.queryByText('cloistr-group-wrap')).not.toBeInTheDocument();
  });
});

