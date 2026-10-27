/**
 * @fileoverview The pieces of the old Sealed tab that outlive it (threads.md 6):
 * the key-offer prompts, and how a sealed message's sender is shown.
 *
 * Private threads now sit in the one thread list, so nothing here lists
 * messages. What remains is the trust surface: an offered key is held until
 * the user decides, and a sender nothing signs is never shown as a name.
 */

import { nip19 } from 'nostr-tools';
import { useAuthStore } from '@/stores/authStore';
import { useAuth } from '@/components/auth/AuthProvider';
import { useThreadKeyStore, type BucketReaderReturn } from '@/services/threads';
import { usePendingKeyWraps, acceptKeyWrap, dismissKeyWrap } from '@/services/threads/pendingKeyOffers';

/**
 * Every key offer waiting on the user, from either route: a bucket hand-off
 * (sender unverifiable) or a signed key-wrap (sender known, not trusted).
 * Renders nothing when there are none.
 */
export function KeyOffers({ reader }: { reader: BucketReaderReturn }) {
  const { pubkey } = useAuthStore();
  const { signer } = useAuth();
  const keyStore = useThreadKeyStore();
  const pendingKeyWraps = usePendingKeyWraps();

  if (reader.pendingHandoffs.length === 0 && pendingKeyWraps.length === 0) return null;

  return (
    <div className="space-y-2">
      {reader.pendingHandoffs.map((offer) => (
        <KeyOfferPrompt
          key={offer.wrapId}
          senderPubkey={offer.granterPubkey}
          senderSigned={false}
          onAccept={() => reader.acceptHandoff(offer.wrapId)}
          onDismiss={() => reader.dismissHandoff(offer.wrapId)}
        />
      ))}
      {pendingKeyWraps.map((offer) => (
        <KeyOfferPrompt
          key={offer.eventId}
          senderPubkey={offer.senderPubkey}
          senderSigned
          onAccept={() => {
            if (acceptKeyWrap(offer.eventId, keyStore, pubkey, signer?.nip44Encrypt?.bind(signer))) reader.refresh();
          }}
          onDismiss={() => dismissKeyWrap(offer.eventId)}
        />
      ))}
    </div>
  );
}

/**
 * An offered thread key, held until the user decides. A hand-off cannot say
 * who really sent it; a key-wrap can, but its sender is not one Space was
 * told to trust. Either way, accepting lets the sender put messages in front
 * of the user.
 */
function KeyOfferPrompt({
  senderPubkey,
  senderSigned,
  onAccept,
  onDismiss,
}: {
  senderPubkey: string;
  senderSigned: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const sender = <span className="font-mono">{shortNpub(senderPubkey)}</span>;
  return (
    <div role="alert" className="rounded border border-cloistr-warning/40 bg-cloistr-warning/10 p-3 text-sm text-cloistr-light">
      <p className="font-medium">
        <span className="mr-2 rounded border border-cloistr-warning/40 px-1 text-[10px] uppercase text-cloistr-warning">
          Unverified invitation
        </span>
        Someone offered you a key to a sealed thread
      </p>
      <p className="mt-1 text-xs text-cloistr-light/70">
        {senderSigned ? (
          <>It was sent by {sender}, who is not a sender Space knows to trust.</>
        ) : (
          <>
            The offer claims to come from {sender}{' '}
            <span className="rounded border border-cloistr-warning/40 px-1 text-[10px] uppercase text-cloistr-warning">
              claimed, unverified
            </span>
            . Anyone can claim any sender here, and Space cannot check it.
          </>
        )}{' '}
        Accept only if you were expecting it: accepting lets whoever sent it put messages in front of you.
      </p>
      <div className="mt-2 flex gap-2">
        <button onClick={onAccept} className="rounded bg-cloistr-primary px-3 py-1 text-xs text-cloistr-dark">
          Accept key
        </button>
        <button
          onClick={onDismiss}
          className="rounded px-3 py-1 text-xs text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * The sender of a sealed message as the message itself claims it. The author
 * field and any name in the body are written by whoever holds the thread key,
 * and nothing signs them, so they are shown as a key with an "unverified"
 * marker, never as a trusted name or profile.
 */
export function UnverifiedSender({ pubkeyHex }: { pubkeyHex: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono">{shortNpub(pubkeyHex)}</span>
      <span
        className="rounded border border-cloistr-warning/40 px-1 text-[10px] uppercase text-cloistr-warning"
        title="Space cannot verify who wrote this. Anyone holding the thread key can claim to be anyone."
      >
        unverified
      </span>
    </span>
  );
}

export function shortNpub(pubkeyHex: string): string {
  try {
    const npub = nip19.npubEncode(pubkeyHex);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return `${pubkeyHex.slice(0, 8)}…`;
  }
}
