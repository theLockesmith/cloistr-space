/**
 * mock-relay.ts — In-browser NIP-01 relay mock for write-path E2E tests.
 *
 * Uses Playwright's routeWebSocket to intercept the app's WebSocket connection
 * to relay.cloistr.xyz. Seeds test events so the UI renders groups, members,
 * and admin lists, and captures every published event for assertion.
 *
 * IMPORTANT: Events are signed with real Schnorr signatures via nostr-tools.
 * NDK v2.18.1 validates event signatures synchronously and silently drops any
 * event with an invalid signature, so fake signatures do not work.
 *
 * WHY WEBSOCKET-LEVEL MOCK (not React hook stubs):
 * The task is to test write-path ACCESS CONTROL end-to-end. That means the
 * full path from "button visible or hidden in the DOM" through hook logic,
 * NDK event construction, signing, and publish must be exercised.
 *
 * PROTOCOL: NIP-01 https://github.com/nostr-protocol/nips/blob/master/01.md
 *   Client -> Relay:  ["REQ", <sub_id>, <filter>...]
 *                     ["CLOSE", <sub_id>]
 *                     ["EVENT", <event>]
 *   Relay -> Client:  ["EVENT", <sub_id>, <event>]
 *                     ["EOSE", <sub_id>]
 *                     ["OK", <event_id>, true|false, <message>]
 */

import type { Page } from '@playwright/test';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
}

