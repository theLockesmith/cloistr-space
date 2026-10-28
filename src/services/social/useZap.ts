/**
 * @fileoverview Zap (NIP-57) hook for components.
 *
 * Wires the NDK-backed signer from useHeadlessAdapters and the real `fetch`
 * into zapService's pure request flow. Paying the resulting invoice (webln or
 * showing it as text) is the component's job -- it is a browser API call, not
 * something this hook should decide on the caller's behalf.
 */

import { useCallback } from 'react';
import { useHeadlessAdapters } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { requestZapInvoice, type ZapInvoiceResult } from './zapService';

export interface ZapParams {
  eventId: string;
  eventPubkey: string;
  /** Resolved LNURL-pay endpoint; caller gets this from zapService.resolveLnurlPayUrl. */
  payUrl: string;
  amountSats: number;
  relays: string[];
  comment?: string;
}

interface UseZapReturn {
  /** Build, sign and send the zap request; returns the bolt11 invoice. Throws on any failure -- nothing here is swallowed. */
  requestInvoice: (params: ZapParams) => Promise<ZapInvoiceResult>;
  /** Whether a zap can be attempted at all (signed in, signer ready). Per-note availability (lightning address present) is a separate check the caller makes against the author's profile. */
  canZap: boolean;
}

export function useZap(): UseZapReturn {
  const { signer } = useHeadlessAdapters();
  const { pubkey, isAuthenticated } = useAuthStore();

  const canZap = isAuthenticated && !!pubkey && !!signer;

  const requestInvoice = useCallback(
    async (params: ZapParams) => {
      if (!signer) throw new Error('Not connected');
      return requestZapInvoice(signer, fetch, {
        payUrl: params.payUrl,
        eventId: params.eventId,
        eventPubkey: params.eventPubkey,
        amountMsats: Math.round(params.amountSats * 1000),
        relays: params.relays,
        comment: params.comment,
      });
    },
    [signer]
  );

  return { requestInvoice, canZap };
}
