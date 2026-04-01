import { Page, expect } from '@playwright/test';

export class AuthHelper {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Mock authentication state to bypass login for testing
   * This sets up localStorage/sessionStorage to simulate authenticated state
   */
  async mockAuthenticatedState() {
    await this.page.addInitScript(() => {
      // Mock localStorage auth data
      const mockAuth = {
        isAuthenticated: true,
        publicKey: 'npub1mockkey123456789abcdefghijklmnopqrstuvwxyz1234567890',
        privateKey: 'nsec1mockprivatekey123456789abcdefghijklmnopqrstuvwxyz1234567',
        profile: {
          name: 'Test User',
          displayName: 'Test User',
          picture: 'https://example.com/avatar.jpg',
        },
        relays: [
          'wss://relay.damus.io',
          'wss://nos.lol'
        ],
        connectedAt: Date.now()
      };

      // Set auth state in localStorage
      localStorage.setItem('cloistr-auth', JSON.stringify(mockAuth));

      // Mock session storage if used
      sessionStorage.setItem('authenticated', 'true');

      // Mock browser extension availability
      window.nostr = {
        async getPublicKey() {
          return mockAuth.publicKey;
        },
        async signEvent(event: any) {
          return { ...event, sig: 'mock-signature' };
        },
        async encrypt(pubkey: string, plaintext: string) {
          return 'mock-encrypted-content';
        },
        async decrypt(pubkey: string, ciphertext: string) {
          return 'mock-decrypted-content';
        }
      };
    });
  }

  /**
   * Mock unauthenticated state
   */
  async mockUnauthenticatedState() {
    await this.page.addInitScript(() => {
      localStorage.removeItem('cloistr-auth');
      sessionStorage.removeItem('authenticated');
      delete window.nostr;
    });
  }

  /**
   * Mock network conditions (offline/slow connection)
   */
  async mockNetworkConditions(condition: 'offline' | 'slow' | 'normal' = 'normal') {
    if (condition === 'offline') {
      await this.page.context().setOffline(true);
    } else if (condition === 'slow') {
      await this.page.route('**/*', (route) => {
        // Delay responses by 2-5 seconds to simulate slow connection
        setTimeout(() => route.continue(), Math.random() * 3000 + 2000);
      });
    } else {
      await this.page.context().setOffline(false);
    }
  }

  /**
   * Mock relay connection states
   */
  async mockRelayStates(states: Record<string, 'connected' | 'disconnected' | 'connecting'>) {
    await this.page.addInitScript((relayStates) => {
      window.__mockRelayStates = relayStates;
    }, states);
  }

  /**
   * Verify user is authenticated and redirected properly
   */
  async expectAuthenticated() {
    await expect(this.page).not.toHaveURL(/.*\/login/);

    // Should be on main app routes
    await expect(this.page).toHaveURL(/\/(activity|projects|social)/);
  }

  /**
   * Verify user needs to authenticate
   */
  async expectUnauthenticated() {
    await expect(this.page).toHaveURL(/.*\/login/);
  }
}