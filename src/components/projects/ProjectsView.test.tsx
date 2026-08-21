/**
 * @fileoverview ProjectsView mobile layout tests
 *
 * Verifies that the group-list panel and workspace panel switch correctly on
 * mobile so neither panel eats the other's screen real estate. The CSS
 * breakpoint logic (`hidden md:flex`, `w-full md:w-64`) is not exercised by
 * jsdom — but the toggling class on the group-list panel IS; that is what
 * determines whether the panel renders at all on a real phone.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectsView } from './ProjectsView';

// --- module mocks ----------------------------------------------------------

vi.mock('@/services/groups', () => ({
  useGroups: vi.fn(),
}));

// Stub child components so they don't pull in NDK / relay connections.
vi.mock('./GroupList', () => ({
  GroupList: ({ onSelectGroup }: { onSelectGroup: (id: string) => void }) => (
    <div data-testid="group-list">
      <button onClick={() => onSelectGroup('group-abc')}>Select Group ABC</button>
    </div>
  ),
}));

vi.mock('./GroupWorkspace', () => ({
  GroupWorkspace: ({ onLeaveGroup }: { onLeaveGroup: () => void }) => (
    <div data-testid="group-workspace">
      <button onClick={onLeaveGroup}>Leave</button>
    </div>
  ),
}));

vi.mock('./GroupBrowser', () => ({
  GroupBrowser: () => <div data-testid="group-browser" />,
}));

vi.mock('./CreateGroupModal', () => ({
  CreateGroupModal: () => null,
}));

// ---------------------------------------------------------------------------

import { useGroups } from '@/services/groups';

const mockUseGroups = vi.mocked(useGroups as () => ReturnType<typeof useGroups>);

const emptyGroupsReturn = {
  groups: [],
  refresh: vi.fn(),
  isLoading: false,
  error: null,
};

const oneGroupReturn = {
  groups: [
    {
      group: { identifier: 'group-abc', name: 'Project Alpha' } as unknown,
      isMember: true,
      isAdmin: false,
      permissions: [],
    },
  ],
  refresh: vi.fn(),
  isLoading: false,
  error: null,
};

describe('ProjectsView mobile panel visibility', () => {
  beforeEach(() => {
    mockUseGroups.mockReturnValue(emptyGroupsReturn as ReturnType<typeof useGroups>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the group-list panel and hides the workspace panel by default', () => {
    render(<ProjectsView />);

    const listPanel = screen.getByTestId('projects-group-list-panel');

    // Panel must be present and NOT carry the "hidden" class that the mobile
    // breakpoint rule relies on to collapse it.  Use classList.contains so
    // "overflow-hidden" (a different class) does not produce a false match.
    expect(listPanel).toBeInTheDocument();
    expect(listPanel.classList.contains('hidden')).toBe(false);

    // Workspace panel is the sibling div that holds the back-button + content.
    // It starts with "hidden" on mobile (mobileShowList=true by default).
    const workspaceSide = listPanel.nextElementSibling as HTMLElement;
    expect(workspaceSide).not.toBeNull();
    expect(workspaceSide.classList.contains('hidden')).toBe(true);
  });

  it('hides the group-list panel and shows the workspace panel when a group is selected', async () => {
    mockUseGroups.mockReturnValue(oneGroupReturn as ReturnType<typeof useGroups>);

    const user = userEvent.setup();
    render(<ProjectsView />);

    // Simulate tapping a group row — the GroupList stub fires onSelectGroup('group-abc').
    await user.click(screen.getByRole('button', { name: 'Select Group ABC' }));

    const listPanel = screen.getByTestId('projects-group-list-panel');

    // After selecting: list panel must carry "hidden".
    expect(listPanel.classList.contains('hidden')).toBe(true);

    // Workspace side must NOT carry "hidden" (overflow-hidden is a different class).
    const workspaceSide = listPanel.nextElementSibling as HTMLElement;
    expect(workspaceSide.classList.contains('hidden')).toBe(false);

    // The workspace stub is visible.
    expect(screen.getByTestId('group-workspace')).toBeInTheDocument();
  });

  it('restores the group-list panel when the Back button is pressed', async () => {
    mockUseGroups.mockReturnValue(oneGroupReturn as ReturnType<typeof useGroups>);

    const user = userEvent.setup();
    render(<ProjectsView />);

    // Select a group first.
    await user.click(screen.getByRole('button', { name: 'Select Group ABC' }));

    // Verify we're in workspace view.
    const listPanel = screen.getByTestId('projects-group-list-panel');
    expect(listPanel.classList.contains('hidden')).toBe(true);

    // Tap the "Back to Projects" button.
    await user.click(screen.getByRole('button', { name: 'Back to projects list' }));

    // Group-list panel must be visible again.
    expect(listPanel.classList.contains('hidden')).toBe(false);

    // Workspace side must be hidden again.
    const workspaceSide = listPanel.nextElementSibling as HTMLElement;
    expect(workspaceSide.classList.contains('hidden')).toBe(true);
  });

  it('group-list panel carries w-full and md:w-64 — never the fixed w-64 alone', () => {
    render(<ProjectsView />);
    const listPanel = screen.getByTestId('projects-group-list-panel');

    // Must include the responsive width pair. If only "w-64" were present the
    // panel would always consume 256 px — the original bug.
    // classList.contains checks individual space-separated tokens so
    // "md:w-64" and "w-64" are treated as distinct entries.
    expect(listPanel.classList.contains('w-full')).toBe(true);
    expect(listPanel.classList.contains('md:w-64')).toBe(true);
    // Must NOT carry a bare, unconditional "w-64" token.
    expect(listPanel.classList.contains('w-64')).toBe(false);
  });
});
