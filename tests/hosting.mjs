// Static hosting without the local marker must retain WebRTC.
import { chromium } from '../work/testing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('web');
const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/efir-local.json') { res.writeHead(404); res.end(); return; }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error();
    const data = await readFile(file);
    const mime = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html';
    res.writeHead(200, { 'Content-Type': mime }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(18766, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const context = await browser.newContext({ viewport: { width: 1320, height: 820 } });
  const errors = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  // Use the real signaling broker; same-profile tabs also have BroadcastChannel.
  const c = await context.newPage(), p = await context.newPage();
  await c.goto('http://127.0.0.1:18766/#/c/NET42');
  await p.goto('http://127.0.0.1:18766/#/p/NET42');
  await c.locator('.ctl.has-prompter').waitFor();
  await p.locator('.prompter.has-script.has-ctl').waitFor();
  assert.equal(await c.evaluate(async () => (await import('./js/environment.js')).localMode), false);
  assert.equal(await c.evaluate(() => typeof window.Peer), 'function');
  assert.ok(await c.locator('[data-a="window"]').count());
  assert.ok(await c.locator('[data-k="voiceDevice"] [data-v="prompter"]').count());
  await c.locator('button[data-view="edit"]').first().click();
  await c.locator('.ed-text').fill('# Проверка\nПрежняя версия на обычном хостинге.');
  await p.locator('.text').filter({ hasText: 'Прежняя версия' }).waitFor();
  // Separate profiles require WebRTC rather than BroadcastChannel.
  const a = await browser.newContext(), b = await browser.newContext();
  // Delay real broker negotiation past the former eight-second deadline.
  // The broker and RTCPeerConnection remain real; only delivery is delayed.
  const brokerSockets = [];
  let brokerBlocked = false;
  for (const ctx of [a, b]) await ctx.routeWebSocket(/0\.peerjs\.com/, socket => {
    if (brokerBlocked) { socket.close(); return; }
    brokerSockets.push(socket);
    const upstream = socket.connectToServer();
    upstream.onMessage(message => {
      const type = JSON.parse(String(message)).type;
      if (['OFFER', 'ANSWER', 'CANDIDATE'].includes(type)) setTimeout(() => { if (!brokerBlocked) socket.send(message); }, 12000);
      else socket.send(message);
    });
  });
  await a.grantPermissions(['microphone']); await b.grantPermissions(['microphone']);
  const ac = await a.newPage(), bp = await b.newPage();
  await ac.goto('http://127.0.0.1:18766/');
  await bp.goto('http://127.0.0.1:18766/');
  // Translations load before selecting a role or room on static hosting.
  for (const [language, labels] of [
    ['en', ['Controller', 'Teleprompter']], ['es', ['Control', 'Teleprónter']],
    ['zh', ['控制台', '提词器']], ['hi', ['नियंत्रक', 'टेलीप्रॉम्प्टर']],
    ['ar', ['لوحة التحكم', 'الملقّن']], ['ru', ['Пульт', 'Суфлёр']],
  ]) {
    await ac.locator('.ui-language').selectOption(language);
    assert.deepEqual(await ac.locator('.role-t b').allTextContents(), labels);
  }
  for (const page of [ac, bp]) await page.evaluate(async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop()); } catch {} });
  const code = 'N' + Math.random().toString(36).slice(2, 6).toUpperCase();
  await ac.evaluate(async code => {
    const { Room } = await import('./js/net.js');
    window.testRoom = new Room(code, 'controller', () => ({}));
    window.received = [];
    window.testRoom.addEventListener('message', e => window.received.push(e.detail));
  }, code);
  await bp.evaluate(async code => {
    const { Room } = await import('./js/net.js');
    window.testRoom = new Room(code, 'prompter', () => ({}));
    window.received = [];
    window.testRoom.addEventListener('message', e => window.received.push(e.detail));
  }, code);
  try { await ac.waitForFunction(() => window.testRoom.peersOf('prompter').length > 0, null, { timeout: 45000 }); } catch (error) { console.log('WebRTC state', await ac.evaluate(() => ({ status: window.testRoom.status, broker: window.testRoom.brokerOk, peer: window.testRoom.peer?.id, disconnected: window.testRoom.peer?.disconnected })), await bp.evaluate(() => ({ status: window.testRoom.status, broker: window.testRoom.brokerOk, peer: window.testRoom.peer?.id }))); throw error; }
  await bp.waitForFunction(() => window.testRoom.peersOf('controller').length > 0, { timeout: 30000 });
  await ac.evaluate(() => window.testRoom.send('script', { text: 'WebRTC проверен' }));
  await bp.waitForFunction(() => window.received.some(m => m.text === 'WebRTC проверен'));
  assert.ok(await ac.evaluate(() => !!window.testRoom.linkInfo()));
  // Losing the broker must not tear down the established device link.
  brokerBlocked = true;
  for (const socket of brokerSockets) socket.close();
  await new Promise(resolve => setTimeout(resolve, 5000));
  await ac.evaluate(() => window.testRoom.send('script', { text: 'Still connected without signaling' }));
  await bp.waitForFunction(() => window.received.some(m => m.text === 'Still connected without signaling'));
  assert.equal(await ac.evaluate(() => window.testRoom.peersOf('prompter').length), 1);
  await ac.evaluate(() => window.testRoom.destroy());
  await bp.evaluate(() => window.testRoom.destroy());
  assert.deepEqual(errors, []);
  console.log('PASS static hosting: no local marker, role choices, six home languages, BroadcastChannel, PeerJS loaded, delayed real WebRTC between separate profiles, live channel survives broker outage');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
