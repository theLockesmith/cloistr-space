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
  if (!isNip46Signer(signer)) return null;

  try {
    const result = await signer.sendRequest('cloistr_ecdh_tag', [
      peerPubkey,
      String(windowId),
    ]);
    if (/^[0-9a-f]{2}$/.test(result)) return result;
    return null;
  } catch {
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
