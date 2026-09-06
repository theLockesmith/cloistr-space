/**
 * @fileoverview Relay routing manifest.
 *
 * NDK routes every subscription by one rule:
 *
 *   Filter WITH `authors`    → that author's write relays (outbox model)
 *   Filter WITHOUT `authors` → ndk.explicitRelayUrls (the configured set)
 *
 * That rule is correct for standard Nostr kinds and wrong for Cloistr-specific
 * kinds that live on our relay by construction. This file documents the per-kind
 * routing decisions and provides the helpers that enforce them.
 *
 * THREE RELAY SETS IN THIS APP
 *
 *   OWN RELAYS  (NdkService.getOwnRelaySet / fetchFromOwnRelays)
 *     The user's declared relay set: kind:30078 cloistr-relays → kind:10002
 *     NIP-65 → hardcoded default. Always includes relay.cloistr.xyz because the
 *     fallback chain terminates there and the resolver never returns empty.
 *     Use for: kinds that live ONLY on our relay. Routing by the outbox model
 *     would scatter the query across relays that have never seen our kinds, and
 *     an empty result is indistinguishable from "no data".
 *
 *   OUTBOX  (NDK default, when filter carries `authors`)
 *     Each author's write relays, resolved from their kind:10002. Dozens of
 *     relays, one per author in the filter. NDK manages this automatically.
 *     Use for: standard Nostr kinds where the data lives wherever the author
 *     chose to publish it.
 *
 *   ALL CONNECTED  (monotonic widen, see globalRelays.ts)
 *     Every relay connected this session, growing but never shrinking. Avoids
 *     re-subscription churn from flapping connections.
 *     Use for: no-authors queries that need breadth beyond explicitRelayUrls,
 *     specifically the global feed and engagement subscriptions.
 *
 * PER-KIND ROUTING DECISIONS
 *
 * ┌───────┬────────────────────────────┬──────────────┬──────────────────────────┐
 * │ Kind  │ What                       │ Relay set    │ Why                      │
 * ├───────┼────────────────────────────┼──────────────┼──────────────────────────┤
 * │     0 │ Profile metadata           │ outbox       │ Lives on author's relays │
 * │     1 │ Short text note            │ outbox / all │ following/wot: outbox    │
 * │       │                            │              │ global: all connected    │
 * │     3 │ Contact list (NIP-02)      │ outbox       │ Lives on author's relays │
 * │     5 │ Deletion                   │ outbox       │ Publish to own relays    │
 * │     6 │ Repost                     │ all connected│ Engagement: no authors   │
 * │     7 │ Reaction                   │ all connected│ Engagement: no authors   │
 * │     9 │ Group chat message         │ own relays   │ NIP-29: group's relay    │
 * │  1063 │ File metadata              │ own relays   │ Cloistr files on our     │
 * │       │                            │              │ relay; Blossom ref       │
 * │  1111 │ Comment / thread           │ own relays   │ Group threads on group   │
 * │       │                            │              │ relay                    │
 * │  9000 │ Mod action (NIP-29)        │ own relays   │ Group admin on group     │
 * │       │                            │              │ relay                    │
 * │  9021 │ Join request (NIP-29)      │ own relays   │ Addressed to group relay │
 * │  9022 │ Leave request (NIP-29)     │ own relays   │ Addressed to group relay │
 * │  9734 │ Zap request                │ outbox       │ Sent to author           │
 * │  9735 │ Zap receipt                │ all connected│ Engagement: no authors   │
 * │ 10002 │ Relay list (NIP-65)        │ outbox       │ Lives on author's relays │
 * │ 10030 │ Emoji list                 │ outbox       │ Lives on author's relays │
 * │ 10050 │ DM inbox relay list        │ outbox       │ Lives on author's relays │
 * │ 22242 │ NIP-42 AUTH                │ (internal)   │ Handled by NDK           │
 * │ 30030 │ Emoji set                  │ outbox       │ Lives on author's relays │
 * │ 30078 │ App-specific data          │ own relays   │ Cloistr relay prefs      │
 * │ 31922 │ Calendar (date)            │ own relays   │ Cloistr calendar on our  │
 * │       │                            │              │ relay                    │
 * │ 31923 │ Calendar (time)            │ own relays   │ Cloistr calendar on our  │
 * │       │                            │              │ relay                    │
 * │ 31990 │ Handler / tasks            │ own relays   │ Cloistr tasks on our     │
 * │       │                            │              │ relay                    │
 * │ 33000 │ NIP-0A contact list (CRDT) │ own relays   │ Cloistr-only kind        │
 * │ 39000 │ Group metadata (NIP-29)    │ own relays   │ Group on group relay     │
 * │ 39001 │ Group admins (NIP-29)      │ own relays   │ Group on group relay     │
 * │ 39002 │ Group members (NIP-29)     │ own relays   │ Group on group relay     │
 * └───────┴────────────────────────────┴──────────────┴──────────────────────────┘
 *
 * THE DANGER IN THE TABLE ABOVE. "Own relays" is correct only because every group
 * in this deployment lives on relay.cloistr.xyz, which is always in the user's
 * relay set. A federated NIP-29 group on a third-party relay would need a
 * GROUP-SPECIFIC relay set (from the group metadata's `relay` tag), not "own
 * relays". That is a future concern; the table documents what is true today.
 *
 * WHAT GOES WRONG WHEN ROUTING IS WRONG
 *
 *   Wrong relay set for a READ:  empty result, indistinguishable from "no data".
 *   Wrong relay set for a WRITE: event published to relays that cannot serve it.
 *
 * Both are silent. The only signal is the product misbehaving in a way that
 * looks like missing data, not a query error. See CLAUDE.md "A broken state and
 * a working-but-empty state render identically."
 */

/**
 * Kinds that live on the user's own relays (Cloistr-specific or NIP-29 group).
 *
 * Any filter for these kinds should use fetchFromOwnRelays or pass an explicit
 * relaySet from getOwnRelaySet, so NDK does not scatter the query via outbox
 * routing. The alternative is relying on explicitRelayUrls happening to contain
 * the right relay, which is the coincidence-not-a-contract that already broke
 * kind:33000 contact lists.
 */
export const OWN_RELAY_KINDS = new Set([
  9,     // GROUP_CHAT_KIND
  1063,  // FILE_METADATA_KIND
  1111,  // THREAD_KIND
  9000,  // GROUP_MOD_ACTION_KIND
  9021,  // GROUP_JOIN_REQUEST_KIND
  9022,  // GROUP_LEAVE_REQUEST_KIND
  30078, // App-specific data (relay prefs)
  31922, // CALENDAR_DATE_KIND
  31923, // CALENDAR_TIME_KIND
  31990, // TASK_KIND (handler info)
  33000, // NIP0A_KIND
  39000, // GROUP_METADATA_KIND
  39001, // GROUP_ADMINS_KIND
  39002, // GROUP_MEMBERS_KIND
]);

/**
 * True when ALL kinds in the filter should be routed to own relays.
 *
 * A mixed filter (some own, some outbox) is a design error and should be split
 * into two queries. This function returns false for a mixed filter rather than
 * silently picking one routing for both.
 */
export function shouldUseOwnRelays(kinds: number[] | undefined): boolean {
  if (!kinds || kinds.length === 0) return false;
  return kinds.every((k) => OWN_RELAY_KINDS.has(k));
}
