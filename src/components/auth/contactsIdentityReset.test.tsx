/**
 * Audit #42 (d): the contact list, its CRDT entries and pending changes must
 * be cleared on every identity change and on logout, or the next key to sign
 * in publishes the previous key's follows under its own name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContactsStore } from '@/stores/contactsStore';

const ALICE = 'a1'.repeat(32);
const DAVE = 'd0'.repeat(32);
const CAROL = 'c0'.repeat(32);

let identityCallback: ((event: { pubkey: string }) => void) | null = null;

vi.mock('@cloistr/auth', () => ({
  connectNip07: vi.fn(),
  connectNip46: vi.fn(),
  isNip07Supported: () => false,
  isValidBunkerUrl: () => false,
  useNostrAuth: () => ({
    authState: { isConnected: false, pubkey: null, activePubkey: null, method: null, isSwitching: false },
    signer: null,
  }),
}));

vi.mock('@cloistr/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSharedSession: () => null,
  saveSharedSession: vi.fn(),
  clearSharedSession: vi.fn(),
  useIdentityChange: (cb: (event: { pubkey: string }) => void) => {
    identityCallback = cb;
  },
}));

vi.mock('@/services/cache', () => ({ clearAll: vi.fn(async () => {}) }));

const { AuthProvider, useAuth } = await import('./AuthProvider');

/** A store holding ALICE's list plus an unsent follow. */
function seedAlice() {
  const store = useContactsStore.getState();
  store.resetFor(ALICE);
  store.markLoaded(ALICE);
  store.addContact(CAROL);
  expect(useContactsStore.getState().crdt.pendingChanges).toHaveLength(1);
}

function expectCleared(owner: string | null) {
  const s = useContactsStore.getState();
  expect(s.owner).toBe(owner);
  expect(s.loadedFor).toBeNull();
  expect(s.contacts.size).toBe(0);
  expect(s.crdt.entries.size).toBe(0);
  expect(s.crdt.pendingChanges).toEqual([]);
}

beforeEach(() => {
  useContactsStore.setState(useContactsStore.getInitialState());
  identityCallback = null;
});

describe('contacts are cleared when the identity changes', () => {
  it('an identity change to another key clears entries and pending changes', () => {
    render(<AuthProvider>{null}</AuthProvider>);
    seedAlice();

    act(() => identityCallback!({ pubkey: DAVE }));

    expectCleared(DAVE);
  });

  it('an identity change to the same key leaves its list alone', () => {
    render(<AuthProvider>{null}</AuthProvider>);
    seedAlice();

    act(() => identityCallback!({ pubkey: ALICE }));

    expect(useContactsStore.getState().crdt.pendingChanges).toHaveLength(1);
    expect(useContactsStore.getState().loadedFor).toBe(ALICE);
  });

  it('logout clears entries and pending changes', async () => {
    let logout!: () => Promise<void>;
    function Grab() {
      logout = useAuth().logout;
      return null;
    }
    render(
      <AuthProvider>
        <Grab />
      </AuthProvider>
    );
    seedAlice();

    await act(async () => {
      await logout();
    });

    expectCleared(null);
  });
});
