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

vi.mock('@/services/threads', () => ({
  useAllThreads: () => ({
    threads: allThreadFixtures,
    groups: groupFixtures,
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
  mockNavigate.mockReset();
});

// ---------------------------------------------------------------------------
// Cross-group listing sealed indicators
// ---------------------------------------------------------------------------

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
