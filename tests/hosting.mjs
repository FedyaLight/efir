// Static hosting without the local marker must retain WebRTC.
import { chromium } from '../work/testing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
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
let broker;
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
  let brokerBlocked = false, firstDialFailed = false, recoveryOfferSent = false;
  for (const ctx of [a, b]) await ctx.routeWebSocket(/0\.peerjs\.com/, socket => {
    if (ctx === a && !firstDialFailed) { firstDialFailed = true; socket.close(); return; }
    // Once recovered negotiation begins, only the existing socket is available.
    if (ctx === a && recoveryOfferSent) { socket.close(); return; }
    if (brokerBlocked) { socket.close(); return; }
    brokerSockets.push(socket);
    const upstream = socket.connectToServer();
    socket.onMessage(message => {
      if (ctx === a && JSON.parse(String(message)).type === 'OFFER') recoveryOfferSent = true;
      upstream.send(message);
    });
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
  await bp.evaluate(async code => {
    const { Room } = await import('./js/net.js');
    window.testRoom = new Room(code, 'prompter', () => ({}));
    window.received = [];
    window.testRoom.addEventListener('message', e => window.received.push(e.detail));
  }, code);
  await bp.waitForFunction(() => window.testRoom.brokerOk && window.testRoom.isHost);
  await ac.evaluate(async code => {
    const { Room } = await import('./js/net.js');
    window.testRoom = new Room(code, 'controller', () => ({}));
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
  // Deny the real WebSocket boundary: STUN success cannot imply broker access,
  // and TURN must not be suggested before signaling is available.
  const blocked = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await blocked.routeWebSocket(/.*/, socket => socket.close());
  const failed = await blocked.newPage();
  await failed.goto('http://127.0.0.1:18766/#/c/BROKER');
  await failed.locator('[data-a="connect"]').first().click();
  await failed.locator('.modal-lan [data-lan="diag"]').click();
  assert.equal(await failed.locator('.modal-lan .lan-diag').filter({ hasText: 'No TURN fallback' }).count(), 0);
  await failed.locator('.modal-lan .lan-diag').filter({ hasText: 'WebSocket check: no signaling server response' }).waitFor();
  await failed.locator('.modal-lan [data-lan="copy"]').click();
  const report = JSON.parse(await failed.evaluate(() => navigator.clipboard.readText()));
  assert.equal(report.room.signaling, false);
  assert.equal(report.probe.signaling.state, 'failed');
  for (const language of ['ru', 'en', 'es', 'zh', 'hi', 'ar']) {
    await failed.evaluate(async language => (await import('./js/i18n.js')).setLanguage(language), language);
    const text = await failed.locator('.modal-lan .lan-diag').textContent();
    assert.ok(text.includes('WebSocket'));
    if (language !== 'ru') assert.equal(/[А-Яа-яЁё]/.test(text), false, language);
    assert.equal(await failed.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, language);
  }
  await blocked.close();

  // Exercise the configured host, port, path and key against official PeerServer.
  broker = spawn(process.execPath, [resolve('work/testing/node_modules/peer/dist/bin/peerjs.js'),
    '--host', '127.0.0.1', '--port', '18768', '--path', '/efir', '--key', 'efir-test'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PeerServer startup timed out')), 10000);
    broker.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    broker.once('error', error => { clearTimeout(timer); reject(error); });
    broker.once('exit', () => { clearTimeout(timer); reject(new Error('PeerServer stopped')); });
  });
  const customController = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }), customReader = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const configureBroker = async (custom, key = 'efir-test') => {
    await custom.route('**/rtc-config.json', async route => {
      const config = JSON.parse(await readFile(resolve(root, 'rtc-config.json'), 'utf8'));
      config.peerServer = { host: '127.0.0.1', port: 18768, path: '/efir', key, secure: false };
      await route.fulfill({ json: config });
    });
    await custom.routeWebSocket(/0\.peerjs\.com/, socket => socket.close());
  };
  for (const custom of [customController, customReader]) { await configureBroker(custom); await custom.grantPermissions(['microphone']); }
  const cc = await customController.newPage(), cp = await customReader.newPage();
  for (const page of [cc, cp]) {
    await page.goto('http://127.0.0.1:18766/');
    await page.evaluate(async () => { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop()); });
  }
  const customCode = 'S' + Math.random().toString(36).slice(2, 6).toUpperCase();
  await cc.goto(`http://127.0.0.1:18766/#/c/${customCode}`);
  await cp.goto(`http://127.0.0.1:18766/#/p/${customCode}`);
  await cc.locator('.ctl.has-prompter').waitFor();
  await cp.locator('.prompter.has-script.has-ctl').waitFor();
  await cc.locator('button[data-view="edit"]').first().click();
  await cc.locator('.ed-text').fill('# Custom signaling\nScript through a self-hosted broker.');
  await cp.locator('.text').filter({ hasText: 'Script through a self-hosted broker.' }).waitFor();
  await cc.locator('[data-a="connect"]').first().click();
  await cc.locator('.modal-lan [data-lan="diag"]').click();
  await cc.locator('.modal-lan .lan-diag').filter({ hasText: 'WebSocket check: signaling server responds' }).waitFor();
  await customController.close(); await customReader.close();
  // A responding broker rejecting a key is not a network outage.
  const wrongKey = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await configureBroker(wrongKey, 'invalid-key');
  const rejected = await wrongKey.newPage();
  await rejected.goto('http://127.0.0.1:18766/#/c/BADKEY');
  await rejected.locator('[data-a="connect"]').first().click();
  await rejected.locator('.modal-lan [data-lan="diag"]').click();
  await rejected.locator('.modal-lan .lan-diag').filter({ hasText: 'server did not accept the connection' }).waitFor();
  await rejected.locator('.modal-lan [data-lan="copy"]').click();
  const rejection = JSON.parse(await rejected.evaluate(() => navigator.clipboard.readText()));
  assert.equal(rejection.probe.signaling.state, 'rejected');
  await wrongKey.close();
  assert.deepEqual(errors, []);
  console.log('PASS static hosting: no local marker, role choices, six home languages, BroadcastChannel, PeerJS loaded, first failed broker dial recovers into delayed real WebRTC, live channel survives broker outage, blocked broker diagnosis, configurable PeerServer');
} finally {
  await browser.close(); await new Promise(r => server.close(r));
  if (broker && broker.exitCode == null) { broker.kill(); await new Promise(r => broker.once('exit', r)); }
}
