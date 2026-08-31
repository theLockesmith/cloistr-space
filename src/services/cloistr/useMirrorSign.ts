/**
 * @fileoverview Mirror signing for custom emoji images.
 *
 * NIP-51 emoji sets reference URLs on arbitrary third-party hosts. The
 * ReactionPicker deliberately refuses to load them directly: doing so would
 * disclose the viewer's IP to strangers' servers every time a picker opens.
 *
 * The mirror endpoint on files.cloistr.xyz solves this properly: sign a batch
 * of source URLs, get back opaque signed links, render those. The client never
 * contacts the origin host.
 *
 * CONTRACT (from cloistr-blossom docs/reference.md):
 *
 *   POST /media/mirror/sign   Nostr auth, t=mirror. Batch of URLs in, signed links out.
 *   GET  /media/mirror        no auth.              Serves the mirrored image.
 *
 * Space is a static SPA, so we cannot hold a signing key client-side. Auth is
 * a kind:24242 event (BUD-06), which is signed by the user's own signer via
 * NDK. The signed link is an opaque bearer token -- identical for every user
 * who mirrors the same URL -- so it identifies content only, never a person.
 *
 * Failure classes from POST /media/mirror/sign and GET /media/mirror:
 *
 *   415  MIRROR_REFUSED     permanent -- will never load; do not retry
 *   502  MIRROR_UNREACHABLE transient -- retry after Retry-After header
 *   403  MIRROR_UNSIGNED    link expired -- re-sign
 *   501  MIRROR_DISABLED    mirroring off on this server -- degrade to text
 *   404                     endpoint absent (pre-mirror server, deploy window,
 *                           or a third-party Blossom impl) -- same as 501:
 *                           degrade to text, do not surface an error state
 *
 * CAPABILITY CHECK
 *
 * GET /.well-known/blossom returns a capabilities document. When it reports
 * features.media_mirror === false we skip mirror entirely and save a signing
 * round trip. Status codes remain the backstop for servers that do not publish
 * capabilities or that return 404 on the capabilities endpoint.
 */

import { useCallback, useRef, useState } from "react";
import { useNdk } from "@/services/nostr";
import { config } from "@/config/environment";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

const MIRROR_SIGN_PATH = "/media/mirror/sign";
/** Links are minted with 5-minute leeway so we do not re-sign mid-session. */
const EXPIRY_SECONDS = 300;

export type MirrorStatus =
  | { state: "ok"; url: string; expiresAt: number }
  | { state: "refused" }       // 415 -- permanent, do not retry
  | { state: "unreachable"; retryAfter: number }  // 502 -- transient
  | { state: "disabled" };     // 501 / 404 / capabilities false -- degrade to text

/** Map from original URL to its mirror result. */
export type MirrorMap = Map<string, MirrorStatus>;

interface SignedItem {
  source: string;
  url: string;
  expires_at: number;
}

interface RejectedItem {
  source: string;
  reason: string;
}

interface SignResponse {
  signed: SignedItem[];
  rejected: RejectedItem[];
}

interface UseMirrorSignReturn {
  /**
   * Sign a batch of URLs. Any already-resolved, non-expired entries are
   * skipped; the request only carries URLs we do not yet have a valid link for.
   *
   * Calling this when the server has returned disabled is a no-op.
   */
  sign: (urls: string[]) => Promise<void>;
  /** Current resolution state, keyed by original URL. */
  mirrorMap: MirrorMap;
  /** True while a sign request is in flight. */
  isSigning: boolean;
}

/**
 * Check /.well-known/blossom for the features.media_mirror capability.
 *
 * Returns true when the server explicitly advertises the feature as enabled.
 * Returns false when the server says disabled, or when the endpoint is absent
 * or returns anything we cannot parse -- those cases are indistinguishable
 * from a server that predates capabilities, and all of them should degrade
 * gracefully rather than proceeding to sign.
 */