export interface MockRelayHandle {
  /** Events published by the app during the test. */
  getPublishedEvents: () => MockEvent[];
  /** Tear down the WebSocket route. */
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Fixed test keypairs
// ---------------------------------------------------------------------------

// These are deterministic test keys — DO NOT use in production.
// Each pubkey is derived from its secret key, so signatures are valid.

const MOCK_SK_HEX =
  'c0cd9873e40c8fff353298e51714dff051a0dd90291a19b72171e18bb16121e0';
const OTHER_SK_HEX =
  'b617f646f08fe043cc9114af887230cec48af69dc35c8e807c4eadf0defb9ac7';
const MEMBER_SK_HEX =
  '22b1ba77869908f7961a112a0dbc78e01ab7202e275e414f9d8142ce6f645865';

/** Secret key bytes for signing events as the test user. */
export const MOCK_SK = hexToBytes(MOCK_SK_HEX);
/** Secret key bytes for signing events as "another user". */
export const OTHER_SK = hexToBytes(OTHER_SK_HEX);

/** Pubkey of the authenticated test user (derived from MOCK_SK). */
export const MOCK_PUBKEY = getPublicKey(MOCK_SK);
/** Pubkey of another user (group creator in non-admin tests). */
export const OTHER_PUBKEY = getPublicKey(OTHER_SK);
/** Pubkey of a regular member (only appears in p-tags). */
export const MEMBER_PUBKEY = getPublicKey(hexToBytes(MEMBER_SK_HEX));

/**
 * d-tag that embeds MOCK_PUBKEY's first 16 hex chars,
 * matching the format buildGroupIdentifier() produces.
 * Used in tests where MOCK_PUBKEY is the owner.
 */
export const TEST_GROUP_ID = `test-project-${MOCK_PUBKEY.slice(0, 16)}-a1b2c3d4`;

/**
 * d-tag embedding OTHER_PUBKEY's prefix.
 * Used in non-owner tests so the app recognises OTHER_PUBKEY as owner.
 */
export const OTHER_GROUP_ID = `test-project-${OTHER_PUBKEY.slice(0, 16)}-b2c3d4e5`;

const ALL_PERMISSIONS = [
  'add-user',
  'remove-user',
  'edit-metadata',
  'delete-event',
  'add-permission',
  'remove-permission',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextTimestamp = Math.floor(Date.now() / 1000) - 3600;

/** Monotonically increasing timestamp so addressable events sort correctly. */
function nextTs(): number {
  return nextTimestamp++;
}

/**
 * Build and SIGN a Nostr event. Returns a MockEvent with valid id + sig.
 */
function signedEvent(
  secretKey: Uint8Array,
  template: { kind: number; content: string; tags: string[][] },
): MockEvent {
  const event = finalizeEvent(
    {
      kind: template.kind,
      created_at: nextTs(),
      tags: template.tags,
      content: template.content,
    },
    secretKey,
  );
  return event as unknown as MockEvent;
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

/**
 * Build a signed kind:39000 group metadata event.
 */
export function groupMetadataEvent(opts: {
  identifier: string;
  name: string;
  secretKey: Uint8Array;
  description?: string;
  picture?: string;
  isPublic?: boolean;
  isOpen?: boolean;
}): MockEvent {
  const tags: string[][] = [
    ['d', opts.identifier],
    ['name', opts.name],
  ];
  if (opts.description) tags.push(['about', opts.description]);
  if (opts.picture) tags.push(['picture', opts.picture]);
  tags.push([opts.isPublic !== false ? 'public' : 'private']);
  tags.push([opts.isOpen ? 'open' : 'closed']);

  return signedEvent(opts.secretKey, {
    kind: 39000,
    content: opts.description || '',
    tags,
  });
}

/**
 * Build a signed kind:39001 admin list event.
 */
export function groupAdminEvent(opts: {
  identifier: string;
  secretKey: Uint8Array;
  admins: { pubkey: string; permissions: string[] }[];
}): MockEvent {
  const tags: string[][] = [['d', opts.identifier]];
  for (const admin of opts.admins) {
    tags.push(['p', admin.pubkey, ...admin.permissions]);
  }

  return signedEvent(opts.secretKey, { kind: 39001, content: '', tags });
}

/**
 * Build a signed kind:39002 member list event.
 */
export function groupMemberEvent(opts: {
  identifier: string;
  secretKey: Uint8Array;
  memberPubkeys: string[];
}): MockEvent {
  const tags: string[][] = [['d', opts.identifier]];
  for (const pk of opts.memberPubkeys) {
    tags.push(['p', pk]);
  }

  return signedEvent(opts.secretKey, { kind: 39002, content: '', tags });
}

// ---------------------------------------------------------------------------
// Filter matching (NIP-01)
// ---------------------------------------------------------------------------

function eventMatchesFilter(event: MockEvent, filter: Record<string, unknown>): boolean {
  if (filter.kinds) {
    if (!(filter.kinds as number[]).includes(event.kind)) return false;
  }

  if (filter.authors) {
    if (!(filter.authors as string[]).includes(event.pubkey)) return false;
  }

  if (filter.ids) {
    if (!(filter.ids as string[]).includes(event.id)) return false;
  }

  // Tag filters (#d, #p, #h, etc.)
  for (const [key, vals] of Object.entries(filter)) {
    if (!key.startsWith('#')) continue;
    const tagName = key.slice(1);
    const filterValues = vals as string[];
    const eventTagValues = event.tags
      .filter((t) => t[0] === tagName)
      .map((t) => t[1]);
    if (!filterValues.some((v) => eventTagValues.includes(v))) return false;
  }

  if (filter.since && (event.created_at ?? 0) < (filter.since as number)) return false;
  if (filter.until && (event.created_at ?? 0) > (filter.until as number)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Install mock relay
// ---------------------------------------------------------------------------

/**
 * Install a mock relay that intercepts WebSocket connections and serves
 * pre-seeded events. Must be called BEFORE page.goto().
 *
 * @param page      Playwright page
 * @param events    Events the relay "has", returned in response to REQ
 * @returns         Handle for retrieving published events and cleanup
 */
export async function installMockRelay(
  page: Page,
  events: MockEvent[],
): Promise<MockRelayHandle> {
  const publishedEvents: MockEvent[] = [];

  await page.routeWebSocket(/wss:\/\/.*/, (ws) => {
    ws.onMessage((raw) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!Array.isArray(msg) || msg.length < 2) return;

      const type = msg[0] as string;

      if (type === 'REQ') {
        const subId = msg[1] as string;
        const filters = msg.slice(2) as Record<string, unknown>[];

        // Deliver matching events
        const sent = new Set<string>();
        for (const event of events) {
          if (sent.has(event.id)) continue;
          for (const filter of filters) {
            if (eventMatchesFilter(event, filter)) {
              ws.send(JSON.stringify(['EVENT', subId, event]));
              sent.add(event.id);
              break;
            }
          }
        }

        ws.send(JSON.stringify(['EOSE', subId]));
      } else if (type === 'CLOSE') {
        // Nothing to do
      } else if (type === 'EVENT') {
        const event = msg[1] as MockEvent;
        publishedEvents.push(event);
        ws.send(JSON.stringify(['OK', event.id, true, '']));
      } else if (type === 'AUTH') {
        // NIP-42: accept silently
        const authEvent = msg[1] as MockEvent | undefined;
        ws.send(JSON.stringify(['OK', authEvent?.id ?? 'auth', true, '']));
      }
    });
  });

  return {
    getPublishedEvents: () => [...publishedEvents],
    cleanup: async () => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    },
  };
}

// ---------------------------------------------------------------------------
// Preset group configurations
// ---------------------------------------------------------------------------

/**
 * MOCK_PUBKEY is full-admin owner with all permissions.
 */
export function adminGroupEvents(): MockEvent[] {
  return [
    groupMetadataEvent({
      identifier: TEST_GROUP_ID,
      name: 'Test Project',
      secretKey: MOCK_SK,
      description: 'A test group for E2E',
    }),
    groupAdminEvent({
      identifier: TEST_GROUP_ID,
      secretKey: MOCK_SK,
      admins: [
        { pubkey: MOCK_PUBKEY, permissions: ALL_PERMISSIONS },
      ],
    }),
    groupMemberEvent({
      identifier: TEST_GROUP_ID,
      secretKey: MOCK_SK,
      memberPubkeys: [MOCK_PUBKEY, MEMBER_PUBKEY],
    }),
  ];
}

/**
 * MOCK_PUBKEY is a plain member with zero permissions.
 * Group created by OTHER_PUBKEY — d-tag embeds OTHER_PUBKEY's prefix so the
 * app recognises OTHER_PUBKEY as the owner.
 */
export function memberOnlyGroupEvents(): MockEvent[] {
  return [
    groupMetadataEvent({
      identifier: OTHER_GROUP_ID,
      name: 'Test Project',
      secretKey: OTHER_SK,
      description: 'A test group for E2E',
    }),
    groupAdminEvent({
      identifier: OTHER_GROUP_ID,
      secretKey: OTHER_SK,
      admins: [
        { pubkey: OTHER_PUBKEY, permissions: ALL_PERMISSIONS },
      ],
    }),
    groupMemberEvent({
      identifier: OTHER_GROUP_ID,
      secretKey: OTHER_SK,
      memberPubkeys: [OTHER_PUBKEY, MOCK_PUBKEY, MEMBER_PUBKEY],
    }),
  ];
}

/**
 * MOCK_PUBKEY has only the listed permissions.
 * d-tag embeds OTHER_PUBKEY's prefix — MOCK_PUBKEY is NOT the owner.
 * Tests granular permission gating.
 */
export function partialAdminGroupEvents(permissions: string[]): MockEvent[] {
  return [
    groupMetadataEvent({
      identifier: OTHER_GROUP_ID,
      name: 'Test Project',
      secretKey: OTHER_SK,
      description: 'A test group for E2E',
    }),
    groupAdminEvent({
      identifier: OTHER_GROUP_ID,
      secretKey: OTHER_SK,
      admins: [
        { pubkey: OTHER_PUBKEY, permissions: ALL_PERMISSIONS },
        { pubkey: MOCK_PUBKEY, permissions },
      ],
    }),
    groupMemberEvent({
      identifier: OTHER_GROUP_ID,
      secretKey: OTHER_SK,
      memberPubkeys: [OTHER_PUBKEY, MOCK_PUBKEY, MEMBER_PUBKEY],
    }),
  ];
}
