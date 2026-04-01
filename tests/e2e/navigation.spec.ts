import { expect } from '@playwright/test';
import { test } from './helpers/fixtures';

test.describe('Navigation', () => {
  test.beforeEach(async ({ authHelper }) => {
    // All navigation tests require authentication
    await authHelper.mockAuthenticatedState();
  });

  test('sidebar navigation works correctly', async ({ page, activityDashboard }) => {
    await page.goto('/');

    // Verify sidebar is visible
    await expect(activityDashboard.sidebar).toBeVisible();

    // Test navigation to Activity (should already be there)
    await activityDashboard.navigateToActivity();
    await expect(page).toHaveURL(/.*\/activity$/);

    // Test navigation to Projects
    await activityDashboard.navigateToProjects();
    await expect(page).toHaveURL(/.*\/projects$/);

    // Test navigation to Social
    await activityDashboard.navigateToSocial();
    await expect(page).toHaveURL(/.*\/social$/);

    // Navigate back to Activity
    await activityDashboard.navigateToActivity();
    await expect(page).toHaveURL(/.*\/activity$/);
  });

  test('sidebar toggle functionality', async ({ page, activityDashboard }) => {
    await page.goto('/activity');

    // Sidebar should be visible initially
    await expect(activityDashboard.sidebar).toBeVisible();

    // Check if sidebar contains text content (expanded state)
    const sidebarText = await activityDashboard.sidebar.textContent();
    const isExpanded = sidebarText?.includes('Activity') || sidebarText?.includes('Projects');

    // Toggle sidebar
    await activityDashboard.toggleSidebar();

    // After toggle, sidebar should still be visible but potentially collapsed
    await expect(activityDashboard.sidebar).toBeVisible();

    // Toggle back
    await activityDashboard.toggleSidebar();
    await expect(activityDashboard.sidebar).toBeVisible();
  });

  test('navigation links have active states', async ({ page, activityDashboard }) => {
    await page.goto('/activity');

    // Activity link should be active
    await expect(activityDashboard.activityLink).toHaveClass(/active|bg-.*primary/);

    // Navigate to projects
    await activityDashboard.navigateToProjects();

    // Projects link should now be active
    await expect(activityDashboard.projectsLink).toHaveClass(/active|bg-.*primary/);

    // Activity should no longer be active
    await expect(activityDashboard.activityLink).not.toHaveClass(/active|bg-.*primary/);
  });

  test('direct URL navigation works', async ({ page, authHelper }) => {
    await authHelper.mockAuthenticatedState();

    // Navigate directly to projects
    await page.goto('/projects');
    await expect(page).toHaveURL(/.*\/projects$/);

    // Navigate directly to social
    await page.goto('/social');
    await expect(page).toHaveURL(/.*\/social$/);

    // Navigate directly to activity
    await page.goto('/activity');
    await expect(page).toHaveURL(/.*\/activity$/);
  });

  test('browser back/forward navigation works', async ({ page, activityDashboard }) => {
    await page.goto('/activity');

    // Navigate to projects
    await activityDashboard.navigateToProjects();
    await expect(page).toHaveURL(/.*\/projects$/);

    // Navigate to social
    await activityDashboard.navigateToSocial();
    await expect(page).toHaveURL(/.*\/social$/);

    // Use browser back
    await page.goBack();
    await expect(page).toHaveURL(/.*\/projects$/);

    // Use browser back again
    await page.goBack();
    await expect(page).toHaveURL(/.*\/activity$/);

    // Use browser forward
    await page.goForward();
    await expect(page).toHaveURL(/.*\/projects$/);
  });
});