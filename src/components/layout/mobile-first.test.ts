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
 *
 * NOTE (2026-08-24 AppShell migration)
 * The mobile hamburger is now owned by AppShell from @cloistr/ui 0.30.0.
 * Sidebar.tsx was removed — nav links live in SpaceNavLinks.tsx. Tests that
 * previously asserted on Sidebar.tsx or the app-owned hamburger in MainLayout
 * have been updated accordingly.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
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

  it('MainLayout uses h-dvh for the inner content column', () => {
    const content = src('src/components/layout/MainLayout.tsx');
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
// iOS HIG and WCAG 2.5.5 require at least 44x44 CSS px touch targets.
// Buttons with small padding icons (p-1, p-2) are below that threshold
// without an explicit minimum.
// ---------------------------------------------------------------------------

describe('tap targets — min-h-[44px] on critical icon buttons', () => {
  it('AppShell owns the mobile hamburger; MainLayout must NOT contain a hamburger button', () => {
    const content = src('src/components/layout/MainLayout.tsx');
    // The app-owned hamburger was removed in the AppShell migration. The shell
    // (AppShell from @cloistr/ui 0.30.0) renders its own tap-compliant toggle
    // via SidebarToggle. The app must not add a second one.
    expect(content).not.toContain('aria-label="Open navigation"');
    expect(content).not.toContain('md:hidden');
  });

  it('SpaceNavLinks nav items have min-h-[44px]', () => {
    const content = src('src/components/layout/SpaceNavLinks.tsx');
    // Every nav link must be reachable with a thumb.
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
// AppShell integration: MainLayout must use AppShell from @cloistr/ui.
// The single mobile hamburger belongs to the shell, not the app.
// ---------------------------------------------------------------------------

describe('AppShell integration', () => {
  it('MainLayout imports AppShell from @cloistr/ui/components', () => {
    const content = src('src/components/layout/MainLayout.tsx');
    expect(content).toContain("from '@cloistr/ui/components'");
    expect(content).toContain('AppShell');
  });

  it('MainLayout passes nav to AppShell (space has in-app nav)', () => {
    const content = src('src/components/layout/MainLayout.tsx');
    // nav= wires SpaceNavLinks into the shell drawer / desktop sidebar.
    expect(content).toContain('nav={');
    expect(content).toContain('SpaceNavLinks');
  });

  it('MainLayout does not pass menu to AppShell (space has no app commands)', () => {
    const content = src('src/components/layout/MainLayout.tsx');
    // space has no menu bar — passing menu would add an empty control.
    expect(content).not.toMatch(/menu=\{/);
  });

  it('index.css does not contain the old mobile hamburger clearance rule', () => {
    const css = src('src/index.css');
    // The padding-left:56px hack was only needed for the now-removed app hamburger.
    expect(css).not.toContain('padding-left: 56px');
  });
});

// ---------------------------------------------------------------------------
// NavLinks: nav items must have min-h-[44px] for touch targets.
// ---------------------------------------------------------------------------

describe('SpaceNavLinks tap targets', () => {
  it('NavLink className includes min-h-[44px]', () => {
    const content = src('src/components/layout/SpaceNavLinks.tsx');
    expect(content).toContain('min-h-[44px]');
  });
});

// ---------------------------------------------------------------------------
// No hover-only action visibility anywhere in src/components.
// opacity-0 group-hover:opacity-100 makes action buttons permanently invisible
// on touch (hover events never fire on capacitive screens). This was present
// in FileBrowser and DocumentList; scan every component file so it cannot
// silently recur in a new file.
// ---------------------------------------------------------------------------

function collectComponentFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      files.push(...collectComponentFiles(full));
    } else if ((entry.endsWith('.tsx') || entry.endsWith('.ts')) && !entry.endsWith('.test.tsx') && !entry.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('no hover-only action visibility — all component files', () => {
  const root = resolve(__dirname, '../../..');
  const componentDir = resolve(root, 'src/components');
  const files = collectComponentFiles(componentDir);

  it('no component file uses opacity-0 group-hover:opacity-100 to hide action buttons', () => {
    const violators: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (
        content.includes('opacity-0 group-hover:opacity-100') ||
        content.includes('opacity-0 hover:opacity-100')
      ) {
        violators.push(file.replace(root + '/', ''));
      }
    }
    expect(
      violators,
      `These files hide action buttons from touch users:\n${violators.join('\n')}`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Horizontal overflow from user-supplied content.
//
// Operator, once the feed started loading: "it's not the fixed mobile width
// I'm expecting". Two causes, both needed to widen the page:
//
//   1. whitespace-pre-wrap wraps at whitespace. Nostr content is full of
//      strings with none -- npub1..., note1..., nevent1..., bare URLs, hex
//      event ids -- so a 63-character npub cannot break and forces the
//      paragraph wider than its container.
//   2. min-w-0 was absent everywhere. A flex child defaults to
//      min-width:auto and refuses to shrink below its content, so the
//      overflow does not stay in the paragraph: it widens the flex child,
//      then the card, then the page.
//
// Fixed with break-words and min-w-0, NOT by hiding overflow -- the
// governance doc lists clipping to mask an overflowing layout as an
// anti-pattern, and it would hide the text rather than wrap it.
//
// Source-level, like the rest of this file: jsdom performs no layout, so the
// overflow itself is not measurable here. These assert the properties that
// prevent it and fail if they are removed.
// ---------------------------------------------------------------------------

describe('user content cannot widen the page', () => {
  // NoteContent replaced SocialFeed's inline rendering: the feed, the profile
  // page and the thread view all render posts through it now, so the property
  // is asserted where the content actually lives rather than where it used to.
  // SocialFeed is deliberately NOT listed -- it no longer renders raw user text
  // directly, and asserting a pre-wrap it does not need would be a guard that
  // fails for the wrong reason.
  const CONTENT_SURFACES = [
    'src/components/social/NoteContent.tsx',
    'src/components/projects/GroupChat.tsx',
    'src/components/projects/GroupThreads.tsx',
  ];

  for (const file of CONTENT_SURFACES) {
    it(`${file} pairs whitespace-pre-wrap with break-words`, () => {
      const text = src(file);
      const preWrapCount = (text.match(/whitespace-pre-wrap/g) ?? []).length;
      const breakWordsCount = (text.match(/break-words/g) ?? []).length;

      expect(preWrapCount, 'expected this file to render user content').toBeGreaterThan(0);
      // Every pre-wrap surface needs a wrap rule; a bare one can be widened by
      // any unbreakable string a user posts.
      expect(
        breakWordsCount,
        'whitespace-pre-wrap without break-words: an npub or URL will widen the page'
      ).toBeGreaterThanOrEqual(preWrapCount);
    });
  }

  it('SocialFeed constrains the flex child holding the display name', () => {
    // A kind:0 display_name is arbitrary text now that profiles resolve, so
    // this stopped being hypothetical the moment avatars started working.
    expect(src('src/components/social/SocialFeed.tsx')).toContain('min-w-0');
  });

  it('GroupChat constrains the flex child holding the message body', () => {
    expect(src('src/components/projects/GroupChat.tsx')).toContain('min-w-0 flex-1');
  });

  it('does not mask overflow by clipping user content', () => {
    // overflow-hidden on a content surface would make these tests pass while
    // truncating what the user wrote. Explicitly not the fix.
    for (const file of CONTENT_SURFACES) {
      const text = src(file);
      const contentBlocks = text
        .split('\n')
        .filter((l) => l.includes('whitespace-pre-wrap'));
      for (const line of contentBlocks) {
        expect(line, `${file}: content clipped rather than wrapped`).not.toContain(
          'overflow-hidden'
        );
      }
    }
  });
});
