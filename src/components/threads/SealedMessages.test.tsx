import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SealedMessages } from './SealedMessages';

const mockUseBucketReader = vi.fn();
const heldStore = { current: new Map<string, Uint8Array>() };

vi.mock('@/services/threads', () => ({
  useThreadKeyStore: () => heldStore.current,
  useThreadKeyLoader: () => ({ loaded: true, keyCount: 0 }),
  useBucketReader: (...args: unknown[]) => mockUseBucketReader(...args),
  useBucketWriter: () => ({ sendMessage: vi.fn(), canPublish: true }),
}));

vi.mock('@/services/profile', () => ({
  useAuthorProfiles: () => new Map(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: 'aabbcc' }),
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
