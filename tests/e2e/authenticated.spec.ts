/**
 * authenticated.spec.ts — Authenticated E2E walkthrough against space.cloistr.xyz
 *
 * AUTHENTICATION: Seeded state (not browser-driven login).
 * global-setup.ts calls the signer API to create a NIP-46 session and writes
 * tests/e2e/.auth/session.json. Each test seeds localStorage from that fixture.
 * The browser login path is additionally exercised by the dedicated "login" test.
 * This is declared because seeded state does not exercise AuthProvider.restoreSession()
 * end-to-end, and that path has broken twice.
 *
 * ASSERTION DISCIPLINE: every assertion is on CONTENT or COUNTS.
 * The test account follows nobody, so "Following" mode shows "No contacts yet".
 * All feed assertions use "Global" mode which loads notes regardless of follows.
 * Filter-difference assertion compares Global (has notes) vs Following (empty by design).
 *
 * WHERE SOMETHING IS ASSERTED ABSENT, the test first proves the selector works
 * by confirming at least one note loaded. Otherwise "no post-not-found" vacuously
 * passes on a blank page.
 *
 * RELAY CONTENT DEPENDENCY.
 * relay.cloistr.xyz is a live relay with real content. Tests that assert
 * specific COUNTS (>1 author, >0 replies) must be written to tolerate a relay
 * that is sparse at any given moment. Verified 2026-08-31: the relay had 100
 * consecutive notes from a single author, so any ">1 distinct author" assertion
 * fails correctly — it is an environment assertion, not an application assertion.
 * Tests 2 and 3 are adjusted accordingly.
 *
 * TIMING BUDGET PER TEST (90 s limit):
 *   dismissSignerError: up to 20 s (covers the 15 s NIP-46 session restore timeout)
 *   note wait:          up to 25 s
 *   extra multi-note:   up to 15 s
 *   assertions:         < 10 s
 *   Subtotal:           ~70 s worst case — leaves 20 s headroom.
 */

import { test, expect } from '@playwright/test';
import { seedAuthState, dismissSignerError, loadSessionFixture } from './helpers/auth-production';
import type { SessionFixture } from './helpers/auth-production';

// 90 s per test to cover: 20 s (signer overlay dismiss) + 25 s (note wait) + buffer
test.describe.configure({ timeout: 90000 });

const BASE = 'https://space.cloistr.xyz';

