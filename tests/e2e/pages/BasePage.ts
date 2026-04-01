import { Page, Locator } from '@playwright/test';

export class BasePage {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly sidebarToggle: Locator;
  readonly logo: Locator;
  readonly mainContent: Locator;
  readonly header: Locator;

  // Navigation links
  readonly activityLink: Locator;
  readonly projectsLink: Locator;
  readonly socialLink: Locator;

  // Service status indicators
  readonly serviceStatus: Locator;
  readonly relayStatus: Locator;

  constructor(page: Page) {
    this.page = page;

    // Layout elements
    this.sidebar = page.getByRole('complementary', { name: /sidebar|navigation/i }).or(page.locator('aside').first());
    this.sidebarToggle = page.getByRole('button', { name: /toggle.*menu|menu/i });
    this.logo = page.getByText('Cloistr').or(page.locator('[data-testid="logo"]'));
    this.mainContent = page.getByRole('main');
    this.header = page.locator('header').or(page.locator('[role="banner"]'));

    // Navigation
    this.activityLink = page.getByRole('link', { name: /activity/i });
    this.projectsLink = page.getByRole('link', { name: /projects/i });
    this.socialLink = page.getByRole('link', { name: /social/i });

    // Service status
    this.serviceStatus = page.locator('[data-testid="service-status"]').or(
      page.getByText(/services/i).locator('..')
    );
    this.relayStatus = page.locator('[data-testid="relay-status"]').or(
      page.getByText(/relay/i).first()
    );
  }

  async navigateToActivity() {
    await this.activityLink.click();
    await this.page.waitForURL(/.*\/activity$/);
  }

  async navigateToProjects() {
    await this.projectsLink.click();
    await this.page.waitForURL(/.*\/projects$/);
  }

  async navigateToSocial() {
    await this.socialLink.click();
    await this.page.waitForURL(/.*\/social$/);
  }

  async toggleSidebar() {
    await this.sidebarToggle.click();
    // Wait for animation to complete
    await this.page.waitForTimeout(300);
  }
}