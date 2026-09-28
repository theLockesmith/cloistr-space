/**
 * The kit wraps each thread message's text in a small envelope, carried INSIDE
 * the encrypted payload:
 *   {"v":"arbiter-fleet-msg-v1","body":"...","task":null,"role":"...","from":"<role>"}
 * The outer author key is the kit's shared fleet identity, so the sender's
 * real name lives only in `from`. Without this the panel printed the raw JSON
 * and labelled every message with the fleet key (seen live 2026-09-28).
 */
export interface FleetEnvelope {
  body: string;
  from: string | null;
  /** The thread's name, carried inside the envelope since 2026-09-28. Older messages lack it. */
  thread: string | null;
}

export function parseFleetEnvelope(plaintext: string): FleetEnvelope | null {
  if (!plaintext.startsWith('{')) return null;
  try {
    const d = JSON.parse(plaintext) as Record<string, unknown>;
    if (d.v !== 'arbiter-fleet-msg-v1' || typeof d.body !== 'string') return null;
    return {
      body: d.body,
      from: typeof d.from === 'string' && d.from ? d.from : null,
      thread: typeof d.thread === 'string' && d.thread ? d.thread : null,
    };
  } catch {
    return null;
  }
}