async function checkMirrorCapability(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/.well-known/blossom`, {
      method: "GET",
    });
    if (!res.ok) return false;
    const body = await res.json();
    // The capabilities document uses features.media_mirror (boolean).
    // Any truthy value is treated as enabled; absent key = disabled.
    return body?.features?.media_mirror === true;
  } catch {
    // Network error or parse failure -- treat as disabled.
    return false;
  }
}

export function useMirrorSign(): UseMirrorSignReturn {
  const { createEvent } = useNdk();
  const [mirrorMap, setMirrorMap] = useState<MirrorMap>(new Map());
  const [isSigning, setIsSigning] = useState(false);

  // Set to true when we know mirror is unavailable (501, 404, or capability=false).
  // Avoids pointless signing round trips once we have a definitive answer.
  const disabledRef = useRef(false);
  // Set to true after the capability check has completed, so we only hit
  // /.well-known/blossom once per hook lifetime.
  const capCheckedRef = useRef(false);

  const sign = useCallback(
    async (urls: string[]) => {
      if (urls.length === 0 || disabledRef.current) return;
      if (!createEvent) return;

      // Capability check on first real sign attempt. Cheaper than a sign
      // round trip when the server does not have the feature enabled.
      if (!capCheckedRef.current) {
        capCheckedRef.current = true;
        const capable = await checkMirrorCapability(config.blossomApiUrl);
        if (!capable) {
          disabledRef.current = true;
          return;
        }
      }

      const now = Math.floor(Date.now() / 1000);

      // Skip URLs we already have a fresh result for.
      const pending = urls.filter((url) => {
        const existing = mirrorMap.get(url);
        if (!existing) return true;
        if (existing.state === "ok" && existing.expiresAt > now + 30) return false;
        if (existing.state === "refused" || existing.state === "disabled") return false;
        return true; // unreachable or expired ok
      });

      if (pending.length === 0) return;

      setIsSigning(true);

      try {
        // Build auth: kind:24242, t=mirror, expiration.
        const event = createEvent() as NDKEvent | null;
        if (!event) return;

        event.kind = 24242;
        event.content = "Mirror media";
        event.tags = [
          ["t", "mirror"],
          ["expiration", String(now + EXPIRY_SECONDS)],
        ];

        await event.sign();

        const rawEvent = event.rawEvent();
        const authHeader = `Nostr ${btoa(JSON.stringify(rawEvent))}`;

        const endpoint = `${config.blossomApiUrl.replace(/\/$/, "")}${MIRROR_SIGN_PATH}`;

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({ urls: pending }),
        });

        // 501 = explicitly disabled. 404 = endpoint absent (pre-mirror server,
        // deploy window, or a third-party Blossom impl that never had it).
        // Both mean: degrade to text, no error state, no retry.
        if (res.status === 501 || res.status === 404) {
          disabledRef.current = true;
          setMirrorMap((prev) => {
            const next = new Map(prev);
            for (const url of pending) {
              next.set(url, { state: "disabled" });
            }
            return next;
          });
          return;
        }

        if (res.status === 403) {
          // Our auth event was rejected -- re-signing next call will fix it.
          // Do not update the map so the next sign() attempt will retry.
          return;
        }

        if (res.status === 502) {
          const retryAfterRaw = res.headers.get("Retry-After");
          const retryAfter = retryAfterRaw
            ? now + parseInt(retryAfterRaw, 10)
            : now + 60;
          setMirrorMap((prev) => {
            const next = new Map(prev);
            for (const url of pending) {
              next.set(url, { state: "unreachable", retryAfter });
            }
            return next;
          });
          return;
        }

        if (!res.ok) {
          // Unexpected status -- treat as transient.
          setMirrorMap((prev) => {
            const next = new Map(prev);
            for (const url of pending) {
              next.set(url, { state: "unreachable", retryAfter: now + 60 });
            }
            return next;
          });
          return;
        }

        const body: SignResponse = await res.json();
        const baseUrl = config.blossomApiUrl.replace(/\/$/, "");

        setMirrorMap((prev) => {
          const next = new Map(prev);
          for (const item of body.signed) {
            next.set(item.source, {
              state: "ok",
              // The server returns a relative path; prefix with our blossom base.
              url: item.url.startsWith("http") ? item.url : `${baseUrl}${item.url}`,
              expiresAt: item.expires_at,
            });
          }
          for (const item of body.rejected) {
            // Rejected items are permanent (bad URL, SSRF, type refusal, etc.).
            next.set(item.source, { state: "refused" });
          }
          return next;
        });
      } catch {
        // Network-level failure -- transient.
        const retryAfter = Math.floor(Date.now() / 1000) + 60;
        setMirrorMap((prev) => {
          const next = new Map(prev);
          for (const url of pending) {
            if (!prev.has(url)) {
              next.set(url, { state: "unreachable", retryAfter });
            }
          }
          return next;
        });
      } finally {
        setIsSigning(false);
      }
    },
    [createEvent, mirrorMap]
  );

  return { sign, mirrorMap, isSigning };
}
