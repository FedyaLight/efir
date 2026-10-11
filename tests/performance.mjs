// Measure real Chromium pages; this does not measure Android battery power.
import { chromium } from '../work/testing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base = process.env.EFIR_URL || 'http://localhost:18765';
const phoneBase = process.env.EFIR_LAN_URL || 'http://0.0.0.0:18765';
const duration = Number(process.env.EFIR_PERF_MS || 8000);
const browser = await chromium.launch({ headless: true });
const result = { environment: { browser: browser.version(), mainThreadOnly: true, durationMs: duration }, cases: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const mc = await browser.newContext({ viewport: { width: 1320, height: 820 } });
  await mc.addInitScript(() => { window.efirNative = { version: 1, role: 'controller', capabilities: { speech: true }, postMessage() {} }; });
  const pc = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const instrument = () => {
    window.perfStats = { raf: 0, writes: 0, writeBytes: 0, sends: 0, sendBytes: 0, states: 0, mutations: 0, metadataMutations: 0 };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(time => { window.perfStats.raf++; callback(time); });
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      window.perfStats.writes++; window.perfStats.writeBytes += new TextEncoder().encode(value).length;
      return write.call(this, key, value);
    };
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      window.perfStats.sends++; window.perfStats.sendBytes += new TextEncoder().encode(data).length;
      try { if (JSON.parse(data).t === 'state') window.perfStats.states++; } catch { /* Binary packet. */ }
      return send.call(this, data);
    };
  };
  await mc.addInitScript(instrument);
  await pc.addInitScript(instrument);
  const controller = await mc.newPage(), phone = await pc.newPage();
  await controller.goto(base + '/#/c/LOCAL');
  await phone.goto(phoneBase + '/#/p/LOCAL');
  await controller.locator('.ctl.has-prompter').waitFor();
  await phone.locator('.prompter.has-script.has-ctl').waitFor();
  const readers = [phone], readerContexts = [pc];
  for (const viewport of [{ width: 1600, height: 900 }, { width: 500, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(instrument);
    const page = await context.newPage();
    await page.goto(base + '/#/p/LOCAL');
    await page.locator('.prompter.has-script.has-ctl').waitFor();
    readers.push(page); readerContexts.push(context);
  }
  await controller.evaluate(() => {
    window.metadataObserver = new MutationObserver(records => {
      window.perfStats.metadataMutations += records.filter(record => record.target.parentElement?.closest('.screen-label,.screen-ready,.screen-config') || record.target.closest?.('.screen-label,.screen-ready,.screen-config')).length;
    });
    window.metadataObserver.observe(document.querySelector('.screen-cards'), { attributes: true, childList: true, characterData: true, subtree: true });
  });
  await controller.locator('button[data-view="edit"]').first().click();
  await controller.locator('.ed-text').fill('# Начало\n' + 'Проверяем ресурсы телефона во время длинного спокойного чтения. '.repeat(700) + '\n\n# Финал\nСпасибо за внимание.');
  await controller.locator('button[data-view="live"]').first().click();
  await controller.locator('[data-g="screen"]').evaluate(el => el.open = true);
  await controller.locator('[data-k="countdown"] [data-v="0"]').click();
  await phone.locator('.p-stage').tap();
  await phone.locator('.prompter.playing').waitFor();
  await controller.locator('[data-a="start"]').click();
  await phone.locator('.prompter:not(.playing)').waitFor();
  await delay(4000);
  await phone.evaluate(() => {
    window.stageObserver = new MutationObserver(records => window.perfStats.mutations += records.length);
    window.stageObserver.observe(document.querySelector('.stage'), { attributes: true, childList: true, characterData: true, subtree: true });
  });
  const pages = [controller, ...readers];
  const cdps = await Promise.all([mc, ...readerContexts].map((context, i) => context.newCDPSession(pages[i])));
  for (const session of cdps) await session.send('Performance.enable');
  const cdp = cdps[1];
  async function sample(name) {
    await cdp.send('HeapProfiler.collectGarbage');
    const videoFrames = () => phone.evaluate(() => document.querySelector('video')?.getVideoPlaybackQuality?.().totalVideoFrames || 0);
    const beforeVideo = await videoFrames();
    await Promise.all(pages.map(page => page.evaluate(() => { for (const key of Object.keys(window.perfStats)) window.perfStats[key] = 0; })));
    const allMetrics = () => Promise.all(cdps.map(async session => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))));
    const beforeAll = await allMetrics(), before = beforeAll[1];
    await delay(duration);
    const afterAll = await allMetrics(), after = afterAll[1];
    const devices = await Promise.all(pages.map(async (page, i) => ({ role: i ? 'reader' : 'controller', ...await page.evaluate(() => window.perfStats), taskCpuPercent: +(100 * (afterAll[i].TaskDuration - beforeAll[i].TaskDuration) / (afterAll[i].Timestamp - beforeAll[i].Timestamp)).toFixed(3) })));
    const stats = await phone.evaluate(() => ({ ...window.perfStats, videoPlaying: !!document.querySelector('video') && !document.querySelector('video').paused }));
    result.cases.push({ name, ...stats, devices, taskCpuPercent: +(100 * (after.TaskDuration - before.TaskDuration) / (after.Timestamp - before.Timestamp)).toFixed(3), scriptMs: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(2), layouts: after.LayoutCount - before.LayoutCount, styleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount, decodedVideoFrames: await videoFrames() - beforeVideo, heapMB: +(after.JSHeapUsedSize / 1048576).toFixed(2), domNodes: after.Nodes });
  }
  await sample('paused-http-video');
  await controller.locator('[data-a="toggle"]').click();
  await phone.locator('.prompter.playing').waitFor();
  await delay(1200);
  await sample('scrolling-http-video');
  await controller.locator('[data-a="voice"]').click();
  await phone.locator('.prompter.voice-active').waitFor();
  await delay(2500);
  await sample('voice-settled-http-video');
  // The native host may hide a WebView while document.hidden stays false.
  // Enabled Gamepad input must stop polling then, and resume on return.
  await controller.bringToFront();
  await controller.locator('[data-a="keys"]').click();
  await controller.locator('.remote-gamepad').check();
  await controller.locator('.modal-x').click();
  await controller.locator('.modal-wrap').waitFor({ state: 'detached' });
  await delay(300);
  await controller.evaluate(() => window.efirNative.onVisible(false));
  await delay(300);
  await controller.evaluate(() => window.perfStats.raf = 0);
  await delay(600);
  result.nativeHiddenFrames = await controller.evaluate(() => window.perfStats.raf);
  assert.equal(result.nativeHiddenFrames, 0, 'hidden native controller stops Gamepad and preview frames');
  await controller.evaluate(() => window.efirNative.onVisible(true));
  await delay(300);
  assert.ok(await controller.evaluate(() => window.perfStats.raf) > 0, 'Gamepad polling resumes with the visible focused window');
  await controller.locator('[data-a="keys"]').click();
  await controller.locator('.remote-gamepad').uncheck();
  await controller.locator('.modal-x').click();
  await controller.locator('.modal-wrap').waitFor({ state: 'detached' });
  const home = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 640 } });
  await home.addInitScript(instrument);
  await home.route('**/efir-local.json', route => route.fulfill({ status: 404, body: '' }));
  const demo = await home.newPage();
  await demo.goto(base); await demo.locator('.home').waitFor();
  await demo.evaluate(() => document.fonts.ready); await delay(500);
  await demo.evaluate(() => window.perfStats.raf = 0); await delay(600);
  result.reducedMotionDemoFrames = await demo.evaluate(() => window.perfStats.raf);
  assert.ok(result.reducedMotionDemoFrames <= 2, 'reduced-motion demo has no continuous animation');
  const demoOffset = () => demo.locator('.demo .scroller').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42);
  const oldOffset = await demoOffset();
  await demo.emulateMedia({ reducedMotion: 'no-preference' }); await delay(600);
  assert.notEqual(await demoOffset(), oldOffset, 'demo resumes when reduced motion is disabled');
  await demo.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await demo.waitForFunction(() => document.querySelector('.demo').getBoundingClientRect().bottom <= 0);
  await delay(300); await demo.evaluate(() => window.perfStats.raf = 0); await delay(600);
  result.offscreenDemoFrames = await demo.evaluate(() => window.perfStats.raf);
  assert.ok(result.offscreenDemoFrames <= 2, 'offscreen demo stops drawing');
  await demo.evaluate(() => scrollTo(0, 0)); await delay(300);
  assert.ok(await demo.evaluate(() => window.perfStats.raf) > 0, 'onscreen demo resumes');
  console.log(JSON.stringify(result, null, 2));
  for (const sample of result.cases) {
    assert.ok(sample.devices[0].metadataMutations <= 8, 'unchanged display labels do not churn during playback');
    assert.ok(sample.videoPlaying && sample.decodedVideoFrames > 0, 'screen protection stays active');
    assert.ok(sample.decodedVideoFrames <= duration / 1000 * 2 + 3, 'wake video decode budget');
    assert.ok(sample.writeBytes < 1024, 'position saves do not rewrite the script');
    if (sample.name !== 'scrolling-http-video') assert.ok(sample.raf <= 8, 'no continuous frames while stationary');
  }
} finally { await browser.close(); }
