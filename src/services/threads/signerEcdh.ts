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
    console.warn('[signerEcdhTag] result did not match 2-hex pattern:', result);
    return null;
  } catch (err) {
    console.warn('[signerEcdhTag] call failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function signerHandoffBuckets(
  signer: SignerInterface,
  granterPubkeys: string[],
  windowId: number,
): Promise<string[]> {
  const results = await Promise.all(
    granterPubkeys.map((pk) => signerEcdhTag(signer, pk, windowId)),
  );
  return results.filter((r): r is string => r !== null);
}
