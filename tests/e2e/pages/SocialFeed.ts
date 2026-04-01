import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class SocialFeed extends BasePage {
  readonly pageTitle: Locator;
  readonly feedContainer: Locator;
  readonly postCard: Locator;
  readonly composeButton: Locator;
  readonly composeArea: Locator;
  readonly publishButton: Locator;
  readonly feedFilters: Locator;
  readonly emptyState: Locator;
  readonly loadMoreButton: Locator;

  constructor(page: Page) {
    super(page);

    // Social feed specific elements
    this.pageTitle = page.getByRole('heading', { name: /social|feed|notes/i });

    this.feedContainer = page.locator('[data-testid="social-feed"]').or(
      page.locator('.feed-container, .social-feed')
    );

    this.postCard = page.locator('[data-testid="post-card"]').or(
      page.locator('.post, .note, .event-card').locator('visible=true')
    );

    this.composeButton = page.getByRole('button', { name: /compose|new.*post|write.*note/i });

    this.composeArea = page.getByPlaceholder(/what.*happening|compose.*note|write.*post/i).or(
      page.locator('textarea[placeholder*="note"]')
    );

    this.publishButton = page.getByRole('button', { name: /publish|post|send|share/i });

    this.feedFilters = page.locator('[data-testid="feed-filters"]').or(
      page.locator('.filters, .filter-bar')
    );

    this.emptyState = page.getByText(/no.*post|empty.*feed|nothing.*here/i).or(
      page.locator('[data-testid="empty-state"]')
    );

    this.loadMoreButton = page.getByRole('button', { name: /load.*more|show.*more/i });
  }

  async goto() {
    await this.page.goto('/social');
  }

  async composePost(content: string) {
    await this.composeButton.click();
    await this.composeArea.fill(content);
    await this.publishButton.click();
  }

  async loadMore() {
    await this.loadMoreButton.click();
  }

  async getPostCount() {
    return await this.postCard.count();
  }
}