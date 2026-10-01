import { t, translateUI } from './i18n.js';
// Shared icons, notifications, QR, dialogs, fullscreen and screen protection.
import { platform } from './platform.js';

const P = {
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  back: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M8 7 3 12l5 5z"/><path d="m16 7 5 5-5 5z"/>',
  flipv: '<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M7 8 12 3l5 5z"/><path d="m7 16 5 5 5-5z"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/>',
  start: '<path d="M6 5v14"/><path d="M19 5 9 12l10 7z"/>',
  prev: '<path d="m15 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h3v4h-3"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h.01M10 6.5h.01"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  live: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  aleft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  acenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  aright: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  ajustify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 16h8"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/><path d="M12 14v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0"/><path d="M12 14v3"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function toast(msg, kind = '') {
  const host = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = 'toast ' + kind;
  node.textContent = t(msg);
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('in'));
  setTimeout(() => { node.classList.remove('in'); setTimeout(() => node.remove(), 400); }, 2600);
}

export function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
const openModals = new Set();
export function closeModals() { for (const close of [...openModals]) close(); }

export function modal(html, { onClose, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog"><button class="modal-x icon-btn" aria-label="Закрыть">${icon('x')}</button>${html}</div>`;
  document.body.appendChild(wrap);
  const releaseTranslation = translateUI(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; openModals.delete(close); releaseTranslation();
    wrap.classList.remove('in');
    setTimeout(() => wrap.remove(), 250);
    document.removeEventListener('keydown', onKey, true);
    onClose && onClose();
  };
  openModals.add(close);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.modal-x').onclick = close;
  return { el: wrap.querySelector('.modal'), close };
}

export function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

export function toggleFullscreen(el = document.documentElement) {
  if (platform.has('fullscreen')) { platform.send('fullscreen'); return; }
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  } else {
    const f = el.requestFullscreen || el.webkitRequestFullscreen;
    if (f) f.call(el).catch?.(() => {});
    else toast(t('Полный экран: «Поделиться» → «На экран Домой»'));
  }
}

export function keepAwake(onChange = () => {}) {
  let lock = null, video = null, dead = false, pending = false, mediaPending = false;
  let nativeFailed = false, retry = 0, reported = null;
  let hostAwake = false;
  const visible = () => !dead && platform.visible;
  const held = () => lock && !lock.released;
  const report = active => {
    if (!dead && active !== reported) { reported = active; onChange(active); }
  };
  const makeVideo = () => {
    if (video) return video;
    video = document.createElement('video');
    video.loop = true; video.playsInline = true; video.preload = 'none';
    video.disablePictureInPicture = true; video.disableRemotePlayback = true;
    // 16×16 at 1 fps with silent audio. Muting disables screen protection on Android.
    video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:.001;pointer-events:none';
    video.setAttribute('aria-hidden', 'true');
    for (const type of ['mp4', 'webm']) {
      const source = document.createElement('source');
      source.src = new URL(`../vendor/keep-awake.${type}`, import.meta.url).href;
      source.type = `video/${type}`;
      video.appendChild(source);
    }
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    document.body.appendChild(video);
    return video;
  };
  const play = () => {
    if (!visible() || held() || mediaPending) return;
    if (video && !video.paused && !video.ended) { report(true); return; }
    const v = makeVideo();
    if (v.error) v.load();
    mediaPending = true;
    v.play().then(() => {
      if (!visible() || held()) v.pause();
      else report(true);
    }).catch(() => { if (!held()) report(false); }).finally(() => { mediaPending = false; });
  };
  const req = async () => {
    if (!visible()) return;
    if (platform.has('screenAwake')) { if (!hostAwake) platform.send('screenAwake', { active: true }); else report(true); return; }
    if (held() || (video && !video.paused)) { report(true); return; }
    if (window.isSecureContext && navigator.wakeLock && !nativeFailed) {
      if (pending) return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (!visible()) { await next.release(); return; }
        lock = next;
        next.addEventListener('release', () => {
          if (lock !== next) return;
          lock = null;
          report(false);
          if (visible()) schedule();
        }, { once: true });
        video?.pause(); report(true);
        return;
      } catch { nativeFailed = true; }
      finally { pending = false; }
    }
    play();
  };
  const schedule = () => {
    clearTimeout(retry);
    if (visible() && !held()) retry = setTimeout(req, 400);
  };
  // Start media in capture phase before fullscreen consumes user activation.
  const touch = () => {
    if (platform.has('screenAwake')) { req(); return; }
    if (held()) return;
    if (nativeFailed || !window.isSecureContext || !navigator.wakeLock || video) play();
    nativeFailed = false; req();
  };
  const onVis = () => {
    if (visible()) { nativeFailed = false; req(); }
    else { clearTimeout(retry); lock?.release().catch(() => {}); video?.pause(); hostAwake = false; if (platform.has('screenAwake')) platform.send('screenAwake', { active: false }); report(false); }
  };
  const onPause = () => { if (visible() && !held()) schedule(); };
  const events = ['pointerup', 'touchend', 'click', 'keydown'];
  events.forEach(type => document.addEventListener(type, touch, true));
  document.addEventListener('visibilitychange', onVis);
  platform.events.addEventListener('visible', onVis);
  document.addEventListener('fullscreenchange', schedule);
  document.addEventListener('webkitfullscreenchange', schedule);
  window.addEventListener('online', req);
  const onHostAwake = e => { hostAwake = e.detail && visible(); report(hostAwake); };
  platform.events.addEventListener('awake', onHostAwake);
  req();
  return () => {
    platform.events.removeEventListener('visible', onVis);
    dead = true; clearTimeout(retry);
    events.forEach(type => document.removeEventListener(type, touch, true));
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('fullscreenchange', schedule);
    document.removeEventListener('webkitfullscreenchange', schedule);
    window.removeEventListener('online', req);
    platform.events.removeEventListener('awake', onHostAwake);
    if (platform.has('screenAwake')) platform.send('screenAwake', { active: false });
    video?.pause(); video?.remove();
    lock?.release().catch(() => {});
  };
}

export function roomUrl(role, code) {
  return `${window.efirNative?.publicOrigin || location.origin}${location.pathname}#/${role}/${code}`;
}

export async function copyText(text, successMessage = 'Ссылка скопирована') {
  try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); toast(t(successMessage)); return; } } catch { /* Clipboard fallback for HTTP. */ }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(el);
  const active = document.activeElement;
  el.focus(); el.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* */ }
  el.remove(); active?.focus();
  toast(ok ? t(successMessage) : text);
}
