// Multiple real readers: geometry, semantic sync, profiles and lifecycle.
import { chromium } from '../work/testing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base = process.env.EFIR_URL || 'http://localhost:18768';
const browser = await chromium.launch({ headless: true });
const errors = [];
const wait = async (fn, message, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 60)); }
  throw new Error(message);
};
const offset = (page, selector = '.p-stage .scroller') => page.locator(selector).evaluate(el => -new DOMMatrix(getComputedStyle(el).transform).m42);
// Reading progress measured from displayed words, without importing session logic.
const progress = page => page.locator('.p-stage .stage').evaluate(stage => {
  const pos = -new DOMMatrix(getComputedStyle(stage.querySelector('.scroller')).transform).m42;
  const marker = parseFloat(stage.style.getPropertyValue('--my'));
  const words = [...stage.querySelectorAll('.w')];
  const lines = words.filter((w, i) => !i || w.offsetTop !== words[i - 1].offsetTop);
  const after = lines.findIndex(w => w.offsetTop + w.offsetHeight / 2 > pos + marker);
  const b = lines[after < 0 ? lines.length - 1 : after], a = lines[Math.max(0, (after < 0 ? lines.length - 1 : after) - 1)];
  const ay = a.offsetTop + a.offsetHeight / 2, by = b.offsetTop + b.offsetHeight / 2;
  const f = by === ay ? 0 : (pos + marker - ay) / (by - ay);
  return Number(a.dataset.i) + f * (Number(b.dataset.i) - Number(a.dataset.i));
});
async function profile(page, button, changes) {
  await button.click();
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'name') { await page.locator('.display-name').fill(value); continue; }
    const row = page.locator(`[data-display-field="${key}"]`);
    await row.locator('.display-own').check();
    if (typeof value === 'boolean') await row.locator('.display-value').setChecked(value);
    else { await row.locator('.display-value').fill(String(value)); await row.locator('.display-value').dispatchEvent('change'); }
  }
  await page.locator('.modal-x').click(); await page.locator('.modal-wrap').waitFor({ state: 'detached' });
}
try {
  const context = async (width, height, controller = false) => {
    const c = await browser.newContext({ locale: 'ru-RU', viewport: { width, height } });
    if (controller) await c.addInitScript(() => { window.efirNative = { version: 1, platform: 'linux', role: 'controller', capabilities: {}, postMessage() {} }; });
    const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); return p;
  };
  const ctl = await context(1500, 1000, true), a = await context(1600, 1000), b = await context(1600, 900);
  await ctl.goto(base + '/#/c/MULTI'); await a.goto(base + '/?screen=wideA#/p/MULTI');
  await a.locator('.prompter.has-script.has-ctl').waitFor();
  await b.goto(base + '/?screen=wideB#/p/MULTI'); await b.locator('.prompter.has-script.has-ctl').waitFor();
  await wait(async () => await ctl.locator('.pm-screen option').count() === 2, 'two selectable screens');
  const mask = await ctl.locator('.preview-primary .format-region').evaluate(el => {
    const scale = new DOMMatrix(getComputedStyle(el.parentElement.querySelector('.preview-scale')).transform).a;
    return { hidden: el.hidden, top: parseFloat(el.style.top) / scale, height: parseFloat(el.style.height) / scale };
  });
  assert.equal(mask.hidden, false); assert.ok(Math.abs(mask.top - 40) < .1, '16:10 excess begins 40px above reading-aligned 16:9');
  assert.ok(Math.abs(mask.height - 900) < .1, '16:9 comparison height is 900px');
  const duplicate = await context(1200, 800); await duplicate.goto(b.url());
  await duplicate.locator('.prompter.has-script.has-ctl').waitFor();
  await wait(async () => duplicate.url() !== b.url(), 'duplicate display link receives a distinct identity');
  await duplicate.close(); await ctl.reload(); await ctl.locator('.ctl.has-prompter').waitFor();
  const portrait = await context(500, 900); await portrait.goto(base + '/?screen=portrait#/p/MULTI');
  await portrait.locator('.prompter.has-script.has-ctl').waitFor();
  await wait(async () => await ctl.locator('.pm-screen option').count() === 3, 'three screens');
  await ctl.locator('button[data-view="edit"]').first().click();
  const script = Array.from({ length: 2600 }, (_, i) => 'word' + String(i).padStart(5, '0')).join(' ');
  await ctl.locator('.ed-text').fill(script); await ctl.locator('button[data-view="live"]').first().click();
  await ctl.locator('[data-k="fontSize"] input').fill('32'); await ctl.locator('[data-k="fontSize"] input').dispatchEvent('input');
  await ctl.locator('[data-k="fontFamily"] select').selectOption('JetBrains Mono');
  await ctl.locator('[data-k="countdown"] [data-v="0"]').click();
  await wait(async () => await portrait.locator('.w').count() === 2600 && await a.locator('.w').count() === 2600, 'chunked script reaches all screens');
  const card = id => ctl.locator(`[data-screen-id="${id}"]`);
  await profile(ctl, card('portrait').locator('.screen-config'), { name: 'Камера 3', leftPad: 3, rightPad: 15, mirrorH: true });
  await wait(async () => await portrait.locator('.stage').evaluate(el => el.style.getPropertyValue('--left')) === '15px', 'targeted left margin');
  assert.equal(await b.locator('.stage').evaluate(el => el.style.getPropertyValue('--left')), '128px', 'other screen margins unchanged');
  assert.ok(await portrait.locator('.stage-inner').evaluate(el => getComputedStyle(el).transform.includes('-1')));
  assert.equal(await b.locator('.stage-inner').evaluate(el => getComputedStyle(el).transform), 'none', 'mirror is screen-local');
  await b.setViewportSize({ width: 1600, height: 1000 });
  await profile(ctl, card('wideB').locator('.screen-config'), { fontSize: 48, sidePad: 15 });
  await wait(async () => await b.locator('.stage').evaluate(el => el.style.getPropertyValue('--fs')) === '48px', 'different layout on same size viewport');
  await ctl.locator('[data-a="start"]').click(); await new Promise(r => setTimeout(r, 500));
  await ctl.locator('.speed-range').fill('10'); await ctl.locator('.speed-range').dispatchEvent('input');
  await ctl.locator('[data-a="toggle"]').click();
  await wait(async () => await a.locator('.prompter.playing').count() === 1 && await portrait.locator('.prompter.playing').count() === 1, 'all readers play');
  await new Promise(r => setTimeout(r, 14000));
  const places = await Promise.all([progress(a), progress(b), progress(portrait)]);
  assert.ok(places[0] > 100, 'long playback advances across many lines');
  assert.ok(Math.max(...places) - Math.min(...places) < 15, 'different wraps stay at the same passage: ' + places);
  await ctl.locator('[data-a="toggle"]').click(); await new Promise(r => setTimeout(r, 250));
  for (const [id, reader] of [['wideB', b], ['portrait', portrait]]) {
    const preview = card(id).locator('.stage');
    assert.deepEqual(await preview.evaluate(el => [el.offsetWidth, el.offsetHeight]), await reader.locator('.stage').evaluate(el => [el.offsetWidth, el.offsetHeight]));
    const discrepancy = Math.abs(await offset(ctl, `[data-screen-id="${id}"] .scroller`) - await offset(reader));
    assert.ok(discrepancy < 3, 'individual preview matches actual screen: ' + discrepancy);
  }
  await ctl.locator('[data-a="toggle"]').click();
  await b.context().setOffline(true);
  await wait(async () => await card('wideB').locator('.screen-ready').innerText() === 'Нет свежих данных — последний кадр', 'stale preview is explicit', 6000);
  const frozen = await offset(ctl, '[data-screen-id="wideB"] .scroller');
  await new Promise(r => setTimeout(r, 250));
  assert.equal(await offset(ctl, '[data-screen-id="wideB"] .scroller'), frozen, 'stale preview does not invent motion');
  await b.context().setOffline(false);
  await wait(async () => await card('wideB').locator('.screen-ready').innerText() !== 'Нет свежих данных — последний кадр' && await b.locator('.prompter.playing').count() === 1, 'stale display recovers', 12000);
  await a.context().setOffline(true);
  await wait(async () => await ctl.locator('.device-ready').innerText() === 'Нет свежих данных — последний кадр', 'stale leading preview is explicit', 6000);
  const leadingFrozen = await offset(ctl, '.preview-primary .scroller');
  await new Promise(r => setTimeout(r, 250));
  assert.equal(await offset(ctl, '.preview-primary .scroller'), leadingFrozen, 'stale leading preview freezes');
  await a.context().setOffline(false);
  await wait(async () => await ctl.locator('.device-ready').innerText() !== 'Нет свежих данных — последний кадр' && await a.locator('.prompter.playing').count() === 1, 'leading display recovers', 12000);
  await ctl.locator('[data-a="toggle"]').click(); await new Promise(r => setTimeout(r, 250));
  await ctl.locator('.pm-all').uncheck(); assert.equal(await ctl.locator('.screen-cards').isVisible(), false);
  await ctl.locator('.pm-all').check();
  await portrait.locator('.p-stage').dispatchEvent('wheel', { deltaY: 500 });
  await new Promise(r => setTimeout(r, 800));
  const sought = await Promise.all([progress(a), progress(b), progress(portrait)]);
  assert.ok(Math.max(...sought) - Math.min(...sought) < 15, 'follower wheel seeks the whole session: ' + sought);
  const beforeReload = portrait.url(); await portrait.reload(); await portrait.locator('.prompter.has-script.has-ctl').waitFor();
  assert.equal(portrait.url(), beforeReload, 'stable screen link');
  await wait(async () => await portrait.locator('.stage').evaluate(el => el.style.getPropertyValue('--left')) === '15px', 'profile survives reload');
  await wait(async () => await ctl.locator('.screen-card').count() === 2, 'reconnect replaces its card');
  await b.setViewportSize({ width: 900, height: 1600 });
  await wait(async () => await card('wideB').locator('.stage').evaluate(el => el.offsetHeight) === 1600, 'resized follower preview');
  await ctl.locator('[data-a="toggle"]').click();
  await a.close();
  await wait(async () => await ctl.locator('.pm-screen option').count() === 2, 'leading screen disconnects');
  await wait(async () => await b.locator('.prompter.playing').count() === 1 && await portrait.locator('.prompter.playing').count() === 1, 'playback continues after failover');
  await new Promise(r => setTimeout(r, 2500));
  assert.ok(Math.abs(await progress(b) - await progress(portrait)) < 15, 'new leader stays in sync');
  const lost = await ctl.locator('.pm-screen').inputValue();
  await ctl.locator('.pm-screen').selectOption({ index: 1 });
  assert.notEqual(await ctl.locator('.pm-screen').inputValue(), lost, 'manual leader selection');
  await ctl.locator('[data-a="toggle"]').click(); await new Promise(r => setTimeout(r, 250));
  await b.close(); await wait(async () => (await ctl.locator('.screen-ready').allTextContents()).some(s => s.includes('последний кадр')), 'disconnected display is labelled');
  await ctl.reload(); await ctl.locator('.ctl.has-prompter').waitFor();
  await wait(async () => (await ctl.locator('.pm-screen').innerText()).includes('Камера 3'), 'controller restores display name/profile');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', playbackWordPositions: places, checked: ['16:10/16:9 shaded regions', 'three readers', 'duplicate display link', 'different fonts on equal viewports', 'semantic sync across wraps', 'exact individual previews', 'per-screen margins/mirror', 'follower seek', 'reload', 'resize', 'leader failover/selection', 'offline preview', 'stale preview freezes and recovers', 'controller profile recovery'] }));
} finally { await browser.close(); }
