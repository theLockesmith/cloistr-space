/**
 * @fileoverview GroupMembers component tests
 * Comprehensive React Testing Library tests covering all states and interactions
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GroupMembers } from './GroupMembers';
import { useGroupMembers, type GroupMember } from '@/services/groups/useGroupMembers';
import type { AdminPermission } from '@/types/groups';

// Mock the hook
vi.mock('@/services/groups/useGroupMembers');

const mockUseGroupMembers = vi.mocked(useGroupMembers);

// Test data fixtures
const mockRegularMember: GroupMember = {
  pubkey: 'npub1abc123def456ghi789',
  isAdmin: false,
  permissions: [],
  profile: {
    name: 'John Doe',
    displayName: 'Johnny',
    picture: 'https://example.com/avatar.jpg',
    nip05: 'john@example.com',
  },
};

const mockAdminMember: GroupMember = {
  pubkey: 'npub1xyz789abc123def456',
  isAdmin: true,
  permissions: ['add-user', 'remove-user', 'edit-metadata'] as AdminPermission[],
  profile: {
    name: 'Alice Admin',
    displayName: 'Alice',
    picture: 'https://example.com/alice.jpg',
    nip05: 'alice@admin.com',
  },
};

const mockMemberWithoutProfile: GroupMember = {
  pubkey: 'npub1noprofile987654321',
  isAdmin: false,
  permissions: [],
};

const mockAdminWithManyPermissions: GroupMember = {
  pubkey: 'npub1superadmin123456789',
  isAdmin: true,
  permissions: ['add-user', 'remove-user', 'edit-metadata', 'delete-event', 'add-permission', 'remove-permission'] as AdminPermission[],
  profile: {
    name: 'Super Admin',
    displayName: 'Super',
  },
};

const defaultHookReturn = {
  members: [],
  isLoading: false,
  error: null,
  refresh: vi.fn(),
};

describe('GroupMembers', () => {
  beforeEach(() => {
    mockUseGroupMembers.mockReturnValue(defaultHookReturn);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic rendering', () => {
    it('renders with correct structure and calls hook with groupId', () => {
      const groupId = 'test-group-id';
      render(<GroupMembers groupId={groupId} />);

      expect(mockUseGroupMembers).toHaveBeenCalledWith(groupId);
      expect(screen.getByRole('heading', { level: 3, name: /members/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    it('displays member count when not loading', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockRegularMember, mockAdminMember],
      });

      render(<GroupMembers groupId="test-group" />);

      // Check the main header shows total count - it should be the h3 element
      const mainHeader = document.querySelector('h3');
      expect(mainHeader).toHaveTextContent('Members (2)');
    });

    it('hides member count when loading', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        isLoading: true,
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('Members')).toBeInTheDocument();
      expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('displays loading skeletons when isLoading is true', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        isLoading: true,
      });

      render(<GroupMembers groupId="test-group" />);

      // Should show 5 skeleton items
      const skeletonContainer = document.querySelector('.space-y-3');
      expect(skeletonContainer).toBeInTheDocument();

      const skeletons = document.querySelectorAll('.animate-pulse');
      expect(skeletons).toHaveLength(5);
    });

    it('does not display members list or error when loading', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        isLoading: true,
        members: [mockRegularMember], // Should be ignored when loading
        error: 'Some error', // Should be ignored when loading
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
      expect(screen.queryByText('Some error')).not.toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('displays error message when error is present', () => {
      const errorMessage = 'Failed to fetch group members';
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        error: errorMessage,
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('calls refresh when "Try again" button is clicked', async () => {
      const user = userEvent.setup();
      const mockRefresh = vi.fn();

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        error: 'Network error',
        refresh: mockRefresh,
      });

      render(<GroupMembers groupId="test-group" />);

      await user.click(screen.getByRole('button', { name: /try again/i }));

      expect(mockRefresh).toHaveBeenCalledOnce();
    });

    it('does not display members or loading when error is present', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        error: 'Some error',
        members: [mockRegularMember], // Should be ignored
        // Note: isLoading is false when error is present - the hook wouldn't return both
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
      expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('displays empty state when no members and no error/loading', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('No members found')).toBeInTheDocument();
    });

    it('shows member count as (0) when empty', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [],
      });

      render(<GroupMembers groupId="test-group" />);

      const mainHeader = document.querySelector('h3');
      expect(mainHeader).toHaveTextContent('Members (0)');
    });
  });

  describe('Members display', () => {
    it('separates admins and regular members into sections', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockRegularMember, mockAdminMember],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('Admins (1)')).toBeInTheDocument();
      expect(screen.getByText('Members (1)')).toBeInTheDocument();
    });

    it('shows only admins section when no regular members', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockAdminMember],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('Admins (1)')).toBeInTheDocument();
      expect(screen.queryByText('Members (')).not.toBeInTheDocument();
    });

    it('shows only members section when no admins', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockRegularMember],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.queryByText('Admins (')).not.toBeInTheDocument();
      expect(screen.getByText('Members (1)')).toBeInTheDocument();
    });
  });

  describe('Member profile display', () => {
    it('displays member with profile picture, display name, and nip05', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockRegularMember],
      });

      render(<GroupMembers groupId="test-group" />);

      const avatar = screen.getByRole('presentation');
      expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg');
      expect(avatar).toHaveAttribute('alt', '');

      expect(screen.getByText('Johnny')).toBeInTheDocument();
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });

    it('falls back to name when no displayName', () => {
      const memberWithoutDisplayName: GroupMember = {
        ...mockRegularMember,
        profile: {
          ...mockRegularMember.profile!,
          displayName: undefined,
        },
      };

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [memberWithoutDisplayName],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('uses formatted pubkey when no profile name', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockMemberWithoutProfile],
      });

      render(<GroupMembers groupId="test-group" />);

      // Should show first 8 + '...' + last 4 characters
      expect(screen.getByText('npub1nop...4321')).toBeInTheDocument();
    });

    it('displays initials avatar when no profile picture', () => {
      const memberWithoutPicture: GroupMember = {
        ...mockRegularMember,
        profile: {
          ...mockRegularMember.profile!,
          picture: undefined,
        },
      };

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [memberWithoutPicture],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('JO')).toBeInTheDocument();
      expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    });

    it('uses initials from formatted pubkey when no profile', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockMemberWithoutProfile],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('NP')).toBeInTheDocument();
    });

    it('does not display nip05 when not present', () => {
      const memberWithoutNip05: GroupMember = {
        ...mockRegularMember,
        profile: {
          ...mockRegularMember.profile!,
          nip05: undefined,
        },
      };

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [memberWithoutNip05],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('Johnny')).toBeInTheDocument();
      expect(screen.queryByText('@')).not.toBeInTheDocument();
    });
  });

  describe('Admin member display', () => {
    it('displays admin badge for admin members', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockAdminMember],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('Admin')).toBeInTheDocument();
    });

    it('does not display admin badge for regular members', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockRegularMember],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });

    it('displays formatted permissions for admins', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockAdminMember],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('Add User')).toBeInTheDocument();
      expect(screen.getByText('Remove User')).toBeInTheDocument();
      expect(screen.getByText('Edit Metadata')).toBeInTheDocument();
    });

    it('shows only first 3 permissions and "+X more" when admin has many permissions', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockAdminWithManyPermissions],
      });

      render(<GroupMembers groupId="test-group" />);

      // Should show first 3 permissions
      expect(screen.getByText('Add User')).toBeInTheDocument();
      expect(screen.getByText('Remove User')).toBeInTheDocument();
      expect(screen.getByText('Edit Metadata')).toBeInTheDocument();

      // Should show "+3 more" for remaining permissions
      expect(screen.getByText('+3 more')).toBeInTheDocument();

      // Should not show the additional permissions
      expect(screen.queryByText('Delete Event')).not.toBeInTheDocument();
    });

    it('does not display permission tags for admin with no permissions', () => {
      const adminWithoutPermissions: GroupMember = {
        ...mockAdminMember,
        permissions: [],
      };

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [adminWithoutPermissions],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.queryByText('Add User')).not.toBeInTheDocument();
    });

    it('does not display permissions for regular members', () => {
      const regularMemberWithPermissions: GroupMember = {
        ...mockRegularMember,
        permissions: ['add-user'] as AdminPermission[], // This shouldn't happen but test edge case
      };

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [regularMemberWithPermissions],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.queryByText('Add User')).not.toBeInTheDocument();
    });
  });

  describe('Refresh functionality', () => {
    it('calls refresh when refresh button is clicked', async () => {
      const user = userEvent.setup();
      const mockRefresh = vi.fn();

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [mockRegularMember],
        refresh: mockRefresh,
      });

      render(<GroupMembers groupId="test-group" />);

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshButton);

      expect(mockRefresh).toHaveBeenCalledOnce();
    });

    it('refresh button has correct title attribute', () => {
      render(<GroupMembers groupId="test-group" />);

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      expect(refreshButton).toHaveAttribute('title', 'Refresh');
    });
  });

  describe('Edge cases and accessibility', () => {
    it('handles empty string groupId', () => {
      render(<GroupMembers groupId="" />);

      expect(mockUseGroupMembers).toHaveBeenCalledWith("");
    });

    it('refresh button is keyboard accessible', async () => {
      const user = userEvent.setup();
      const mockRefresh = vi.fn();

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        refresh: mockRefresh,
      });

      render(<GroupMembers groupId="test-group" />);

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      refreshButton.focus();

      await user.keyboard('{Enter}');

      expect(mockRefresh).toHaveBeenCalledOnce();
    });

    it('handles members with special characters in names', () => {
      const memberWithSpecialChars: GroupMember = {
        pubkey: 'npub1special123',
        isAdmin: false,
        permissions: [],
        profile: {
          name: 'João Müller',
          displayName: 'J&M <test>',
        },
      };

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [memberWithSpecialChars],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('J&M <test>')).toBeInTheDocument();
    });

    it('handles very long member names with truncation', () => {
      const memberWithLongName: GroupMember = {
        pubkey: 'npub1long123',
        isAdmin: false,
        permissions: [],
        profile: {
          displayName: 'This is a very long display name that should be truncated in the UI',
        },
      };

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [memberWithLongName],
      });

      render(<GroupMembers groupId="test-group" />);

      const nameElement = screen.getByText('This is a very long display name that should be truncated in the UI');
      expect(nameElement).toHaveClass('truncate');
    });

    it('renders correctly with mixed admin and regular members', () => {
      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [
          mockRegularMember,
          mockAdminMember,
          mockMemberWithoutProfile,
          mockAdminWithManyPermissions,
        ],
      });

      render(<GroupMembers groupId="test-group" />);

      const mainHeader = document.querySelector('h3');
      expect(mainHeader).toHaveTextContent('Members (4)');
      expect(screen.getByText('Admins (2)')).toBeInTheDocument();
      expect(screen.getByText('Members (2)')).toBeInTheDocument();

      // Check all members are displayed
      expect(screen.getByText('Johnny')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('npub1nop...4321')).toBeInTheDocument();
      expect(screen.getByText('Super')).toBeInTheDocument();
    });
  });

  describe('Permission formatting', () => {
    it('correctly formats different permission types', () => {
      const adminWithVariousPermissions: GroupMember = {
        pubkey: 'npub1permissions123',
        isAdmin: true,
        permissions: ['add-user', 'edit-metadata', 'delete-event'] as AdminPermission[],
        profile: {
          name: 'Permission Tester',
        },
      };

      mockUseGroupMembers.mockReturnValue({
        ...defaultHookReturn,
        members: [adminWithVariousPermissions],
      });

      render(<GroupMembers groupId="test-group" />);

      expect(screen.getByText('Add User')).toBeInTheDocument();
      expect(screen.getByText('Edit Metadata')).toBeInTheDocument();
      expect(screen.getByText('Delete Event')).toBeInTheDocument();
    });
  });
});