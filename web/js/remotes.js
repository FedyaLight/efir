// Device-local input bindings. HID keyboards need no device permission.
import { t } from './i18n.js';
import { modal } from './ui.js';

const KEY = 'efir.remotes.v1';
const ACTIONS = {
  toggle: 'Пуск / пауза', faster: 'Быстрее', slower: 'Медленнее', next: 'Следующий раздел',
  prev: 'Предыдущий раздел', start: 'В начало', forward: 'Прокрутка вперёд', back: 'Прокрутка назад',
  fontUp: 'Увеличить шрифт', fontDown: 'Уменьшить шрифт', mirror: 'Зеркало',
  fullscreen: 'Полный экран', voice: 'Ведение голосом', editor: 'Редактор / эфир', none: 'Не выполнять действие',
};
const DEFAULT = {
  'code:Space': 'toggle', 'code:Enter': 'toggle', 'code:KeyB': 'toggle', 'key:.': 'toggle',
  'code:ArrowUp': 'faster', 'code:ArrowDown': 'slower', 'code:ArrowRight': 'next',
  'code:ArrowLeft': 'prev', 'code:PageDown': 'next', 'code:PageUp': 'prev', 'code:Home': 'start',
  'code:KeyM': 'mirror', 'code:KeyV': 'voice', 'code:KeyE': 'editor', 'code:KeyF': 'fullscreen',
  'key:+': 'fontUp', 'key:=': 'fontUp', 'key:-': 'fontDown', 'key:_': 'fontDown',
  'key:MediaPlayPause': 'toggle', 'key:MediaTrackNext': 'next', 'key:MediaTrackPrevious': 'prev',
};
const REPEAT = new Set(['faster', 'slower', 'fontUp', 'fontDown']);
const HELD = new Set(['forward', 'back']);
const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tokenFor = e => e.code && e.code !== 'Unidentified' ? 'code:' + e.code : 'key:' + e.key;
const label = token => token.replace(/^(code:|key:)/, '').replace(/^Key/, '').replace(/^pad:button:/, 'Gamepad #').replace(/^pad:axis:/, 'Gamepad axis ');

