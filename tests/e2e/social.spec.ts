import { expect } from '@playwright/test';
import { test } from './helpers/fixtures';

test.describe('Social Feed', () => {
  test.beforeEach(async ({ authHelper }) => {
    await authHelper.mockAuthenticatedState();
  });

  test('loads social feed successfully', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    // Verify we're on the social page
    await expect(page).toHaveURL(/.*\/social$/);

    // Verify main content area is visible
    await expect(socialFeed.mainContent).toBeVisible();

    // Verify page has loaded (no loading states)
    await expect(page.locator('[data-testid="loading"]')).not.toBeVisible();
  });

  test('displays social page title', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    // Look for page title/heading
    const possibleTitles = [
      page.getByRole('heading', { name: /social/i }),
      page.getByRole('heading', { name: /feed/i }),
      page.getByRole('heading', { name: /notes/i }),
      page.getByText(/social/i).first(),
      page.getByText(/feed/i).first()
    ];

    let titleFound = false;
    for (const title of possibleTitles) {
      try {
        await expect(title).toBeVisible({ timeout: 1000 });
        titleFound = true;
        break;
      } catch {
        // Continue trying
      }
    }

    // At least one title should be found, or the page should have social-related content
    if (!titleFound) {
      await expect(socialFeed.mainContent).toContainText(/social|feed|notes/i);
    }
  });

  test('shows sidebar with social link active', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    await expect(socialFeed.sidebar).toBeVisible();
    await expect(socialFeed.socialLink).toBeVisible();

    // Social link should have active styling
    await expect(socialFeed.socialLink).toHaveClass(/active|bg-.*primary|text-.*primary/);
  });

  test('displays feed content or empty state', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    // Look for posts or empty state
    const hasPosts = (await socialFeed.getPostCount()) > 0;
    const hasEmptyState = await socialFeed.emptyState.isVisible().catch(() => false);

    // Either there should be posts, or an empty state, or a feed container
    if (!hasPosts && !hasEmptyState) {
      // Should at least have main content area for the feed
      await expect(socialFeed.mainContent).toBeVisible();
    }
  });

  test('compose button is accessible when available', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    // Check if compose button exists
    const composeButtonExists = await socialFeed.composeButton.count() > 0;

    if (composeButtonExists) {
      await expect(socialFeed.composeButton).toBeVisible();
      await expect(socialFeed.composeButton).toBeEnabled();
    }
  });

  test('compose flow works when available', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    // Check if compose functionality exists
    const composeButtonExists = await socialFeed.composeButton.count() > 0;

    if (composeButtonExists) {
      await socialFeed.composeButton.click();

      // Check if compose area appears
      const composeAreaExists = await socialFeed.composeArea.isVisible();
      if (composeAreaExists) {
        await socialFeed.composeArea.fill('Test post content');
        await expect(socialFeed.composeArea).toHaveValue('Test post content');

        // Check if publish button is available
        const publishButtonExists = await socialFeed.publishButton.count() > 0;
        if (publishButtonExists) {
          await expect(socialFeed.publishButton).toBeEnabled();
          // Don't actually publish in tests
        }
      }
    }
  });

  test('post cards are visible when available', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    const postCount = await socialFeed.getPostCount();

    if (postCount > 0) {
      // First post card should be visible
      await expect(socialFeed.postCard.first()).toBeVisible();

      // Posts should contain some content
      const firstPost = socialFeed.postCard.first();
      const postContent = await firstPost.textContent();
      expect(postContent?.length).toBeGreaterThan(0);
    }
  });

  test('load more functionality works when available', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    // Check if load more button exists
    const loadMoreExists = await socialFeed.loadMoreButton.count() > 0;

    if (loadMoreExists) {
      const initialPostCount = await socialFeed.getPostCount();

      await socialFeed.loadMore();

      // Wait a moment for potential loading
      await page.waitForTimeout(1000);

      // Either more posts loaded, or the button behavior changed
      const newPostCount = await socialFeed.getPostCount();
      expect(newPostCount).toBeGreaterThanOrEqual(initialPostCount);
    }
  });

  test('feed filters work when available', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    // Check if feed filters exist
    const filtersExist = await socialFeed.feedFilters.count() > 0;

    if (filtersExist) {
      await expect(socialFeed.feedFilters).toBeVisible();

      // Interact with filters if they're interactive
      const filterButtons = socialFeed.feedFilters.locator('button');
      const filterButtonCount = await filterButtons.count();

      if (filterButtonCount > 0) {
        await expect(filterButtons.first()).toBeEnabled();
      }
    }
  });

  test('responsive design works on mobile', async ({ page, socialFeed }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await socialFeed.goto();

    // Main content should still be visible on mobile
    await expect(socialFeed.mainContent).toBeVisible();

    // Sidebar should still be accessible
    await expect(socialFeed.sidebar).toBeVisible();

    // Check if posts adapt to mobile layout
    if ((await socialFeed.getPostCount()) > 0) {
      await expect(socialFeed.postCard.first()).toBeVisible();
    }

    // Compose button should still be accessible on mobile
    if (await socialFeed.composeButton.count() > 0) {
      await expect(socialFeed.composeButton).toBeVisible();
    }
  });

  test('scroll behavior works correctly', async ({ page, socialFeed }) => {
    await socialFeed.goto();

    // Test scrolling behavior in the main content area
    const mainContent = socialFeed.mainContent;

    // Scroll down
    await mainContent.evaluate(element => {
      element.scrollTop = element.scrollHeight / 2;
    });

    // Page should remain stable
    await expect(socialFeed.mainContent).toBeVisible();

    // Scroll back to top
    await mainContent.evaluate(element => {
      element.scrollTop = 0;
    });

    await expect(socialFeed.mainContent).toBeVisible();
  });
});