import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly privateKeyInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly title: Locator;
  readonly extensionLoginButton: Locator;
  readonly generateKeyButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // Login form elements (using flexible selectors since we don't have the exact structure)
    this.privateKeyInput = page.getByLabel(/private.*key|nsec|secret/i).or(
      page.locator('input[type="password"]').or(
        page.locator('input[placeholder*="nsec"]').or(
          page.locator('textarea[placeholder*="private"]')
        )
      )
    );

    this.loginButton = page.getByRole('button', { name: /login|sign in|connect/i });
    this.extensionLoginButton = page.getByRole('button', { name: /extension|nos2x|alby/i });
    this.generateKeyButton = page.getByRole('button', { name: /generate|create.*key/i });

    this.errorMessage = page.getByRole('alert').or(
      page.locator('[role="alert"]').or(
        page.locator('.error, .alert-error').first()
      )
    );

    this.title = page.getByRole('heading', { name: /login|sign in|welcome/i });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async loginWithPrivateKey(privateKey: string) {
    await this.privateKeyInput.fill(privateKey);
    await this.loginButton.click();
  }

  async attemptExtensionLogin() {
    await this.extensionLoginButton.click();
  }

  async generateNewKey() {
    await this.generateKeyButton.click();
  }

  async expectErrorMessage(message?: string) {
    await expect(this.errorMessage).toBeVisible();
    if (message) {
      await expect(this.errorMessage).toContainText(message);
    }
  }

  async expectLoginPage() {
    await expect(this.title).toBeVisible();
    await expect(this.page).toHaveURL(/.*\/login/);
  }
}