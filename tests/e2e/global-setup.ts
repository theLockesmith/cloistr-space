/**
 * global-setup.ts — Playwright global setup for authenticated-production tests.
 *
 * Runs once before all test projects. When the credential file is absent or
 * the signer API is unreachable, exits cleanly — unauthenticated tests don't
 * read the fixture so they are unaffected.
 *
 * Steps (when credentials are present):
 *   1. Reads ~/.credentials/cliostr-test-account (username line 1, password line 2).
 *      Values are NEVER printed, logged, or stored in committed artifacts —
 *      they go directly into the fetch() body and are zeroed afterward.
 *   2. POST /api/v1/users/login → JWT.
 *   3. GET  /api/v1/keys        → test-account primary key (pubkey + id).
 *   4. Generates ephemeral secp256k1 client keypair via nostr-tools.
 *   5. POST /api/v1/nostrconnect/session, consent=true → signer approves
 *      the ephemeral client pubkey (silent re-auth on subsequent reconnects).
 *   6. Writes tests/e2e/.auth/session.json (gitignored):
 *        { bunkerUrl, clientSecretKey, pubkey }
 *      clientSecretKey is the ephemeral private key hex — NOT the user's nsec.
 *
 * Authentication strategy: SEEDED STATE (not browser-driven login).
 * Each test calls seedAuthState() to inject this fixture into localStorage
 * before navigation. The browser login path itself is exercised by the
 * dedicated "login" test in authenticated.spec.ts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const _require   = createRequire(import.meta.url);
const SIGNER_BASE  = 'https://signer.cloistr.xyz';
const RELAY_URL    = 'wss://relay.cloistr.xyz';
const CRED_PATH    = `${process.env.HOME}/.credentials/cliostr-test-account`;
const AUTH_DIR     = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'session.json');

function generateClientKeypair(): { secretKey: string; pubkey: string } {
  // nostr-tools is a declared project dependency; use CJS bundle via createRequire
  // so this module can be loaded as ESM without bundling.
  const nt = _require('nostr-tools/pure') as {
    generateSecretKey: () => Uint8Array;
    getPublicKey: (sk: Uint8Array) => string;
  };
  const skBytes   = nt.generateSecretKey();
  const secretKey = Buffer.from(skBytes).toString('hex');
  const pubkey    = nt.getPublicKey(skBytes);
  return { secretKey, pubkey };
}

export default async function globalSetup(): Promise<void> {
  if (!existsSync(CRED_PATH)) {
    console.log('[global-setup] Credential file not found — skipping auth fixture');
    return;
  }

  let username: string;
  let password: string;
  try {
    const lines = readFileSync(CRED_PATH, 'utf8').trim().split('\n');
    username = lines[0]!.trim();
    password = lines[1]!.trim();
    if (!username || !password) throw new Error('empty lines');
  } catch (err) {
    console.warn(`[global-setup] Cannot parse credentials: ${err} — skipping`);
    return;
  }

  try {
    // 2. Login → JWT
    const loginRes = await fetch(`${SIGNER_BASE}/api/v1/users/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    // Zero local vars after use so they cannot be read from heap snapshots
    username = '';
    password = '';

    if (!loginRes.ok) {
      throw new Error(`Login ${loginRes.status}: ${await loginRes.text()}`);
    }
    const loginBody = await loginRes.json() as { token: string };
    const jwt = loginBody.token;
    if (!jwt) throw new Error('login response missing token');

    // 3. List keys → primary pubkey + id
    const keysRes = await fetch(`${SIGNER_BASE}/api/v1/keys`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!keysRes.ok) throw new Error(`GET /api/v1/keys: ${keysRes.status}`);
    const keys = await keysRes.json() as Array<{ id: string; pubkey: string; primary?: boolean }>;
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('test account has no keys');
    const primaryKey   = keys.find(k => k.primary) ?? keys[0]!;
    const signerPubkey = primaryKey.pubkey;
    const keyId        = primaryKey.id;

    // 4. Generate ephemeral client keypair
    const { secretKey: clientSecretKey, pubkey: clientPubkey } = generateClientKeypair();

    // Allow the async Vault key-load goroutine launched at login time to settle
    await new Promise(r => setTimeout(r, 3000));

    // 5. Approve the ephemeral client key at the signer
    const connectURI = `nostrconnect://${clientPubkey}?relay=${encodeURIComponent(RELAY_URL)}&secret=e2etest&name=space-e2e-playwright`;
    const sessionRes = await fetch(`${SIGNER_BASE}/api/v1/nostrconnect/session`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body:    JSON.stringify({ uri: connectURI, key_id: keyId, consent: true }),
    });
    if (!sessionRes.ok) {
      throw new Error(`POST /nostrconnect/session: ${sessionRes.status} ${await sessionRes.text()}`);
    }
    const sessionBody = await sessionRes.json() as { success?: boolean };
    if (!sessionBody.success) {
      throw new Error(`Signer did not approve session: ${JSON.stringify(sessionBody)}`);
    }

    // 6. Write fixture — clientSecretKey goes to a gitignored file, never to stdout
    const bunkerUrl = `bunker://${signerPubkey}?relay=${RELAY_URL}`;
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify({ bunkerUrl, clientSecretKey, pubkey: signerPubkey }));
    console.log(`[global-setup] Session fixture written. Signer prefix: ${signerPubkey.slice(0, 16)}…`);

  } catch (err) {
    console.error(`[global-setup] Auth fixture creation failed: ${err}`);
    // Non-fatal: unauthenticated tests continue; authenticated ones fail individually.
  }
}
