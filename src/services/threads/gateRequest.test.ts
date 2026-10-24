/**
 * @fileoverview The operator's "yes" to a kit gate request, sent from Space.
 *
 * The kit's merge gate accepts a yes only as a complete Nostr event signed by an
 * operator key: kind 1111, content "yes", an `e` tag naming the request. It
 * reads that event as the WHOLE decrypted message text (the `p` of the wrap),
 * not inside an envelope. A wrap's own signer is a one-time key and proves
 * nothing, so a plain "yes" typed into the composer can never pass.
 *
 * The request fixture is made by the kit's own code
 * (__fixtures__/make_gate_request_fixture.py). The last block hands Space's
 * reply to the kit's own gate (__fixtures__/judge_gate_yes_with_kit.py), so the
 * kit, not a Space reimplementation, decides whether it passes.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeEvent, getPublicKey, verifyEvent, nip44, type Event, type UnsignedEvent } from 'nostr-tools';
import { hexToBytes, bytesToHex } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { tryUnwrapMessage, wrapThreadMessageWithKey } from './giftWrap';
import { parseFleetEnvelope } from './fleetEnvelope';
import { parseGateRequest, parseGateYes, signGateYes, wrapGateYes } from './gateRequest';
import fx from './__fixtures__/kitGateRequest.json';

const THREAD_SK = hexToBytes('11'.repeat(32));
const THREAD_SECRET_HEX = bytesToHex(THREAD_SK);
const OPERATOR_SK = hexToBytes('66'.repeat(32));
const OPERATOR_PK = getPublicKey(OPERATOR_SK);

/** A signer holding the operator's key, as a NIP-07/NIP-46 signer would. */
function operatorSigner(overrides: Partial<{ signEvent: (e: UnsignedEvent) => Promise<Event> }> = {}) {
  return {
    getPublicKey: async () => OPERATOR_PK,
    signEvent: async (e: UnsignedEvent) => finalizeEvent(e, OPERATOR_SK),
    ...overrides,
  };
}

function heldStore() {
  const s = new ThreadKeyStore();
  s.set(fx.keys.threadPk, THREAD_SK);
  return s;
}

/** The decrypted `p` of a wrap, as the kit reads it. */
function innerText(wrap: Event): string {
  const ck = nip44.v2.utils.getConversationKey(THREAD_SK, wrap.pubkey);
  return JSON.parse(nip44.v2.decrypt(wrap.content, ck)).p;
}

describe('reading a kit gate request', () => {
  it('finds the request attached to the kit message, with its own signed text', () => {
    const msg = tryUnwrapMessage(fx.wrap, heldStore());
    expect(msg).not.toBeNull();
    const req = parseFleetEnvelope(msg!.plaintext)?.grantRequest;
    expect(req).toMatchObject({
      id: fx.request.id,
      repo: 'aegis/arbiter-client',
      target: 'main',
      gate: 'merge',
      text: fx.request.content,
    });
  });

  it('ignores a request whose text was changed after it was signed', () => {
    // What the operator reads must be what the id covers: the yes signs the id.
    expect(parseGateRequest({ ...fx.request, content: 'Something harmless.' })).toBeNull();
  });

  it('ignores a request whose diff was swapped', () => {
    const tags = fx.request.tags.map((t) => (t[0] === 'diff' ? ['diff', 'cd'.repeat(32)] : t));
    expect(parseGateRequest({ ...fx.request, tags })).toBeNull();
  });

  it('ignores anything that is not a kit gate request', () => {
    const other = finalizeEvent({ kind: 1111, content: 'hi', tags: [], created_at: 1 }, OPERATOR_SK);
    expect(parseGateRequest(other)).toBeNull();
    expect(parseGateRequest('not an event')).toBeNull();
  });
});

