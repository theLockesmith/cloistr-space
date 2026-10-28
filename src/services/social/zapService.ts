/**
 * @fileoverview Pure NIP-57 zap flow, callable without React.
 *
 * Same discipline as noteService.ts: every function takes a SignerInterface
 * (and here, a `fetch`) as a parameter rather than reaching for a global, so
 * the whole flow is testable with mocks and a headless caller can drive it
 * directly. useZap.ts supplies the NDK-backed signer and the real `fetch` for
 * components.
 *
 * The flow, in order:
 *   1. resolveLnurlPayUrl    -- lud16/lud06 on the recipient's kind:0 -> an
 *                               LNURL-pay HTTPS endpoint.
 *   2. fetchLnurlPayInfo     -- GET that endpoint; read callback, min/max
 *                               sendable, and whether it accepts NIP-57 zaps.
 *   3. buildZapRequest       -- an unsigned kind:9734 template.
 *   4. requestZapInvoice     -- sign it, send amount+event to the callback,
 *                               get back a bolt11 invoice, and REFUSE to hand
 *                               back an invoice whose amount does not match
 *                               what was asked for.
 *
 * Paying the bolt11 (webln or showing it as text) is UI concern and lives in
 * the component -- it is a browser API call, not protocol logic, and this
 * module has no business deciding how a payment gets made.
 */

import type { SignerInterface } from '../headless';
import { ZAP_REQUEST_KIND } from '@/types/social';

// ============================================
// bech32 (BIP-173) -- vendored, not imported
// ============================================
//
// LUD-06 lightning addresses carry their URL bech32-encoded with the "lnurl"
// human-readable part, and NIP-57's `lnurl` zap-request tag is the same
// encoding of the resolved pay URL. nostr-tools' nip19 module only encodes
// its own fixed prefixes (npub, nevent, ...); it does not expose a generic
// encoder/decoder for an arbitrary HRP. @scure/base has one, but it is not a
// declared dependency of this package -- only present because something else
// happens to pull it in -- and importing an undeclared transitive dependency
// is exactly the mistake this repo's "verify bundled deps by reading the
// file" lesson is about: it is not guaranteed to be there on the next
// install. bech32 is a small, fully-specified algorithm, so it is
// implemented here instead, covered by round-trip tests.

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= BECH32_GENERATOR[i];
    }
  }
  return chk >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (const c of hrp) result.push(c.charCodeAt(0) >>> 5);
  result.push(0);
  for (const c of hrp) result.push(c.charCodeAt(0) & 31);
  return result;
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ 1;
  const ret: number[] = [];
  for (let p = 0; p < 6; p++) ret.push((mod >>> (5 * (5 - p))) & 31);
  return ret;
}

/** 8-bit bytes <-> 5-bit groups. Returns null on invalid input (per BIP-173). */
function convertBits(
  data: ArrayLike<number>,
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || value >>> fromBits !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >>> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || (acc << (toBits - bits)) & maxv) {
    return null;
  }
  return ret;
}

/** Encode arbitrary bytes as bech32 with the given human-readable prefix. */
export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = convertBits(bytes, 8, 5, true);
  if (!data) throw new Error('bech32: could not convert data to 5-bit groups');
  const checksum = bech32CreateChecksum(hrp, data);
  return hrp + '1' + [...data, ...checksum].map((d) => BECH32_CHARSET[d]).join('');
}

/** Decode a bech32 string. Returns null rather than throwing on bad input -- this reads untrusted profile/network data. */
export function bech32Decode(input: string): { hrp: string; bytes: Uint8Array } | null {
  if (input.length < 8 || input.length > 2000) return null;
  const hasLower = input !== input.toUpperCase();
  const hasUpper = input !== input.toLowerCase();
  if (hasLower && hasUpper) return null; // mixed case is invalid per spec
  const s = input.toLowerCase();

  const sep = s.lastIndexOf('1');
  if (sep < 1 || sep + 7 > s.length) return null;
  const hrp = s.slice(0, sep);
  const dataPart = s.slice(sep + 1);

  const data: number[] = [];
  for (const c of dataPart) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) return null;
    data.push(idx);
  }

  if (bech32Polymod([...bech32HrpExpand(hrp), ...data]) !== 1) return null;

  const payload = data.slice(0, -6);
  const bytes = convertBits(payload, 5, 8, false);
  if (!bytes) return null;
  return { hrp, bytes: new Uint8Array(bytes) };
}

