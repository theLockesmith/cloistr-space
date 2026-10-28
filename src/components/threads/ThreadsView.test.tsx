/**
 * @fileoverview The one thread list and its two detail screens (threads.md 6).
 *
 * Also the new home of what the Sealed tab guaranteed: key offers asked about
 * before being taken, sealed senders shown as unverified keys, and a failed
 * send that keeps the text and says why.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { PublicThreadItem, StandaloneThread } from '@/services/threads';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const THREAD_PK = 'c'.repeat(64);

let publicFixtures: PublicThreadItem[] = [];
let privateFixtures: StandaloneThread[] = [];
let groupFixtures: { id: string; name: string }[] = [];
let reader = makeReader();

const createPublicThread = vi.fn();
const replyToPublicThread = vi.fn();
const archivePublicThread = vi.fn();
const sendMessage = vi.fn();
const fakeSigner = { getPublicKey: async () => ME };
const fakeRelay = {};

function makeReader(over: Record<string, unknown> = {}) {
  return {
    messages: [],
    handoffs: [],
    pendingHandoffs: [] as { wrapId: string; granterPubkey: string }[],
    acceptHandoff: vi.fn(),
    dismissHandoff: vi.fn(),
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    debug: {},
    ...over,
  };
}

vi.mock('@/services/threads', async () => {
  const list = await vi.importActual<typeof import('@/services/threads/publicThreadList')>(
    '@/services/threads/publicThreadList',
  );
  return {
    useAllThreads: () => ({
      publicThreads: publicFixtures,
      privateThreads: privateFixtures,
      groups: groupFixtures,
      allAdminPubkeys: [],
      sealedReader: reader,
      isLoading: false,
      error: null,
    }),
    matchesSearch: list.matchesSearch,
    createPublicThread: (...a: unknown[]) => createPublicThread(...a),
    replyToPublicThread: (...a: unknown[]) => replyToPublicThread(...a),
    archivePublicThread: (...a: unknown[]) => archivePublicThread(...a),
    useThreadKeyStore: () => ({ exportHex: (pk: string) => (pk === THREAD_PK ? 'd'.repeat(64) : undefined) }),
    useBucketWriter: () => ({ sendMessage, canPublish: true }),
  };
});

vi.mock('@/services/nostr', () => ({
  useHeadlessAdapters: () => ({ signer: fakeSigner, relay: fakeRelay }),
}));

vi.mock('@/services/threads/pendingKeyOffers', () => ({
  usePendingKeyWraps: () => pendingKeyWraps,
  acceptKeyWrap: vi.fn(() => true),
  dismissKeyWrap: vi.fn(),
}));
let pendingKeyWraps: { eventId: string; senderPubkey: string }[] = [];

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ signer: null }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: ME }),
}));

const { ThreadsView } = await import('./ThreadsView');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pub(opts: {
  id: string;
  title: string;
  at: number;
  author?: string;
  groupId?: string | null;
  archived?: boolean;
  hidden?: number;
  replies?: { id: string; content: string; at: number }[];
}): PublicThreadItem {
  const groupId = opts.groupId ?? null;
  const author = opts.author ?? OTHER;
  const replies = (opts.replies ?? []).map((r) => ({
    id: r.id,
    pubkey: OTHER,
    groupId: groupId ?? '',
    content: r.content,
    createdAt: r.at,
    rootId: opts.id,
    parentId: opts.id,
    replies: [],
    depth: 1,
  }));
  return {
    thread: {
      root: { id: opts.id, pubkey: author, groupId: groupId ?? '', content: `body of ${opts.title}`, createdAt: opts.at, subject: opts.title },
      replies,
      replyCount: replies.length,
      lastActivity: opts.at,
      status: opts.archived ? 'archived' : 'open',
      hiddenLaterReplies: opts.hidden ?? 0,
    },
    groupId,
    rootKind: 11,
  } as PublicThreadItem;
}

function priv(opts: { title: string; at: number; text?: string; approx?: boolean; projectId?: string | null }): StandaloneThread {
  const msg = {
    id: `m-${opts.title}`,
    pubkey: OTHER,
    createdAt: opts.at,
    approxTime: opts.approx,
    threadKey: `sealed:${THREAD_PK}`,
    title: opts.title,
    text: opts.text ?? 'sealed hello',
    from: 'cloistr-orchestrator',
    sealed: true,
    projectId: opts.projectId ?? null,
  };
  return {
    threadKey: `sealed:${THREAD_PK}`,
    title: opts.title,
    sealed: true,
    projectId: opts.projectId ?? null,
    messages: [msg],
    lastActivity: opts.at,
    lastActivityApprox: opts.approx === true,
  };
}

const rowTitles = () =>
  within(screen.getByRole('list', { name: 'Threads' }))
    .getAllByRole('button')
    .map((b) => b.textContent ?? '');

beforeEach(() => {
  publicFixtures = [];
  privateFixtures = [];
  groupFixtures = [];
  pendingKeyWraps = [];
  reader = makeReader();
  createPublicThread.mockReset();
  replyToPublicThread.mockReset();
  archivePublicThread.mockReset();
  sendMessage.mockReset();
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe('ThreadsView list', () => {
  it('interleaves public and private threads by last activity, with a lock on private ones only', () => {
    publicFixtures = [pub({ id: 'p1', title: 'Oldest public', at: 100 }), pub({ id: 'p2', title: 'Newest public', at: 300 })];
    privateFixtures = [priv({ title: 'Middle private', at: 200 })];
    render(<ThreadsView />);

    const rows = rowTitles();
    expect(rows[0]).toContain('Newest public');
    expect(rows[1]).toContain('Middle private');
    expect(rows[2]).toContain('Oldest public');
    expect(screen.getAllByLabelText('Private thread')).toHaveLength(1);
    expect(rows[1]).toContain('🔒');
    expect(rows[0]).not.toContain('🔒');
  });

  it('keeps archived threads out of the active list, under Archived, and in search', () => {
    publicFixtures = [pub({ id: 'p1', title: 'Live topic', at: 100 }), pub({ id: 'p2', title: 'Old decision', at: 200, archived: true })];
    render(<ThreadsView />);

    expect(rowTitles().join()).not.toContain('Old decision');
    fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    expect(rowTitles()).toHaveLength(1);
    expect(rowTitles()[0]).toContain('Old decision');

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: 'decision' } });
    expect(rowTitles()[0]).toContain('Old decision');
  });

  it('searches the text of private messages as well as public posts', () => {
    publicFixtures = [pub({ id: 'p1', title: 'Unrelated', at: 100 })];
    privateFixtures = [priv({ title: 'Fleet', at: 200, text: 'the relay migration is done' })];
    render(<ThreadsView />);

    fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: 'migration' } });
    expect(rowTitles()).toHaveLength(1);
    expect(rowTitles()[0]).toContain('Fleet');
  });

  it('says which empty it is when a search finds nothing', () => {
    publicFixtures = [pub({ id: 'p1', title: 'Something', at: 100 })];
    render(<ThreadsView />);
    fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: 'zzz' } });
    expect(screen.getByText('No threads match “zzz”.')).toBeInTheDocument();
  });

  it('says there are no threads yet, rather than showing a blank panel', () => {
    render(<ThreadsView />);
    expect(screen.getByText('No threads yet. Start one in a project, or on its own.')).toBeInTheDocument();
  });

  it('does not say "no threads yet" when it could not look for private threads', () => {
    reader = makeReader({ handoffLookupUnavailable: true });
    render(<ThreadsView />);
    expect(screen.queryByText('No threads yet. Start one in a project, or on its own.')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('could not look for private threads');
  });

  it('the project is a filter chip, and filters both kinds of thread', () => {
    groupFixtures = [{ id: 'g1', name: 'Garden' }];
    publicFixtures = [pub({ id: 'p1', title: 'In the garden', at: 100, groupId: 'g1' })];
    privateFixtures = [priv({ title: 'Fleet', at: 200 })];
    render(<ThreadsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Garden' }));
    expect(rowTitles()).toHaveLength(1);
    expect(rowTitles()[0]).toContain('In the garden');
    fireEvent.click(screen.getByRole('button', { name: 'No project' }));
    expect(rowTitles()[0]).toContain('Fleet');
  });

  it("as a project's tab, shows only that project's threads and no project chips", () => {
    groupFixtures = [{ id: 'g1', name: 'Garden' }, { id: 'g2', name: 'Kitchen' }];
    publicFixtures = [
      pub({ id: 'p1', title: 'In the garden', at: 100, groupId: 'g1' }),
      pub({ id: 'p2', title: 'In the kitchen', at: 200, groupId: 'g2' }),
    ];
    render(<ThreadsView groupId="g1" />);

    expect(rowTitles()).toHaveLength(1);
    expect(rowTitles()[0]).toContain('In the garden');
    expect(screen.queryByRole('group', { name: 'Filter by project' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// New thread
// ---------------------------------------------------------------------------

describe('ThreadsView new thread', () => {
  it('will not post until a project (or no project) is chosen, then says it is public', async () => {
    groupFixtures = [{ id: 'g1', name: 'Garden' }, { id: 'g2', name: 'Kitchen' }];
    createPublicThread.mockResolvedValue({ accepted: 1 });
    render(<ThreadsView />);

    fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Seeds' } });
    expect(screen.getByRole('button', { name: 'Post thread' })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__none__' } });
    expect(screen.getByText(/Public: anyone can read it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Post thread' }));

    await waitFor(() => expect(createPublicThread).toHaveBeenCalledTimes(1));
    expect(createPublicThread.mock.calls[0][2]).toEqual({ title: 'Seeds', body: '', groupId: undefined });
  });

  it("in a project's tab, posts into that project without asking", async () => {
    groupFixtures = [{ id: 'g1', name: 'Garden' }, { id: 'g2', name: 'Kitchen' }];
    createPublicThread.mockResolvedValue({ accepted: 1 });
    render(<ThreadsView groupId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Seeds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post thread' }));

    await waitFor(() => expect(createPublicThread).toHaveBeenCalledTimes(1));
    expect(createPublicThread.mock.calls[0][2]).toMatchObject({ groupId: 'g1' });
  });
});

// ---------------------------------------------------------------------------
// Public thread detail
// ---------------------------------------------------------------------------

describe('ThreadsView public thread', () => {
  it('replies with the root kind and project, and keeps the text when the relay refuses', async () => {
    publicFixtures = [pub({ id: 'p1', title: 'Topic', at: 100, groupId: 'g1' })];
    replyToPublicThread.mockRejectedValue(new Error('No relay accepted the event'));
    render(<ThreadsView />);

    fireEvent.click(screen.getByText('Topic'));
    fireEvent.change(screen.getByLabelText('Reply…'), { target: { value: 'my answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('No relay accepted the event')).toBeInTheDocument();
    expect(screen.getByLabelText('Reply…')).toHaveValue('my answer');
    expect(replyToPublicThread.mock.calls[0][2]).toMatchObject({
      rootId: 'p1',
      rootKind: 11,
      parentId: 'p1',
      groupId: 'g1',
    });
  });

  it('offers archive to the owner only after saying it is read-only, searchable and permanent', async () => {
    publicFixtures = [pub({ id: 'p1', title: 'Mine', at: 100, author: ME })];
    archivePublicThread.mockResolvedValue({ accepted: 1 });
    render(<ThreadsView />);

    fireEvent.click(screen.getByText('Mine'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive thread' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('read-only');
    expect(dialog).toHaveTextContent('searchable');
    expect(dialog).toHaveTextContent('cannot be deleted');
    expect(archivePublicThread).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archivePublicThread).toHaveBeenCalledTimes(1));
    expect(archivePublicThread.mock.calls[0][2]).toMatchObject({ id: 'p1', pubkey: ME });
  });

  it('offers no archive on a thread someone else started', () => {
    publicFixtures = [pub({ id: 'p1', title: 'Theirs', at: 100 })];
    render(<ThreadsView />);
    fireEvent.click(screen.getByText('Theirs'));
    expect(screen.queryByRole('button', { name: 'Archive thread' })).not.toBeInTheDocument();
  });

  it('an archived thread is read-only and says how many later replies it hides', () => {
    publicFixtures = [
      pub({ id: 'p1', title: 'Closed', at: 100, archived: true, hidden: 2, replies: [{ id: 'r1', content: 'before the archive', at: 90 }] }),
    ];
    render(<ThreadsView />);
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
    fireEvent.click(screen.getByText('Closed'));

    expect(screen.getByText('before the archive')).toBeInTheDocument();
    expect(screen.getByText(/2 later replies hidden/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Private thread detail: what the Sealed tab used to guarantee
// ---------------------------------------------------------------------------

describe('ThreadsView private thread', () => {
  it('shows the sender as an unverified key, never the name the message claims', () => {
    privateFixtures = [priv({ title: 'Fleet', at: 200, text: 'status green' })];
    render(<ThreadsView />);
    fireEvent.click(screen.getByText('Fleet'));

    expect(screen.getByText('status green')).toBeInTheDocument();
    expect(screen.getByText('unverified')).toBeInTheDocument();
    expect(screen.queryByText(/cloistr-orchestrator/)).not.toBeInTheDocument();
  });

  it('shows only the day for a message whose exact time is unknown', () => {
    privateFixtures = [priv({ title: 'Fleet', at: 1_700_000_000, approx: true })];
    render(<ThreadsView />);
    fireEvent.click(screen.getByText('Fleet'));

    const approx = screen.getAllByTitle('Exact time not recorded by the sender');
    expect(approx.length).toBeGreaterThan(0);
    expect(approx[0].textContent).toBe(`~${new Date(1_700_000_000 * 1000).toLocaleDateString()}`);
  });

  it('nests a reply under the message it answers', () => {
    const base = priv({ title: 'Fleet', at: 200 });
    const parent = { ...base.messages[0], id: 'w-parent', rumorId: 'a'.repeat(64), text: 'question', createdAt: 200 };
    const other = { ...base.messages[0], id: 'w-other', rumorId: 'c'.repeat(64), text: 'unrelated', createdAt: 250 };
    const child = { ...base.messages[0], id: 'w-child', rumorId: 'b'.repeat(64), parentId: 'a'.repeat(64), text: 'answer', createdAt: 300 };
    privateFixtures = [{ ...base, messages: [parent, other, child] }];
    render(<ThreadsView />);
    fireEvent.click(screen.getByText('Fleet'));

    const indent = (text: string) => (screen.getByText(text).closest('[style]') as HTMLElement | null)?.style.marginLeft;
    expect(indent('question')).toBe('0px');
    expect(indent('answer')).toBe('16px');
    expect(indent('unrelated')).toBe('0px');
    // The answer is drawn right under its question, ahead of a later top-level message.
    const order = ['question', 'answer', 'unrelated'].map((t) => screen.getByText(t));
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("replies sealed to that thread's own key", async () => {
    privateFixtures = [priv({ title: 'Fleet', at: 200 })];
    sendMessage.mockResolvedValue(undefined);
    render(<ThreadsView />);
    fireEvent.click(screen.getByText('Fleet'));

    fireEvent.change(screen.getByLabelText('Sealed reply…'), { target: { value: 'ack' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('ack', ME, 'd'.repeat(64)));
  });

  it('shows the relay’s reason when a send fails, and keeps the text', async () => {
    privateFixtures = [priv({ title: 'Fleet', at: 200 })];
    sendMessage.mockRejectedValue(new Error('rate-limited: slow down'));
    render(<ThreadsView />);
    fireEvent.click(screen.getByText('Fleet'));

    fireEvent.change(screen.getByLabelText('Sealed reply…'), { target: { value: 'ack' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('rate-limited: slow down')).toBeInTheDocument();
    expect(screen.getByLabelText('Sealed reply…')).toHaveValue('ack');
  });
});

// ---------------------------------------------------------------------------
// Key offers
// ---------------------------------------------------------------------------

describe('ThreadsView key offers', () => {
  it('asks before taking a handed-off key, and says the sender cannot be verified', () => {
    reader = makeReader({ pendingHandoffs: [{ wrapId: 'w1', granterPubkey: OTHER }] });
    render(<ThreadsView />);

    const offer = screen.getByRole('alert');
    expect(offer).toHaveTextContent('Unverified invitation');
    expect(offer).toHaveTextContent('claimed, unverified');
    expect(offer).toHaveTextContent('Space cannot check it');
    expect(reader.acceptHandoff).not.toHaveBeenCalled();
    fireEvent.click(within(offer).getByRole('button', { name: 'Accept key' }));
    expect(reader.acceptHandoff).toHaveBeenCalledWith('w1');
  });

  it("shows a stranger's key-wrap as an offer from a sender Space does not trust", () => {
    pendingKeyWraps = [{ eventId: 'e1', senderPubkey: OTHER }];
    render(<ThreadsView />);
    expect(screen.getByRole('alert')).toHaveTextContent('not a sender Space knows to trust');
  });
});
