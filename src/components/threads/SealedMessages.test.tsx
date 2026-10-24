import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes, bytesToHex } from 'nostr-tools/utils';
import { SealedMessages } from './SealedMessages';
import { ThreadKeyStore } from '@/services/threads/threadKeyStore';
import { tryUnwrapMessage } from '@/services/threads/giftWrap';
import gateFx from '@/services/threads/__fixtures__/kitGateRequest.json';

const mockUseBucketReader = vi.fn();
const mockSend = vi.fn();
const mockGateYes = vi.fn();
const authState = vi.hoisted(() => ({ signer: null as unknown, pubkey: 'aabbcc' }));
const heldStore = { current: new Map<string, Uint8Array>() };

vi.mock('@/services/threads', () => ({
  useThreadKeyStore: () => heldStore.current,
  useThreadKeyLoader: () => ({ loaded: true, keyCount: 0 }),
  useBucketReader: (...args: unknown[]) => ({
    pendingHandoffs: [],
    acceptHandoff: vi.fn(),
    dismissHandoff: vi.fn(),
    ...mockUseBucketReader(...args),
  }),
  useBucketWriter: () => ({ sendMessage: mockSend, sendGateYes: mockGateYes, canPublish: true }),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ signer: authState.signer }),
}));

vi.mock('@/services/profile', () => ({
  useAuthorProfiles: () => new Map(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: authState.pubkey }),
}));

const mockMembers = vi.fn((_id: string) => ({
  members: [
    { pubkey: 'admin1hex', isAdmin: true, permissions: ['edit-metadata'] },
    { pubkey: 'member1hex', isAdmin: false, permissions: [] },
  ],
  isLoading: false,
  error: null,
  unverifiable: false,
  refresh: vi.fn(),
}));

vi.mock('@/services/groups/useGroupMembers', () => ({
  useGroupMembers: (id: string) => mockMembers(id),
}));

