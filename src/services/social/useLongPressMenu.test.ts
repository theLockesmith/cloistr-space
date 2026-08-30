/**
 * @fileoverview Tests for the reaction affordances.
 *
 * The case that matters most is the one you cannot see in code review: a hold
 * that fires must swallow the click that follows, or a single gesture both
 * opens the picker and sends a heart the user never chose.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLongPressMenu } from './useLongPressMenu';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function mouseEvent() {
  return {
    button: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent & React.PointerEvent;
}

function setup(overrides: Partial<Parameters<typeof useLongPressMenu>[0]> = {}) {
  const onOpen = vi.fn();
  const onActivate = vi.fn();
  const { result } = renderHook(() =>
    useLongPressMenu({ onOpen, onActivate, holdMs: 500, ...overrides })
  );
  return { onOpen, onActivate, h: () => result.current.handlers };
}

describe('useLongPressMenu', () => {
  it('sends the default reaction on a plain click', () => {
    const { onOpen, onActivate, h } = setup();
    const e = mouseEvent();

    act(() => h().onPointerDown(e));
    act(() => h().onPointerUp());
    act(() => h().onClick(e));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the menu after holding', () => {
    const { onOpen, onActivate, h } = setup();

    act(() => h().onPointerDown(mouseEvent()));
    act(() => vi.advanceTimersByTime(500));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not fire the default reaction on the click that ends a hold', () => {
    // THE bug this hook exists to avoid. Without the fired-flag, holding gives
    // you a picker and a heart.
    const { onOpen, onActivate, h } = setup();
    const e = mouseEvent();

    act(() => h().onPointerDown(e));
    act(() => vi.advanceTimersByTime(500));
    act(() => h().onPointerUp());
    act(() => h().onClick(e));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('goes back to plain clicks after a hold', () => {
    // The suppression is one-shot. If it stuck, the button would be dead to
    // ordinary taps for the rest of its life.
    const { onActivate, h } = setup();
    const e = mouseEvent();

    act(() => h().onPointerDown(e));
    act(() => vi.advanceTimersByTime(500));
    act(() => h().onClick(e));
    act(() => h().onPointerDown(e));
    act(() => h().onClick(e));

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('does not open when the press is released early', () => {
    const { onOpen, h } = setup();

    act(() => h().onPointerDown(mouseEvent()));
    act(() => vi.advanceTimersByTime(300));
    act(() => h().onPointerUp());
    act(() => vi.advanceTimersByTime(500));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('cancels the hold when the pointer leaves the control', () => {
    // Dragging off a button is how people abort a press they did not mean.
    const { onOpen, h } = setup();

    act(() => h().onPointerDown(mouseEvent()));
    act(() => h().onPointerLeave());
    act(() => vi.advanceTimersByTime(500));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens on right-click and suppresses only this control menu', () => {
    const { onOpen, h } = setup();
    const e = mouseEvent();

    act(() => h().onContextMenu(e));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('does not double-open when right-click follows a pointerdown', () => {
    const { onOpen, h } = setup();

    act(() => h().onPointerDown(mouseEvent()));
    act(() => h().onContextMenu(mouseEvent()));
    act(() => vi.advanceTimersByTime(500));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ignores non-primary pointer buttons', () => {
    const { onOpen, h } = setup();

    act(() => h().onPointerDown({ ...mouseEvent(), button: 2 } as React.PointerEvent));
    act(() => vi.advanceTimersByTime(500));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens from the keyboard with ArrowDown', () => {
    const { onOpen, h } = setup();
    const e = { key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;

    act(() => h().onKeyDown(e));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('does nothing at all when disabled', () => {
    // The action gate already blocks reacting when signed out. A picker that
    // opened anyway would offer choices that cannot be published.
    const { onOpen, onActivate, h } = setup({ disabled: true });
    const e = mouseEvent();

    act(() => h().onPointerDown(e));
    act(() => vi.advanceTimersByTime(500));
    act(() => h().onContextMenu(e));
    act(() => h().onClick(e));

    expect(onOpen).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not open after unmount', () => {
    const onOpen = vi.fn();
    const { result, unmount } = renderHook(() =>
      useLongPressMenu({ onOpen, onActivate: vi.fn(), holdMs: 500 })
    );

    act(() => result.current.handlers.onPointerDown(mouseEvent()));
    unmount();
    act(() => vi.advanceTimersByTime(500));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
