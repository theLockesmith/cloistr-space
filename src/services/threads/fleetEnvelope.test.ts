import { describe, it, expect } from 'vitest';
import { parseFleetEnvelope } from './fleetEnvelope';

describe('parseFleetEnvelope', () => {
  it('extracts body and sender from the kit envelope (as delivered live 2026-09-28)', () => {
    const raw = '{"v":"arbiter-fleet-msg-v1","body":"Fresh test from cloistr-orchestrator.","task":null,"role":"operator","from":"cloistr-orchestrator"}';
    expect(parseFleetEnvelope(raw)).toEqual({ body: 'Fresh test from cloistr-orchestrator.', from: 'cloistr-orchestrator' });
  });
  it('leaves plain text alone', () => {
    expect(parseFleetEnvelope('just a message')).toBeNull();
  });
  it('leaves other JSON alone', () => {
    expect(parseFleetEnvelope('{"hello":"world"}')).toBeNull();
    expect(parseFleetEnvelope('{"v":"something-else","body":"x"}')).toBeNull();
  });
  it('tolerates a missing sender', () => {
    expect(parseFleetEnvelope('{"v":"arbiter-fleet-msg-v1","body":"x"}')).toEqual({ body: 'x', from: null });
  });
  it('does not throw on malformed JSON', () => {
    expect(parseFleetEnvelope('{not json')).toBeNull();
  });
});