// ============================================
// Lightning address resolution (LUD-06 / LUD-16)
// ============================================

/** A recipient's lightning address, read from their kind:0. Either may be present, neither may. */
export interface LightningAddress {
  lud16?: string;
  lud06?: string;
}

/**
 * LUD-16: `name@domain` -> `https://domain/.well-known/lnurlp/name`.
 *
 * Returns null on anything that is not a plausible address rather than
 * guessing -- a malformed lud16 should disable the button, not send a request
 * to a wrong or attacker-controlled host.
 */
export function lnurlPayUrlFromLud16(lud16: string): string | null {
  const trimmed = lud16.trim();
  const match = /^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(trimmed);
  if (!match) return null;
  const [, name, domain] = match;
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

/** LUD-06: a bech32 string (`lnurl1...`) whose data bytes are the UTF-8 pay URL. */
export function lnurlPayUrlFromLud06(lud06: string): string | null {
  const decoded = bech32Decode(lud06.trim());
  if (!decoded || decoded.hrp !== 'lnurl') return null;
  try {
    const url = new TextDecoder().decode(decoded.bytes);
    return /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** Resolve an LNURL-pay endpoint from whichever of lud16/lud06 is present, preferring lud16 (LUD-16 is the current recommendation; LUD-06 is the legacy fallback). */
export function resolveLnurlPayUrl(address: LightningAddress | undefined): string | null {
  if (!address) return null;
  if (address.lud16) {
    const url = lnurlPayUrlFromLud16(address.lud16);
    if (url) return url;
  }
  if (address.lud06) {
    return lnurlPayUrlFromLud06(address.lud06);
  }
  return null;
}

/**
 * Whether this profile has anything resolvable to a pay endpoint.
 *
 * Deliberately a pure, local check with no network call -- it is what
 * disables the zap button on render, before any fetch happens. "No lightning
 * address" and "the address is unreachable right now" are different facts
 * reported at different points in the flow; this is only the first one.
 */
export function hasLightningAddress(address: LightningAddress | undefined): boolean {
  return resolveLnurlPayUrl(address) !== null;
}

// ============================================
// LNURL-pay params
// ============================================

export interface LnurlPayInfo {
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  /** NIP-57 support flag the LNURL service advertises. */
  allowsNostr: boolean;
  /** The service's pubkey, used by receipt verification. Not used by this module, which never publishes or reads back a 9735 -- carried through so a caller that does can. */
  nostrPubkey?: string;
  /** LUD-12: 0 (or absent) means comments are not accepted at all; a positive number is the max length. */
  commentAllowed?: number;
}

type FetchFn = typeof fetch;

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`${what} did not return a valid response.`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${what} did not return a valid response.`);
  }
  return data as Record<string, unknown>;
}

/** LUD-03 error shape: `{status: "ERROR", reason: "..."}`. Shared by the pay-info fetch and the callback fetch. */
function throwOnLnurlError(obj: Record<string, unknown>, what: string): void {
  if (typeof obj.status === 'string' && obj.status.toUpperCase() === 'ERROR') {
    const reason = typeof obj.reason === 'string' && obj.reason ? obj.reason : 'refused the request.';
    throw new Error(`${what} ${reason}`);
  }
}

/** GET the LNURL-pay endpoint and validate the fields this flow depends on. */
export async function fetchLnurlPayInfo(fetchFn: FetchFn, payUrl: string): Promise<LnurlPayInfo> {
  let res: Response;
  try {
    res = await fetchFn(payUrl);
  } catch (err) {
    throw new Error(
      `Could not reach the lightning address.${err instanceof Error ? ` ${err.message}` : ''}`,
      { cause: err }
    );
  }
  if (!res.ok) {
    throw new Error(`Lightning address returned an error (HTTP ${res.status}).`);
  }

  const obj = await readJson(res, 'Lightning address');
  throwOnLnurlError(obj, 'Lightning address');

  if (typeof obj.callback !== 'string' || !obj.callback) {
    throw new Error('Lightning address has no payment callback.');
  }
  if (typeof obj.minSendable !== 'number' || typeof obj.maxSendable !== 'number') {
    throw new Error('Lightning address did not specify an amount range.');
  }

  return {
    callback: obj.callback,
    minSendable: obj.minSendable,
    maxSendable: obj.maxSendable,
    metadata: typeof obj.metadata === 'string' ? obj.metadata : '',
    allowsNostr: obj.allowsNostr === true,
    nostrPubkey: typeof obj.nostrPubkey === 'string' ? obj.nostrPubkey : undefined,
    commentAllowed: typeof obj.commentAllowed === 'number' ? obj.commentAllowed : undefined,
  };
}

/** Throws unless the LNURL service has declared NIP-57 support. */
export function assertSupportsNostrZap(info: LnurlPayInfo): void {
  if (!info.allowsNostr || !info.nostrPubkey) {
    throw new Error('This lightning address does not support zaps (no Nostr receipt support).');
  }
}

// ============================================
// Zap request (kind:9734)
// ============================================

export interface BuildZapRequestOptions {
  eventId: string;
  eventPubkey: string;
  /** Millisats. Must be a positive integer -- it goes straight into the `amount` tag the recipient and relay validate against. */
  amountMsats: number;
  relays: string[];
  /** The resolved LNURL-pay endpoint, plain https URL. Encoded to bech32 for the `lnurl` tag per NIP-57. */
  lnurl: string;
  comment?: string;
}

/** Build an unsigned kind:9734 template. Pure; exported for testing. */
export function buildZapRequest(
  opts: BuildZapRequestOptions
): { kind: number; content: string; tags: string[][] } {
  if (!Number.isFinite(opts.amountMsats) || opts.amountMsats <= 0) {
    throw new Error('Zap amount must be greater than zero.');
  }
  if (!opts.relays.length) {
    throw new Error('Cannot build a zap request with no relays to deliver the receipt to.');
  }

  const tags: string[][] = [
    ['relays', ...opts.relays],
    ['amount', String(Math.round(opts.amountMsats))],
    ['lnurl', bech32Encode('lnurl', new TextEncoder().encode(opts.lnurl))],
    ['p', opts.eventPubkey],
    ['e', opts.eventId],
  ];

  return { kind: ZAP_REQUEST_KIND, content: opts.comment?.trim() ?? '', tags };
}

// ============================================
// bolt11 amount check
// ============================================

const BOLT11_UNIT_MSATS: Record<string, number> = {
  m: 1e8, // milli-bitcoin
  u: 1e5, // micro-bitcoin
  n: 1e2, // nano-bitcoin
  p: 1e-1, // pico-bitcoin
};

/**
 * Read the amount, in millisats, out of a bolt11 invoice's human-readable
 * part -- without decoding the invoice's data part or validating its
 * checksum. That is all this flow needs: a local figure to compare against
 * what was requested, before anything gets paid.
 *
 * Returns null for a no-amount invoice (no digits in the HRP) or anything
 * that does not parse as bolt11, rather than throwing -- an LNURL server is
 * allowed to omit the amount from its own HRP in principle, and "cannot
 * check" and "checked and it is wrong" must not be the same code path.
 */
export function decodeBolt11AmountMsats(invoice: string): number | null {
  const s = invoice.trim().toLowerCase().replace(/^lightning:/, '');
  const sep = s.lastIndexOf('1');
  if (sep < 2) return null;
  const hrp = s.slice(0, sep);

  const match = /^ln[a-z]*?(\d+)([munp])?$/.exec(hrp);
  if (!match) return null;

  const [, digits, unit] = match;
  const amount = Number(digits);
  if (!Number.isFinite(amount)) return null;

  const msats = unit ? amount * BOLT11_UNIT_MSATS[unit] : amount * 1e11;
  return Math.round(msats);
}

// ============================================
// Full flow
// ============================================

export interface RequestZapInvoiceOptions {
  /** The resolved LNURL-pay endpoint -- caller gets this from resolveLnurlPayUrl. */
  payUrl: string;
  eventId: string;
  eventPubkey: string;
  amountMsats: number;
  relays: string[];
  comment?: string;
}

export interface ZapInvoiceResult {
  /** bolt11 payment request. */
  pr: string;
  /** Optional LUD-21 verify URL, carried through for a caller that wants to poll it. */
  verify?: string;
}

/**
 * The full request half of NIP-57: fetch LNURL-pay params, check Nostr
 * support and the amount range, sign a kind:9734 through `signer`, send it to
 * the callback, and return the invoice -- after checking its amount matches
 * what was asked for.
 *
 * Does NOT pay the invoice. That is the caller's job: try window.webln, or
 * show the bolt11 as text. Keeping it out of this module means the amount
 * check below is the last word on whether an invoice is safe to pay, for
 * every caller, including one that never heard of webln.
 */
export async function requestZapInvoice(
  signer: SignerInterface,
  fetchFn: FetchFn,
  opts: RequestZapInvoiceOptions
): Promise<ZapInvoiceResult> {
  const info = await fetchLnurlPayInfo(fetchFn, opts.payUrl);
  assertSupportsNostrZap(info);

  const requested = Math.round(opts.amountMsats);
  if (requested < info.minSendable || requested > info.maxSendable) {
    throw new Error(
      `Amount must be between ${Math.ceil(info.minSendable / 1000)} and ` +
        `${Math.floor(info.maxSendable / 1000)} sats.`
    );
  }

  const template = buildZapRequest({
    eventId: opts.eventId,
    eventPubkey: opts.eventPubkey,
    amountMsats: requested,
    relays: opts.relays,
    lnurl: opts.payUrl,
    comment: opts.comment,
  });

  const pubkey = await signer.getPublicKey();
  const signed = await signer.signEvent({
    ...template,
    created_at: Math.floor(Date.now() / 1000),
    pubkey,
  });

  const callbackUrl = new URL(info.callback);
  callbackUrl.searchParams.set('amount', String(requested));
  callbackUrl.searchParams.set('nostr', JSON.stringify(signed));
  if (opts.comment?.trim() && info.commentAllowed !== 0) {
    callbackUrl.searchParams.set('comment', opts.comment.trim());
  }

  let res: Response;
  try {
    res = await fetchFn(callbackUrl.toString());
  } catch (err) {
    throw new Error(`Could not reach the zap callback.${err instanceof Error ? ` ${err.message}` : ''}`, {
      cause: err,
    });
  }
  if (!res.ok) {
    throw new Error(`Zap callback returned an error (HTTP ${res.status}).`);
  }

  const obj = await readJson(res, 'Zap callback');
  throwOnLnurlError(obj, 'Zap callback');

  if (typeof obj.pr !== 'string' || !obj.pr) {
    throw new Error('Zap callback did not return an invoice.');
  }

  // The one check that matters most: refuse to hand back an invoice for the
  // wrong amount. Paying it blind turns a misbehaving (or malicious) LNURL
  // server's bug into the user's money, not a bug report.
  const invoiceMsats = decodeBolt11AmountMsats(obj.pr);
  if (invoiceMsats !== null && invoiceMsats !== requested) {
    throw new Error(
      `The invoice is for ${invoiceMsats} msats, not the ${requested} msats requested. Refusing to pay it.`
    );
  }

  return { pr: obj.pr, verify: typeof obj.verify === 'string' ? obj.verify : undefined };
}
