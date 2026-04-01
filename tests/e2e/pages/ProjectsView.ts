import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProjectsView extends BasePage {
  readonly pageTitle: Locator;
  readonly projectsList: Locator;
  readonly projectCard: Locator;
  readonly createProjectButton: Locator;
  readonly projectFilters: Locator;
  readonly searchInput: Locator;
  readonly emptyState: Locator;
  readonly groupSelector: Locator;

  constructor(page: Page) {
    super(page);

    // Projects view specific elements
    this.pageTitle = page.getByRole('heading', { name: /projects|groups/i });

    this.projectsList = page.locator('[data-testid="projects-list"]').or(
      page.locator('.projects-grid, .projects-list')
    );

    this.projectCard = page.locator('[data-testid="project-card"]').or(
      page.locator('.project-card, .group-card').locator('visible=true')
    );

    this.createProjectButton = page.getByRole('button', { name: /create.*project|new.*project|add.*project/i });

    this.projectFilters = page.locator('[data-testid="project-filters"]').or(
      page.locator('.filters, .filter-bar')
    );

    this.searchInput = page.getByPlaceholder(/search.*project|filter.*project/i).or(
      page.getByRole('searchbox')
    );

    this.emptyState = page.getByText(/no.*project|empty|create.*first.*project/i).or(
      page.locator('[data-testid="empty-state"]')
    );

    this.groupSelector = page.locator('[data-testid="group-selector"]').or(
      page.locator('select, .dropdown').filter({ hasText: /group|project/i })
    );
  }

  async goto() {
    await this.page.goto('/projects');
  }

  async createProject() {
    await this.createProjectButton.click();
  }

  async searchProjects(query: string) {
    await this.searchInput.fill(query);
  }

  async getProjectCount() {
    return await this.projectCard.count();
  }

  async selectProject(index: number = 0) {
    await this.projectCard.nth(index).click();
  }
}