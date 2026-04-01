/**
 * Manual RTL tests for GroupList - for comparison with component-tester agent
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroupList } from './GroupList'

// Mock the hook
vi.mock('@/services/groups', () => ({
  useGroups: vi.fn(),
}))

import { useGroups } from '@/services/groups'

const mockUseGroups = vi.mocked(useGroups)

import type { GroupMembership, AdminPermission } from '@/types/groups'

const mockGroups: GroupMembership[] = [
  {
    group: {
      id: 'event-id-1',
      pubkey: 'relay-pubkey-1',
      identifier: 'group-1',
      name: 'Test Group 1',
      description: 'Description 1',
      picture: 'https://example.com/pic1.jpg',
      isPublic: true,
      isOpen: true,
      relay: 'wss://relay.example.com',
      createdAt: 1700000000,
    },
    isAdmin: false,
    isMember: true,
    permissions: [],
  },
  {
    group: {
      id: 'event-id-2',
      pubkey: 'relay-pubkey-2',
      identifier: 'group-2',
      name: 'Admin Group',
      description: undefined,
      picture: undefined,
      isPublic: false,
      isOpen: false,
      relay: 'wss://relay.example.com',
      createdAt: 1700000001,
    },
    isAdmin: true,
    isMember: true,
    permissions: ['add-user', 'remove-user'] as AdminPermission[],
  },
]

describe('GroupList', () => {
  const mockOnSelectGroup = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('shows skeleton loaders when loading', () => {
      mockUseGroups.mockReturnValue({
        groups: [],
        isLoading: true,
        error: null,
        refresh: vi.fn(),
      })

      render(<GroupList onSelectGroup={mockOnSelectGroup} />)

      // Check for skeleton elements (animate-pulse class)
      const skeletons = document.querySelectorAll('.animate-pulse')
      expect(skeletons.length).toBeGreaterThan(0)
    })
  })

  describe('error state', () => {
    it('shows error message and retry button', () => {
      const mockRefresh = vi.fn()
      mockUseGroups.mockReturnValue({
        groups: [],
        isLoading: false,
        error: 'Failed to load groups',
        refresh: mockRefresh,
      })

      render(<GroupList onSelectGroup={mockOnSelectGroup} />)

      expect(screen.getByText('Failed to load groups')).toBeInTheDocument()

      const retryButton = screen.getByRole('button', { name: /try again/i })
      fireEvent.click(retryButton)
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
  })

  describe('empty state', () => {
    it('shows empty message when no groups', () => {
      mockUseGroups.mockReturnValue({
        groups: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<GroupList onSelectGroup={mockOnSelectGroup} />)

      expect(screen.getByText('No groups yet')).toBeInTheDocument()
      expect(screen.getByText(/join or create a group/i)).toBeInTheDocument()
    })
  })

  describe('with groups', () => {
    beforeEach(() => {
      mockUseGroups.mockReturnValue({
        groups: mockGroups,
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      })
    })

    it('renders all groups', () => {
      render(<GroupList onSelectGroup={mockOnSelectGroup} />)

      expect(screen.getByText('Test Group 1')).toBeInTheDocument()
      expect(screen.getByText('Admin Group')).toBeInTheDocument()
    })

    it('shows admin badge for admin groups', () => {
      render(<GroupList onSelectGroup={mockOnSelectGroup} />)

      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    it('shows description when present', () => {
      render(<GroupList onSelectGroup={mockOnSelectGroup} />)

      expect(screen.getByText('Description 1')).toBeInTheDocument()
    })

    it('calls onSelectGroup when group clicked', () => {
      render(<GroupList onSelectGroup={mockOnSelectGroup} />)

      fireEvent.click(screen.getByText('Test Group 1'))
      expect(mockOnSelectGroup).toHaveBeenCalledWith('group-1')
    })

    it('highlights selected group', () => {
      render(<GroupList onSelectGroup={mockOnSelectGroup} selectedGroupId="group-1" />)

      const buttons = screen.getAllByRole('button')
      const selectedButton = buttons.find(b => b.textContent?.includes('Test Group 1'))
      expect(selectedButton?.className).toContain('bg-cloistr-primary')
    })
  })
})
