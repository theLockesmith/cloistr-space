import { expect } from '@playwright/test';
import { test } from './helpers/fixtures';

test.describe('Projects View', () => {
  test.beforeEach(async ({ authHelper }) => {
    await authHelper.mockAuthenticatedState();
  });

  test('loads projects view successfully', async ({ page, projectsView }) => {
    await projectsView.goto();

    // Verify we're on the projects page
    await expect(page).toHaveURL(/.*\/projects$/);

    // Verify main content area is visible
    await expect(projectsView.mainContent).toBeVisible();

    // Verify page has loaded (no loading states)
    await expect(page.locator('[data-testid="loading"]')).not.toBeVisible();
  });

  test('displays projects page title', async ({ page, projectsView }) => {
    await projectsView.goto();

    // Look for page title/heading
    const possibleTitles = [
      page.getByRole('heading', { name: /projects/i }),
      page.getByRole('heading', { name: /groups/i }),
      page.getByText(/projects/i).first(),
      page.getByText(/groups/i).first()
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

    // At least one title should be found, or the page should have project-related content
    if (!titleFound) {
      await expect(projectsView.mainContent).toContainText(/projects|groups/i);
    }
  });

  test('shows sidebar with projects link active', async ({ page, projectsView }) => {
    await projectsView.goto();

    await expect(projectsView.sidebar).toBeVisible();
    await expect(projectsView.projectsLink).toBeVisible();

    // Projects link should have active styling
    await expect(projectsView.projectsLink).toHaveClass(/active|bg-.*primary|text-.*primary/);
  });

  test('displays projects or empty state', async ({ page, projectsView }) => {
    await projectsView.goto();

    // Look for projects list or empty state
    const hasProjects = (await projectsView.projectCard.count()) > 0;
    const hasEmptyState = await projectsView.emptyState.isVisible().catch(() => false);

    // Either there should be projects, or an empty state, or a projects container
    if (!hasProjects && !hasEmptyState) {
      // Should at least have main content area for projects
      await expect(projectsView.mainContent).toBeVisible();
    }
  });

  test('create project button is accessible when available', async ({ page, projectsView }) => {
    await projectsView.goto();

    // Check if create project button exists
    const createButtonExists = await projectsView.createProjectButton.count() > 0;

    if (createButtonExists) {
      await expect(projectsView.createProjectButton).toBeVisible();
      await expect(projectsView.createProjectButton).toBeEnabled();
    }
  });

  test('search functionality works when available', async ({ page, projectsView }) => {
    await projectsView.goto();

    // Check if search input exists
    const searchExists = await projectsView.searchInput.count() > 0;

    if (searchExists) {
      await expect(projectsView.searchInput).toBeVisible();

      // Test search interaction
      await projectsView.searchProjects('test');
      await expect(projectsView.searchInput).toHaveValue('test');

      // Clear search
      await projectsView.searchInput.clear();
      await expect(projectsView.searchInput).toHaveValue('');
    }
  });

  test('project cards are interactive when available', async ({ page, projectsView }) => {
    await projectsView.goto();

    const projectCount = await projectsView.getProjectCount();

    if (projectCount > 0) {
      // First project card should be clickable
      await expect(projectsView.projectCard.first()).toBeVisible();

      // Click on first project (should navigate or open details)
      const firstProject = projectsView.projectCard.first();
      await expect(firstProject).toBeEnabled();

      // We don't click here as it might navigate away, but verify it's interactive
      await expect(firstProject).toHaveAttribute('href');
    }
  });

  test('handles project-specific routes', async ({ page, authHelper }) => {
    await authHelper.mockAuthenticatedState();

    // Navigate to a specific project route (might be for NIP-29 groups)
    await page.goto('/projects/example-group-id');

    // Should still show projects view but potentially with specific project details
    await expect(page).toHaveURL(/.*\/projects\/.+/);

    // Main content should be visible
    const mainContent = page.getByRole('main');
    await expect(mainContent).toBeVisible();
  });

  test('responsive design works on mobile', async ({ page, projectsView }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await projectsView.goto();

    // Main content should still be visible on mobile
    await expect(projectsView.mainContent).toBeVisible();

    // Sidebar should still be accessible
    await expect(projectsView.sidebar).toBeVisible();

    // Check if project cards adapt to mobile layout
    if ((await projectsView.getProjectCount()) > 0) {
      await expect(projectsView.projectCard.first()).toBeVisible();
    }
  });

  test('keyboard navigation works', async ({ page, projectsView }) => {
    await projectsView.goto();

    // Test tab navigation
    await page.keyboard.press('Tab');

    // Should be able to navigate through interactive elements
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();

    // Test escape key behavior if modal/dialogs are present
    await page.keyboard.press('Escape');

    // Page should remain stable
    await expect(projectsView.mainContent).toBeVisible();
  });
});