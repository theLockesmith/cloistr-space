import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly bunkerUrlInput: Locator;
  readonly connectButton: Locator;
  readonly errorMessage: Locator;
  readonly title: Locator;
  readonly subtitle: Locator;
  readonly extensionLoginButton: Locator;
  readonly remoteSignerButton: Locator;
  readonly loadingSpinner: Locator;

  constructor(page: Page) {
    this.page = page;

    // Main title: "Cloistr Space"
    this.title = page.getByRole('heading', { name: /cloistr space/i });

    // Subtitle: "Connect your identity"
    this.subtitle = page.getByRole('heading', { name: /connect your identity/i });

    // NIP-07 browser extension button
    this.extensionLoginButton = page.getByRole('button', { name: /browser extension/i });

    // NIP-46 remote signer button
    this.remoteSignerButton = page.getByRole('button', { name: /remote signer/i });

    // Bunker URL input (on NIP-46 view)
    this.bunkerUrlInput = page.getByPlaceholder(/bunker:\/\//i);

    // Connect button (on NIP-46 view)
    this.connectButton = page.getByRole('button', { name: /^connect$/i });

    // Error message
    this.errorMessage = page.locator('.bg-red-500\\/10');

    // Loading spinner
    this.loadingSpinner = page.locator('.animate-spin');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async loginWithExtension() {
    await this.extensionLoginButton.click();
  }

  async loginWithBunkerUrl(bunkerUrl: string) {
    await this.remoteSignerButton.click();
    await this.bunkerUrlInput.fill(bunkerUrl);
    await this.connectButton.click();
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

  async expectLoading() {
    await expect(this.loadingSpinner).toBeVisible();
  }

  async expectSelectView() {
    await expect(this.subtitle).toBeVisible();
    await expect(this.extensionLoginButton).toBeVisible();
    await expect(this.remoteSignerButton).toBeVisible();
  }
}