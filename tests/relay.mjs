// Check a running local server using an isolated test session.
import assert from 'node:assert/strict';
const base = process.env.EFIR_URL || 'http://localhost:8765';
const meta = await fetch(base + '/efir-local.json');
assert.equal((await meta.json()).local, true);
for (const [path, mime] of [['/', 'text/html'], ['/js/net.js', 'text/javascript'], ['/manifest.webmanifest', 'application/manifest+json'], ['/icon.svg', 'image/svg+xml']]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 200, path); assert.ok(r.headers.get('content-type').startsWith(mime), path);
}
assert.equal((await fetch(base + '/.netlify/state.json')).status, 404);
assert.equal((await fetch(base + '/css/%2e%2e/%2e%2e/Info.plist')).status, 404);
assert.equal(meta.headers.get('cache-control'), 'no-store');
const asset = await fetch(base + '/js/net.js');
const etag = asset.headers.get('etag');
assert.ok(etag, 'static resource has ETag');
assert.equal(asset.headers.get('cache-control'), 'no-cache');
const unchanged = await fetch(base + '/js/net.js', { headers: { 'If-None-Match': etag } });
assert.equal(unchanged.status, 304); assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
const head = await fetch(base + '/js/net.js', { method: 'HEAD' });
assert.equal(head.headers.get('etag'), etag);
assert.equal(head.headers.get('content-length'), asset.headers.get('content-length'));
const manifest = await (await fetch(base + '/vendor/SOURCES.json')).json();
const font = await fetch(base + '/vendor/' + manifest.find(item => item.file.endsWith('.woff2')).file);
assert.ok(font.headers.get('cache-control').includes('immutable'));
async function client(room) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws?room=' + room);
  const queue = [];
  ws.addEventListener('message', e => queue.push(e.data));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { ws, queue };
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('timeout');
}
const [a, b, other] = await Promise.all([client('TST42'), client('TST42'), client('TST43')]);
try {
  // Preserve whitespace and unknown fields; never echo to the sender.
  const packet = '{ "t":"script", "from":"test", "seq":1, "text":"Привет\\n世界", "extra":42 }';
  a.ws.send(packet);
  await until(() => b.queue.length === 1);
  assert.equal(b.queue.shift(), packet);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(a.queue.length, 0); assert.deepEqual(other.queue.splice(0), [packet]);
  a.ws.send(JSON.stringify({ t: '__efir_ping', ts: 12.5 }));
  await until(() => a.queue.length === 1);
  assert.deepEqual(JSON.parse(a.queue.shift()), { t: '__efir_pong', ts: 12.5 });
  assert.equal(b.queue.length, 0); assert.equal(other.queue.length, 0);
  // Large messages survive WebSocket frame fragmentation.
  const large = JSON.stringify({ t: 'scriptPart', from: 'test', seq: 2, chunk: 'текст '.repeat(12000) });
  b.ws.send(large);
  await until(() => a.queue.length === 1);
  assert.equal(a.queue.shift(), large);
} finally { for (const c of [a, b, other]) c.ws.close(); }
console.log('PASS HTTP/MIME/cache/HEAD, one shared local session, exact relay, no sender echo, ping/pong, fragmented UTF-8 message');
