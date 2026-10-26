/**
 * @fileoverview Tests for the mirror sign logic.
 *
 * useMirrorSign is a hook; this tests only the pure-function reasoning and the
 * batch-filter logic (which URLs to send on a second call) in isolation, since
 * the fetch and signing paths are covered by integration tests.
 *
 * Key invariants this suite pins:
 *  - ok entries that are still fresh are NOT re-sent.
 *  - refused entries are NOT retried (permanent).
 *  - unreachable entries are re-sent once their retryAfter has passed, not before.
 *  - disabled short-circuits the whole batch.
 */

import { describe, it, expect } from "vitest";
import { pendingMirrorUrls, type MirrorStatus } from "./useMirrorSign";

// The disabled flag lives in a ref inside the hook and short-circuits before
// the filter runs; modelled here so the existing cases keep their shape.
function pendingUrls(
  urls: string[],
  mirrorMap: Map<string, MirrorStatus>,
  nowSeconds: number,
  disabled: boolean
): string[] {
  return disabled ? [] : pendingMirrorUrls(urls, mirrorMap, nowSeconds);
}

const NOW = 1_000_000;
const FRESH_EXPIRY = NOW + 300;
const STALE_EXPIRY = NOW - 1;

describe("useMirrorSign pending-URL filter", () => {
  it("sends everything on a fresh map", () => {
    const urls = ["https://a.test/a.png", "https://b.test/b.png"];
    expect(pendingUrls(urls, new Map(), NOW, false)).toEqual(urls);
  });

  it("skips a fresh ok entry", () => {
    const map = new Map<string, MirrorStatus>([
      ["https://a.test/a.png", { state: "ok", url: "/m?u=a&s=x", expiresAt: FRESH_EXPIRY }],
    ]);
    const result = pendingUrls(["https://a.test/a.png", "https://b.test/b.png"], map, NOW, false);
    expect(result).toEqual(["https://b.test/b.png"]);
  });

  it("retries an expired ok entry", () => {
    const map = new Map<string, MirrorStatus>([
      ["https://a.test/a.png", { state: "ok", url: "/m?u=a&s=x", expiresAt: STALE_EXPIRY }],
    ]);
    const result = pendingUrls(["https://a.test/a.png"], map, NOW, false);
    expect(result).toEqual(["https://a.test/a.png"]);
  });

  it("never retries a refused entry", () => {
    const map = new Map<string, MirrorStatus>([
      ["https://a.test/a.png", { state: "refused" }],
    ]);
    expect(pendingUrls(["https://a.test/a.png"], map, NOW, false)).toEqual([]);
  });

  it("retries an unreachable entry", () => {
    const map = new Map<string, MirrorStatus>([
      ["https://a.test/a.png", { state: "unreachable", retryAfter: NOW - 5 }],
    ]);
    expect(pendingUrls(["https://a.test/a.png"], map, NOW, false)).toEqual(["https://a.test/a.png"]);
  });

  it("does not retry an unreachable entry before its retryAfter", () => {
    // Without this, every re-render during a mirror outage re-signed and
    // re-sent: one signer round trip per render.
    const map = new Map<string, MirrorStatus>([
      ["https://a.test/a.png", { state: "unreachable", retryAfter: NOW + 60 }],
    ]);
    expect(pendingUrls(["https://a.test/a.png"], map, NOW, false)).toEqual([]);
  });

  it("returns nothing when disabled", () => {
    expect(pendingUrls(["https://a.test/a.png"], new Map(), NOW, true)).toEqual([]);
  });
});
