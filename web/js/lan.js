import { t, translateUI, onLanguageChange } from './i18n.js';
import { localMode } from './environment.js';
import { copyText } from './ui.js';
import { probeSignaling } from './rtc.js';

// Help WebRTC expose local host candidates.
//
// Some networks cannot resolve browsers' anonymized mDNS addresses.
// A temporary capture permission can expose host candidates in browsers
// that support this behavior. Stop capture immediately afterwards.

const KEY = 'efir.lan.v1';

export function lanUnlocked() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export async function micPermission() {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    return p.state; // granted | prompt | denied
  } catch { return 'unknown'; }
}

export async function unlockLan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Safari can retain permission without an active microphone.
    s.getTracks().forEach(t => t.stop());
    try { localStorage.setItem(KEY, '1'); } catch { /* */ }
    return true;
  } catch {
    return false;
  }
}

// Inspect the host candidates visible to WebRTC on this device.
export async function diagnose(signal) {
  const res = { host: 'none', srflx: false, relay: false, error: null };
  if (localMode) return { ...res, signaling: { state: 'local' } };
  const signaling = probeSignaling(signal);
  if (typeof RTCPeerConnection !== 'function') {
    res.error = 'WebRTC не поддерживается'; res.signaling = await signaling; return res;
  }
  let pc, timer, cancel;
  try {
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] });
    pc.createDataChannel('probe');
    const done = new Promise((resolve) => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      cancel = finish;
      timer = setTimeout(finish, 4000);
      if (signal?.aborted) { finish(); return; }
      signal?.addEventListener('abort', finish, { once: true });
      pc.onicecandidate = (e) => {
        if (!e.candidate) { finish(); return; }
        const c = e.candidate.candidate;
        const addr = c.split(' ')[4] || '';
        if (/ typ host/.test(c)) {
          if (addr.endsWith('.local')) { if (res.host === 'none') res.host = 'mdns'; }
          else if (!addr.includes(':')) res.host = 'ip';   // IPv4 host candidate.
          else if (res.host !== 'ip') res.host = 'ipv6';
        }
        if (/ typ srflx/.test(c)) res.srflx = true;
        if (/ typ relay/.test(c)) res.relay = true;
      };
    });
    if (!signal?.aborted) await pc.setLocalDescription(await pc.createOffer());
    await done;
  } catch (e) {
    res.error = String(e && e.message || e);
  } finally {
    pc?.close();
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
  res.signaling = await signaling;
  return res;
}

export function describe(d, state, connected = false) {
  const lines = [];
  if (state) {
    lines.push(state.signaling ? ['ok', 'Сервер знакомства подключён'] : ['bad', 'Нет связи с сервером знакомства']);
    const iceFailed = state.channels.some(c => c.ice === 'failed') || state.lastIce === 'failed'
      || ['connection-timeout', 'webrtc', 'negotiation-failed'].includes(state.error);
    const failed = iceFailed || !!state.error;
    lines.push(connected ? ['ok', 'Связь со вторым устройством установлена']
      : !state.signaling ? ['bad', 'Второе устройство нельзя найти, пока сервер знакомства недоступен']
      : state.channels.length && !iceFailed ? ['wait', 'Устанавливаю канал WebRTC — ожидаю ответ второго устройства…']
      : failed ? ['bad', 'Канал со вторым устройством не установлен']
      : ['wait', 'Ожидаю второе устройство — проверьте ссылку и код на обоих устройствах']);
    if (!connected && state.signaling && iceFailed && !state.relay) lines.push(['warn', 'Резервный сервер TURN не настроен. Если сеть блокирует прямой канал, веб-версия не соединится. Попробуйте локальное приложение Эфир.']);
    if (state.configError) lines.push(['warn', 'Не удалось загрузить настройки соединения — используются стандартные STUN-серверы']);
    if (state.error) lines.push(['bad', `${t('Ошибка соединения')}: ${state.error}${state.lastIce ? ` (ICE: ${state.lastIce})` : ''}`]);
  }
  if (!d) return lines;
  if (d.signaling && d.signaling.state !== 'cancelled') {
    lines.push(d.signaling.state === 'connected' ? ['ok', 'Проверка WebSocket: сервер знакомства отвечает']
      : d.signaling.state === 'rejected' ? ['bad', 'Проверка WebSocket: сервер не принял подключение. Проверьте ключ и настройки сервера.']
      : ['bad', 'Проверка WebSocket: нет ответа сервера знакомства. Возможны блокировка адреса, фильтрация соединений или сбой сервиса.']);
  }
  lines.push(['warn', 'Проверки адресов ниже относятся только к этому устройству и не подтверждают связь со вторым.']);
  lines.push(d.host === 'ip' ? ['ok', 'Локальный адрес этого устройства виден браузеру']
    : d.host === 'mdns' ? ['warn', 'Локальный адрес скрыт браузером (.local) — нажмите «Разрешить поиск в локальной сети»']
    : d.host === 'ipv6' ? ['warn', 'Виден только IPv6-адрес — нажмите «Разрешить поиск в локальной сети»']
    : ['bad', 'Локальный адрес не найден — устройство не в сети или WebRTC заблокирован']);
  lines.push(d.srflx ? ['ok', 'Внешний адрес получен (STUN работает)'] : ['warn', 'Внешний адрес не получен — STUN недоступен или проверка не успела завершиться']);
  if (d.error) lines.push(['bad', d.error]);
  return lines;
}

