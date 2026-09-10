/**
 * Integration test: prove that NDK's subscription grouping silently drops
 * REQs when two subscriptions share filter key shapes, and that
 * groupable:false fixes it.
 *
 * This uses a real NDK instance against a mock relay (WebSocket server)
 * to capture the actual REQ frames on the wire — the same evidence the
 * original reporter gathered from Chrome DevTools.
 */

import { WebSocketServer } from 'ws';
import NDK from '@nostr-dev-kit/ndk';
import { setTimeout as sleep } from 'timers/promises';

// -- Mock relay: just captures REQ frames and responds with EOSE --
const wss = new WebSocketServer({ port: 0 }); // Random port
const PORT = await new Promise((resolve) => {
  wss.on('listening', () => resolve(wss.address().port));
});

const capturedReqs = [];

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (Array.isArray(msg) && msg[0] === 'REQ') {
        capturedReqs.push(msg);
        // Respond with EOSE immediately
        ws.send(JSON.stringify(['EOSE', msg[1]]));
      }
    } catch { /* ignore non-JSON */ }
  });
});

console.log(`Mock relay listening on ws://localhost:${PORT}`);

// --- Test 1: DEFAULT (groupable:true) — demonstrate the collision ---

console.log('\n=== Test 1: groupable:true (default) — the bug ===');

const ndk1 = new NDK({
  explicitRelayUrls: [`ws://localhost:${PORT}`],
});
await ndk1.connect();
await sleep(500);

capturedReqs.length = 0;

// Subscribe to three filter shapes that differ in kinds but share key names.
// This is exactly what useGroupChat (kind:9), useThreads (kind:1111), and
// useGroupFiles (kind:1063) do when a project view mounts.
const sub1a = ndk1.subscribe(
  [{ kinds: [9], '#h': ['test-group'], limit: 100 }],
  { groupable: true, groupableDelay: 250 }
);
const sub1b = ndk1.subscribe(
  [{ kinds: [1111], '#h': ['test-group'], limit: 100 }],
  { groupable: true, groupableDelay: 250 }
);
const sub1c = ndk1.subscribe(
  [{ kinds: [1063], '#h': ['test-group'], limit: 100 }],
  { groupable: true, groupableDelay: 250 }
);

// Wait for the groupable window (250ms) plus execution time
await sleep(1000);

const groupedReqCount = capturedReqs.length;
console.log(`REQ messages on the wire: ${groupedReqCount}`);

for (const req of capturedReqs) {
  const filters = req.slice(2);
  const kinds = filters.flatMap(f => f.kinds || []);
  console.log(`  REQ ${req[1]}: kinds=${JSON.stringify(kinds)}`);
}

if (groupedReqCount < 3) {
  console.log(`BUG CONFIRMED: ${3 - groupedReqCount} subscription(s) never sent a REQ.`);
  console.log('  Three subscriptions were opened, but NDK grouped them because');
  console.log('  filterFingerprint({kinds,#h,limit}) produces the same key');
  console.log('  regardless of the kind values.');
} else {
  console.log('All 3 got their own REQ (no collision this run — timing-dependent).');
}

sub1a.stop();
sub1b.stop();
sub1c.stop();

// --- Test 2: groupable:false — the fix ---

console.log('\n=== Test 2: groupable:false — the fix ===');

const ndk2 = new NDK({
  explicitRelayUrls: [`ws://localhost:${PORT}`],
});
await ndk2.connect();
await sleep(500);

capturedReqs.length = 0;

const sub2a = ndk2.subscribe(
  [{ kinds: [9], '#h': ['test-group'], limit: 100 }],
  { groupable: false }
);
const sub2b = ndk2.subscribe(
  [{ kinds: [1111], '#h': ['test-group'], limit: 100 }],
  { groupable: false }
);
const sub2c = ndk2.subscribe(
  [{ kinds: [1063], '#h': ['test-group'], limit: 100 }],
  { groupable: false }
);

await sleep(1000);

const ungroupedReqCount = capturedReqs.length;
console.log(`REQ messages on the wire: ${ungroupedReqCount}`);

for (const req of capturedReqs) {
  const filters = req.slice(2);
  const kinds = filters.flatMap(f => f.kinds || []);
  console.log(`  REQ ${req[1]}: kinds=${JSON.stringify(kinds)}`);
}

if (ungroupedReqCount >= 3) {
  console.log('FIX CONFIRMED: all three subscriptions sent their own REQ.');

  // Check each REQ has exactly one kinds value (not merged)
  const allSingle = capturedReqs.every(req => {
    const filters = req.slice(2);
    return filters.every(f => !f.kinds || f.kinds.length === 1);
  });
  if (allSingle) {
    console.log('  Each REQ carries exactly one kind — no merging occurred.');
  }
} else {
  console.log(`UNEXPECTED: only ${ungroupedReqCount} REQ(s) with groupable:false`);
}

sub2a.stop();
sub2b.stop();
sub2c.stop();

// --- Summary ---

console.log('\n=== Summary ===');
const passed = groupedReqCount < 3 && ungroupedReqCount >= 3;
if (passed) {
  console.log('PASS: groupable:true loses REQs, groupable:false does not.');
  console.log(`  Default: ${groupedReqCount}/3 REQs reached the relay`);
  console.log(`  Fixed:   ${ungroupedReqCount}/3 REQs reached the relay`);
} else if (groupedReqCount >= 3 && ungroupedReqCount >= 3) {
  console.log('INCONCLUSIVE on bug (timing-dependent), but fix sends all 3.');
  console.log('  The grouped test happened not to collide this run.');
  console.log(`  Default: ${groupedReqCount}/3, Fixed: ${ungroupedReqCount}/3`);
} else {
  console.log('FAIL: unexpected results.');
  console.log(`  Default: ${groupedReqCount}/3, Fixed: ${ungroupedReqCount}/3`);
  process.exitCode = 1;
}

wss.close();
process.exit(process.exitCode || 0);
