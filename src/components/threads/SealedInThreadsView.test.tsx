/**
 * Verifies that ThreadsView has a reachable Sealed section that renders
 * SealedMessages without requiring a group.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/services/threads', () => ({
  useAllThreads: () => ({
    threads: [],
    groups: [],
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
  useBucketReader: vi.fn(() => ({
    messages: [],
    handoffs: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  })),
  useBucketWriter: () => ({ sendMessage: vi.fn(), canPublish: false }),
}));

vi.mock('@/services/profile', () => ({
  useAuthorProfiles: () => new Map(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: 'aabbcc' }),
}));

vi.mock('@/services/groups/useGroupMembers', () => ({
  useGroupMembers: () => ({
    members: [],
    isLoading: false,
    error: null,
    unverifiable: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/config/environment', () => ({
  config: {
    threadGranters: ['3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4'],
  },
}));

const { ThreadsView } = await import('./ThreadsView');

describe('Sealed messages in ThreadsView', () => {
  it('has a Sealed tab that is clickable even with no groups', () => {
    render(<ThreadsView />);

    const sealedTab = screen.getByRole('button', { name: /sealed/i });
    expect(sealedTab).toBeInTheDocument();
  });

  it('shows SealedMessages content when Sealed tab is active', () => {
    render(<ThreadsView />);

    fireEvent.click(screen.getByRole('button', { name: /sealed/i }));

    expect(screen.getByText('No thread keys held')).toBeInTheDocument();
  });
});
