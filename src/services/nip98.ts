/**
 * @fileoverview NIP-98 HTTP auth: one signed kind:27235 event per request.
 *
 * u is the exact request URL (query included) and method its HTTP method.
 * Every event carries a random nonce tag: ids are otherwise deterministic, so
 * two signings of the same URL in the same second collide, and servers that
 * reject a repeated id (Tasks) would refuse the second. NIP-98 permits extra
 * tags.
 */

import type { SignerInterface } from '@/services/headless';

export const NIP98_KIND = 27235;

function randomNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `Nostr <base64 event>` for one request. Throws whatever the signer throws. */
export async function signNip98(signer: SignerInterface, url: string, method: string): Promise<string> {
  const event = await signer.signEvent({
    kind: NIP98_KIND,
    pubkey: await signer.getPublicKey(),
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['u', url],
      ['method', method.toUpperCase()],
      ['nonce', randomNonce()],
    ],
  });
  return `Nostr ${btoa(JSON.stringify(event))}`;
}