// Connection help shared by the controller and reader.
export function mountLanHelp(host, room, isConnected, { eager = true, always = false } = {}) {
  if (localMode) return { update() {}, destroy() {} };
  const box = document.createElement('div');
  box.className = 'lan-help';
  box.innerHTML = `
    <div class="lan-txt">
      <b>Устройства не видят друг друга напрямую?</b>
      <p>Если браузер скрывает локальный адрес, разрешение микрофона может помочь соединиться. Запись сразу останавливается. Это не гарантирует связь: сеть может блокировать прямые соединения. <b>Сделайте это на обоих устройствах.</b></p>
    </div>
    <div class="lan-act">
      <button class="pill-btn accent" data-lan="unlock">Разрешить поиск в локальной сети</button>
      <button class="pill-btn" data-lan="diag">Диагностика</button>
      <button class="pill-btn" data-lan="copy" hidden>Скопировать диагностику</button>
    </div>
    <ul class="lan-diag"></ul>`;
  host.appendChild(box);
  const releaseTranslation = translateUI(box);
  const diagEl = box.querySelector('.lan-diag');
  let unlockedNow = false, autoTried = false;
  const started = Date.now();

  let probe, probeAbort, checking = false, disposed = false, shown = false, lastRender = '';
  const copyBtn = box.querySelector('[data-lan="copy"]');
  const paintDiag = () => {
    if (!shown || disposed) return;
    const lines = describe(probe, room.diagnostics(), isConnected());
    if (checking) lines.push(['wait', 'Проверяю…']);
    const translated = lines.map(([status, source]) => [status, t(source)]);
    const signature = JSON.stringify(translated);
    if (signature === lastRender) return;
    lastRender = signature;
    diagEl.replaceChildren(...translated.map(([status, text]) => {
      const li = document.createElement('li');
      li.dataset.s = status; li.textContent = text; return li;
    }));
  };
  const renderDiag = async () => {
    if (checking || disposed) return;
    shown = true; checking = true; probe = undefined; copyBtn.hidden = false; copyBtn.disabled = true; paintDiag();
    probeAbort = new AbortController();
    probe = await diagnose(probeAbort.signal); checking = false; copyBtn.disabled = false; paintDiag();
  };
  copyBtn.onclick = () => copyText(JSON.stringify({
    site: location.origin + location.pathname,
    time: new Date().toISOString(), browser: navigator.userAgent,
    room: room.diagnostics(), probe,
  }, null, 2), 'Диагностика скопирована');

  box.querySelector('[data-lan="unlock"]').onclick = async () => {
    const ok = await unlockLan();
    if (ok) {
      unlockedNow = true;
      room.restart();
      renderDiag();
    } else {
      shown = true; probe = { host: 'none', srflx: false, error: 'Доступ не выдан. Разрешите микрофон для этого сайта в настройках браузера и нажмите ещё раз.' };
      copyBtn.hidden = false; paintDiag();
    }
    update();
  };
  box.querySelector('[data-lan="diag"]').onclick = renderDiag;

  async function update() {
    if (disposed) return;
    paintDiag();
    const connected = isConnected();
    const failing = room.status === 'nop2p' || (eager && !connected && Date.now() - started > 9000);
    box.classList.toggle('show', always || (!connected && failing));
    box.classList.toggle('done', unlockedNow);
    const btn = box.querySelector('[data-lan="unlock"]');
    btn.textContent = unlockedNow ? t('Разрешено здесь ✓ — теперь на втором устройстве') : t('Разрешить поиск в локальной сети');
    // Reuse an existing microphone permission.
    if (!connected && failing && !autoTried && !unlockedNow) {
      autoTried = true;
      if (await micPermission() === 'granted' && await unlockLan()) { unlockedNow = true; room.restart(); update(); }
    }
  }
  const timer = setInterval(update, 1500);
  const onStatus = () => update();
  room.addEventListener('status', onStatus);
  update();
  const releaseLanguage = onLanguageChange(update);
  return { update, destroy() { disposed = true; probeAbort?.abort(); releaseTranslation(); releaseLanguage(); clearInterval(timer); room.removeEventListener('status', onStatus); box.remove(); } };
}
