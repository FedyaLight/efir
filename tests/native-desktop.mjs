// Exercise the native WebView and IPC in a separate OS test profile.
import assert from 'node:assert/strict';
const driver = process.env.EFIR_DRIVER || 'http://localhost:4444';
let session = process.env.EFIR_DRIVER_SESSION;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(driver + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const { value } = await r.json();
  if (value?.error) throw new Error(`${value.error}: ${value.message}`);
  return value;
}
if (!session) session = (await request('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: process.env.EFIR_APP || '/usr/bin/efir' } } } })).sessionId;
const command = (path, body, method) => request(`/session/${session}${path}`, body, method);
const script = (source, ...args) => command('/execute/sync', { script: source, args });
const asyncScript = (source, ...args) => command('/execute/async', { script: source, args });
async function until(source, detail) {
  for (let i = 0; i < 100; i++) { if (await script(source)) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('timeout: ' + detail);
}
try {
  await until('return !!document.querySelector(".ctl")', 'controller loaded');
  const info = await script('return { platform: window.efirNative.platform, role: window.efirNative.role, url: location.href, peer: typeof window.Peer }');
  assert.equal(info.role, 'controller'); assert.equal(info.peer, 'undefined');
  assert.match(info.url, /^http:\/\/localhost:\d+\/#\/c\/LOCAL$/);
  const native = action => asyncScript('const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke("native", {message:arguments[0]}).then(()=>done(true),e=>done(String(e)));', action);
  assert.equal(await native({ action: 'fullscreen' }), true);
  await until('return window.efirNative && document.documentElement.clientWidth > 0', 'fullscreen resize');
  assert.equal(await asyncScript('const done=arguments[arguments.length-1]; import("./js/platform.js").then(({platform})=>done(platform.fullscreen));'), true, 'native fullscreen acknowledgement');
  assert.equal(await native({ action: 'fullscreen' }), true);
  assert.equal(await asyncScript('const done=arguments[arguments.length-1]; import("./js/platform.js").then(({platform})=>done(platform.fullscreen));'), false);
  await script('const select=document.querySelector(".ui-language");select.value="es";select.dispatchEvent(new Event("change",{bubbles:true}));');
  await until('return [...document.querySelectorAll("[data-a=connect]")].some(el=>el.textContent.includes("Conectar"))', 'language updates interface');
  await command('/refresh', {});
  await until('return document.querySelector(".ui-language")?.value === "es"', 'native language survives reload');
  await script('document.querySelector("[data-a=voice]").click();');
  await until('return !!document.querySelector(".toast.bad")', 'missing offline model has actionable message');
  assert.match(await script('return document.querySelector(".toast.bad").textContent'), /Vosk/);
  assert.equal(await native({ action: 'voiceStop' }), true);
  const rejected = await native({ action: 'selectAddress', address: '127.0.0.1' });
  assert.match(rejected, /hardware LAN/, 'QR cannot be redirected to loopback or VPN');
  await script('const select=document.querySelector(".ui-language");select.value="en";select.dispatchEvent(new Event("change",{bubbles:true}));');
  if (process.env.EFIR_LAN_URL) {
    // Compare actual WebKitGTK and Chromium at matching viewport dimensions.
    const { chromium }=await import('../work/testing/node_modules/playwright/index.mjs');
    const browser=await chromium.launch({headless:true});
    let max=0;
    try {
      const phone=await browser.newPage({viewport:{width:844,height:390}});
      await phone.goto(process.env.EFIR_LAN_URL+'/#/p/LOCAL');
      await until('return !!document.querySelector(".ctl.has-prompter")','phone connected to native controller');
      await script('document.querySelector("[data-a=manual]").click();const input=document.querySelector("[data-k=fontSize] input");input.value="44";input.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("[data-view=live]").click();');
      for (const viewport of [{width:844,height:390},{width:390,height:844}]) {
      await phone.setViewportSize(viewport);
      await until(`return document.querySelector('.stage').offsetWidth===${viewport.width} && document.querySelector('.stage').offsetHeight===${viewport.height}`,'native preview follows phone viewport');
      for (const sentence of ['Мы проверяем шрифт суфлёра и совпадение положения слов.','We check the teleprompter font and the exact position of every word.','今天我们检查提词器的字体和同步位置。','नमस्कार आज हम टेलीप्रॉम्प्टर के पाठ और स्थान की जाँच करते हैं।','مرحباً نتحقق اليوم من النص والخط وموضع الكلمات في الملقّن.']) {
        const text=(sentence+'\n\n').repeat(28);
        await script('document.querySelector("[data-view=edit]").click();const input=document.querySelector(".ed-text");input.value=arguments[0];input.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("[data-view=live]").click();',text);
        await phone.waitForFunction(sentence=>document.querySelector('.text')?.textContent.includes(sentence),sentence);
        await asyncScript('const done=arguments[arguments.length-1];document.fonts.ready.then(()=>done(true));');
        await phone.evaluate(()=>document.fonts.ready);
        await new Promise(r=>setTimeout(r,350));
        const positions='return [...document.querySelectorAll(".text .w")].map(el=>[el.offsetTop,el.offsetLeft,el.offsetHeight]);';
        assert.deepEqual(await script('return [document.querySelector(".stage").offsetWidth,document.querySelector(".stage").offsetHeight];'),await phone.locator('.stage').evaluate(el=>[el.offsetWidth,el.offsetHeight]));
        const controllerWords=await script(positions);
        const phoneWords=await phone.evaluate(()=>[...document.querySelectorAll('.text .w')].map(el=>[el.offsetTop,el.offsetLeft,el.offsetHeight]));
        assert.equal(controllerWords.length,phoneWords.length);
        for(let i=0;i<controllerWords.length;i++) for(let coordinate=0;coordinate<3;coordinate++) max=Math.max(max,Math.abs(controllerWords[i][coordinate]-phoneWords[i][coordinate]));
        if(max>2) console.log(JSON.stringify({sentence,controller:controllerWords.slice(0,24),phone:phoneWords.slice(0,24),controllerStyle:await script('const el=document.querySelector(".text");const s=getComputedStyle(el);return {font:s.font,line:s.lineHeight,width:el.offsetWidth,dir:s.direction,fonts:[...document.fonts].filter(f=>f.status==="loaded").map(f=>f.family)};'),phoneStyle:await phone.locator('.text').evaluate(el=>{const s=getComputedStyle(el);return {font:s.font,line:s.lineHeight,width:el.offsetWidth,dir:s.direction,fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family)}})}));
        assert.ok(max<=2,`cross-renderer geometry drift ${max}px`);
      }
      }
      console.log(JSON.stringify({result:'PASS WebKitGTK/Chromium Russian, English, Chinese, Hindi and Arabic geometry at landscape and portrait sizes',maxErrorPx:max}));
    } finally {await browser.close();}
  }
  console.log(JSON.stringify({ result: 'PASS native controller startup, real IPC/fullscreen, language persistence, offline-model guidance, LAN address guard', ...info }));
} finally { await command('', undefined, 'DELETE'); }
