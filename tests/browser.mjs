// End-to-end checks through a real server with isolated browser profiles.
import { chromium } from '../work/testing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base = process.env.EFIR_URL || 'http://localhost:8765';
const phoneBase = process.env.EFIR_LAN_URL || base;
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=user-gesture-required'] });
const errors = [], external = [];
const contexts = [];
async function context(native = false, locale = 'ru-RU') {
  const c = await browser.newContext({ locale, viewport: native ? { width: 1320, height: 820 } : { width: 844, height: 390 }, hasTouch: !native, isMobile: !native });
  contexts.push(c);
  const origins = new Set([new URL(base).origin, new URL(phoneBase).origin]);
  await c.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:') || origins.has(new URL(url).origin)) return route.continue();
    external.push(url); return route.abort();
  });
  if (native) await c.addInitScript(() => {
    window.nativeMessages = [];
    window.efirNative = { version: 1, platform: 'linux', deviceName: 'Компьютер', role: 'controller',
      capabilities: { speech: true, fullscreen: true, sessionAwake: true }, postMessage: message => window.nativeMessages.push(message) };
  });
  c.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  return c;
}
async function waitFor(fn, detail, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await fn()) return; await new Promise(r => setTimeout(r, 60)); }
  throw new Error('timeout: ' + detail);
}
const cy = async page => page.locator('.scroller').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42);
try {
  const mc = await context(true), pc = await context();
  const controller = await mc.newPage(), phone = await pc.newPage();
  await controller.goto(base + '/#/c/TST42');
  await phone.goto(phoneBase + '/#/p/TST42');
  await controller.locator('.ctl.has-prompter').waitFor();
  await phone.locator('.prompter.has-script.has-ctl').waitFor();
  assert.equal(await phone.evaluate(() => typeof window.Peer), 'undefined');
  assert.equal(await phone.locator('.lan-help').count(), 0);
  const text = '# Начало\nДобрый день это проверка текста для суфлёра. Сегодня мы читаем сценарий проверяем голос скорость положение экрана.\n\n' + ('Отдельная строка для прокрутки и проверки размеров. '.repeat(50)) + '\n\n# Финал\nСпасибо до встречи в эфире.';
  await controller.locator('button[data-view="edit"]').first().click();
  await controller.locator('.ed-text').fill(text);
  await controller.locator('button[data-view="live"]').first().click();
  await waitFor(async () => (await phone.locator('.text').innerText()).includes('Спасибо'), 'text sync');
  await phone.locator('.p-stage').tap();
  await phone.locator('.prompter.playing.ui-hidden').waitFor();
  await waitFor(async () => await controller.locator('.ctl.playing').count() > 0, 'reader tap starts the controller');
  await phone.locator('.p-stage').tap();
  await waitFor(async () => await phone.locator('.prompter:not(.playing):not(.ui-hidden)').count() > 0, 'reader tap pauses and reveals controls');
  await phone.locator('[data-a="mirror"]').tap();
  await waitFor(async () => await controller.evaluate(async () => (await import('./js/store.js')).store.settings().mirrorH === true), 'reader mirror reaches controller settings');
  await phone.locator('[data-a="mirror"]').tap();
  await waitFor(async () => await controller.evaluate(async () => (await import('./js/store.js')).store.settings().mirrorH === false), 'reader mirror toggles off');
  const fontSize = controller.locator('[data-k="fontSize"] input');
  await fontSize.fill('44'); await fontSize.dispatchEvent('input');
  await waitFor(async () => await phone.locator('.text').evaluate(el => getComputedStyle(el).fontSize) === '44px', 'settings sync');
  await controller.locator('[data-g="screen"]').evaluate(el => el.open = true);
  await controller.locator('[data-k="countdown"] [data-v="0"]').click();
  await controller.locator('[data-k="orient"] [data-v="1-0"]').click();
  await waitFor(async () => await phone.locator('.stage-inner').evaluate(el => getComputedStyle(el).transform.includes('-1')), 'mirror sync');
  // The preview uses the phone's exact CSS viewport dimensions.
  const dimensions = async p => p.locator('.stage').evaluate(el => [el.offsetWidth, el.offsetHeight]);
  assert.deepEqual(await dimensions(controller), await dimensions(phone));
  await controller.locator('[data-a="toggle"]').click();
  await phone.locator('.prompter.playing').waitFor();
  assert.equal(await phone.locator('.p-fullscreen').innerText(), '');
  await waitFor(async () => await phone.locator('.p-fullscreen').evaluate(el => +getComputedStyle(el).opacity) <= .13, 'subtle fullscreen icon while playing');
  await new Promise(r => setTimeout(r, 1200));
  let maxError = 0;
  for (let i = 0; i < 10; i++) {
    const [c, p] = await Promise.all([cy(controller), cy(phone)]);
    maxError = Math.max(maxError, Math.abs(c - p));
    await new Promise(r => setTimeout(r, 80));
  }
  assert.ok(maxError < 3, 'preview drift ' + maxError);
  // UI language changes preserve the role, script and recognition language.
  const beforeLanguage = await controller.evaluate(() => ({ url: location.href, speech: document.querySelector('[data-k="voiceLang"] select').value, script: document.querySelector('.ed-text').value }));
  for (const [language, label] of [['en', 'Connect teleprompter'], ['es', 'Conectar teleprónter'], ['zh', '连接提词器'], ['hi', 'टेलीप्रॉम्प्टर जोड़ें'], ['ar', 'توصيل الملقّن'], ['ru', 'Подключить суфлёр']]) {
    await controller.locator('.ui-language').selectOption(language);
    assert.equal(await controller.locator('[data-a="connect"]').last().innerText(), label);
    assert.equal(await controller.locator('[data-k="voiceLang"] select').inputValue(), beforeLanguage.speech);
    assert.equal(await controller.locator('.ed-text').inputValue(), beforeLanguage.script);
    assert.equal(controller.url(), beforeLanguage.url);
    assert.ok(await phone.locator('.prompter.playing').count(), 'reading continues after language switch');
  }
  if (!await phone.locator('.ui-language').isVisible()) await phone.locator('.p-stage').tap();
  await phone.locator('.ui-language').selectOption('ar');
  assert.equal(await phone.locator('.p-fullscreen').getAttribute('aria-label'), 'ملء الشاشة');
  assert.equal(await phone.evaluate(() => document.documentElement.dir), 'rtl');
  assert.equal(await phone.locator('.text').evaluate(el => getComputedStyle(el).direction), 'ltr', 'Arabic UI keeps Russian script direction');
  assert.ok(Math.abs(await cy(controller) - await cy(phone)) < 3, 'locale does not change preview geometry');
  await phone.locator('.ui-language').selectOption('ru');
  await waitFor(async () => (await controller.locator('.device-ready').innerText()).includes('Защита экрана активна'), 'phone readiness reaches controller after activation');
  // Touch lock blocks seeking during playback; unlocking restores it.
  const lockedPos = await cy(phone);
  await phone.locator('.p-stage').dispatchEvent('wheel', { deltaY: 500 });
  await new Promise(r => setTimeout(r, 100));
  assert.ok(Math.abs(await cy(phone) - lockedPos) < 30, 'accidental gesture blocked during reading');
  await phone.locator('.p-lock').click();
  const unlockedPos = await cy(phone);
  await phone.locator('.p-stage').dispatchEvent('wheel', { deltaY: 500 });
  await waitFor(async () => Math.abs(await cy(phone) - unlockedPos) > 400, 'explicit unlock allows gesture');
  await phone.locator('.p-lock').click();
  // A fresh reader resumes the current session without a cache.
  const lc = await context(), latePhone = await lc.newPage();
  await latePhone.goto(phoneBase + '/#/p/LOCAL');
  await latePhone.locator('.prompter.has-script.has-ctl').waitFor();
  await waitFor(async () => await latePhone.locator('.prompter.playing').count() > 0 && Math.abs(await cy(phone) - await cy(latePhone)) < 3, 'fresh prompter resumes current playback');
  await lc.close();
  await controller.locator('[data-a="toggle"]').click();
  await controller.locator('.sec-item[data-k="1"]').click();
  await waitFor(async () => Math.abs(await cy(controller) - await cy(phone)) < 2, 'section jump settles');
  // Both roles recover after reload without reentering the code.
  await phone.reload(); await phone.locator('.prompter.has-script.has-ctl').waitFor();
  await waitFor(async () => await phone.locator('.text').evaluate(el => getComputedStyle(el).fontSize) === '44px', 'settings after phone reload');
  await controller.reload(); await controller.locator('.ctl.has-prompter').waitFor();
  await waitFor(async () => (await phone.locator('.text').innerText()).includes('Спасибо'), 'text after controller reload');
  // Heartbeat detects network loss and triggers reconnection.
  await pc.setOffline(true);
  await new Promise(r => setTimeout(r, 8500));
  await pc.setOffline(false);
  await phone.locator('.prompter.has-script.has-ctl').waitFor({ timeout: 22000 });
  await controller.locator('.ctl.has-prompter').waitFor();
  // Native transcripts use the shared matcher and move the remote reader.
  await controller.locator('[data-a="start"]').click();
  await new Promise(r => setTimeout(r, 800));
  await controller.locator('[data-a="voice"]').click();
  await waitFor(async () => controller.evaluate(() => window.nativeMessages.some(m => m.action === 'voiceStart')), 'native voice start');
  await controller.evaluate(() => window.efirNative.onTranscript('Добрый день это проверка текста для суфлёра', false));
  await waitFor(async () => await phone.locator('.stage').evaluate(el => el.classList.contains('voice-live')), 'native hearing reaches phone');
  await waitFor(async () => await phone.locator('.w.now').getAttribute('data-i') === '6', 'native word match reaches phone');
  await controller.evaluate(() => window.efirNative.onTranscript('Сегодня мы читаем сценарий проверяем голос скорость положение экрана', true));
  await waitFor(async () => await phone.locator('.w.now').getAttribute('data-i') === '15', 'native voice advances');
  await controller.evaluate(() => window.efirNative.onTranscript('Добрый день это проверка текста для суфлёра', true));
  await waitFor(async () => await phone.locator('.w.now').getAttribute('data-i') === '6', 'native rereading returns');
  await controller.locator('[data-a="manual"]').click();
  assert.ok(await controller.evaluate(() => window.nativeMessages.some(m => m.action === 'voiceStop')));
  assert.ok(await controller.evaluate(() => window.nativeMessages.some(m => m.action === 'sessionActive' && m.active)), 'platform receives active session');
  // Applying a profile restores settings on the connected reader.
  await controller.locator('[data-a="profile-save"]').click();
  await controller.getByRole('textbox', { name: 'Название профиля' }).fill('Съёмка тест');
  await controller.locator('.profile-form button').click();
  await controller.locator('.profile-select').selectOption('glass');
  await waitFor(async () => await phone.locator('.text').evaluate(el => getComputedStyle(el).fontSize) === '64px', 'built in profile applies');
  await controller.locator('.profile-select').selectOption({ label: 'Съёмка тест' });
  await waitFor(async () => await phone.locator('.text').evaluate(el => getComputedStyle(el).fontSize) === '44px', 'saved profile restores');
  // Download and reimport a backup without losing newly created scripts.
  await controller.locator('[data-a="backup"]').click();
  const downloading = controller.waitForEvent('download');
  await controller.locator('[data-b="save"]').click();
  const saved = await downloading;
  const backupPath = new URL('../work/browser-backup.json', import.meta.url).pathname;
  await saved.saveAs(backupPath);
  await controller.locator('[data-a="new"]').click();
  await controller.locator('.ed-title').fill('Текст после копии');
  await controller.locator('.ed-text').fill('Этот текст должен остаться после восстановления библиотеки.');
  await new Promise(r => setTimeout(r, 600));
  controller.on('dialog', dialog => dialog.accept());
  await controller.locator('[data-a="backup"]').click();
  await controller.locator('.backup-file').setInputFiles(backupPath);
  await waitFor(async () => (await phone.locator('.text').innerText()).includes('Спасибо'), 'backup restores current script');
  assert.ok((await controller.locator('.lib-list').innerText()).includes('Текст после копии'), 'restore keeps newer script');
  await controller.locator('.profile-select').selectOption({ label: 'Съёмка тест' });
  await waitFor(async () => await phone.locator('.text').evaluate(el => getComputedStyle(el).fontSize) === '44px', 'profile survives backup restore');
  const beforeBadBackup = await controller.evaluate(() => localStorage.getItem('efir.scripts.v1'));
  await controller.locator('[data-a="backup"]').click();
  await controller.locator('.backup-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"efir-backup","version":999,"scripts":[]}') });
  await controller.locator('.toast.bad').waitFor();
  assert.equal(await controller.evaluate(() => localStorage.getItem('efir.scripts.v1')), beforeBadBackup, 'bad backup leaves library intact');
  await controller.locator('.modal-x').click();
  await phone.locator('.p-stage').tap();
  if (!await phone.evaluate(() => window.isSecureContext)) {
    await waitFor(async () => phone.evaluate(() => [...document.querySelectorAll('video')].some(v => !v.paused)), 'NoSleep starts after Android touch');
    await phone.evaluate(() => document.querySelector('video').pause());
    await waitFor(async () => phone.evaluate(() => !document.querySelector('video').paused), 'wake video resumes without another touch');
  }
  await phone.locator('.p-fullscreen').click();
  await waitFor(async () => phone.evaluate(() => !!document.fullscreenElement), 'fullscreen icon');
  await phone.evaluate(() => document.exitFullscreen());
  // An insecure HTTP origin uses the local screen-protection video.
  if (!await phone.evaluate(() => window.isSecureContext)) {
    await waitFor(async () => phone.evaluate(() => [...document.querySelectorAll('video')].some(v => !v.paused)), 'NoSleep video');
    const support = await phone.evaluate(async () => (await import('./js/voice.js')).voiceSupported);
    assert.equal(support, false);
  }
  // Check lock release and API denial on a secure context.
  const wc = await context();
  await wc.addInitScript(() => {
    window.wakeSentinels = [];
    window.denyNativeWake = false;
    Object.defineProperty(navigator, 'wakeLock', { value: {
      async request() {
        if (window.denyNativeWake) throw new DOMException('denied', 'NotAllowedError');
        const sentinel = new EventTarget();
        sentinel.released = false;
        sentinel.release = async () => {
          if (sentinel.released) return;
          sentinel.released = true;
          sentinel.dispatchEvent(new Event('release'));
        };
        window.wakeSentinels.push(sentinel);
        return sentinel;
      },
    } });
  });
  const wakePage = await wc.newPage();
  await wakePage.goto(base + '/#/p/LOCAL');
  await waitFor(async () => wakePage.evaluate(() => window.wakeSentinels.length === 1), 'system screen lock');
  await wakePage.evaluate(() => window.wakeSentinels[0].release());
  await waitFor(async () => wakePage.evaluate(() => window.wakeSentinels.length === 2), 'system lock reacquired after release');
  await wakePage.evaluate(() => { window.denyNativeWake = true; window.wakeSentinels[1].release(); });
  await waitFor(async () => wakePage.evaluate(() => {
    const v = document.querySelector('video');
    return (v && !v.paused && v.readyState >= 2) || !document.querySelector('.p-awake').hidden;
  }), 'fallback starts or requests a touch');
  if (await wakePage.locator('.p-awake').isVisible()) await wakePage.locator('.p-awake').tap();
  await waitFor(async () => wakePage.evaluate(() => !document.querySelector('video').paused), 'video fallback when system API denied');
  await wakePage.locator('.p-awake').waitFor({ state: 'hidden' });
  assert.ok(await wakePage.evaluate(() => { const v = document.querySelector('video'); return !v.muted && v.volume > 0; }));
  // Cached reader data must restore without a controller.
  await pc.routeWebSocket(/\/ws\?/, socket => socket.close());
  await phone.reload();
  await phone.locator('.prompter.has-script').waitFor();
  assert.ok(await phone.locator('.text').evaluate(el => el.textContent.includes('Спасибо')));
  assert.equal(await phone.locator('.text').evaluate(el => getComputedStyle(el).fontSize), '44px');
  assert.ok(await phone.locator('.stage-inner').evaluate(el => getComputedStyle(el).transform.includes('-1')));
  // The Android adapter acknowledges screen protection without video.
  const ac = await context();
  await ac.addInitScript(() => {
    let full = false;
    window.efirNative = { version: 1, platform: 'android', deviceName: 'Android', role: 'prompter',
      capabilities: { screenAwake: true, fullscreen: true }, postMessage(message) {
        queueMicrotask(() => {
          if (message.action === 'screenAwake') window.efirNative.onAwake(message.active);
          if (message.action === 'fullscreen') window.efirNative.onFullscreen(full = !full);
        });
      } };
  });
  const android = await ac.newPage();
  await android.goto(phoneBase + '/#/p/LOCAL');
  await android.locator('.prompter.has-script.has-ctl').waitFor();
  await android.locator('.p-awake').waitFor({ state: 'hidden' });
  assert.equal(await android.locator('video').count(), 0, 'native screen protection does not decode video');
  await android.locator('.p-fullscreen:visible, .prompter:not(.ui-hidden) [data-a="fs"]').tap();
  await android.locator('.prompter.is-fullscreen').waitFor();
  // Start in the system language; retain a selected language after reload.
  const sc = await context(false, 'es-MX'), spanish = await sc.newPage();
  await spanish.goto(phoneBase);
  await spanish.locator('.prompter').waitFor();
  assert.equal(await spanish.locator('.ui-language').inputValue(), 'es');
  if (!await spanish.locator('.ui-language').isVisible()) await spanish.locator('.p-stage').tap();
  await spanish.locator('.ui-language').selectOption('en');
  await spanish.reload();
  await spanish.locator('.prompter').waitFor();
  assert.equal(await spanish.locator('.ui-language').inputValue(), 'en');
  await sc.close();
  // Insert localized cues without translating existing script text.
  await controller.locator('button[data-view="live"]').first().click();
  await controller.locator('[data-a="manual"]').click();
  await controller.locator('.ui-language').selectOption('es');
  await controller.locator('button[data-view="edit"]').first().click();
  await controller.locator('.ed-text').fill('Texto de prueba.');
  await controller.locator('[data-ins="note"]').click();
  assert.equal(await controller.locator('.ed-text').inputValue(), 'Texto de prueba.[pausa]');
  await controller.locator('.ui-language').selectOption('ru');
  // Voice matching and rereading work across Chinese, Hindi and Arabic scripts.
  for (const [lang, script, first, last, word1, word2] of [
    ['zh-CN', '# 试读\n今天我们开始测试中文提词器，文字应该跟随说话的声音。然后再次阅读之前的句子。', '今天我们开始测试中文提词器', '文字应该跟随说话的声音', '器', '音'],
    ['hi-IN', '# पठन\nआज हम नई पटकथा पढ़ रहे हैं और आवाज़ के साथ पाठ आगे बढ़ता है', 'आज हम नई पटकथा पढ़ रहे हैं', 'और आवाज़ के साथ पाठ आगे बढ़ता है', 'हैं', 'है'],
    ['ar-SA', '# قراءة\nهذا نص للتجربة وسوف يتبع الصوت الكلمات على الشاشة', 'هذا نص للتجربة وسوف يتبع الصوت', 'الكلمات على الشاشة', 'الصوت', 'الشاشة'],
  ]) {
    await controller.locator('button[data-view="live"]').first().click();
    await controller.locator('[data-a="manual"]').click();
    await controller.locator('button[data-view="edit"]').first().click();
    await controller.locator('.ed-text').fill(script);
    await controller.locator('button[data-view="live"]').first().click();
    await waitFor(async () => (await android.locator('.text').innerText()).includes(word2), 'translated alphabet script reaches phone');
    if (lang === 'hi-IN') assert.ok((await controller.locator('.ed-stats').innerText()).startsWith('16 слов'), 'Hindi vowel marks do not split words');
    if (lang === 'ar-SA') assert.equal(await android.locator('.text').evaluate(el => getComputedStyle(el).direction), 'rtl', 'Arabic script direction is independent of UI');
    if (!await controller.locator('.settings-more').evaluate(el => el.open)) await controller.locator('.settings-more > summary').click();
    if (!await controller.locator('[data-g="voice"]').evaluate(el => el.open)) await controller.locator('[data-g="voice"] > summary').click();
    await controller.locator('[data-k="voiceLang"] select').selectOption(lang);
    await controller.locator('[data-a="voice"]').click();
    await controller.evaluate(text => window.efirNative.onTranscript(text, false), first);
    await waitFor(async () => (await android.locator('.w.now').textContent()) === word1, 'voice match in ' + lang);
    await controller.evaluate(text => window.efirNative.onTranscript(text, false), last);
    await waitFor(async () => (await android.locator('.w.now').textContent()) === word2, 'voice advances in ' + lang);
    await controller.evaluate(text => window.efirNative.onTranscript(text, true), first);
    await waitFor(async () => (await android.locator('.w.now').textContent()) === word1, 'voice returns in ' + lang);
  }
  assert.deepEqual(external, [], 'offline external requests');
  assert.deepEqual(errors, [], 'page errors');
  console.log(JSON.stringify({ result: 'PASS', previewMaxErrorPx: maxError, offlineExternalRequests: external.length, checked: ['script', 'settings', 'tap playback and paused controls', 'quick mirror', 'mirror', 'sections', 'fresh prompter resumes playback', 'reload both roles', 'network loss reconnect', 'native transcript forwarding and rereading', 'profiles', 'backup download/import and corrupt file rejection', 'touch lock', 'readiness', 'HTTP wake video and automatic resume', 'system wake lock release and API denial fallback', 'platform contract without WebKit and Android adapter acknowledgements', 'six UI languages during playback and RTL', 'system language and persisted preference', 'localized editor insertion', 'Chinese/Hindi/Arabic voice matching and rereading'] }));
} finally { await browser.close(); }
