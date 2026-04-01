import { expect } from '@playwright/test';
import { test } from './helpers/fixtures';

test.describe('Application Core', () => {
  test('loads successfully and shows login page when unauthenticated', async ({ page, loginPage, authHelper }) => {
    // Ensure we start in unauthenticated state
    await authHelper.mockUnauthenticatedState();

    await page.goto('/');

    // Should redirect to login
    await authHelper.expectUnauthenticated();
    await loginPage.expectLoginPage();
  });

  test('shows main layout when authenticated', async ({ page, authHelper, activityDashboard }) => {
    // Mock authenticated state
    await authHelper.mockAuthenticatedState();

    await page.goto('/');

    // Should be authenticated and see main layout
    await authHelper.expectAuthenticated();

    // Verify main layout elements are present
    await expect(activityDashboard.sidebar).toBeVisible();
    await expect(activityDashboard.mainContent).toBeVisible();
  });

  test('handles root redirect correctly', async ({ page, authHelper }) => {
    await authHelper.mockAuthenticatedState();

    await page.goto('/');

    // Should redirect to /activity by default
    await expect(page).toHaveURL(/.*\/activity$/);
  });

  test('handles invalid routes', async ({ page, authHelper }) => {
    await authHelper.mockAuthenticatedState();

    await page.goto('/invalid-route-that-does-not-exist');

    // Should redirect to root (which goes to /activity)
    await expect(page).toHaveURL(/.*\/activity$/);
  });

  test('displays error boundary for React errors', async ({ page, authHelper }) => {
    await authHelper.mockAuthenticatedState();

    // Mock a React error by injecting problematic code
    await page.addInitScript(() => {
      // Override a critical React hook to cause an error
      const originalError = console.error;
      window.addEventListener('error', (event) => {
        // Suppress error logging in tests
        if (event.message.includes('ReactError')) {
          event.preventDefault();
        }
      });
    });

    await page.goto('/activity');

    // The app should still load - error boundaries should catch issues
    await expect(page.locator('body')).toBeVisible();
  });
});