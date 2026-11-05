// Browser-engine layout differences must not accumulate into a different passage.
import { chromium, webkit } from '../work/testing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = process.env.EFIR_URL || 'http://localhost:18765';
const chrome = await chromium.launch(), safari = await webkit.launch();
const errors = [];
const wait = async (fn, message, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 60)); }
  throw new Error(message);
};
const script = process.env.EFIR_SCRIPT ? await readFile(process.env.EFIR_SCRIPT, 'utf8')
  : Array.from({ length: 100 }, (_, i) => `Scene ${i + 1}. The camera follows the speaker across the room.\nThe operator checks the reading screen before starting the next take.\nA short pause gives everyone enough time to prepare.`).join('\n\n');
const geometry = page => page.locator('.stage').first().evaluate(stage => ({
  max: stage.querySelector('.text').offsetHeight - stage.offsetHeight,
  marker: parseFloat(stage.style.getPropertyValue('--my')),
  tops: [...stage.querySelectorAll('.w')].map(w => w.offsetTop + w.offsetHeight / 2),
}));
const wordY = (page, i, selector = '.stage') => page.locator(selector).first().evaluate((stage, i) => {
  const word = stage.querySelector(`.w[data-i="${i}"]`);
  const offset = new DOMMatrix(getComputedStyle(stage.querySelector('.scroller')).transform).m42;
  return word.offsetTop + word.offsetHeight / 2 + offset - parseFloat(stage.style.getPropertyValue('--my'));
}, i);
const pads = page => page.locator('.text').first().evaluate(el => {
  const style = getComputedStyle(el); return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
});
const hasPads = async (page, left, right) => { const values = await pads(page); return Math.abs(values[0] - left) < .02 && Math.abs(values[1] - right) < .02; };
// Compare the passage at the reading line without importing sync code.
const passage = page => page.locator('.stage').first().evaluate(stage => {
  const y = parseFloat(stage.style.getPropertyValue('--my')) - new DOMMatrix(getComputedStyle(stage.querySelector('.scroller')).transform).m42;
  const words = [...stage.querySelectorAll('.w')];
  const lines = words.filter((w, i) => !i || w.offsetTop !== words[i - 1].offsetTop);
  let k = lines.findIndex(w => w.offsetTop + w.offsetHeight / 2 > y);
  if (k < 0) k = lines.length - 1;
  const a = lines[Math.max(0, k - 1)], b = lines[k];
  const ay = a.offsetTop + a.offsetHeight / 2, by = b.offsetTop + b.offsetHeight / 2;
  return Number(a.dataset.i) + (by > ay ? (y - ay) / (by - ay) : 0) * (Number(b.dataset.i) - Number(a.dataset.i));
});
async function range(ctl, key, value) {
  const input = ctl.locator(`[data-k="${key}"] input`);
  await input.fill(String(value)); await input.dispatchEvent('input');
}
async function scrub(ctl, fraction) {
  const box = await ctl.locator('.scrub-track').boundingBox();
  await ctl.mouse.click(box.x + fraction * box.width, box.y + box.height / 2);
}
try {
  const ctl = await chrome.newPage({ locale: 'ru-RU', viewport: { width: 1500, height: 1000 } });
  let dropResyncReplies = false;
  await ctl.routeWebSocket('**/ws*', route => {
    const server = route.connectToServer();
    server.onMessage(message => {
      if (dropResyncReplies && JSON.parse(String(message)).t === 'resynced') return;
      route.send(message);
    });
  });
  await ctl.addInitScript(() => { window.efirNative = { version: 1, platform: 'mac', role: 'controller', capabilities: {}, postMessage() {} }; });
  const phone = await safari.newPage({ locale: 'ru-RU', viewport: { width: 844, height: 390 } });
  for (const p of [ctl, phone]) p.on('pageerror', e => errors.push(e.message));
  await ctl.goto(base + '/#/c/SYNC'); await phone.goto(base + '/?screen=phone#/p/SYNC');
  await ctl.locator('.ctl.has-prompter').waitFor();
  await ctl.locator('button[data-view="edit"]').first().click();
  await ctl.locator('.ed-text').fill(script);
  await ctl.locator('button[data-view="live"]').first().click();
  await range(ctl, 'fontSize', 64);
  await ctl.locator('[data-k="countdown"] [data-v="0"]').click();
  await wait(async () => (await phone.locator('.text').innerText()).includes(script.trim().split('\n').at(-1)), 'script reaches WebKit');
  await Promise.all([ctl.evaluate(() => document.fonts.ready), phone.evaluate(() => document.fonts.ready)]);
  // The generated fixture exercises accumulated metric drift deterministically.
  // A supplied script uses its natural Chromium/WebKit wrapping differences.
  if (!process.env.EFIR_SCRIPT) {
    await phone.addStyleTag({ content: '.text p { margin-bottom: calc(var(--paragraph-gap) + 1px); }' });
    await phone.setViewportSize({ width: 846, height: 390 });
    await phone.waitForFunction(() => document.querySelector('.stage').offsetWidth === 846);
    await phone.setViewportSize({ width: 844, height: 390 });
    await wait(async () => await ctl.locator('.stage').first().evaluate(el => el.offsetWidth) === 844, 'reader geometry returns to the same viewport');
  }
  const [c, p] = await Promise.all([geometry(ctl), geometry(phone)]);
  const common = c.tops.map((top, i) => i).filter(i => i > 0 && i < c.tops.length * .85 && i > c.tops.length * .3
    && c.tops[i] !== c.tops[i - 1] && p.tops[i] !== p.tops[i - 1]);
  const i = common.sort((a, b) => Math.abs(c.tops[b] - p.tops[b]) - Math.abs(c.tops[a] - p.tops[a]))[0];
  assert.ok(Math.abs(c.tops[i] - p.tops[i]) > 30, 'fixture has accumulated measured layout drift');
  await scrub(ctl, (c.tops[i] - c.marker) / c.max);
  await wait(async () => Math.abs(await wordY(phone, i)) < 2 && Math.abs(await wordY(ctl, i)) < 2,
    'a late-script seek must put the same word at both reading lines');

  // The operator can repair a stale preview without moving the reader.
  await ctl.addStyleTag({ content: '.preview-primary .text p { margin-bottom: calc(var(--paragraph-gap) + 2px); }' });
  const beforeSync = await wordY(phone, i);
  await ctl.getByRole('button', { name: 'Синхронизировать экраны', exact: true }).click();
  await wait(async () => (await ctl.locator('#toasts').textContent()).includes('Экраны синхронизированы'), 'manual sync acknowledged');
  assert.ok(Math.abs(await wordY(phone, i) - beforeSync) < 2, 'manual sync preserves the reader passage');
  assert.ok(Math.abs(await wordY(ctl, i) - beforeSync) < 2, 'manual sync repairs the preview immediately');

  const follower = await chrome.newPage({ locale: 'ru-RU', viewport: { width: 500, height: 900 } });
  follower.on('pageerror', e => errors.push(e.message));
  await follower.goto(base + '/?screen=follower#/p/SYNC');
  await follower.locator('.prompter.has-script.has-ctl').waitFor();
  await ctl.locator('.speed-range').fill('6'); await ctl.locator('.speed-range').dispatchEvent('input');
  await ctl.locator('[data-a="toggle"]').click();
  await phone.locator('.prompter.playing').waitFor();
  for (let sample = 0; sample < 5; sample++) {
    await new Promise(r => setTimeout(r, 1500));
    if (sample === 1) {
      await ctl.locator('[data-a="sync"]').click();
      await wait(async () => await ctl.locator('[data-a="sync"]').getAttribute('aria-busy') === 'false', 'all readers acknowledge sync during playback');
    }
    const positions = await Promise.all([passage(ctl), passage(phone), passage(follower)]);
    assert.ok(Math.max(...positions) - Math.min(...positions) < 10, 'playback keeps all browser engines at the same passage: ' + positions);
    assert.equal(await phone.locator('.prompter.playing').count(), 1, 'sync preserves playback');
  }
  await ctl.locator('[data-a="toggle"]').click();
  await follower.close();

  await ctl.locator('.settings-more').evaluate(el => el.open = true);
  await ctl.locator('[data-g="margins"]').evaluate(el => el.open = true);
  await range(ctl, 'leftPad', 3); await range(ctl, 'rightPad', 17);
  await wait(() => hasPads(phone, 25.32, 143.48), 'independent margins reach reader');
  await ctl.locator('[data-a="profile-save"]').click();
  await ctl.getByRole('textbox', { name: 'Название профиля' }).fill('Asymmetric');
  await ctl.locator('.profile-form button').click();
  await range(ctl, 'leftPad', 10); await range(ctl, 'rightPad', 10);
  const saved = await ctl.locator('.profile-select option').filter({ hasText: 'Asymmetric' }).getAttribute('value');
  await ctl.locator('.profile-select').selectOption(saved);
  await wait(() => hasPads(phone, 25.32, 143.48), 'profile restores independent margins');
  await ctl.reload(); await ctl.locator('.ctl.has-prompter').waitFor();
  assert.equal(await ctl.locator('[data-k="leftPad"] input').inputValue(), '3');
  assert.equal(await ctl.locator('[data-k="rightPad"] input').inputValue(), '17');
  const backup = await ctl.evaluate(async () => (await import('./js/store.js')).store.backup());
  await ctl.evaluate(async backup => { const { store } = await import('./js/store.js'); store.restoreBackup(backup); }, backup);
  await ctl.reload(); await ctl.locator('.ctl.has-prompter').waitFor();
  assert.equal(await ctl.locator('[data-k="rightPad"] input').inputValue(), '17', 'backup retains optional numeric margins');
  await ctl.locator('[data-k="leftPad"] output').dblclick();
  await range(ctl, 'sidePad', 12);
  await wait(() => hasPads(phone, 101.28, 143.48), 'reset side inherits symmetric margin while the other side stays independent');
  dropResyncReplies = true;
  await ctl.locator('[data-a="sync"]').click();
  await wait(async () => (await ctl.locator('#toasts').textContent()).includes('Не удалось синхронизировать экраны'), 'a lost reply reports a failed synchronization');
  dropResyncReplies = false;
  assert.equal(await ctl.locator('[data-a="sync"]').isEnabled(), true, 'synchronization can be retried after a timeout');
  await ctl.locator('[data-a="sync"]').click();
  await wait(async () => (await ctl.locator('#toasts').textContent()).includes('Экраны синхронизированы'), 'synchronization succeeds on retry');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', measuredDrift: c.tops[i] - p.tops[i], checked: ['Chromium/WebKit word alignment', 'late seek', 'manual sync', 'three-screen playback', 'sync during playback', 'independent margins', 'profile/reload/backup', 'symmetric inheritance', 'lost sync reply/timeout/retry'] }));
} finally { await chrome.close(); await safari.close(); }
