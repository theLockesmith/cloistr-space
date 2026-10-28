/**
 * When zapService refuses an invoice (no amount, wrong amount, plain-http
 * payee), the button must say so in plain text and never show or pay it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZapButton } from './ZapButton';

const requestInvoice = vi.fn();

vi.mock('@/services/social/useZap', () => ({
  useZap: () => ({ requestInvoice, canZap: true }),
}));

afterEach(() => {
  requestInvoice.mockReset();
  delete (window as unknown as { webln?: unknown }).webln;
});

describe('ZapButton when the invoice is refused', () => {
  it('shows the refusal as an error, and neither shows nor pays an invoice', async () => {
    const sendPayment = vi.fn();
    (window as unknown as { webln: unknown }).webln = { enable: vi.fn(), sendPayment };
    requestInvoice.mockRejectedValue(
      new Error('The invoice does not state an amount, so it cannot be checked. Refusing to pay it.'),
    );

    render(
      <ZapButton
        eventId={'e'.repeat(64)}
        eventPubkey={'f'.repeat(64)}
        address={{ lud16: 'bob@cloistr.xyz' }}
        canAct
        zapAmountSats={0}
        relays={[]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send a zap' }));
    fireEvent.click(screen.getByRole('button', { name: /^Zap \d+ sats$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('does not state an amount');
    expect(screen.queryByText('Open in wallet')).not.toBeInTheDocument();
    expect(sendPayment).not.toHaveBeenCalled();
  });
});
