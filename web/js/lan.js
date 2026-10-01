import { t, translateUI, onLanguageChange } from './i18n.js';
import { localMode } from './environment.js';

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
export async function diagnose() {
  const res = { host: 'none', srflx: false, relay: false, error: null };
  if (typeof RTCPeerConnection !== 'function') { res.error = 'WebRTC не поддерживается'; return res; }
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] });
  try {
    pc.createDataChannel('probe');
    const done = new Promise((resolve) => {
      const t = setTimeout(resolve, 4000);
      pc.onicecandidate = (e) => {
        if (!e.candidate) { clearTimeout(t); resolve(); return; }
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
    await pc.setLocalDescription(await pc.createOffer());
    await done;
  } catch (e) {
    res.error = String(e && e.message || e);
  } finally {
    pc.close();
  }
  return res;
}

export function describe(d) {
  const lines = [];
  lines.push(d.host === 'ip' ? ['ok', 'Локальный адрес виден — прямое соединение в Wi‑Fi возможно']
    : d.host === 'mdns' ? ['warn', 'Локальный адрес скрыт браузером (.local) — нажмите «Разрешить поиск в локальной сети»']
    : d.host === 'ipv6' ? ['warn', 'Виден только IPv6-адрес — нажмите «Разрешить поиск в локальной сети»']
    : ['bad', 'Локальный адрес не найден — устройство не в сети или WebRTC заблокирован']);
  lines.push(d.srflx ? ['ok', 'Внешний адрес получен (STUN работает)'] : ['warn', 'Внешний адрес не получен — сеть блокирует UDP/STUN']);
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
      <p>Браузер скрывает адрес этого устройства в локальной сети. Разрешите доступ — браузер спросит микрофон: только так сайт может открыть свой локальный адрес. Микрофон сразу выключается. <b>Сделайте это на обоих устройствах.</b></p>
    </div>
    <div class="lan-act">
      <button class="pill-btn accent" data-lan="unlock">Разрешить поиск в локальной сети</button>
      <button class="pill-btn" data-lan="diag">Диагностика</button>
    </div>
    <ul class="lan-diag"></ul>`;
  host.appendChild(box);
  const releaseTranslation = translateUI(box);
  const diagEl = box.querySelector('.lan-diag');
  let unlockedNow = false, autoTried = false;
  const started = Date.now();

  const renderDiag = async () => {
    diagEl.innerHTML = '<li data-s="wait">Проверяю…</li>';
    translateUI(diagEl);
    const d = await diagnose();
    diagEl.innerHTML = describe(d).map(([s, t]) => `<li data-s="${s}">${t}</li>`).join('');
    translateUI(diagEl);
  };

  box.querySelector('[data-lan="unlock"]').onclick = async () => {
    const ok = await unlockLan();
    if (ok) {
      unlockedNow = true;
      room.restart();
      renderDiag();
    } else {
      diagEl.innerHTML = '<li data-s="bad">Доступ не выдан. Разрешите микрофон для этого сайта в настройках браузера и нажмите ещё раз.</li>';
      translateUI(diagEl);
    }
    update();
  };
  box.querySelector('[data-lan="diag"]').onclick = renderDiag;

  async function update() {
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
  return { update, destroy() { releaseTranslation(); releaseLanguage(); clearInterval(timer); room.removeEventListener('status', onStatus); box.remove(); } };
}
