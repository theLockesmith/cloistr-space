import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SealedMessages } from './SealedMessages';

const mockUseBucketReader = vi.fn();

vi.mock('@/services/threads', () => ({
  useThreadKeyStore: () => new Map(),
  useThreadKeyLoader: () => ({ loaded: true, keyCount: 0 }),
  useBucketReader: (...args: unknown[]) => mockUseBucketReader(...args),
  useBucketWriter: () => ({ sendMessage: vi.fn(), canPublish: false }),
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
  mockUseBucketReader.mockReturnValue({
    messages: [],
    handoffs: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  });
});

describe('SealedMessages without groupId (top-level Threads page)', () => {
  it('uses only fleet granters when no groupId is provided', () => {
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
