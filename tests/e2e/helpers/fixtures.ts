import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { ActivityDashboard } from '../pages/ActivityDashboard';
import { ProjectsView } from '../pages/ProjectsView';
import { SocialFeed } from '../pages/SocialFeed';
import { AuthHelper } from './auth';

// Extend basic test by providing page object model fixtures
export const test = base.extend<{
  loginPage: LoginPage;
  activityDashboard: ActivityDashboard;
  projectsView: ProjectsView;
  socialFeed: SocialFeed;
  authHelper: AuthHelper;
}>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  activityDashboard: async ({ page }, use) => {
    await use(new ActivityDashboard(page));
  },

  projectsView: async ({ page }, use) => {
    await use(new ProjectsView(page));
  },

  socialFeed: async ({ page }, use) => {
    await use(new SocialFeed(page));
  },

  authHelper: async ({ page }, use) => {
    await use(new AuthHelper(page));
  },
});

export { expect } from '@playwright/test';