describe('signing the yes', () => {
  it("is signed by the operator's own key, says yes, and names the request", async () => {
    const yes = await signGateYes(operatorSigner(), fx.request.id);
    expect(verifyEvent(yes)).toBe(true);
    expect(yes.pubkey).toBe(OPERATOR_PK);
    expect(yes.kind).toBe(1111);
    expect(yes.content).toBe('yes');
    expect(yes.tags).toEqual([['e', fx.request.id]]);
  });

  it('refuses a signer that hands back an event with a bad signature', async () => {
    const signer = operatorSigner({
      signEvent: async (e) => ({ ...finalizeEvent(e, OPERATOR_SK), sig: '00'.repeat(64) }),
    });
    await expect(signGateYes(signer, fx.request.id)).rejects.toThrow();
  });

  it('refuses a signer that signs as a different key than the signed-in one', async () => {
    const signer = operatorSigner({
      signEvent: async (e) => finalizeEvent(e, hexToBytes('77'.repeat(32))),
    });
    await expect(signGateYes(signer, fx.request.id)).rejects.toThrow();
  });

  it('refuses a signer that changed what it was asked to sign', async () => {
    const signer = operatorSigner({
      signEvent: async (e) => finalizeEvent({ ...e, content: 'no' }, OPERATOR_SK),
    });
    await expect(signGateYes(signer, fx.request.id)).rejects.toThrow();
  });
});

describe('the wrap Space sends', () => {
  it('carries the signed yes as the whole message text, every field intact', async () => {
    const yes = await signGateYes(operatorSigner(), fx.request.id);
    const { event } = wrapGateYes(yes, THREAD_SECRET_HEX);
    const inner = JSON.parse(innerText(event));
    expect(inner).toEqual({
      id: yes.id,
      pubkey: yes.pubkey,
      created_at: yes.created_at,
      kind: yes.kind,
      tags: yes.tags,
      content: yes.content,
      sig: yes.sig,
    });
    // The wrap itself is still signed by a one-time key, never the operator's.
    expect(event.pubkey).not.toBe(OPERATOR_PK);
  });

  it('reads back as a signed yes to that request', async () => {
    const yes = await signGateYes(operatorSigner(), fx.request.id);
    const msg = tryUnwrapMessage(wrapGateYes(yes, THREAD_SECRET_HEX).event, heldStore());
    expect(parseGateYes(msg!.plaintext)).toEqual({ requestId: fx.request.id, signer: OPERATOR_PK });
  });

  it('a forged yes does not read back as one', () => {
    const forged = { ...finalizeEvent({ kind: 1111, content: 'yes', tags: [['e', fx.request.id]], created_at: 1 }, OPERATOR_SK) };
    forged.pubkey = getPublicKey(hexToBytes('77'.repeat(32)));
    expect(parseGateYes(JSON.stringify(forged))).toBeNull();
    expect(parseGateYes('yes')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The kit's own gate as the judge. Needs the kit checkout on this machine
// (python3 + ~/.arbiter); CI has neither, so there it is reported as skipped.
// ---------------------------------------------------------------------------

// Tests run from the repo root (jsdom gives import.meta.url a non-file scheme).
const JUDGE = resolve(process.cwd(), 'src/services/threads/__fixtures__/judge_gate_yes_with_kit.py');
const KIT = `${process.env.HOME}/.arbiter/hooks/lib/grant_request.py`;
const kitHere = existsSync(KIT);

function kitAccepts(wrap: Event, operatorPk = OPERATOR_PK): boolean {
  const job = {
    request: fx.request,
    wrap,
    operatorPk,
    gate: 'merge',
    repo: 'aegis/arbiter-client',
    target: 'main',
    diff: 'ab'.repeat(32),
  };
  const out = execFileSync('python3', [JUDGE], { input: JSON.stringify(job), encoding: 'utf8' });
  return JSON.parse(out).accepted === true;
}

describe.skipIf(!kitHere)("the kit's merge gate, judging what Space sends", () => {
  it('accepts the yes Space builds', async () => {
    const yes = await signGateYes(operatorSigner(), fx.request.id);
    expect(kitAccepts(wrapGateYes(yes, THREAD_SECRET_HEX).event)).toBe(true);
  }, 30_000);

  it('rejects "yes" typed into the composer, which is what Space sent before', () => {
    const { event } = wrapThreadMessageWithKey('yes', OPERATOR_PK, THREAD_SECRET_HEX);
    expect(kitAccepts(event)).toBe(false);
  }, 30_000);

  it('rejects the same yes when its signer is not an operator', async () => {
    const yes = await signGateYes(operatorSigner(), fx.request.id);
    expect(kitAccepts(wrapGateYes(yes, THREAD_SECRET_HEX).event, getPublicKey(hexToBytes('77'.repeat(32))))).toBe(false);
  }, 30_000);
});
