/**
 * Headless interfaces for Space operations without React.
 *
 * SignerInterface comes from @cloistr/auth/core, which has no React in its
 * dependency graph. RelayClient is the minimal relay abstraction the pure
 * modules need: publish a signed event, fetch events by filter.
 *
 * A React hook provides implementations backed by NDK. A headless caller
 * (CLI, test, fleet script) provides its own.
 */

import type { Event } from 'nostr-tools';

export type { SignerInterface } from '@cloistr/auth/core';

export interface RelayClient {
  publish(event: Event): Promise<number>;
  fetch(filter: Record<string, unknown>): Promise<Event[]>;
}
