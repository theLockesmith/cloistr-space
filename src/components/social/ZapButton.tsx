/**
 * @fileoverview Send a NIP-57 zap, from the feed or a note's detail view.
 *
 * Replaces the placeholder that showed a zap total with no way to send one.
 * The disabled states say WHY, as text, not only in a title attribute --
 * CLAUDE.md's rule from the react/undo work: a control that cannot act and
 * does not say so is indistinguishable from one that is broken, and the
 * operator reported exactly that from a phone, where nothing hovers.
 *
 * Paying the invoice: window.webln if the browser has an extension providing
 * it, otherwise the bolt11 is shown as text with a `lightning:` link and a
 * copy button. Protocol logic (LNURL resolution, building/signing the zap
 * request, checking the invoice amount) lives in zapService.ts; this
 * component only drives it and renders the result.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveLnurlPayUrl,
  hasLightningAddress,
  type LightningAddress,
} from '@/services/social/zapService';
import { useZap } from '@/services/social/useZap';

/** Minimal shape of the window.webln API this component calls. Not a declared dependency -- it is a browser extension's injected global, present or not. */
interface WeblnProvider {
  enable(): Promise<void>;
  sendPayment(paymentRequest: string): Promise<unknown>;
}

function getWebln(): WeblnProvider | null {
  const w = window as unknown as { webln?: WeblnProvider };
  return w.webln ?? null;
}

const PRESET_SATS = [21, 100, 500, 1000, 5000];

interface Props {
  eventId: string;
  eventPubkey: string;
  address: LightningAddress | undefined;
  /** Same global gate as react/repost (signed in, connected, signer ready). */
  canAct: boolean;
  /** Total sats zapped so far, for the count shown next to the icon. */
  zapAmountSats: number;
  /** Relay hints the zap receipt should be deliverable to -- the same set a share link carries. */
  relays: string[];
}

type Phase = 'idle' | 'requesting' | 'invoice' | 'paying' | 'paid' | 'error';

