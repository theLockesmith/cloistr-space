import type { SignerInterface } from '@cloistr/auth';

interface Nip46Signer extends SignerInterface {
  sendRequest(method: string, params: string[]): Promise<string>;
}

function isNip46Signer(signer: SignerInterface): signer is Nip46Signer {
  return typeof (signer as Nip46Signer).sendRequest === 'function';
}

export async function signerEcdhTag(
  signer: SignerInterface,
  peerPubkey: string,
  windowId: number,
): Promise<string | null> {
  if (!isNip46Signer(signer)) {
    console.warn('[signerEcdhTag] signer has no sendRequest method');
    return null;
  }

  try {
    const result = await signer.sendRequest('cloistr_ecdh_tag', [
      peerPubkey,
      String(windowId),
    ]);
    if (/^[0-9a-f]{2}$/.test(result)) return result;
    // Never log the value: a signer that answered with the shared secret
    // instead of its one-byte tag would put key material in the console.
    console.warn('[signerEcdhTag] result did not match 2-hex pattern (length', String(result).length + ')');
    return null;
  } catch (err) {
    console.warn('[signerEcdhTag] call failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * A tag for a given user, granter and window never changes, and the bucket it
 * names is already visible in the relay request, so it is remembered rather
 * than asked for again: each ask is a signer round trip, and the Threads page
 * made 22 of them per load (live baseline, 2026-10-28). Only the current and
 * previous windows are kept.
 */
const TAG_CACHE_PREFIX = 'cloistr:ecdh-tags:';

function readTagCache(userPk: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(TAG_CACHE_PREFIX + userPk);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeTagCache(userPk: string, cache: Record<string, string>, windowId: number): void {
  // Merge with what is stored now: the current and previous windows are
  // looked up at the same time, and neither may overwrite the other's tags.
  const kept: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...readTagCache(userPk), ...cache })) {
    if (Number(k.split(':')[1]) >= windowId - 1) kept[k] = v;
  }
  try {
    localStorage.setItem(TAG_CACHE_PREFIX + userPk, JSON.stringify(kept));
  } catch {
    // Storage blocked or full: the tags are simply asked for again next load.
  }
}

async function userPubkey(signer: SignerInterface): Promise<string | null> {
  try {
    const pk = await signer.getPublicKey();
    return typeof pk === 'string' && /^[0-9a-f]{64}$/.test(pk) ? pk : null;
  } catch {
    return null;
  }
}

export async function signerHandoffBuckets(
  signer: SignerInterface,
  granterPubkeys: string[],
  windowId: number,
): Promise<string[]> {
  const userPk = await userPubkey(signer);
  const cache = userPk ? readTagCache(userPk) : {};
  let added = false;
  const results = await Promise.all(
    granterPubkeys.map(async (pk) => {
      const key = `${pk}:${windowId}`;
      if (cache[key]) return cache[key];
      const tag = await signerEcdhTag(signer, pk, windowId);
      if (tag && userPk) {
        cache[key] = tag;
        added = true;
      }
      return tag;
    }),
  );
  if (added && userPk) writeTagCache(userPk, cache, windowId);
  return results.filter((r): r is string => r !== null);
}
