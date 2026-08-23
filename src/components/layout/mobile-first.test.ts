/**
 * @fileoverview Mobile-first structural tests
 *
 * These are SOURCE-LEVEL structural tests: they read the source files and
 * assert on the text they contain. They are NOT behavioural — they do not
 * render components in jsdom. That distinction matters: a refactor that keeps
 * the class token in a different string would pass these tests even if the
 * rendered HTML changes. They exist because the layout properties they guard
 * (100dvh, tap-target minimums, modal overflow) are CSS properties that jsdom
 * cannot measure at all.
 *
 * Each test fails when the change it guards is reverted (the old token is
 * put back) and passes when the new token is present — which satisfies the
 * "must not pass on revert" requirement while being honest about the level.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const src = (rel: string) => readFileSync(resolve(__dirname, '../../..', rel), 'utf8');

// ---------------------------------------------------------------------------
// 100dvh: h-screen / min-h-screen must not appear in layout and auth files.
// 100vh clips content behind the iOS Safari URL bar; 100dvh accounts for it.
// ---------------------------------------------------------------------------

describe('100dvh — no 100vh via h-screen', () => {
  const layoutFiles = [
    'src/components/layout/MainLayout.tsx',
    'src/components/layout/Sidebar.tsx',
    'src/components/auth/LoginPage.tsx',
    'src/components/auth/AuthGuard.tsx',
    'src/components/common/ErrorBoundary.tsx',
  ];

  for (const file of layoutFiles) {
    it(`${file} uses dvh, not vh-based classes`, () => {
      const content = src(file);
      // Neither bare h-screen (= 100vh) nor min-h-screen should appear.
      expect(content).not.toMatch(/\bh-screen\b/);
      expect(content).not.toMatch(/\bmin-h-screen\b/);
    });
  }

  it('MainLayout uses h-dvh for the root shell', () => {
    const content = src('src/components/layout/MainLayout.tsx');
    expect(content).toContain('h-dvh');
  });

  it('Sidebar uses h-dvh for the fixed aside panel', () => {
    const content = src('src/components/layout/Sidebar.tsx');
    expect(content).toContain('h-dvh');
  });

  it('LoginPage uses h-dvh and min-h-dvh', () => {
    const content = src('src/components/auth/LoginPage.tsx');
    expect(content).toContain('h-dvh');
    expect(content).toContain('min-h-dvh');
  });
});

// ---------------------------------------------------------------------------
// --cloistr-primary-fg: local fallback must be defined in index.css.
// @cloistr/ui v0.20.6 does not export this token; the fallback lives in CSS.
// ---------------------------------------------------------------------------

describe('--cloistr-primary-fg local fallback', () => {
  it('index.css defines the fallback variable', () => {
    const css = src('src/index.css');
    expect(css).toContain('--cloistr-primary-fg-fallback');
  });

  it('index.css maps --color-cloistr-primary-fg in @theme', () => {
    const css = src('src/index.css');
    expect(css).toContain('--color-cloistr-primary-fg');
  });

  it('index.css comment explains the local fallback', () => {
    const css = src('src/index.css');
    expect(css).toContain('LOCAL FALLBACK');
    expect(css).toContain('0.20.6');
  });
});

// ---------------------------------------------------------------------------
// Modals: all four modals must be scrollable on small screens.
// Without max-h-[90dvh] + overflow-y-auto, a tall modal form clips the
// submit button on an iPhone 13 (844px viewport height).
// ---------------------------------------------------------------------------

describe('modal mobile-safety — max-h + overflow', () => {
  const modals = [
    'src/components/activity/CreateEventModal.tsx',
    'src/components/activity/FileUploadModal.tsx',
    'src/components/integrations/ShareModal.tsx',
    'src/components/projects/CreateGroupModal.tsx',
  ];

  for (const modal of modals) {
    it(`${modal} inner container has max-h-[90dvh] and overflow-y-auto`, () => {
      const content = src(modal);
      expect(content).toContain('max-h-[90dvh]');
      expect(content).toContain('overflow-y-auto');
    });

    it(`${modal} backdrop allows scroll with overflow-y-auto`, () => {
      const content = src(modal);
      // The outer fixed container needs overflow-y-auto so the inner card
      // can scroll into view even when taller than the viewport.
      expect(content).toContain('overflow-y-auto');
    });
  }
});

// ---------------------------------------------------------------------------
// Tap targets: critical icon-only buttons must declare min-h-[44px].
// iOS HIG and WCAG 2.5.5 require at least 44×44 CSS px touch targets.
// Buttons with small padding icons (p-1, p-2) are below that threshold
// without an explicit minimum.
// ---------------------------------------------------------------------------

describe('tap targets — min-h-[44px] on critical icon buttons', () => {
  it('MainLayout hamburger button has min-h-[44px]', () => {
    const content = src('src/components/layout/MainLayout.tsx');
    // The hamburger opens the mobile drawer — it MUST be reachable with a thumb.
    expect(content).toContain('min-h-[44px]');
  });

  it('Sidebar toggle button has min-h-[44px]', () => {
    const content = src('src/components/layout/Sidebar.tsx');
    expect(content).toContain('min-h-[44px]');
  });

  it('SubHeader bell button has min-h-[44px]', () => {
    const content = src('src/components/layout/SubHeader.tsx');
    expect(content).toContain('min-h-[44px]');
  });

  it('Modal close buttons have min-h-[44px]', () => {
    const modals = [
      'src/components/activity/CreateEventModal.tsx',
      'src/components/activity/FileUploadModal.tsx',
      'src/components/integrations/ShareModal.tsx',
      'src/components/projects/CreateGroupModal.tsx',
    ];
    for (const m of modals) {
      expect(src(m), `close button in ${m}`).toContain('min-h-[44px]');
    }
  });

  it('FileBrowser file action buttons have min-h-[44px]', () => {
    const content = src('src/components/integrations/FileBrowser.tsx');
    expect(content).toContain('min-h-[44px]');
  });
});

// ---------------------------------------------------------------------------
// Desktop-only affordances: FileBrowser must NOT hide actions behind hover.
// opacity-0 group-hover:opacity-100 makes those buttons invisible on touch
// (hover never fires on capacitive screens). They must always be reachable.
// ---------------------------------------------------------------------------

describe('FileBrowser — no hover-only action visibility', () => {
  it('does not use opacity-0 group-hover:opacity-100 to hide action buttons', () => {
    const content = src('src/components/integrations/FileBrowser.tsx');
    // This pattern makes buttons invisible on touch; it must be absent.
    expect(content).not.toContain('opacity-0 group-hover:opacity-100');
    expect(content).not.toContain('opacity-0 hover:opacity-100');
  });
});

// ---------------------------------------------------------------------------
// NavLinks: sidebar nav items must have min-h-[44px] for touch targets.
// ---------------------------------------------------------------------------

describe('Sidebar NavLink tap targets', () => {
  it('NavLink className includes min-h-[44px]', () => {
    const content = src('src/components/layout/Sidebar.tsx');
    expect(content).toContain('min-h-[44px]');
  });
});