export function ZapButton({ eventId, eventPubkey, address, canAct, zapAmountSats, relays }: Props) {
  const { requestInvoice, canZap } = useZap();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [amountSats, setAmountSats] = useState<number>(100);
  const [customAmount, setCustomAmount] = useState('');
  const [comment, setComment] = useState('');
  const [invoice, setInvoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weblnNotice, setWeblnNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const hasAddress = hasLightningAddress(address);
  const canOpen = canAct && canZap && hasAddress;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const reset = useCallback(() => {
    setPhase('idle');
    setInvoice(null);
    setError(null);
    setWeblnNotice(null);
    setCopied(false);
  }, []);

  const effectiveAmount = customAmount.trim() ? Number(customAmount.trim()) : amountSats;

  const send = useCallback(async () => {
    const payUrl = resolveLnurlPayUrl(address);
    if (!payUrl) {
      // Should be unreachable -- the button is disabled without an address --
      // but a race (profile changed while the popover was open) is not
      // impossible, and silently doing nothing would be worse than this.
      setError('No lightning address.');
      setPhase('error');
      return;
    }
    if (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) {
      setError('Enter an amount greater than zero.');
      setPhase('error');
      return;
    }

    setPhase('requesting');
    setError(null);
    setWeblnNotice(null);

    try {
      const result = await requestInvoice({
        eventId,
        eventPubkey,
        payUrl,
        amountSats: effectiveAmount,
        relays,
        comment: comment.trim() || undefined,
      });
      setInvoice(result.pr);

      const webln = getWebln();
      if (!webln) {
        setPhase('invoice');
        return;
      }

      setPhase('paying');
      try {
        await webln.enable();
        await webln.sendPayment(result.pr);
        setPhase('paid');
      } catch (weblnErr) {
        // The invoice is still good -- fall back to showing it rather than
        // losing the user's work because the wallet extension declined.
        setWeblnNotice(
          weblnErr instanceof Error
            ? `Wallet did not complete the payment: ${weblnErr.message}`
            : 'Wallet did not complete the payment.'
        );
        setPhase('invoice');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Zap failed.');
      setPhase('error');
    }
  }, [address, effectiveAmount, requestInvoice, eventId, eventPubkey, relays, comment]);

  const copyInvoice = useCallback(async () => {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [invoice]);

  const disabled = !canOpen;

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      <button
        onClick={() => {
          if (disabled) return;
          reset();
          setOpen((o) => !o);
        }}
        disabled={disabled}
        aria-disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={hasAddress ? 'Send a zap' : 'Zap unavailable — no lightning address'}
        title={hasAddress ? 'Send a zap' : undefined}
        className={`flex items-center gap-1.5 text-sm ${
          disabled
            ? 'cursor-not-allowed text-cloistr-light/20'
            : 'text-cloistr-light/40 hover:text-cloistr-warning'
        }`}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {zapAmountSats > 0 && formatSats(zapAmountSats)}
      </button>

      {/* Visible, not hover-only: the same mobile lesson that put the
          blocked-reason banner in SocialFeed as text rather than a title. */}
      {!hasAddress && (
        <span className="text-xs text-cloistr-light/30">no lightning address</span>
      )}

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-72 space-y-3 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-3 shadow-lg"
        >
          {(phase === 'idle' || phase === 'requesting') && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_SATS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      setAmountSats(preset);
                      setCustomAmount('');
                    }}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      !customAmount.trim() && amountSats === preset
                        ? 'bg-cloistr-warning text-cloistr-dark'
                        : 'bg-cloistr-light/10 text-cloistr-light/70 hover:bg-cloistr-light/20'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Custom amount (sats)"
                className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 px-2 py-1.5 text-sm text-cloistr-light"
              />
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment (optional)"
                maxLength={200}
                className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 px-2 py-1.5 text-sm text-cloistr-light"
              />
              <button
                onClick={() => void send()}
                disabled={phase === 'requesting'}
                className="w-full rounded bg-cloistr-warning px-3 py-1.5 text-sm font-medium text-cloistr-dark disabled:opacity-50"
              >
                {phase === 'requesting' ? 'Requesting invoice…' : `Zap ${effectiveAmount || 0} sats`}
              </button>
            </>
          )}

          {phase === 'paying' && (
            <p className="text-sm text-cloistr-light/70">Opening your wallet…</p>
          )}

          {(phase === 'invoice' || phase === 'paid') && invoice && (
            <div className="space-y-2">
              {phase === 'paid' ? (
                <p role="status" className="text-sm text-cloistr-success">
                  Zap sent — {effectiveAmount} sats ⚡
                </p>
              ) : (
                <>
                  {weblnNotice && (
                    <p role="alert" className="text-xs text-cloistr-warning">
                      {weblnNotice}
                    </p>
                  )}
                  <p className="text-xs text-cloistr-light/60">
                    Pay this invoice with any Lightning wallet:
                  </p>
                  <p className="break-all rounded bg-cloistr-light/5 p-2 font-mono text-[10px] text-cloistr-light/80">
                    {invoice}
                  </p>
                  <div className="flex gap-2">
                    <a
                      href={`lightning:${invoice}`}
                      className="flex-1 rounded bg-cloistr-warning px-2 py-1.5 text-center text-xs font-medium text-cloistr-dark"
                    >
                      Open in wallet
                    </a>
                    <button
                      onClick={() => void copyInvoice()}
                      className="flex-1 rounded border border-cloistr-light/10 px-2 py-1.5 text-xs text-cloistr-light/70 hover:bg-cloistr-light/10"
                    >
                      {copied ? 'Copied!' : 'Copy invoice'}
                    </button>
                  </div>
                </>
              )}
              <button
                onClick={() => setOpen(false)}
                className="w-full rounded px-2 py-1 text-xs text-cloistr-light/40 hover:text-cloistr-light"
              >
                Close
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-cloistr-error">
                {error}
              </p>
              <button
                onClick={reset}
                className="w-full rounded border border-cloistr-light/10 px-2 py-1.5 text-xs text-cloistr-light/70 hover:bg-cloistr-light/10"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 1000) return `${(sats / 1000).toFixed(1)}k`;
  return sats.toString();
}