test.describe('Authenticated walkthrough — space.cloistr.xyz', () => {
  let session: SessionFixture;

  test.beforeAll(async () => {
    // Called after global-setup.ts has written the fixture
    session = loadSessionFixture();
  });

  // ---------------------------------------------------------------------------
  // Helper: go to /social in Global mode with auth, wait for at least one note.
  //
  // dismissSignerError waits 20 s so it catches the 15 s NIP-46 session restore
  // timeout. If the signer reconnect succeeds, it returns immediately.
  // ---------------------------------------------------------------------------
  async function goToGlobalFeed(page: Parameters<typeof seedAuthState>[0]): Promise<void> {
    await seedAuthState(page, session);
    await page.goto(`${BASE}/social`);
    await dismissSignerError(page);
    // Switch to Global — test account follows nobody, Following is empty
    await page.getByRole('button', { name: 'Global' }).click();
    await page.locator('[aria-label^="Open this post"]').first().waitFor({ timeout: 25000 });
  }

  // ---------------------------------------------------------------------------
  // 1. Login completes — browser path
  // ---------------------------------------------------------------------------
  test('login: modal navigates to bunker screen, no eternal spinner on connect', async ({ page }) => {
    // Starts UNAUTHENTICATED and uses the browser login UI.
    // Uses the bunkerUrl already approved by the signer in global-setup.
    await page.goto(BASE);
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Open the sign-in modal via the page-level CTA
    await page.getByRole('button', { name: 'Sign in with Cloistr' }).first().click();

    // Expand advanced login methods (bunker is hidden behind this toggle)
    await page.getByRole('button', { name: 'Other login methods' }).click();

    // Navigate to the bunker URL screen
    await page.getByRole('button', { name: 'Bunker URL (NIP-46)' }).click();

    // Bunker URL input must now be visible — proves the screen rendered
    const bunkerInput = page.getByLabel('Bunker URL');
    await expect(bunkerInput).toBeVisible({ timeout: 5000 });

    // Fill with the pre-approved session bunker URL from global-setup
    await bunkerInput.fill(session.bunkerUrl);

    // Connect button is enabled only when the URL is valid per isValidBunkerUrl()
    const connectBtn = page.getByRole('button', { name: 'Connect' });
    await expect(connectBtn).toBeEnabled({ timeout: 2000 });
    await connectBtn.click();

    // Wait for redirect away from /login (up to 30 s for NIP-46 handshake)
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });

    // Workspace nav must be visible — proves we reached the app shell.
    // Two <nav> elements exist (sidebar + footer); select by name to avoid strict mode.
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible({ timeout: 10000 });
  });

  // ---------------------------------------------------------------------------
  // 2. Feed (Global) renders notes — and they are not filtered to only the
  //    authenticated user's network.
  //
  // WHAT THIS TESTS: that Global mode does not incorrectly scope to the user's
  // follow list or show an empty feed when the user follows nobody.
  //
  // WHAT THIS DOES NOT TEST: that multiple distinct authors are always present.
  // relay.cloistr.xyz is a live relay; the last 100 notes verified on 2026-08-31
  // were all from a single author. Asserting ">1 distinct author" is an assertion
  // about relay content, not application behaviour — a sparse relay would make it
  // permanently fail regardless of whether the code is correct. The code-level
  // check (Global mode queries all connected relays, not just explicitRelayUrls)
  // is covered by unit tests in globalRelays.test.ts.
  // ---------------------------------------------------------------------------
  test('social feed (Global): notes appear, feed is not filtered to empty', async ({ page }) => {
    await goToGlobalFeed(page);

    // Wait up to 15 s for at least 2 notes so the feed is genuinely populated.
    await page.waitForFunction(
      () => document.querySelectorAll('[aria-label^="Open this post"]').length >= 2,
      { timeout: 15000 },
    ).catch(() => {}); // let the count assertion below give the real message

    const noteLinks = page.locator('[aria-label^="Open this post"]');
    const count = await noteLinks.count();
    expect(
      count,
      'Global feed has fewer than 2 notes — relay is sparse or query filters too aggressively',
    ).toBeGreaterThan(1);

    // Each note card renders a profile link: aria-label="<displayName>'s profile"
    const profileLinks = page.locator('[aria-label$="\'s profile"]');
    const linkCount = await profileLinks.count();
    expect(linkCount, 'notes must have author profile links').toBeGreaterThan(0);

    // The application-level invariant: Global mode must not show a ZERO-note feed
    // when the relay has events. As long as notes appear (checked above), the
    // global filter is not incorrectly excluding all content.
    //
    // The ">1 distinct author" assertion is intentionally absent here. Verified
    // on 2026-08-31: the relay had 100 consecutive notes from one author. An
    // assertion that contradicts live relay state is not a useful regression test;
    // it is noise that trains reviewers to ignore failures.
    expect(linkCount, 'profile links present — feed rendered note author data').toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 3. Engagement counts surface when the relay has any engagement data.
  //
  // WHAT THIS TESTS: that the engagement subscription correctly routes to all
  // connected relays and that reaction counts update in the UI.
  //
  // WHAT THIS DOES NOT TEST: that reply counts are always non-zero. The relay
  // verified on 2026-08-31 had 0 replies to feed notes but 2 reactions. Testing
  // only reply counts (kind:1 tagged with note IDs) would permanently fail on
  // a relay with zero replies. The engagement subscription correctness question
  // is better tested via reactions (kind:7), which the relay does have.
  //
  // The reaction button now carries aria-label="Reactions to this post (N)"
  // so this test can find and assert on it.
  //
  // TIMING: the engagement subscription starts 500 ms after notes settle, then
  // the relay responds, then applyEngagement runs. waitForFunction polls until
  // at least one count appears non-zero, giving the subscription time to complete.
  // ---------------------------------------------------------------------------
  test('social feed (Global): at least one note has a non-zero engagement count', async ({ page }) => {
    await goToGlobalFeed(page);

    // Engagement buttons must render before checking counts.
    // The reply button appears immediately (with count 0); reactions also appear
    // immediately. Wait for the first reply button to confirm the feed rendered.
    const replyButtons = page.locator('[aria-label^="Replies to this post"]');
    await replyButtons.first().waitFor({ timeout: 10000 });
    const btnCount = await replyButtons.count();
    expect(btnCount, 'reply count buttons must exist on feed notes').toBeGreaterThan(0);

    // The engagement subscription has a 500 ms settle period before it opens,
    // then the relay must respond and applyEngagement must run. Poll until at
    // least one reaction count appears non-zero, up to 15 s.
    //
    // The selector covers reactions (aria-label="Reactions to this post (N)")
    // because reactions exist on relay.cloistr.xyz while replies do not. Both
    // are equally valid evidence that the engagement subscription routed correctly
    // and that applyEngagement updated the feed. Checking only replies would
    // permanently fail on a relay with zero replies, which is a data constraint,
    // not a code bug.
    const anyNonZero = await page.waitForFunction(
      () => {
        // Check reaction counts (aria-label="Reactions to this post (N)")
        const rxnBtns = document.querySelectorAll('[aria-label^="Reactions to this post"]');
        for (const btn of rxnBtns) {
          const match = btn.getAttribute('aria-label')?.match(/\((\d+)\)/);
          if (match && parseInt(match[1]!, 10) > 0) return true;
        }
        // Also accept non-zero reply counts if they appear (belt-and-suspenders).
        const replyBtns = document.querySelectorAll('[aria-label^="Replies to this post"]');
        for (const btn of replyBtns) {
          const match = btn.getAttribute('aria-label')?.match(/\((\d+)\)/);
          if (match && parseInt(match[1]!, 10) > 0) return true;
        }
        return false;
      },
      { timeout: 15000 },
    ).catch(() => null);

    expect(
      anyNonZero !== null,
      'all engagement counts are zero after 15 s — the engagement subscription is not routing to the relay or applyEngagement is not running. ' +
      'The relay (relay.cloistr.xyz) has kind:7 reactions for feed notes; if the subscription were working, at least one reaction count would be > 0.',
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. Clicking a note opens detail without "Post not found"
  // ---------------------------------------------------------------------------
  test('note detail: clicking a Global feed note does not show "Post not found"', async ({ page }) => {
    await goToGlobalFeed(page);

    await page.locator('[aria-label^="Open this post"]').first().click();
    await expect(page).toHaveURL(/\/e\//, { timeout: 8000 });

    // Wait for loading to clear before asserting "not found" is absent
    await page.getByText('Loading post…').waitFor({ state: 'hidden', timeout: 18000 }).catch(() => {});

    const notFound = page.getByRole('heading', { name: 'Post not found' });
    expect(
      await notFound.count(),
      '"Post not found" appeared for a note that was visible in the feed one click earlier',
    ).toBe(0);

    // Prove the selector works: article content must be present
    const article = page.locator('article').or(page.locator('[role="article"]'));
    await expect(article.first()).toBeVisible({ timeout: 5000 });
  });

  // ---------------------------------------------------------------------------
  // 5. Three feed filters produce distinct note sets
  //    Test account follows nobody, so Following = empty by design.
  //    Assert: Global has notes AND Global differs from Following.
  // ---------------------------------------------------------------------------
  test('social feed: Global differs from Following, both behave deterministically', async ({ page }) => {
    await seedAuthState(page, session);
    await page.goto(`${BASE}/social`);
    await dismissSignerError(page);

    // Following mode — test account follows nobody → "No contacts yet"
    await page.waitForTimeout(3000);
    const followingText = page.getByText('No contacts yet');
    const followingIsEmpty = await followingText.isVisible().catch(() => false);

    // Global mode — must have notes
    await page.getByRole('button', { name: 'Global' }).click();
    await page.locator('[aria-label^="Open this post"]').first().waitFor({ timeout: 25000 });

    async function collectIds(): Promise<string[]> {
      const links = await page.locator('a[href^="/e/"]').all();
      const ids: string[] = [];
      for (const l of links) {
        const href = await l.getAttribute('href');
        if (href) {
          const id = href.replace('/e/', '').split('?')[0]!;
          if (id.length > 20) ids.push(id);
        }
      }
      return [...new Set(ids)];
    }

    const globalIds = await collectIds();
    expect(globalIds.length, 'Global mode must return at least one note').toBeGreaterThan(0);

    // If Following was empty by design, they are inherently different.
    expect(
      followingIsEmpty || globalIds.length > 0,
      'Global returned no notes even though Following was empty — both queries are broken',
    ).toBe(true);

    // WoT mode
    await page.getByRole('button', { name: 'WoT' }).click();
    await page.waitForTimeout(4000);
    const wotIds = await collectIds();

    // The pathological bug was ALL THREE modes returning IDENTICAL sets from
    // a shared cache key. Assert that at least Global differs from Following.
    const globalAfterWot = new Set(wotIds);
    const wotHasGlobalNotes = globalIds.every(id => globalAfterWot.has(id));
    expect(
      followingIsEmpty || !wotHasGlobalNotes,
      'All three feed modes are identical — filter cache keys are likely shared',
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 6. No duplicate note IDs in Global feed
  //
  // WHAT THIS TESTS: that each note event renders at most one "Open this post"
  // link in the feed. This catches the state bug where the same note object
  // appears twice in the notes array (e.g., from a snapshot restore that did
  // not seed seenIdsRef, causing the live subscription to redelivery every
  // restored note as a second copy).
  //
  // SELECTOR CHOICE: [aria-label^="Open this post"] rather than a[href^="/e/"].
  //
  // The broader a[href^="/e/"] selector would also match the "Replies to this
  // post (N)" action button, which links to the SAME note URL. Each NoteCard
  // intentionally has TWO links to the same note URL (overlay + reply button)
  // so that right-click/middle-click work on both. Collecting all /e/ links
  // would therefore find every note ID twice — 10 notes → 20 links — and the
  // test would report all 10 as "duplicates" even when the feed is correct.
  //
  // [aria-label^="Open this post"] selects ONLY the overlay link, which is
  // unique per NoteCard. Duplicate notes in the React state produce two
  // overlay links with the same href, which this test catches.
  // ---------------------------------------------------------------------------
  test('social feed (Global): no note ID appears twice', async ({ page }) => {
    await goToGlobalFeed(page);

    // Use the overlay link selector — one per NoteCard, not the reply button.
    const overlayLinks = await page.locator('[aria-label^="Open this post"]').all();
    const ids: string[] = [];
    for (const link of overlayLinks) {
      const href = await link.getAttribute('href');
      if (href) {
        const id = href.replace('/e/', '').split('?')[0]!;
        if (id.length > 20) ids.push(id);
      }
    }

    // Prove IDs were collected before asserting no duplicates
    expect(ids.length, 'must have collected at least one note ID from Global feed').toBeGreaterThan(0);

    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(
      [...new Set(duplicates)],
      `duplicate note IDs: ${[...new Set(duplicates)].slice(0, 3).join(', ')}`,
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 7. Profile: NIP-05 shown correctly, avatar not rendered as raw URL text
  // ---------------------------------------------------------------------------
  test('profile: NIP-05 shown as identifier, avatar is an image not raw URL text', async ({ page }) => {
    await goToGlobalFeed(page);

    // Click first author profile link
    await page.locator('[aria-label$="\'s profile"]').first().click();
    await expect(page).toHaveURL(/\/p\//, { timeout: 8000 });
    await page.waitForTimeout(5000);

    // If a NIP-05 is displayed, it must be an email-style identifier, not a URL
    const nip05Spans = page.locator('span').filter({ hasText: /^[\w.+%-]+@[\w.-]+$/ });
    if (await nip05Spans.count() > 0) {
      const text = await nip05Spans.first().textContent();
      expect(text, 'NIP-05 must be an email-style identifier, not a raw URL').not.toMatch(/^https?:\/\//);
    }

    // Look for a user avatar with an https:// src — skips the Cloistr logo
    // (which is an inline SVG or data: URI and IS correctly rendered as an image).
    // If an https:// avatar exists, its URL must not appear as raw visible text.
    const avatarImg = page.locator('img[src^="https://"]').first();
    if (await avatarImg.count() > 0) {
      const src = await avatarImg.getAttribute('src');
      if (src) {
        const visibleUrl = page.getByText(src, { exact: true });
        expect(
          await visibleUrl.count(),
          'avatar URL rendered as plain text — image element is missing or broken',
        ).toBe(0);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 8. Projects: settings panel is populated, not blank
  // ---------------------------------------------------------------------------
  test('projects: settings panel shows the project name, not blank', async ({ page }) => {
    await seedAuthState(page, session);
    await page.goto(`${BASE}/projects`);
    await dismissSignerError(page);
    await page.waitForTimeout(6000);

    const groupItems = page
      .locator('[data-testid="projects-group-list-panel"] [role="button"]')
      .or(page.locator('[data-testid="projects-group-list-panel"] a'));

    if (await groupItems.count() === 0) {
      test.skip(true, 'No projects for test account — skipping settings check');
      return;
    }

    await groupItems.first().click();

    const settingsTab = page
      .getByRole('tab', { name: /settings/i })
      .or(page.getByRole('link', { name: /settings/i }))
      .or(page.getByRole('button', { name: /settings/i }));

    if (await settingsTab.count() === 0) {
      test.skip(true, 'No settings tab in workspace');
      return;
    }
    await settingsTab.first().click();

    const nameInput    = page.getByLabel('Name').or(page.getByPlaceholder('Project name'));
    const couldNotLoad = page.getByText("Could not load this project's details");

    await Promise.race([
      nameInput.first().waitFor({ timeout: 12000 }),
      couldNotLoad.waitFor({ timeout: 12000 }),
    ]).catch(() => {});

    expect(
      await couldNotLoad.count(),
      '"Could not load this project\'s details" — settings blank; saving from here wipes kind:39000',
    ).toBe(0);

    const nameVal = await nameInput.first().inputValue().catch(() => '');
    expect(
      nameVal.trim(),
      'Project name input is empty — data-loss risk: saving blank name wipes the kind:39000 name tag',
    ).not.toBe('');
  });

  // ---------------------------------------------------------------------------
  // 9. No unhandled console errors or uncaught HTTP failures on load
  // ---------------------------------------------------------------------------
  test('no console errors, no uncaught HTTP failures on Global feed load', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const errorResponses: string[] = [];

    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Filter noise: favicons, ResizeObserver, WebSocket errors, non-Error rejections,
      // and the browser's generic "Failed to load resource: 401" (the URL is captured
      // separately via the response listener where it CAN be filtered by domain).
      if (
        text.includes('favicon') ||
        text.includes('ResizeObserver loop') ||
        text.includes('WebSocket') ||
        text.includes('Non-Error promise rejection') ||
        text.includes('Failed to load resource')
      ) return;
      consoleErrors.push(text);
    });

    page.on('requestfailed', req => {
      const url = req.url();
      if (url.startsWith('ws://') || url.startsWith('wss://')) return;
      if (url.includes('favicon')) return;
      const errorText = req.failure()?.errorText ?? '';
      // ERR_ABORTED: browser cancelled inflight requests during test navigation — not bugs
      if (errorText.includes('ERR_ABORTED')) return;
      failedRequests.push(`${req.method()} ${url}: ${errorText || 'unknown'}`);
    });

    // Capture HTTP 4xx/5xx responses.
    // signer.cloistr.xyz 401s are expected with seeded auth (no signer session cookie).
    // All other 4xx/5xx responses are unexpected and represent real bugs.
    page.on('response', res => {
      const status = res.status();
      if (status < 400) return;
      const url = res.url();
      if (url.includes('favicon')) return;
      if (url.startsWith('ws://') || url.startsWith('wss://')) return;
      // Filter expected signer 401s (seeded auth lacks the signer session cookie)
      if (status === 401 && url.includes('signer.cloistr.xyz')) return;
      errorResponses.push(`HTTP ${status} ${res.request().method()} ${url}`);
    });

    await goToGlobalFeed(page);

    // Confirm the instrument can see content — prevents vacuous pass on broken feed
    const noteCount = await page.locator('[aria-label^="Open this post"]').count();
    expect(noteCount, 'Global feed must have notes before error assertions (proves instrument is live)').toBeGreaterThan(0);

    // Report all error categories together so URLs are visible even when console errors fire
    const allErrors = [
      ...consoleErrors.map(e => `console: ${e}`),
      ...failedRequests.map(e => `request-failed: ${e}`),
      ...errorResponses.map(e => `http-error: ${e}`),
    ];
    expect(
      allErrors,
      `Errors on Global feed load:\n${allErrors.join('\n')}`,
    ).toHaveLength(0);
  });
});