export function mountRemotes(handlers) {
  let config = { bindings: {}, gamepad: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') {
      config.gamepad = saved.gamepad === true;
      for (const [token, action] of Object.entries(saved.bindings || {}).slice(0, 100)) {
        if (/^(code:|key:|pad:button:|pad:axis:)/.test(token) && token.length < 100 && Object.hasOwn(ACTIONS, action)) config.bindings[token] = action;
      }
    }
  } catch { /* Input works even without storage. */ }
  const pressed = new Map();
  let dialog = null, learning = null, raf = 0, padArmed = false, dead = false;
  const available = action => action === 'none' || typeof handlers[action] === 'function';
  const bindings = () => ({ ...DEFAULT, ...config.bindings });
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* */ }
  }
  function stop(token) {
    const prior = pressed.get(token);
    if (prior && HELD.has(prior.action)) handlers[prior.action]?.(false);
    pressed.delete(token);
  }
  function release() { for (const token of [...pressed.keys()]) stop(token); padArmed = false; }
  function fire(token, action) {
    if (!available(action) || action === 'none') return false;
    const now = performance.now(), prior = pressed.get(token);
    if (prior && (!REPEAT.has(action) || now - prior.at < 120)) return true;
    pressed.set(token, { action, at: now });
    handlers[action](true);
    return true;
  }
  function learn(token) {
    config.bindings[token] = learning; learning = null; save(); renderDialog();
  }
  function onKey(e) {
    if (e.defaultPrevented || e.isComposing || e.key === 'Process' || e.key === 'Dead' || e.ctrlKey || e.metaKey || e.altKey) return;
    const token = tokenFor(e);
    if (learning) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); learning = null; renderDialog(); return; }
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) learn(token);
      return;
    }
    if (document.querySelector('.modal-wrap') || e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button,a,[role="button"]')) return;
    const all = bindings();
    const keyToken = 'key:' + e.key;
    const selected = Object.hasOwn(config.bindings, token) ? token : Object.hasOwn(config.bindings, keyToken) ? keyToken
      : Object.hasOwn(DEFAULT, keyToken) ? keyToken : token;
    const action = all[selected];
    if (!action || !available(action)) return;
    e.preventDefault();
    // A repeat arriving after focus was lost must not retrigger a toggle.
    if (e.repeat && !REPEAT.has(action)) return;
    fire(token, action);
  }
  const onUp = e => stop(tokenFor(e));
  const onHidden = () => { if (document.hidden) release(); };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onUp, true);
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('blur', release);

  // Explicit opt-in: axes/buttons vary by hardware, so learn rather than guess.
  function poll() {
    raf = 0;
    if (dead || !config.gamepad || document.hidden) return;
    const signals = new Set();
    let padCount = 0, padError = typeof navigator.getGamepads !== 'function';
    if (!document.hasFocus()) { release(); raf = requestAnimationFrame(poll); return; }
    if (document.hasFocus()) {
      try {
        for (const pad of navigator.getGamepads?.() || []) {
          if (!pad?.connected) continue;
          padCount++;
          pad.buttons.forEach((b, i) => { if (b.pressed || b.value > .6) signals.add('pad:button:' + i); });
          pad.axes.forEach((v, i) => { if (Math.abs(v) > .65) signals.add('pad:axis:' + i + (v > 0 ? '+' : '-')); });
        }
      } catch { padError = true; }
    }
    const status = dialog?.el.querySelector('.remote-pad-status');
    if (status) status.textContent = t(padError ? 'Gamepad недоступен в этом браузере. Используйте режим клавиатуры.' : 'Gamepad: {count}. Для обнаружения нажмите кнопку на подключённом пульте.', { count: padCount });
    if (!padArmed) { if (!signals.size) padArmed = true; }
    else {
      for (const token of [...pressed.keys()]) if (token.startsWith('pad:') && !signals.has(token)) stop(token);
      for (const token of signals) {
        if (learning && !pressed.has(token)) { pressed.set(token, { action: 'none', at: performance.now() }); learn(token); break; }
        if (!document.querySelector('.modal-wrap') && !document.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) fire(token, bindings()[token]);
      }
    }
    raf = requestAnimationFrame(poll);
  }
  const startPoll = () => { if (!raf && config.gamepad && !dead && !document.hidden) raf = requestAnimationFrame(poll); };
  document.addEventListener('visibilitychange', startPoll);
  startPoll();

  function renderDialog() {
    if (!dialog) return;
    const body = dialog.el.querySelector('.remote-body');
    body.innerHTML = `<p class="muted">${t('Настройки пульта сохраняются только на этом устройстве. Подключите USB или Bluetooth пульт в режиме клавиатуры.')}</p>
      <label class="chk"><input type="checkbox" class="remote-gamepad" ${config.gamepad ? 'checked' : ''}>${t('Включить кнопки и оси Gamepad')}</label>
      <p class="remote-pad-status muted" role="status"></p>
      <p class="remote-learn" role="status">${learning ? t('Нажмите кнопку пульта. Escape — отмена.') : t('Выберите действие и назначьте ему кнопку пульта.')}</p>
      <div class="remote-actions">${Object.entries(ACTIONS).filter(([a]) => available(a)).map(([action, name]) => `<div class="remote-row">
        <span>${t(name)}</span><button class="pill-btn" data-learn="${action}">${t('Назначить кнопку')}</button>
        <div class="remote-bindings">${Object.entries(bindings()).filter(([, a]) => a === action).map(([token]) => `<button class="link-btn" data-unbind="${esc(token)}" title="${t('Убрать назначение')}"><kbd>${esc(label(token))}</kbd> ×</button>`).join('')}</div></div>`).join('')}</div>
      <button class="pill-btn" data-remote-reset>${t('Сбросить назначения')}</button>
      <p class="fine">${t('Пульт работает, пока это окно активно. Фирменные пульты без режима клавиатуры или Gamepad требуют приложения производителя. Медиаклавиши могут перехватываться системой.')}</p>`;
    body.querySelector('.remote-gamepad').onchange = e => { release(); config.gamepad = e.target.checked; save(); cancelAnimationFrame(raf); raf = 0; startPoll(); };
    body.querySelectorAll('[data-learn]').forEach(b => b.onclick = () => { release(); learning = b.dataset.learn; renderDialog(); });
    body.querySelectorAll('[data-unbind]').forEach(b => b.onclick = () => { release(); config.bindings[b.dataset.unbind] = 'none'; save(); renderDialog(); });
    body.querySelector('[data-remote-reset]').onclick = () => { release(); config = { bindings: {}, gamepad: false }; learning = null; save(); renderDialog(); };
  }
  return {
    open() {
      if (dialog) return;
      release();
      dialog = modal(`<h2>${t('Пульты и кнопки')}</h2><div class="remote-body"></div>`, { onClose: () => { learning = null; release(); dialog = null; } });
      renderDialog();
    },
    destroy() {
      dead = true; release(); dialog?.close(); cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onUp, true);
      document.removeEventListener('visibilitychange', onHidden); document.removeEventListener('visibilitychange', startPoll);
      window.removeEventListener('blur', release);
    },
  };
}
