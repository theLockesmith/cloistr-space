/**
 * @fileoverview Tells the user their feed may be incomplete while relay auth is off.
 *
 * With "Let relays verify who you are" switched off, relays that only serve
 * identified readers return nothing to us. That emptiness is indistinguishable
 * from those authors not having posted, so the feed has to say it rather than
 * leave the user to infer it.
 */

import { Link } from 'react-router-dom';
import { useNdk, loadRelayAuthEnabled } from '@/services/nostr';

export function RelayAuthOffNotice() {
  const { service } = useNdk();
  // Same fallback as Profile: before the provider hands over the service, the
  // saved value is what the policy is about to be built with.
  //
  // Read at render, not subscribed to. The setting only changes on the Profile
  // route, so the feed remounts and rereads it on the way back. A layout that
  // kept the feed mounted across routes would need a subscription here.
  const enabled = service ? service.getAuthPolicy().isEnabled() : loadRelayAuthEnabled();
  if (enabled) return null;

  return (
    <div
      role="status"
      className="rounded-lg border border-cloistr-warning/30 bg-cloistr-warning/5 px-4 py-2 text-sm text-cloistr-light/70"
    >
      Some posts may be missing. You've turned off letting relays verify who you are, and some
      relays only show posts to people who do.{' '}
      <Link to="/profile" className="text-cloistr-primary underline hover:no-underline">
        Change this in Profile
      </Link>
    </div>
  );
}
