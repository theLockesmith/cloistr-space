/**
 * @fileoverview The frame acts only on messages from Stash's origin AND its
 * own iframe, sends the embed nothing, and says so when Stash never answers
 * rather than showing an empty box forever.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STASH_EMBED_READY_TIMEOUT_MS, StashEmbedFrame } from './StashEmbedFrame';
import { StashPicker } from './StashPicker';
import { FilesView } from './FilesView';

vi.mock('./FileBrowser', () => ({ FileBrowser: () => <div>legacy drive browser</div> }));

const STASH = 'https://stash.cloistr.xyz';
const SHA = 'b'.repeat(64);
const item = { name: 'plan.pdf', sha256: SHA, size: 2048, mimeType: 'application/pdf' };
const env = (data: Record<string, unknown>) => ({ source: 'cloistr-stash-embed', version: 1, ...data });

function frameWindow(): Window {
  const frame = screen.getByTitle('Stash files') as HTMLIFrameElement;
  if (!frame.contentWindow) throw new Error('jsdom gave the iframe no window');
  return frame.contentWindow;
}

function post(data: unknown, over: { origin?: string; source?: Window | null } = {}) {
  const source = 'source' in over ? over.source : frameWindow();
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: over.origin ?? STASH, source }));
  });
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('StashEmbedFrame', () => {
  it('frames Stash with Space’s exact origin and the mode', () => {
    render(<StashEmbedFrame mode="pick" stashOrigin={STASH} />);
    const url = new URL((screen.getByTitle('Stash files') as HTMLIFrameElement).src);
    expect(url.origin).toBe(STASH);
    expect(url.pathname).toBe('/embed/files');
    expect(url.searchParams.get('parent')).toBe(window.location.origin);
    expect(url.searchParams.get('mode')).toBe('pick');
  });

  it('hands picked references to the caller, and cancel to the caller', () => {
    const onPicked = vi.fn();
    const onCancelled = vi.fn();
    render(<StashEmbedFrame mode="pick" stashOrigin={STASH} onPicked={onPicked} onCancelled={onCancelled} />);
    post(env({ type: 'picked', items: [{ ...item, key: 'never kept' }] }));
    expect(onPicked).toHaveBeenCalledWith([item]);
    post(env({ type: 'cancelled' }));
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it('sizes the frame to the height the embed reports', () => {
    render(<StashEmbedFrame mode="browse" stashOrigin={STASH} />);
    post(env({ type: 'resize', height: 731 }));
    expect((screen.getByTitle('Stash files') as HTMLIFrameElement).style.height).toBe('731px');
  });

  it.each([
    ['the wrong origin', { origin: 'https://evil.example' }],
    ['Space’s own origin', { origin: window.location.origin }],
    ['the wrong source window', { source: window }],
    ['no source window', { source: null }],
  ])('drops a picked message from %s', (_label, over) => {
    const onPicked = vi.fn();
    render(<StashEmbedFrame mode="pick" stashOrigin={STASH} onPicked={onPicked} />);
    post(env({ type: 'picked', items: [item] }), over);
    post(env({ type: 'resize', height: 999 }), over);
    expect(onPicked).not.toHaveBeenCalled();
    expect((screen.getByTitle('Stash files') as HTMLIFrameElement).style.height).not.toBe('999px');
  });

  it.each([
    ['a wrong version', { ...env({ type: 'picked', items: [item] }), version: 2 }],
    ['a malformed item', env({ type: 'picked', items: [{ ...item, sha256: 'nope' }] })],
    ['a string payload', 'picked'],
  ])('drops %s', (_label, data) => {
    const onPicked = vi.fn();
    render(<StashEmbedFrame mode="pick" stashOrigin={STASH} onPicked={onPicked} />);
    post(data);
    expect(onPicked).not.toHaveBeenCalled();
  });

  it('sends the embed nothing', () => {
    render(<StashEmbedFrame mode="pick" stashOrigin={STASH} onPicked={vi.fn()} />);
    const spy = vi.spyOn(frameWindow(), 'postMessage');
    post(env({ type: 'ready', signedIn: true }));
    post(env({ type: 'picked', items: [item] }));
    post(env({ type: 'cancelled' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('says Stash did not answer when no ready arrives in time', () => {
    render(<StashEmbedFrame mode="browse" stashOrigin={STASH} />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => void vi.advanceTimersByTime(STASH_EMBED_READY_TIMEOUT_MS + 1));
    expect(screen.getByRole('alert').textContent).toMatch(/Stash did not answer/);
  });

  it('a ready message in time means no such warning', () => {
    render(<StashEmbedFrame mode="browse" stashOrigin={STASH} />);
    post(env({ type: 'ready', signedIn: true }));
    act(() => void vi.advanceTimersByTime(STASH_EMBED_READY_TIMEOUT_MS + 1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a ready from the wrong origin does not count as an answer', () => {
    render(<StashEmbedFrame mode="browse" stashOrigin={STASH} />);
    post(env({ type: 'ready', signedIn: true }), { origin: 'https://evil.example' });
    act(() => void vi.advanceTimersByTime(STASH_EMBED_READY_TIMEOUT_MS + 1));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('a new address starts over: the old embed’s answer does not carry across', () => {
    const { rerender } = render(<StashEmbedFrame mode="browse" stashOrigin={STASH} />);
    post(env({ type: 'ready', signedIn: false }));
    expect(screen.getByText(/signed out of Stash/)).toBeTruthy();
    rerender(<StashEmbedFrame mode="pick" stashOrigin={STASH} />);
    expect(screen.queryByText(/signed out of Stash/)).toBeNull();
    act(() => void vi.advanceTimersByTime(STASH_EMBED_READY_TIMEOUT_MS + 1));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('tells a signed-out user how to sign in', () => {
    render(<StashEmbedFrame mode="browse" stashOrigin={STASH} />);
    expect(screen.queryByText(/signed out of Stash/)).toBeNull();
    post(env({ type: 'ready', signedIn: false }));
    expect(screen.getByText(/signed out of Stash/)).toBeTruthy();
  });
});

describe('StashPicker', () => {
  it('returns the picked references and closes', () => {
    const onPicked = vi.fn();
    const onClose = vi.fn();
    render(<StashPicker isOpen onClose={onClose} onPicked={onPicked} />);
    expect(new URL((screen.getByTitle('Stash files') as HTMLIFrameElement).src).searchParams.get('mode')).toBe('pick');
    post(env({ type: 'picked', items: [item] }));
    expect(onPicked).toHaveBeenCalledWith([item]);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on cancel without picking', () => {
    const onPicked = vi.fn();
    const onClose = vi.fn();
    render(<StashPicker isOpen onClose={onClose} onPicked={onPicked} />);
    post(env({ type: 'cancelled' }));
    expect(onClose).toHaveBeenCalled();
    expect(onPicked).not.toHaveBeenCalled();
  });

  it('renders no frame while closed', () => {
    render(<StashPicker isOpen={false} onClose={vi.fn()} onPicked={vi.fn()} />);
    expect(screen.queryByTitle('Stash files')).toBeNull();
  });
});

describe('FilesView', () => {
  it('shows the drive through Stash in browse mode by default', () => {
    render(<FilesView />);
    const frames = screen.getAllByTitle('Stash files') as HTMLIFrameElement[];
    expect(frames).toHaveLength(1);
    expect(new URL(frames[0].src).searchParams.get('mode')).toBe('browse');
  });

  it('keeps the existing browser for uploads and changes', () => {
    render(<FilesView />);
    fireEvent.click(screen.getByRole('tab', { name: /Upload/ }));
    expect(screen.getByText('legacy drive browser')).toBeTruthy();
  });

  it('Choose from Stash lists the picked files with no link', () => {
    render(<FilesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose from Stash' }));
    const pickFrame = (screen.getAllByTitle('Stash files') as HTMLIFrameElement[]).find(
      (f) => new URL(f.src).searchParams.get('mode') === 'pick'
    );
    if (!pickFrame?.contentWindow) throw new Error('no pick frame');
    post(env({ type: 'picked', items: [item] }), { source: pickFrame.contentWindow });
    const list = screen.getByRole('region', { name: 'Chosen from Stash' });
    expect(list.textContent).toContain('plan.pdf');
    expect(list.textContent).toContain('2.0 KB');
    expect(list.querySelector('a')).toBeNull();
  });
});
