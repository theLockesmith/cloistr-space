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
import type { SignerInterface } from '@cloistr/auth/core';

export type { SignerInterface };

export interface RelayClient {
  publish(event: Event): Promise<number>;
  fetch(filter: Record<string, unknown>): Promise<Event[]>;
}

/**
 * One relay's answer to a query, kept apart from every other relay's.
 *
 * RelayClient.fetch merges relays and resolves the same way whether a relay
 * answered "nothing" or never answered, which is fine for display and not
 * enough for a decision that is only safe if EVERY relay said "nothing".
 * `answered` means this relay sent EOSE; anything else (timeout, CLOSED, not
 * connected) is `failed`.
 */
export type RelayAnswer =
  | { url: string; status: 'answered'; events: Event[] }
  | { url: string; status: 'failed'; reason: string };

/** Ask each of the user's own relays separately. */
export type RelayProbe = (filter: Record<string, unknown>) => Promise<RelayAnswer[]>;

/**
 * How a publish went. Never zero relays -- zero throws instead.
 *
 * The user's relay list is mostly third-party, so "some relays took it" is the
 * normal good outcome. Only zero acceptances is a failure.
 */
export interface PublishOutcome {
  acceptedBy: number;
  /** Id of the event published, so a caller can reference or retract it. */
  eventId: string;
}

/**
 * How long a publish may take before the caller is told it failed. Matches
 * @cloistr/collab-common 0.5.0, so every Cloistr app gives up at the same point.
 */
export const PUBLISH_TIMEOUT_MS = 15_000;

/**
 * A publish that did not finish in time. Not a refusal: the relay may still be
 * working on it, so the event can land after the caller has been told it failed.
 */
export class PublishTimeoutError extends Error {
  constructor(ms: number) {
    super(`No relay answered within ${ms / 1000}s. It may still arrive; check before posting it again.`);
    this.name = 'PublishTimeoutError';
  }
}

/** Reject with PublishTimeoutError if `work` has not settled within `ms`. */
export function withPublishTimeout<T>(work: Promise<T>, ms = PUBLISH_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PublishTimeoutError(ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Publish an already-signed event; throw when no relay accepts it in time. */
export async function publishOrThrow(relay: RelayClient, event: Event): Promise<PublishOutcome> {
  const acceptedBy = await withPublishTimeout(relay.publish(event));
  if (acceptedBy === 0) {
    throw new Error('No relay accepted it. Check your relay list and connection.');
  }
  return { acceptedBy, eventId: event.id };
}

/** Sign a template as the signer's identity, then publishOrThrow. */
export async function signAndPublish(
  signer: SignerInterface,
  relay: RelayClient,
  template: { kind: number; content: string; tags: string[][] },
): Promise<PublishOutcome> {
  const pubkey = await signer.getPublicKey();
  const signed = await signer.signEvent({
    ...template,
    created_at: Math.floor(Date.now() / 1000),
    pubkey,
  });
  return publishOrThrow(relay, signed);
}
