# E2E Tests for Cloistr Space

This directory contains end-to-end tests for the Cloistr Space application using Playwright.

## Overview

The E2E tests cover the core user flows of the Nostr-native productivity workspace:

- **Application Core** - App loading, routing, error handling
- **Authentication** - Login flows (with mocked auth state)
- **Navigation** - Sidebar navigation between views
- **Activity Dashboard** - Main activity view functionality
- **Projects View** - NIP-29 groups and project management
- **Social Feed** - Social interactions and content

## Test Structure

### Page Object Model

Tests use the Page Object Model pattern with the following structure:

- `pages/BasePage.ts` - Common layout elements (sidebar, navigation)
- `pages/LoginPage.ts` - Login page interactions
- `pages/ActivityDashboard.ts` - Activity view elements
- `pages/ProjectsView.ts` - Projects view elements
- `pages/SocialFeed.ts` - Social feed elements

### Helpers

- `helpers/auth.ts` - Authentication mocking utilities
- `helpers/fixtures.ts` - Test fixtures and shared setup

## Running Tests

```bash
# Install Playwright browsers (first time only)
pnpm run playwright:install

# Run all E2E tests
pnpm run test:e2e

# Run with UI mode (interactive)
pnpm run test:e2e:ui

# Run in headed mode (see browser)
pnpm run test:e2e:headed

# Debug tests step by step
pnpm run test:e2e:debug
```

## Authentication Strategy

Since the app requires Nostr authentication, tests use mocked authentication state:

- `authHelper.mockAuthenticatedState()` - Simulates logged-in user
- `authHelper.mockUnauthenticatedState()` - Simulates logged-out user
- Mocks browser extension (window.nostr) for extension-based auth

This allows testing UI flows without requiring actual Nostr private keys or relay connections.

## Test Coverage

### Core Flows Tested

✅ **App Loading**
- Initial load and routing
- Error boundary handling
- Responsive design

✅ **Navigation**
- Sidebar navigation between views
- URL routing and browser history
- Active state indicators

✅ **Authentication Guards**
- Protected route access
- Login page display
- Auth state persistence

✅ **Activity Dashboard**
- Page loading and layout
- Service status indicators
- Mobile responsiveness

✅ **Projects View**
- Project listing/empty states
- Create project functionality
- Search and filtering
- NIP-29 group routing

✅ **Social Feed**
- Feed loading and display
- Post composition (when available)
- Feed filtering and pagination

### What's NOT Tested

❌ **Actual Nostr Operations**
- Real relay connections
- Event publishing/receiving
- Cryptographic operations

❌ **Backend Integration**
- File storage (Blossom)
- Group synchronization
- Cross-device state sync

These are intentionally excluded as they require external services and are better covered by integration tests.

## Browser Support

Tests run across multiple browsers:

- **Chromium** (primary)
- **Firefox**
- **WebKit** (Safari)
- **Mobile viewports** (Chrome on Android, Safari on iOS)

## Configuration

The Playwright configuration (`playwright.config.ts`) includes:

- **Base URL**: `http://localhost:5173` (Vite dev server)
- **Auto-start dev server** for tests
- **Trace collection** on test failure
- **HTML reporter** with screenshots
- **Retry logic** for flaky tests

## Development Guidelines

### Writing New Tests

1. Use the Page Object Model pattern
2. Rely on semantic selectors (roles, labels) over CSS classes
3. Mock authentication state appropriately
4. Test both success and error scenarios
5. Ensure mobile compatibility

### Selector Strategy

Preferred selector priority:

1. **Role-based**: `getByRole('button', { name: 'Submit' })`
2. **Label-based**: `getByLabel('Email address')`
3. **Text-based**: `getByText('Welcome back')`
4. **Test ID**: `getByTestId('submit-button')` (last resort)

### Avoiding Flaky Tests

- Use `waitForURL()` for navigation
- Prefer `expect().toBeVisible()` over timing-based waits
- Mock time-dependent functionality
- Use `page.waitForLoadState('networkidle')` for async operations

## Continuous Integration

Tests run automatically on:

- Pull requests to `main`/`master`
- Pushes to `main`/`master`

The CI pipeline includes:

1. Install dependencies
2. Install Playwright browsers
3. Start dev server
4. Run E2E tests
5. Upload test reports as artifacts

Reports are available for 30 days after test runs.