vi.mock('@/config/environment', () => ({
  config: {
    threadGranters: ['3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4'],
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  authState.signer = null;
  authState.pubkey = 'aabbcc';
  heldStore.current = new Map();
  mockUseBucketReader.mockReturnValue({
    messages: [],
    handoffs: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  });
});

describe('SealedMessages without groupId (top-level Threads page)', () => {
  it('includes additionalGranters alongside fleet granters when no groupId is provided', () => {
    render(<SealedMessages additionalGranters={['admin-from-group-a', 'admin-from-group-b']} />);

    const [, granters] = mockUseBucketReader.mock.calls[0];
    expect(granters).toContain('3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4');
    expect(granters).toContain('admin-from-group-a');
    expect(granters).toContain('admin-from-group-b');
  });

  it('deduplicates additionalGranters against fleet list', () => {
    const fleet = '3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4';
    render(<SealedMessages additionalGranters={[fleet, 'unique-admin']} />);

    const [, granters] = mockUseBucketReader.mock.calls[0];
    expect(granters.filter((g: string) => g === fleet)).toHaveLength(1);
    expect(granters).toContain('unique-admin');
  });

  it('falls back to fleet granters alone when additionalGranters is omitted', () => {
    render(<SealedMessages />);

    const [, granters] = mockUseBucketReader.mock.calls[0];
    expect(granters).toContain('3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4');
    expect(granters).toHaveLength(1);
  });

  it('does not call useGroupMembers with a real group id when groupId is absent', () => {
    render(<SealedMessages />);

    expect(mockMembers).toHaveBeenCalledWith('');
  });
});

describe('SealedMessages granter list', () => {
  it('passes admin pubkeys and fleet granters to useBucketReader', () => {
    render(<SealedMessages groupId="test-group" />);

    expect(mockUseBucketReader).toHaveBeenCalled();
    const [, granters] = mockUseBucketReader.mock.calls[0];
    expect(granters).toContain('admin1hex');
    expect(granters).toContain('3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4');
  });

  it('does not include non-admin members in granter list', () => {
    render(<SealedMessages groupId="test-group" />);

    const [, granters] = mockUseBucketReader.mock.calls[0];
    expect(granters).not.toContain('member1hex');
  });

  it('never passes an empty granter list', () => {
    mockMembers.mockReturnValue({
      members: [],
      isLoading: false,
      error: null,
      unverifiable: false,
      refresh: vi.fn(),
    });

    render(<SealedMessages groupId="test-group" />);

    const [, granters] = mockUseBucketReader.mock.calls[0];
    expect(granters.length).toBeGreaterThan(0);
  });

  it('deduplicates when an admin is also in the fleet list', () => {
    mockMembers.mockReturnValue({
      members: [
        {
          pubkey: '3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4',
          isAdmin: true,
          permissions: ['edit-metadata'],
        },
      ],
      isLoading: false,
      error: null,
      unverifiable: false,
      refresh: vi.fn(),
    });

    render(<SealedMessages groupId="test-group" />);

    const [, granters] = mockUseBucketReader.mock.calls[0];
    const fleet = '3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4';
    expect(granters.filter((g: string) => g === fleet)).toHaveLength(1);
  });
});

describe('SealedMessages diagnostics panel', () => {
  it('does not render the diag panel in production', () => {
    mockUseBucketReader.mockReturnValue({
      messages: [],
      handoffs: [],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
      debug: { hasSigner: false, isNip46: false, granterCount: 1, handoffBuckets: [], realBuckets: [], windowId: 123, signerError: null },
    });

    const { container } = render(<SealedMessages />);

    expect(container.querySelector('details')).toBeNull();
  });
});

describe('SealedMessages key count', () => {
  it('counts keys that arrived by hand-off after page load, and offers the reply box', () => {
    // Loader read storage at page load and found nothing (keyCount 0); a
    // hand-off then delivered a key and a message decrypted with it. This is
    // the operator's screen on 2026-09-28.
    heldStore.current = new Map([['threadpk', new Uint8Array(32)]]);
    mockUseBucketReader.mockReturnValue({
      messages: [{ plaintext: 'hello from the kit', authorHex: '3331f3b0', threadId: 'threadpk', wrapId: 'w1' }],
      handoffs: [{ threadId: 't', threadSecretHex: '00'.repeat(32), granterPubkey: '3331f3b0', wrapId: 'h1' }],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
    const { queryByText, getByText, container } = render(<SealedMessages />);
    expect(queryByText('No thread keys held')).toBeNull();
    expect(getByText(/1 thread key\b/)).toBeTruthy();
    expect(container.querySelector('textarea, input[type="text"]')).not.toBeNull();
  });

  it('still says no keys when there genuinely are none', () => {
    const { getByText } = render(<SealedMessages />);
    expect(getByText('No thread keys held')).toBeTruthy();
  });
});

describe('SealedMessages renders the kit envelope', () => {
  it('shows the message text, and the sender as an unverified key rather than the name the message claims', () => {
    heldStore.current = new Map([['threadpk', new Uint8Array(32)]]);
    mockUseBucketReader.mockReturnValue({
      messages: [{
        plaintext: '{"v":"arbiter-fleet-msg-v1","body":"Fresh test from cloistr-orchestrator.","task":null,"role":"operator","from":"cloistr-orchestrator"}',
        authorHex: '3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4',
        threadId: 'threadpk',
        wrapId: 'w1',
      }],
      handoffs: [],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
    const { getByText, queryByText } = render(<SealedMessages />);
    expect(getByText('Fresh test from cloistr-orchestrator.')).toBeTruthy();
    // `from` and the author field are written by whoever holds the thread
    // key and nothing signs them, so neither may be shown as a trusted name.
    expect(queryByText('cloistr-orchestrator')).toBeNull();
    expect(getByText(/^npub1/)).toBeTruthy();
    expect(getByText('unverified')).toBeTruthy();
    expect(queryByText(/arbiter-fleet-msg-v1/)).toBeNull();
  });
});

describe('SealedMessages thread names', () => {
  const base = { handoffs: [], isLoading: false, error: null, refresh: vi.fn() };
  it('labels a thread with the name carried in the envelope', () => {
    heldStore.current = new Map([['threadpk', new Uint8Array(32)]]);
    mockUseBucketReader.mockReturnValue({ ...base, messages: [{
      plaintext: '{"v":"arbiter-fleet-msg-v1","body":"hi","from":"conscience-orch","thread":"conscience-group-wrap"}',
      authorHex: 'aa', threadId: 'c8e8289dec3e0000', wrapId: 'w1',
    }] });
    const { getByText, queryByText } = render(<SealedMessages />);
    expect(getByText('conscience-group-wrap')).toBeTruthy();
    expect(queryByText(/Thread c8e8289dec3e/)).toBeNull();
  });
  it('falls back to the key label for older messages without a name', () => {
    heldStore.current = new Map([['threadpk', new Uint8Array(32)]]);
    mockUseBucketReader.mockReturnValue({ ...base, messages: [{
      plaintext: '{"v":"arbiter-fleet-msg-v1","body":"old","from":"cloistr-orchestrator"}',
      authorHex: 'aa', threadId: 'c8e8289dec3e0000', wrapId: 'w2',
    }] });
    const { getByText } = render(<SealedMessages />);
    expect(getByText(/Thread c8e8289dec3e/)).toBeTruthy();
  });
});

describe('SealedMessages sending', () => {
  it('shows the relay’s reason when a send fails, and keeps the text', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    heldStore.current = new Map([['threadpk', new Uint8Array(32)]]);
    mockUseBucketReader.mockReturnValue({ messages: [], handoffs: [], isLoading: false, error: null, refresh: vi.fn() });
    mockSend.mockRejectedValueOnce(new Error('restricted: you can only publish events as your authenticated identity'));
    const { getByPlaceholderText, getByRole, findByText } = render(<SealedMessages />);

    await userEvent.type(getByPlaceholderText('Sealed message…'), 'hello');
    await userEvent.click(getByRole('button', { name: 'Send' }));

    expect(await findByText(/you can only publish events as your authenticated identity/)).toBeTruthy();
    expect((getByPlaceholderText('Sealed message…') as HTMLInputElement).value).toBe('hello');
  });
});

describe('SealedMessages order', () => {
  it('lists a thread’s messages in the order they were sent, not the order they arrived', () => {
    heldStore.current = new Map([['threadpk', new Uint8Array(32)]]);
    mockUseBucketReader.mockReturnValue({
      handoffs: [], isLoading: false, error: null, refresh: vi.fn(),
      messages: [
        { plaintext: 'second', authorHex: 'aa', threadId: 'threadpk', wrapId: 'w2', createdAt: 20, approxTime: false },
        { plaintext: 'first', authorHex: 'aa', threadId: 'threadpk', wrapId: 'w1', createdAt: 10, approxTime: false },
      ],
    });
    const { getByText } = render(<SealedMessages />);
    const first = getByText('first');
    expect(first.compareDocumentPosition(getByText('second')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('SealedMessages hand-off prompt', () => {
  it('asks before taking an offered key, and says the sender cannot be verified', async () => {
    const acceptHandoff = vi.fn();
    const dismissHandoff = vi.fn();
    mockUseBucketReader.mockReturnValue({
      messages: [],
      handoffs: [],
      pendingHandoffs: [{
        wrapId: 'w9',
        threadId: 'looks-official',
        threadSecretHex: '11'.repeat(32),
        granterPubkey: '3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4',
        threadPubkey: 'bb'.repeat(32),
      }],
      acceptHandoff,
      dismissHandoff,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
    const { getByText, getByRole } = render(<SealedMessages />);

    expect(getByText(/cannot\s+verify who sent it/)).toBeTruthy();
    getByRole('button', { name: 'Accept key' }).click();
    expect(acceptHandoff).toHaveBeenCalledWith('w9');
    getByRole('button', { name: 'Dismiss' }).click();
    expect(dismissHandoff).toHaveBeenCalledWith('w9');
  });
});

describe('SealedMessages key-wrap prompt', () => {
  it("shows a stranger's key-wrap as an offer from a sender Space does not trust", async () => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools');
    const { bytesToHex } = await import('nostr-tools/utils');
    const { offerKeyWrap, clearKeyWraps } = await import('@/services/threads/pendingKeyOffers');
    const threadSk = generateSecretKey();
    clearKeyWraps();
    offerKeyWrap({
      eventId: 'kw1',
      threadPubkey: getPublicKey(threadSk),
      secretHex: bytesToHex(threadSk),
      senderPubkey: getPublicKey(generateSecretKey()),
    });

    const { getByText, getByRole } = render(<SealedMessages />);
    expect(getByText(/not a sender Space knows to trust/)).toBeTruthy();
    expect(getByRole('button', { name: 'Accept key' })).toBeTruthy();
    clearKeyWraps();
  });
});

// ---------------------------------------------------------------------------
// Kit gate requests: the operator answers yes from here
// ---------------------------------------------------------------------------
//
// The request comes from the kit's own code (kitGateRequest.json). The yes is
// sent by sendGateYes, which has the user's own signer sign it; see
// services/threads/gateRequest.test.ts for what the kit's gate makes of it.

describe('SealedMessages gate requests', () => {
  const OPERATOR_SK = hexToBytes('66'.repeat(32));
  const OPERATOR_PK = getPublicKey(OPERATOR_SK);
  const THREAD_SK = hexToBytes('11'.repeat(32));
  const base = { handoffs: [], isLoading: false, error: null, refresh: vi.fn() };

  function requestMessage() {
    const store = new ThreadKeyStore();
    store.set(gateFx.keys.threadPk, THREAD_SK);
    return tryUnwrapMessage(gateFx.wrap, store)!;
  }

  function showMessages(messages: unknown[]) {
    heldStore.current = new Map([[gateFx.keys.threadPk, THREAD_SK]]);
    mockUseBucketReader.mockReturnValue({ ...base, messages });
  }

  it("shows the request's own signed text and asks for a yes", async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    authState.signer = { getPublicKey: async () => OPERATOR_PK };
    showMessages([requestMessage()]);
    const { getByRole, getAllByText } = render(<SealedMessages />);

    expect(getAllByText(/aegis\/arbiter-client/).length).toBeGreaterThan(0);
    await userEvent.click(getByRole('button', { name: /yes, let this change through/i }));

    expect(mockGateYes).toHaveBeenCalledWith(authState.signer, gateFx.request.id, bytesToHex(THREAD_SK));
    // Sent as its own signed event, never as composer text.
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('says why it cannot answer when there is no signer', () => {
    showMessages([requestMessage()]);
    const { getByRole, getByText } = render(<SealedMessages />);
    expect(getByRole('button', { name: /yes, let this change through/i })).toBeDisabled();
    expect(getByText(/sign in with your own key/i)).toBeTruthy();
  });

  it('shows the error and keeps the button when the yes could not be sent', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    authState.signer = { getPublicKey: async () => OPERATOR_PK };
    mockGateYes.mockRejectedValueOnce(new Error('Your signer returned a reply that does not verify.'));
    showMessages([requestMessage()]);
    const { getByRole, findByText } = render(<SealedMessages />);

    await userEvent.click(getByRole('button', { name: /yes, let this change through/i }));
    expect(await findByText(/does not verify/)).toBeTruthy();
    expect(getByRole('button', { name: /yes, let this change through/i })).toBeEnabled();
  });

  it('once your signed yes to it is in the thread, says so instead of asking again', () => {
    authState.signer = { getPublicKey: async () => OPERATOR_PK };
    authState.pubkey = OPERATOR_PK;
    const yes = finalizeEvent(
      { kind: 1111, content: 'yes', tags: [['e', gateFx.request.id]], created_at: 2_000_000_000 },
      OPERATOR_SK,
    );
    const reply = { ...requestMessage(), wrapId: 'yes-wrap', plaintext: JSON.stringify(yes), createdAt: 2_000_000_000 };
    showMessages([requestMessage(), reply]);
    const { queryByRole, getAllByText } = render(<SealedMessages />);

    expect(queryByRole('button', { name: /yes, let this change through/i })).toBeNull();
    expect(getAllByText(/signed yes/i).length).toBeGreaterThan(0);
    // Not the raw event JSON.
    expect(getAllByText(/signed yes/i)[0].textContent).not.toMatch(/"sig"/);
  });

  it("someone else's signed yes does not hide your button", () => {
    authState.signer = { getPublicKey: async () => OPERATOR_PK };
    authState.pubkey = OPERATOR_PK;
    const other = finalizeEvent(
      { kind: 1111, content: 'yes', tags: [['e', gateFx.request.id]], created_at: 2_000_000_000 },
      hexToBytes('77'.repeat(32)),
    );
    const reply = { ...requestMessage(), wrapId: 'other-yes', plaintext: JSON.stringify(other), createdAt: 2_000_000_000 };
    showMessages([requestMessage(), reply]);
    const { getByRole } = render(<SealedMessages />);
    expect(getByRole('button', { name: /yes, let this change through/i })).toBeTruthy();
  });

  it('a "yes" nobody signed does not count as an answer', () => {
    authState.signer = { getPublicKey: async () => OPERATOR_PK };
    const unsigned = { ...requestMessage(), wrapId: 'plain-yes', plaintext: 'yes', createdAt: 2_000_000_000 };
    showMessages([requestMessage(), unsigned]);
    const { getByRole } = render(<SealedMessages />);
    expect(getByRole('button', { name: /yes, let this change through/i })).toBeTruthy();
  });
});
