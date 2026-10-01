// Responsive UI contract: translated controls stay inside their panels.
import { chromium } from '../work/testing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.EFIR_URL || 'http://localhost:18765';
const browser = await chromium.launch({ headless: true });
const languages = ['ru', 'en', 'es', 'zh', 'hi', 'ar'];
const sizes = [[320, 640], [390, 844], [640, 360], [844, 390], [768, 1024], [1024, 768], [1440, 900]];
const variants = process.env.EFIR_LAYOUT_VARIANTS?.split(',') || ['android', 'standalone', 'desktop', 'browser', 'hosted'];
const problems = [], errors = [];
let checked = 0;
if (process.env.EFIR_LAYOUT_ARTIFACTS) await mkdir(process.env.EFIR_LAYOUT_ARTIFACTS, { recursive: true });
async function inspect(page, scope, name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const failures = await page.locator(scope).evaluateAll(roots => {
    const failures = [];
    for (const root of roots) {
      const rr = root.getBoundingClientRect();
      if (!rr.width || !rr.height || getComputedStyle(root).display === 'none') continue;
      for (const el of root.querySelectorAll('button,a,select,input:not([type="file"]),textarea')) {
        const style = getComputedStyle(el), r = el.getBoundingClientRect();
        if (!r.width || !r.height || style.visibility === 'hidden' || +style.opacity === 0) continue;
        // Scrollable settings/library content may legitimately extend vertically.
        if (r.left < Math.max(0, rr.left) - 1 || r.right > Math.min(innerWidth, rr.right) + 1 ||
            (root.matches('.ctl-top,.p-top,.p-bottom,.pane-live,.pane-edit,.mnav') && getComputedStyle(root).overflowY !== 'auto' && (r.top < rr.top - 1 || r.bottom > Math.min(innerHeight, rr.bottom) + 1))) {
          failures.push(`${el.tagName} ${el.dataset.a || el.dataset.view || el.className}: outside panel`);
        }
      }
      if (root.scrollWidth > root.clientWidth + 1) failures.push(`${root.className}: horizontal overflow ${root.scrollWidth}/${root.clientWidth}`);
    }
    return failures;
  });
  for (const failure of failures) problems.push(`${name}: ${failure}`);
  if (failures.length && process.env.EFIR_LAYOUT_ARTIFACTS) {
    await mkdir(process.env.EFIR_LAYOUT_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: `${process.env.EFIR_LAYOUT_ARTIFACTS}/${name.replaceAll('/', '-')}.png` });
  }
  checked++;
}
try {
  for (const variant of variants) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (variant === 'hosted' && url.pathname === '/efir-local.json') return route.fulfill({ status: 404, body: '' });
      return url.origin === new URL(base).origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
    });
    if (variant !== 'hosted') await context.addInitScript(variant => {
      const reader = location.hash.includes('/p/');
      if (variant === 'browser' && reader) return;
      const android = variant === 'android' || variant === 'standalone';
      window.efirNative = { version: 1, platform: android ? 'android' : variant === 'desktop' ? 'linux' : 'macos', deviceName: android ? 'Android' : variant === 'desktop' ? 'Linux' : 'Mac', role: reader ? 'prompter' : 'controller',
        addresses: [{ name: 'Wi-Fi (en0)', address: '192.168.1.23' }, { name: 'Ethernet (en1)', address: '192.168.100.123' }],
        capabilities: { fullscreen: true, navigation: android, showPrompter: android, standalone: variant === 'standalone', screenAwake: true,
          speech: !reader, speechModels: !reader && variant === 'desktop', speechDownload: !reader && android, networkSettings: !reader && (variant === 'desktop' || variant === 'android') },
        postMessage() {} };
    }, variant);
    const c = await context.newPage(), p = await context.newPage();
    await c.goto(base + '/#/c/LAYOUT42');
    await p.goto(base + '/#/p/LAYOUT42');
    await p.locator('.prompter.has-script.has-ctl').waitFor();
    await p.locator('.p-stage').tap();
    await p.locator('.p-stage').tap();
    await p.waitForFunction(() => getComputedStyle(document.querySelector('.p-ui')).opacity === '1');
    for (const language of languages) {
      await c.locator('.ui-language').selectOption(language);
      for (const theme of ['light', 'dark']) {
        for (const page of [c, p]) await page.emulateMedia({ colorScheme: theme });
        for (const [width, height] of sizes) {
          for (const page of [c, p]) await page.setViewportSize({ width, height });
          for (const page of [c, p]) await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const name = `${variant}/${language}/${theme}/${width}x${height}`;
          if (variant === 'android' || variant === 'standalone' || variant === 'hosted') {
            const back = p.locator('.p-top > a');
            if (await back.innerText()) problems.push(`${name}: exit has a visible caption`);
            if (!await back.getAttribute('aria-label')) problems.push(`${name}: exit lacks an accessible label`);
          }
          await inspect(p, '.p-top,.p-bottom', name + '/reader');
          await c.locator(`button[data-view="live"]:visible`).last().click();
          await inspect(c, '.ctl-top,.pane-live,.mnav', name + '/live');
          if (variant === 'android' || variant === 'standalone') assert.equal(await c.locator('[data-a="read"]:visible').count(), 1, 'one Read action per visible pane');
          await c.locator(`button[data-view="edit"]:visible`).last().click();
          await inspect(c, '.ctl-top,.pane-edit,.mnav', name + '/edit');
          if (width <= 900) await c.locator('button[data-view="set"]:visible').click();
          await c.locator('.grp').evaluateAll(groups => groups.forEach(group => group.open = true));
          await inspect(c, '.settings', name + '/settings');
          if (variant !== 'standalone') {
            await c.locator('[data-a="connect"]').first().click();
            await c.waitForFunction(() => getComputedStyle(document.querySelector('.modal-wrap')).opacity === '1');
            await inspect(c, '.modal', name + '/connect');
            await c.locator('.modal-x').click();
            await c.locator('.modal-wrap').waitFor({ state: 'detached' });
          }
        }
      }
    }
    if (variant === 'android' || variant === 'standalone') {
      await p.evaluate(() => window.efirNative.onFullscreen(true));
      assert.equal(await p.locator('[data-a="fs"]').innerText(), '');
      if (await p.locator('[data-a="fs"] svg').innerHTML() !== await p.locator('.p-top > a svg').innerHTML()) problems.push('fullscreen exit does not use an arrow');
      if (await p.locator('[data-a="fs"]').getAttribute('aria-label') === await p.locator('.p-fullscreen').getAttribute('aria-label')) problems.push('fullscreen exit lacks its own accessible label');
      for (const language of languages) {
        await p.locator('.ui-language').selectOption(language);
        const state = await p.evaluate(async () => {
          const { t, uiLanguage } = await import('./js/i18n.js');
          return { language: uiLanguage(), label: document.querySelector('[data-a="fs"]').getAttribute('aria-label'), expected: t('Выйти из полного экрана') };
        });
        assert.equal(state.language, language, 'language choice survives queued events from the other window');
        assert.equal(state.label, state.expected);
      }
      await p.evaluate(() => window.efirNative.onFullscreen(false));
      assert.equal(await p.locator('[data-a="fs"] svg').innerHTML(), await p.locator('.p-fullscreen svg').innerHTML(), 'fullscreen entry restores its icon');
    }
    await context.close();
    console.log(`Checked ${variant}: all six languages, two themes, seven viewport sizes`);
  }
  const home = await browser.newContext();
  await home.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/efir-local.json') return route.fulfill({ status: 404, body: '' });
    return url.origin === new URL(base).origin ? route.continue() : route.abort();
  });
  const page = await home.newPage();
  const waiting = await home.newPage();
  await page.goto(base);
  await waiting.goto(base + '/#/p/LAYOUT42');
  await page.locator('#roomInput').fill('LAYOUT42');
  for (const language of languages) {
    await page.locator('.ui-language').selectOption(language);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await waiting.setViewportSize({ width, height });
      await inspect(page, '.h-bar,.h-panel', `home/${language}/${width}x${height}`);
      await inspect(waiting, '.p-wait-card', `waiting/${language}/${width}x${height}`);
      assert.ok(await waiting.locator('.p-wait-card').evaluate(el => el.getBoundingClientRect().top >= 0), 'waiting screen begins inside the viewport');
    }
  }
  await home.close();
  console.log(`${checked} layout checks; ${problems.length} issues`);
  if (process.env.EFIR_LAYOUT_ARTIFACTS) await writeFile(`${process.env.EFIR_LAYOUT_ARTIFACTS}/issues.json`, JSON.stringify(problems, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(problems, []);
  console.log('PASS translated controller and reader layouts, icon-only exit and native fullscreen state');
} finally { await browser.close(); }
