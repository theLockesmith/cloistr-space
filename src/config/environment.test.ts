/**
 * Space's service addresses come from runtime configuration (the image's
 * /config.js) first, so one image serves production and staging.
 *
 * The test that protects the live service is the first one: with no runtime
 * configuration, every address is production.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadWith(runtime: Record<string, unknown> | undefined) {
  vi.resetModules();
  if (runtime) window.__CLOISTR_CONFIG__ = runtime;
  else delete window.__CLOISTR_CONFIG__;
  return (await import('./environment')).config;
}

afterEach(() => {
  delete window.__CLOISTR_CONFIG__;
});

describe('config with no runtime configuration', () => {
  it('is production, everywhere', async () => {
    const config = await loadWith(undefined);
    expect(config.environment).toBe('production');
    expect(config.relayUrl).toBe('wss://relay.cloistr.xyz');
    expect(config.signerUrl).toBe('https://signer.cloistr.xyz');
    expect(config.blossomApiUrl).toBe('https://files.cloistr.xyz');
    expect(config.discoveryApiUrl).toBe('https://discover.cloistr.xyz/api');
    expect(config.driveApiUrl).toBe('https://stash.cloistr.xyz');
    expect(config.docsApiUrl).toBe('https://docs-api.cloistr.xyz');
    expect(config.tasksUrl).toBe('https://tasks.cloistr.xyz');
  });
});

describe('config with staging runtime configuration', () => {
  const staging = {
    environment: 'staging',
    relayUrl: 'wss://relay.staging.cloistr.xyz',
    signerUrl: 'https://signer.staging.cloistr.xyz',
    blossomUrl: 'https://files.staging.cloistr.xyz',
    discoveryUrl: 'https://discover.staging.cloistr.xyz',
    appUrl: 'https://space.staging.cloistr.xyz',
    services: {
      files: 'https://stash.staging.cloistr.xyz',
      tasks: 'https://tasks.staging.cloistr.xyz',
      docs: 'https://docs.staging.cloistr.xyz',
      'docs-api': 'https://docs-api.staging.cloistr.xyz',
    },
  };

  it('takes every address from the runtime configuration', async () => {
    const config = await loadWith(staging);
    expect(config.environment).toBe('staging');
    expect(config.relayUrl).toBe(staging.relayUrl);
    expect(config.signerUrl).toBe(staging.signerUrl);
    expect(config.blossomApiUrl).toBe(staging.blossomUrl);
    expect(config.discoveryApiUrl).toBe('https://discover.staging.cloistr.xyz/api');
    expect(config.appUrl).toBe(staging.appUrl);
    expect(config.driveApiUrl).toBe(staging.services.files);
    expect(config.tasksUrl).toBe(staging.services.tasks);
    expect(config.docsApiUrl).toBe(staging.services['docs-api']);
  });

  it('leaves no production host anywhere in the resolved config', async () => {
    const config = await loadWith(staging);
    const all = JSON.stringify({ ...config, defaultRelays: (await import('./environment')).defaultRelays });
    const prodHosts = all.match(/[a-z0-9-]+\.cloistr\.xyz/g)!.filter((h) => !h.endsWith('.staging.cloistr.xyz') && h !== 'staging.cloistr.xyz');
    expect(prodHosts).toEqual([]);
  });

  it('treats an empty runtime value as unset, so blank env vars fall back to production', async () => {
    const config = await loadWith({ relayUrl: '', services: { files: '' } });
    expect(config.relayUrl).toBe('wss://relay.cloistr.xyz');
    expect(config.driveApiUrl).toBe('https://stash.cloistr.xyz');
  });
});
