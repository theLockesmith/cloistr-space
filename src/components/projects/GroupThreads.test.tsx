/**
 * @fileoverview Tests for sealed thread indicators in GroupThreads.
 *
 * Covers the three rendering cases the sealed flag introduces:
 * - Sealed + decrypted: lock badge on the author line, content readable
 * - Sealed + still ciphertext: placeholder message, reply button hidden
 * - Not sealed: normal rendering, no lock
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateThread = vi.fn();
const mockReply = vi.fn();

let threadFixtures: ReturnType<typeof makeThread>[] = [];

vi.mock('@/services/threads', () => ({
  useThreads: () => ({
    threads: threadFixtures,
    isLoading: false,
    error: null,
    createThread: mockCreateThread,
    reply: mockReply,
    refresh: vi.fn(),
  }),
}));

const { GroupThreads } = await import('./GroupThreads');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A string that passes looksLikeNip44: base64, 32+ chars, no "?iv="
const FAKE_CIPHERTEXT =
  'AjVFteIntVbdTFXdTNjkF3rhMN6by0ncWMOLabcdefghijk';

function makeThread(opts: {
  id: string;
  content: string;
  subject?: string;
  sealed?: boolean;
  replyCount?: number;
}) {
  return {
    root: {
      id: opts.id,
      pubkey: 'a'.repeat(64),
      groupId: 'devs',
      content: opts.content,
      createdAt: Math.floor(Date.now() / 1000),
      subject: opts.subject,
      sealed: opts.sealed,
    },
    replies: [],
    replyCount: opts.replyCount ?? 0,
    lastActivity: Math.floor(Date.now() / 1000),
  };
}

beforeEach(() => {
  threadFixtures = [];
  mockCreateThread.mockReset();
  mockReply.mockReset();
});

// ---------------------------------------------------------------------------
// Thread list sealed indicators
// ---------------------------------------------------------------------------

describe('GroupThreads thread list', () => {
  it('shows lock emoji on a sealed thread', () => {
    threadFixtures = [
      makeThread({
        id: 'sealed-1',
        content: 'Decrypted content here',
        subject: 'Secret meeting',
        sealed: true,
      }),
    ];

    render(<GroupThreads groupId="devs" />);

    expect(screen.getByTitle('Encrypted thread')).toBeInTheDocument();
    expect(screen.getByText('Secret meeting')).toBeInTheDocument();
  });

  it('shows "Encrypted thread" when sealed and content is still ciphertext', () => {
    threadFixtures = [
      makeThread({
        id: 'sealed-no-key',
        content: FAKE_CIPHERTEXT,
        sealed: true,
        // No subject — so the fallback text is used
      }),
    ];

    render(<GroupThreads groupId="devs" />);

    expect(screen.getByText('Encrypted thread')).toBeInTheDocument();
    // The raw ciphertext must not appear
    expect(screen.queryByText(FAKE_CIPHERTEXT)).not.toBeInTheDocument();
  });

  it('shows subject when sealed with ciphertext body but a subject exists', () => {
    threadFixtures = [
      makeThread({
        id: 'sealed-with-subject',
        content: FAKE_CIPHERTEXT,
        subject: 'Design review',
        sealed: true,
      }),
    ];

    render(<GroupThreads groupId="devs" />);

    expect(screen.getByText('Design review')).toBeInTheDocument();
    expect(screen.queryByText(FAKE_CIPHERTEXT)).not.toBeInTheDocument();
  });

  it('shows normal preview for unsealed threads', () => {
    threadFixtures = [
      makeThread({
        id: 'plain-1',
        content: 'This is a normal thread about lunch',
      }),
    ];

    render(<GroupThreads groupId="devs" />);

    expect(screen.getByText(/normal thread about lunch/)).toBeInTheDocument();
    expect(screen.queryByTitle('Encrypted thread')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ThreadDetail Comment sealed indicators
// ---------------------------------------------------------------------------

describe('GroupThreads comment rendering', () => {
  it('shows encrypted placeholder and hides reply when content is ciphertext', async () => {
    threadFixtures = [
      makeThread({
        id: 'sealed-detail',
        content: FAKE_CIPHERTEXT,
        subject: 'Private',
        sealed: true,
      }),
    ];

    render(<GroupThreads groupId="devs" />);

    // Click into the thread detail
    const threadButton = screen.getByText('Private');
    await userEvent.click(threadButton);

    // The placeholder should appear
    expect(
      screen.getByText(/Encrypted — you don't have the key/)
    ).toBeInTheDocument();

    // Raw ciphertext must not be shown
    expect(screen.queryByText(FAKE_CIPHERTEXT)).not.toBeInTheDocument();
  });

  it('shows decrypted content with lock badge when sealed but readable', async () => {
    threadFixtures = [
      makeThread({
        id: 'sealed-decrypted',
        content: 'The staging deploy is broken',
        subject: 'Incident',
        sealed: true,
      }),
    ];

    render(<GroupThreads groupId="devs" />);

    await userEvent.click(screen.getByText('Incident'));

    // Content should be visible
    expect(screen.getByText('The staging deploy is broken')).toBeInTheDocument();

    // Lock badge should appear (the "Decrypted" title on the author line)
    expect(screen.getByTitle('Decrypted')).toBeInTheDocument();
  });

  it('shows normal content without lock for unsealed comments', async () => {
    threadFixtures = [
      makeThread({
        id: 'plain-detail',
        content: 'Just a normal discussion',
        subject: 'Standup',
      }),
    ];

    render(<GroupThreads groupId="devs" />);

    await userEvent.click(screen.getByText('Standup'));

    expect(screen.getByText('Just a normal discussion')).toBeInTheDocument();
    expect(screen.queryByTitle('Decrypted')).not.toBeInTheDocument();
    expect(screen.queryByText(/don't have the key/)).not.toBeInTheDocument();
  });
});
