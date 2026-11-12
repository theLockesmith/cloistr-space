/**
 * Send each due hand-off again (see handoffGrants.ts). Pure, so a headless
 * caller can run the same retry with its own signer and connections.
 */

import type { SignerInterface } from '@cloistr/auth';
import type { ThreadKeyStore } from './threadKeyStore';
import type { HandoffGrants } from './handoffGrants';
import { getWindowId } from './bucketCrypto';
import { publishKeyHandoffViaSigner, type ThreadPublishOptions } from './threadPublish';

/**
 * Returns how many were sent. A grant whose key is not held (yet: keys
 * restore late) or whose send failed stays due and is tried on the next run.
 */
export async function resendDueHandoffs(
  grants: HandoffGrants,
  keyStore: Pick<ThreadKeyStore, 'exportHex'>,
  signer: SignerInterface,
  opts: ThreadPublishOptions = {},
): Promise<number> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const windowId = getWindowId(now);
  let sent = 0;
  for (const g of grants.due(windowId)) {
    const secret = keyStore.exportHex(g.thread);
    if (!secret) continue;
    try {
      await publishKeyHandoffViaSigner(g.tid, secret, signer, g.member, { ...opts, nowSec: now });
      await grants.record(g.thread, g.member, g.tid, windowId, { resend: true });
      sent += 1;
    } catch {
      // Relays or signer unavailable: still due, tried again next run.
    }
  }
  return sent;
}
