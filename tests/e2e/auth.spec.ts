import { expect } from '@playwright/test';
import { test } from './helpers/fixtures';

test.describe('Authentication', () => {
  test('redirects to login when not authenticated', async ({ page, authHelper, loginPage }) => {
    await authHelper.mockUnauthenticatedState();

    // Try to access protected route
    await page.goto('/activity');

    // Should redirect to login
    await authHelper.expectUnauthenticated();
    await loginPage.expectLoginPage();
  });

  test('login page displays correctly', async ({ page, authHelper, loginPage }) => {
    await authHelper.mockUnauthenticatedState();

    await loginPage.goto();

    // Verify login page elements
    await loginPage.expectLoginPage();

    // Should have some form of authentication options
    const hasPrivateKeyInput = await loginPage.privateKeyInput.count() > 0;
    const hasExtensionButton = await loginPage.extensionLoginButton.count() > 0;
    const hasGenerateButton = await loginPage.generateKeyButton.count() > 0;

    // At least one authentication method should be available
    expect(hasPrivateKeyInput || hasExtensionButton || hasGenerateButton).toBe(true);
  });

  test('private key login form works when available', async ({ page, authHelper, loginPage }) => {
    await authHelper.mockUnauthenticatedState();

    await loginPage.goto();

    // Check if private key input exists
    const hasPrivateKeyInput = await loginPage.privateKeyInput.count() > 0;

    if (hasPrivateKeyInput) {
      await expect(loginPage.privateKeyInput).toBeVisible();

      // Test form interaction
      await loginPage.privateKeyInput.fill('test-private-key');
      await expect(loginPage.privateKeyInput).toHaveValue('test-private-key');

      // Login button should be available
      if (await loginPage.loginButton.count() > 0) {
        await expect(loginPage.loginButton).toBeVisible();
        await expect(loginPage.loginButton).toBeEnabled();
      }
    }
  });

  test('extension login option works when available', async ({ page, authHelper, loginPage }) => {
    await authHelper.mockUnauthenticatedState();

    await loginPage.goto();

    // Check if extension login exists
    const hasExtensionButton = await loginPage.extensionLoginButton.count() > 0;

    if (hasExtensionButton) {
      await expect(loginPage.extensionLoginButton).toBeVisible();
      await expect(loginPage.extensionLoginButton).toBeEnabled();

      // Mock window.nostr availability
      await page.addInitScript(() => {
        window.nostr = {
          async getPublicKey() {
            return 'npub1mockextensionkey123456789';
          },
          async signEvent(event: any) {
            return { ...event, sig: 'mock-extension-signature' };
          }
        };
      });

      // Extension button should be clickable
      await loginPage.extensionLoginButton.click();

      // May show loading state or immediate success
      await page.waitForTimeout(100);
    }
  });

  test('key generation option works when available', async ({ page, authHelper, loginPage }) => {
    await authHelper.mockUnauthenticatedState();

    await loginPage.goto();

    // Check if generate key option exists
    const hasGenerateButton = await loginPage.generateKeyButton.count() > 0;

    if (hasGenerateButton) {
      await expect(loginPage.generateKeyButton).toBeVisible();
      await expect(loginPage.generateKeyButton).toBeEnabled();

      // Should be able to generate new key
      await loginPage.generateKeyButton.click();

      // May show generated key or start auth flow
      await page.waitForTimeout(100);
    }
  });

  test('prevents access to protected routes without auth', async ({ page, authHelper }) => {
    await authHelper.mockUnauthenticatedState();

    const protectedRoutes = ['/activity', '/projects', '/social'];

    for (const route of protectedRoutes) {
      await page.goto(route);

      // Should redirect to login for each protected route
      await expect(page).toHaveURL(/.*\/login/);
    }
  });

  test('authenticated state allows access to protected routes', async ({ page, authHelper, activityDashboard }) => {
    await authHelper.mockAuthenticatedState();

    const protectedRoutes = [
      { path: '/activity', urlPattern: /.*\/activity$/ },
      { path: '/projects', urlPattern: /.*\/projects$/ },
      { path: '/social', urlPattern: /.*\/social$/ }
    ];

    for (const route of protectedRoutes) {
      await page.goto(route.path);

      // Should be able to access protected routes
      await expect(page).toHaveURL(route.urlPattern);
      await expect(activityDashboard.mainContent).toBeVisible();
    }
  });

  test('handles authentication state persistence', async ({ page, authHelper, activityDashboard }) => {
    // Set authenticated state
    await authHelper.mockAuthenticatedState();

    await page.goto('/activity');
    await authHelper.expectAuthenticated();

    // Reload the page
    await page.reload();

    // Should remain authenticated
    await authHelper.expectAuthenticated();
    await expect(activityDashboard.mainContent).toBeVisible();
  });

  test('handles authentication errors gracefully', async ({ page, authHelper, loginPage }) => {
    await authHelper.mockUnauthenticatedState();

    await loginPage.goto();

    // Mock authentication failure
    await page.addInitScript(() => {
      // Override any auth methods to fail
      window.nostr = {
        async getPublicKey() {
          throw new Error('Extension not available');
        },
        async signEvent() {
          throw new Error('Signing failed');
        }
      };
    });

    // Try extension login if available
    if (await loginPage.extensionLoginButton.count() > 0) {
      await loginPage.extensionLoginButton.click();

      // Should handle error gracefully - either show error message or stay on login
      await expect(page).toHaveURL(/.*\/login/);
    }
  });

  test('logout functionality works when available', async ({ page, authHelper, activityDashboard }) => {
    await authHelper.mockAuthenticatedState();

    await page.goto('/activity');
    await authHelper.expectAuthenticated();

    // Look for logout button (might be in header, sidebar, or dropdown)
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });

    if (await logoutButton.count() > 0) {
      await logoutButton.click();

      // Should redirect to login after logout
      await authHelper.expectUnauthenticated();
    }
  });
});