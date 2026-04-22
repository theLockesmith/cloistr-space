import { Page, expect } from '@playwright/test';

export class AuthHelper {
  readonly page: Page;

  // Mock pubkey - 64 hex chars
  static readonly MOCK_PUBKEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Mock authentication state to bypass login for testing
   * This sets up localStorage and window.nostr to simulate authenticated state
   */
  async mockAuthenticatedState() {
    const mockPubkey = AuthHelper.MOCK_PUBKEY;

    await this.page.addInitScript((pubkey) => {
      // Mock window.nostr FIRST (before app loads)
      // This is what connectNip07() from collab-common checks
      (window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: async (event: any) => ({
          ...event,
          id: 'mock-event-id-' + Date.now(),
          pubkey: pubkey,
          sig: '0'.repeat(128), // 64 bytes hex
        }),
        nip04: {
          encrypt: async (_pubkey: string, _plaintext: string) => 'mock-encrypted',
          decrypt: async (_pubkey: string, _ciphertext: string) => 'mock-decrypted',
        },
        getRelays: async () => ({}),
      };

      // Mock AuthProvider session state (cloistr-space-session)
      const sessionState = {
        method: 'nip07',
      };
      localStorage.setItem('cloistr-space-session', JSON.stringify(sessionState));

      // Pre-populate Zustand auth store state (cloistr-space-auth)
      const zustandState = {
        state: {
          isAuthenticated: true,
          pubkey: pubkey,
          isLoading: false,
          signerType: 'nip07',
          bunkerUrl: null,
          profile: null,
        },
        version: 0
      };
      localStorage.setItem('cloistr-space-auth', JSON.stringify(zustandState));
    }, mockPubkey);
  }

  /**
   * Mock unauthenticated state
   */
  async mockUnauthenticatedState() {
    await this.page.addInitScript(() => {
      localStorage.removeItem('cloistr-space-auth');
      localStorage.removeItem('cloistr-space-session');
      localStorage.removeItem('cloistr-space-client-id');
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