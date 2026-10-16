/**
 * The button appears only for an unfinished project; a relay that did not
 * answer gets a "can't be checked" message instead; a finished project, or one
 * the viewer does not own, shows nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { UseProjectSetupReturn } from '@/services/groups/useProjectSetup';

const finish = vi.fn();
let hookState: Partial<UseProjectSetupReturn>;

vi.mock('@/services/groups/useProjectSetup', () => ({
  useProjectSetup: () => ({ check: null, finish, isBusy: false, error: null, notice: null, ...hookState }),
}));

const { FinishProjectSetup } = await import('./FinishProjectSetup');

const button = () => screen.queryByRole('button', { name: 'Finish setting up this project' });

beforeEach(() => {
  finish.mockClear();
  hookState = {};
});

describe('FinishProjectSetup', () => {
  it('offers the button for an unfinished project and calls finish', () => {
    hookState = { check: { status: 'unfinished', needsAdmins: true } };
    render(<FinishProjectSetup groupId="g" />);
    fireEvent.click(button()!);
    expect(finish).toHaveBeenCalledOnce();
  });

  it("says it can't be checked, with no button, when a relay did not answer", () => {
    hookState = { check: { status: 'unchecked' } };
    render(<FinishProjectSetup groupId="g" />);
    expect(button()).toBeNull();
    expect(screen.getByText(/can't be checked right now/)).toBeTruthy();
  });

  it.each([
    ['still checking', null],
    ['complete', { status: 'complete' as const }],
    ['not the owner', { status: 'not-owner' as const }],
  ])('shows nothing when %s', (_label, check) => {
    hookState = { check };
    const { container } = render(<FinishProjectSetup groupId="g" />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps showing the outcome after the project is finished', () => {
    hookState = { check: { status: 'complete' }, notice: 'Project set up. You can add members now.' };
    render(<FinishProjectSetup groupId="g" />);
    expect(screen.getByRole('status').textContent).toMatch(/Project set up/);
    expect(button()).toBeNull();
  });
});
