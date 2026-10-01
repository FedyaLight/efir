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
  await pc.addInitScript(() => {
    window.perfStats = { raf: 0, writes: 0, writeBytes: 0, sends: 0, sendBytes: 0, states: 0, mutations: 0 };
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
  });
  const controller = await mc.newPage(), phone = await pc.newPage();
  await controller.goto(base + '/#/c/LOCAL');
  await phone.goto(phoneBase + '/#/p/LOCAL');
  await controller.locator('.ctl.has-prompter').waitFor();
  await phone.locator('.prompter.has-script.has-ctl').waitFor();
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
  const cdp = await pc.newCDPSession(phone);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  async function sample(name) {
    await cdp.send('HeapProfiler.collectGarbage');
    const videoFrames = () => phone.evaluate(() => document.querySelector('video')?.getVideoPlaybackQuality?.().totalVideoFrames || 0);
    const beforeVideo = await videoFrames();
    await phone.evaluate(() => { for (const key of Object.keys(window.perfStats)) window.perfStats[key] = 0; });
    const before = await metrics();
    await delay(duration);
    const after = await metrics();
    const stats = await phone.evaluate(() => ({ ...window.perfStats, videoPlaying: !!document.querySelector('video') && !document.querySelector('video').paused }));
    result.cases.push({ name, ...stats, taskCpuPercent: +(100 * (after.TaskDuration - before.TaskDuration) / (after.Timestamp - before.Timestamp)).toFixed(3), scriptMs: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(2), layouts: after.LayoutCount - before.LayoutCount, styleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount, decodedVideoFrames: await videoFrames() - beforeVideo, heapMB: +(after.JSHeapUsedSize / 1048576).toFixed(2), domNodes: after.Nodes });
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
  for (const sample of result.cases) {
    assert.ok(sample.videoPlaying && sample.decodedVideoFrames > 0, 'screen protection stays active');
    assert.ok(sample.decodedVideoFrames <= duration / 1000 * 2 + 3, 'wake video decode budget');
    assert.ok(sample.writeBytes < 1024, 'position saves do not rewrite the script');
    if (sample.name !== 'scrolling-http-video') assert.ok(sample.raf <= 8, 'no continuous frames while stationary');
  }
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
