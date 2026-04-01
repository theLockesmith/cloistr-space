import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ActivityDashboard extends BasePage {
  readonly pageTitle: Locator;
  readonly activityCards: Locator;
  readonly recentActivities: Locator;
  readonly activityFilters: Locator;
  readonly refreshButton: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);

    // Activity dashboard specific elements
    this.pageTitle = page.getByRole('heading', { name: /activity|dashboard/i });

    this.activityCards = page.locator('[data-testid="activity-card"]').or(
      page.locator('.activity-card, .card').locator('visible=true')
    );

    this.recentActivities = page.locator('[data-testid="recent-activities"]').or(
      page.getByText(/recent.*activit/i).locator('..')
    );

    this.activityFilters = page.locator('[data-testid="activity-filters"]').or(
      page.locator('.filters, .filter-bar')
    );

    this.refreshButton = page.getByRole('button', { name: /refresh|reload/i });

    this.emptyState = page.getByText(/no.*activit|empty|nothing.*here/i).or(
      page.locator('[data-testid="empty-state"]')
    );
  }

  async goto() {
    await this.page.goto('/activity');
  }

  async refreshActivities() {
    await this.refreshButton.click();
  }

  async getActivityCount() {
    return await this.activityCards.count();
  }
}