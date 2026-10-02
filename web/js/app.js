import { localMode } from './environment.js';
import { platform } from './platform.js';
import { t, translateUI, onLanguageChange, languagePicker, uiLanguage } from './i18n.js';

import { store, newRoomCode, cleanRoom, DEFAULTS } from './store.js';
import { mountController } from './controller.js';
import { mountPrompter } from './prompter.js';
import { icon } from './ui.js';
import { Stage, Engine } from './stage.js';


const app = document.getElementById('app');
let current = null;

function route() {
  if (current && current.destroy) current.destroy();
  current = null;
  app.innerHTML = '';
  document.body.className = '';
  if (localMode && !/^#\/(c|p)\/[A-Za-z0-9]+/.test(location.hash)) { location.hash = platform.role === 'controller' ? '#/c/LOCAL' : '#/p/LOCAL'; return; }
  const m = location.hash.match(/^#\/(c|p)\/([A-Za-z0-9]+)/);
  if (m) {
    const code = localMode ? 'LOCAL' : cleanRoom(m[2]);
    store.setRoom(code);
    const role = localMode ? (platform.role === 'controller' ? 'c' : 'p') : m[1];
    current = role === 'c' ? mountController(app, code) : mountPrompter(app, code);
    if (localMode) document.body.classList.add('is-local');
  } else {
    current = mountHome(app);
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('pageshow', e => { if (e.persisted) route(); });
window.addEventListener('pagehide', () => { if (current && current.destroy) current.destroy(); });

// Home


function mountHome(root) {
  document.body.className = 'is-home';
  let code = store.room() || newRoomCode();
  const el = document.createElement('div');
  el.className = 'home';
  el.innerHTML = `
    <header class="h-bar">
      <span class="wordmark">ЭФИР<span>/суфлёр</span></span>
      <span class="h-meta">веб-приложение · без установки и аккаунтов</span>${languagePicker()}
    </header>
    <main class="h-grid">
      <section class="h-intro">
        <h1>Суфлёр на одном устройстве, пульт&nbsp;— на&nbsp;другом.</h1>
        <p>Откройте сайт на двух устройствах и введите один код. Они соединятся напрямую, по вашей сети: команды доходят за миллисекунды, текст никуда не загружается.</p>
        <div class="demo">
          <div class="demo-head"><span>монитор суфлёра · пример</span><span class="demo-tally">эфир</span></div>
          <div class="demo-screen"></div>
        </div>
      </section>

      <section class="h-panel">
        <div class="h-step"><span class="n">01</span><span>Код комнаты</span></div>
        <div class="room-field">
          <input id="roomInput" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Код комнаты" value="${code}">
          <button class="icon-btn" id="regen" title="Новый код">${icon('refresh')}</button>
        </div>
        <p class="hint">Тот же код введите на втором устройстве. Или отсканируйте QR после входа.</p>

        <div class="h-step"><span class="n">02</span><span>Это устройство</span></div>
        <div class="roles">
          <button class="role" data-role="c">
            <span class="role-k">A</span>
            <span class="role-t"><b>Пульт</b><small>Тексты, настройки, точный предпросмотр. Телефон в руке или ноутбук оператора.</small></span>
            ${icon('arrow')}
          </button>
          <button class="role" data-role="p">
            <span class="role-k">B</span>
            <span class="role-t"><b>Суфлёр</b><small>Экран перед ведущим или под стеклом у камеры. Текст на весь экран.</small></span>
            ${icon('arrow')}
          </button>
        </div>
        <p class="h-download">Есть приложение для macOS, Windows, Linux и Android. <a href="https://fedyalight.github.io/efir/download/" data-download>Скачать приложение</a></p>
      </section>

      <section class="h-notes">
        <div><span class="n">—</span><b>Прямое соединение</b><p>${localMode ? 'Связь через приложение Эфир по локальной сети. Интернет не нужен; компьютер раздаёт сайт и пересылает команды.' : 'WebRTC между устройствами. Сервер лишь сводит их по коду, текст и команды идут напрямую — в одной Wi‑Fi сети по локальной сети.'}</p></div>
        <div><span class="n">—</span><b>Ведение голосом</b><p>Текст едет за речью и возвращается, если ведущий перечитывает фразу.</p></div>
        <div><span class="n">—</span><b>Для стекла</b><p>Отражение и поворот картинки, линия чтения, поля, отсчёт, кликеры презентаций.</p></div>
      </section>
    </main>`;
  root.appendChild(el);
  const releaseTranslation = translateUI(el);
  const download = el.querySelector('[data-download]');
  const updateDownload = () => { download.href = `https://fedyalight.github.io/efir/download/${uiLanguage() === 'en' ? '' : uiLanguage() + '/'}#downloads`; };
  updateDownload();

  // The demo uses the same Stage as the reading screen.
  const stage = new Stage(el.querySelector('.demo-screen'), { fill: true });
  stage.setSettings({ ...DEFAULTS, fontSize: 26, sidePad: 7, topPad: 45, bottomPad: 60, markerPos: 45, showTimer: false, countdown: 0 });
  stage.setScript(t('sample.demo'));
  const engine = new Engine(stage);
  const releaseLanguage = onLanguageChange(() => { stage.setScript(t('sample.demo')); engine.pos = stage.clamp(engine.pos); updateDownload(); });
  engine.speed = 3.2;
  engine.play(0);
  let raf = 0, last = performance.now(), wait = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const loop = (t) => {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (!reduce) {
      if (!engine.playing) { wait += dt; if (wait > 2) { wait = 0; engine.pos = 0; engine.play(0); } }
      engine.step(dt);
    }
    stage.render(engine.snapshot());
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const input = el.querySelector('#roomInput');
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    input.value = cleanRoom(input.value);
    input.setSelectionRange(pos, pos);
  });
  el.querySelector('#regen').onclick = () => {
    input.value = newRoomCode();
    input.classList.remove('flash'); void input.offsetWidth; input.classList.add('flash');
  };
  el.querySelectorAll('.role').forEach(b => b.onclick = () => {
    const c = cleanRoom(input.value);
    if (c.length < 3) { input.focus(); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 500); return; }
    location.hash = `#/${b.dataset.role}/${c}`;
  });
  return { destroy() { releaseTranslation(); releaseLanguage(); cancelAnimationFrame(raf); stage.destroy(); } };
}

if (localMode) await document.fonts?.ready;
route();
