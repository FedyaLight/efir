// Observable input behavior through a real controller/reader session.
import { chromium } from '../work/testing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base = process.env.EFIR_URL || 'http://localhost:18765';
const browser = await chromium.launch({ headless: true });
const errors = [];
const wait = async (fn, message) => {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 60)); }
  throw new Error(message);
};
const bodyFocus = p => p.evaluate(() => document.activeElement?.blur());
const playing = p => p.locator('.prompter.playing').count();
const pos = p => p.locator('.scroller').evaluate(e => -new DOMMatrix(getComputedStyle(e).transform).m42);
try {
  const c = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1400, height: 900 } });
  const r = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 720 } });
  await c.addInitScript(() => { window.efirNative = { version: 1, platform: 'linux', role: 'controller', capabilities: {}, postMessage() {} }; });
  const ctl = await c.newPage(), reader = await r.newPage();
  for (const p of [ctl, reader]) p.on('pageerror', e => errors.push(e.message));
  await ctl.goto(base + '/#/c/REM42'); await reader.goto(base + '/#/p/REM42');
  await ctl.locator('.ctl.has-prompter').waitFor();
  await reader.locator('.prompter.has-script.has-ctl').waitFor();
  await ctl.bringToFront(); await bodyFocus(ctl);
  await ctl.keyboard.down('Space'); await wait(() => playing(reader), 'first press starts');
  await ctl.keyboard.down('Space'); await new Promise(r => setTimeout(r, 200));
  assert.equal(await playing(reader), 1, 'held toggle must fire once');
  await ctl.keyboard.up('Space'); await ctl.keyboard.press('Space');
  await wait(async () => !await playing(reader), 'release permits next toggle');
  await ctl.keyboard.press('Control+b'); await new Promise(r => setTimeout(r, 150));
  assert.equal(await playing(reader), 0, 'modified shortcuts do not control playback');
  await ctl.locator('[data-a="keys"]').click();
  await ctl.locator('[data-learn="toggle"]').click(); await ctl.keyboard.press('q');
  assert.ok(await ctl.locator('.remote-bindings').allTextContents().then(v => v.join('').includes('Q')));
  await ctl.locator('.modal-x').click(); await ctl.locator('.modal-wrap').waitFor({ state: 'detached' }); await bodyFocus(ctl); await ctl.keyboard.press('q');
  await wait(() => playing(reader), 'learned key works');
  await ctl.keyboard.press('q'); await wait(async () => !await playing(reader), 'learned key pauses');
  await ctl.reload(); await ctl.locator('.ctl.has-prompter').waitFor(); await bodyFocus(ctl);
  await ctl.keyboard.press('q'); await wait(() => playing(reader), 'mapping survives reload');
  await ctl.keyboard.press('q'); await wait(async () => !await playing(reader), 'pause after reload');
  await ctl.locator('button[data-view="edit"]').first().click(); await ctl.locator('.ed-title').fill('');
  await ctl.keyboard.type('qb'); assert.equal(await playing(reader), 0, 'typing does not drive the reader');
  await ctl.locator('button[data-view="live"]').first().click();
  await ctl.locator('[data-a="keys"]').click(); await ctl.keyboard.press('Space');
  assert.equal(await playing(reader), 0, 'settings dialog blocks playback');
  await ctl.locator('[data-learn="forward"]').click(); await ctl.keyboard.press('n');
  await ctl.locator('.modal-x').click(); await ctl.locator('.modal-wrap').waitFor({ state: 'detached' }); await bodyFocus(ctl);
  const before = await pos(reader); await ctl.keyboard.down('n');
  await wait(async () => await pos(reader) > before + 50, 'held nudge scrolls');
  await ctl.evaluate(() => window.dispatchEvent(new Event('blur'))); await ctl.keyboard.up('n');
  await new Promise(r => setTimeout(r, 150)); const stopped = await pos(reader);
  await new Promise(r => setTimeout(r, 250)); assert.ok(Math.abs(await pos(reader) - stopped) < 3, 'blur stops held nudge');
  await reader.bringToFront(); await bodyFocus(reader);
  await reader.keyboard.down('Enter'); await wait(() => playing(reader), 'reader Enter starts');
  await reader.keyboard.down('Enter'); assert.equal(await playing(reader), 1, 'reader repeat does not toggle');
  await reader.keyboard.up('Enter'); await reader.keyboard.press('Enter'); await wait(async () => !await playing(reader), 'reader Enter pauses');
  // Feed browser Gamepad signals at its public API boundary; no hardware claim.
  await reader.bringToFront(); await reader.locator('[data-a="keys"]').click();
  await reader.evaluate(() => {
    window.testPad = { connected: true, buttons: [{ pressed: false, value: 0 }], axes: [0] };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
  });
  await reader.locator('.remote-gamepad').check();
  await reader.locator('[data-learn="toggle"]').click();
  await new Promise(r => setTimeout(r, 100));
  await reader.evaluate(() => window.testPad.buttons[0].pressed = true);
  await wait(async () => (await reader.locator('.remote-bindings').allTextContents()).join('').includes('Gamepad #0'), 'gamepad button learned');
  await reader.evaluate(() => window.testPad.buttons[0].pressed = false);
  await reader.locator('.modal-x').click(); await reader.locator('.modal-wrap').waitFor({ state: 'detached' });
  await bodyFocus(reader); await new Promise(r => setTimeout(r, 100));
  await reader.evaluate(() => window.testPad.buttons[0].pressed = true); await wait(() => playing(reader), 'gamepad starts');
  await new Promise(r => setTimeout(r, 200)); assert.equal(await playing(reader), 1, 'gamepad hold fires once');
  await reader.evaluate(() => window.testPad.buttons[0].pressed = false); await new Promise(r => setTimeout(r, 100));
  await reader.evaluate(() => window.testPad.buttons[0].pressed = true); await wait(async () => !await playing(reader), 'gamepad release rearms toggle');
  await reader.evaluate(() => window.testPad.connected = false);
  assert.deepEqual(errors, []);
  console.log('PASS: repeat, modifiers, learning, reload, editing, dialogs, nudge release, reader input, Gamepad learning and edges');
} finally { await browser.close(); }
