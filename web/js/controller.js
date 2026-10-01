import { t, translateUI, onLanguageChange, languagePicker, countLabel } from './i18n.js';
import { FrameLoop } from './frames.js';
import { localMode, nativeVoice, hostName } from './environment.js';
import { platform } from './platform.js';
import { captureSession, restoreSession } from './session.js';

// Controller: library, editor, preview and settings. Its engine follows
// the reading screen, preserving matching layout and smooth scrolling.

import { store, DEFAULTS, THEMES, FONTS, newScript, wordCount, uid } from './store.js';
import { Stage, Engine, fmt } from './stage.js';
import { Room } from './net.js';
import { VoiceTracker, voiceSupported } from './voice.js';
import { relayout } from './prompter.js';
import { mountLanHelp } from './lan.js';
import { icon, toast, qrSvg, modal, closeModals, loadScript, roomUrl, copyText } from './ui.js';

const LAYOUT_KEYS = ['fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing', 'uppercase', 'sidePad', 'topPad', 'bottomPad', 'markerPos', 'align'];

const FORMATS = [
  { id: '1280x720', label: '16:9 · монитор', w: 1280, h: 720 },
  { id: '1180x820', label: 'iPad горизонтально', w: 1180, h: 820 },
  { id: '820x1180', label: 'iPad вертикально', w: 820, h: 1180 },
  { id: '844x390', label: 'Телефон горизонтально', w: 844, h: 390 },
  { id: '390x844', label: 'Телефон вертикально', w: 390, h: 844 },
];

const LANGS = [
  ['ru-RU', 'Русский'], ['uk-UA', 'Українська'], ['be-BY', 'Беларуская'], ['kk-KZ', 'Қазақ'],
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['de-DE', 'Deutsch'], ['fr-FR', 'Français'],
  ['es-ES', 'Español'], ['it-IT', 'Italiano'], ['pt-BR', 'Português'], ['pl-PL', 'Polski'], ['tr-TR', 'Türkçe'],
  ['zh-CN', '中文'], ['hi-IN', 'हिन्दी'], ['ar-SA', 'العربية'],
];

const ORIENTS = [
  ['0-0', 'Обычно', 'none'],
  ['1-0', 'Зеркало ↔', 'scaleX(-1)'],
  ['0-1', 'Зеркало ↕', 'scaleY(-1)'],
  ['1-1', 'Поворот 180°', 'rotate(180deg)'],
];

const GROUPS = [
  { id: 'basic', title: 'Основные', items: [] },
  { id: 'text', title: 'Текст', items: [
    ['fontSize', 'range', { label: 'Размер', min: 16, max: 240, step: 1, unit: 'px' }],
    ['fontFamily', 'select', { label: 'Шрифт', options: FONTS.map(f => [f.id, f.label]) }],
    ['fontWeight', 'seg', { label: 'Насыщенность', options: [[300, 'Лёгкий'], [500, 'Средний'], [700, 'Жирный']] }],
    ['lineHeight', 'range', { label: 'Межстрочный', min: 1, max: 2.4, step: 0.05, fmt: v => v.toFixed(2) }],
    ['letterSpacing', 'range', { label: 'Расстояние между буквами', min: -0.04, max: 0.2, step: 0.005, unit: '%', fmt: v => (v * 100).toFixed(1) }],
    ['align', 'seg', { label: 'Выравнивание', options: [['left', icon('aleft')], ['center', icon('acenter')], ['right', icon('aright')], ['justify', icon('ajustify')]] }],
    ['uppercase', 'toggle', { label: 'Все заглавные' }],
  ] },
  { id: 'margins', title: 'Поля', items: [
    ['sidePad', 'range', { label: 'По бокам', min: 0, max: 35, step: 0.5, unit: '%' }],
    ['topPad', 'range', { label: 'Сверху до текста', min: 0, max: 100, step: 1, unit: '%' }],
    ['bottomPad', 'range', { label: 'Снизу после текста', min: 0, max: 150, step: 1, unit: '%' }],
  ] },
  { id: 'marker', title: 'Линия чтения', items: [
    ['marker', 'toggle', { label: 'Показывать линию' }],
    ['markerPos', 'range', { label: 'Положение', min: 5, max: 95, step: 1, unit: '%' }],
    ['markerStyle', 'seg', { label: 'Вид', options: [['band', 'Полоса'], ['line', 'Линия'], ['arrows', 'Стрелки']] }],
    ['markerColor', 'color', { label: 'Цвет линии' }],
    ['fade', 'toggle', { label: 'Затемнять края экрана' }],
  ] },
  { id: 'colors', title: 'Цвета', items: [
    ['theme', 'themes', {}],
    ['textColor', 'color', { label: 'Текст' }],
    ['bgColor', 'color', { label: 'Фон' }],
    ['accentColor', 'color', { label: 'Акцент и разделы' }],
    ['noteColor', 'color', { label: 'Заметки [ ]' }],
  ] },
  { id: 'screen', title: 'Экран суфлёра', items: [
    ['orient', 'orient', { label: 'Ориентация картинки' }],
    ['countdown', 'seg', { label: 'Отсчёт перед стартом', options: [[0, 'Нет'], [3, '3 с'], [5, '5 с'], [10, '10 с']] }],
    ['showProgress', 'toggle', { label: 'Полоса прогресса' }],
    ['showTimer', 'toggle', { label: 'Таймер' }],
    ['touchLock', 'toggle', { label: 'Защита от касаний при чтении' }],
  ] },
  { id: 'voice', title: 'Голос', items: [
    ...(localMode ? [] : [['voiceDevice', 'seg', { label: 'Чей микрофон слушать', options: [['prompter', 'Суфлёра'], ['controller', 'Пульта']] }]]),
    ['voiceLang', 'select', { label: 'Язык речи', options: LANGS }],
    ['dimRead', 'toggle', { label: 'Приглушать прочитанное' }],
  ] },
];
for (const key of ['fontSize', 'fontFamily', 'sidePad', 'markerPos', 'orient', 'countdown']) {
  for (const group of GROUPS.slice(1)) {
    const i = group.items.findIndex(item => item[0] === key);
    if (i >= 0) {
      const [item] = group.items.splice(i, 1);
      if (key === 'markerPos') item[2].label = 'Положение линии чтения';
      if (key === 'sidePad') item[2].label = 'Боковые поля';
      GROUPS[0].items.push(item);
    }
  }
}
const PRESETS = [
  { id: 'glass', name: 'Телефон в стекле', settings: { ...DEFAULTS, mirrorH: true } },
  { id: 'tablet', name: 'Планшет', settings: { ...DEFAULTS, fontSize: 80, sidePad: 10 } },
];

export function mountController(root, code) {
  document.body.className = 'is-controller';
  let settings = store.settings();
  let scripts = store.scripts();
  let cur = scripts.find(s => s.id === store.currentId()) || scripts[0];
  let fmtId = localStorage.getItem('efir.fmt') || '1280x720';
  let showMirror = false;
  let remote = null;          // Latest state from the primary reader.
  let primary = null;         // Primary reader ID.
  let holdUntil = 0;          // Ignore stale state briefly after a local command.
  let seekHold = 0;
  let localVoiceState = 'off';
  let sessionEstablished = false;
  let lastTranscript = '';
  let lastNativeActive = null;
  const pendingSync = new Map(), readiness = new Map();

  const readerActions = platform.has('showPrompter') ? `<div class="local-reader-actions">
    <button class="pill-btn accent" data-a="read" title="Полный экран">${icon('fullscreen')}<span>Читать здесь</span></button>
    <button class="icon-btn" data-a="mirror" title="Зеркало ↔" aria-label="Зеркало ↔" aria-pressed="false">${icon('mirror')}</button>
  </div>` : '';
  const el = document.createElement('div');
  el.className = 'ctl';
  el.dataset.view = 'live';
  el.innerHTML = `
  <header class="ctl-top">
    <a class="wordmark" href="#" title="На главную">ЭФИР<span>/пульт</span></a>
    <button class="room-chip" data-a="connect" title="Подключить устройства">
      <span class="rc-label">КОМН</span><span class="rc-code">${code}</span>
      <span class="rc-sep"></span><i class="dot"></i><span class="st">Суфлёр не подключён</span>
    </button>
    <div class="top-r">
      ${languagePicker()}
      ${platform.has('standalone') ? '' : `<button class="pill-btn accent" data-a="connect">${icon('qr')}<span>Подключить суфлёр</span></button>`}
      ${localMode ? '' : `<button class="icon-btn" data-a="window" title="Суфлёр в новом окне (второй монитор)">${icon('window')}</button>`}
      <button class="icon-btn hide-sm" data-a="keys" title="Горячие клавиши">${icon('keyboard')}</button>
    </div>
  </header>

  <aside class="lib panel">
    <div class="panel-h">
      <h3>Тексты</h3>
      <div class="panel-actions">
        <button class="icon-btn" data-a="backup" title="Резервная копия библиотеки" aria-label="Резервная копия библиотеки">${icon('download')}</button>
        <label class="icon-btn" title="Импорт .txt .md .docx">${icon('upload')}<input type="file" accept=".txt,.md,.docx,.text,text/plain" hidden class="imp"></label>
        <button class="icon-btn" data-a="new" title="Новый текст">${icon('plus')}</button>
      </div>
    </div>
    <div class="lib-list"></div>
    <div class="panel-h sub"><h3>Разделы</h3><span class="muted sec-count"></span></div>
    <div class="sec-list"></div>
  </aside>

  <main class="center">
    <div class="tabs" role="tablist">
      <button data-view="live">Эфир</button>
      <button data-view="edit">Текст</button>
    </div>

    <section class="pane-live">
      <div class="lan-slot"></div>
      <div class="preview-box">
        <div class="monitor">
          <div class="preview-frame">
            <div class="preview-scale"></div>
            <div class="preview-hint">тяните текст, чтобы прокрутить</div>
          </div>
          <div class="mv-label"><span class="pm-dev"></span><span class="mv-tally"></span></div>
        </div>
      </div>
      <div class="preview-meta">
        <select class="pm-fmt" title="Формат предпросмотра без суфлёра">${FORMATS.map(f => `<option value="${f.id}">${f.label}</option>`).join('')}</select>
        <label class="chk" title="Показать картинку так, как её выводит монитор суфлёра — с отражением"><input type="checkbox" class="pm-mirror"><span>как на мониторе (с отражением)</span></label>
      </div>
      <div class="device-ready" role="status"></div>
      ${readerActions}

      <div class="scrub">
        <div class="scrub-track"><div class="scrub-ticks"></div><div class="scrub-fill"></div><div class="scrub-knob"></div></div>
        <div class="scrub-times"><span class="t-el">0:00</span><span class="t-sec"></span><span class="t-rm">−0:00</span></div>
      </div>

      <div class="transport">
        <div class="tk"><button class="icon-btn lg" data-a="start" title="В начало (Home)">${icon('start')}</button><span>начало</span></div>
        <div class="tk"><button class="icon-btn lg" data-a="prev" title="Предыдущий раздел (←)">${icon('prev')}</button><span>раздел</span></div>
        <div class="tk"><button class="play-btn xl" data-a="toggle" title="Пуск / пауза (пробел)"><i class="led"></i>${icon('play', 'i-play')}${icon('pause', 'i-pause')}<span class="cd-num"></span></button><span class="play-l"></span></div>
        <div class="tk"><button class="icon-btn lg" data-a="next" title="Следующий раздел (→)">${icon('next')}</button><span>раздел</span></div>
      </div>

      <div class="reading-mode seg" aria-label="Режим чтения">
        <button data-a="manual">${icon('play')}<span>С заданной скоростью</span></button>
        <button data-a="voice" class="voice-btn" title="Ведение голосом (V)">${icon('mic')}<span>За голосом</span></button>
      </div>

      <div class="speed-row">
        <button class="icon-btn" data-a="slower" title="Медленнее (↓)">${icon('minus')}</button>
        <div class="speed-box">
          <input type="range" class="speed-range" min="0.1" max="12" step="0.1" aria-label="Скорость прокрутки">
          <div class="speed-val"><small>≈ слов/мин</small><b>130</b></div>
        </div>
        <button class="icon-btn" data-a="faster" title="Быстрее (↑)">${icon('plus')}</button>
        <div class="nudge">
          <button class="icon-btn" data-nudge="-1" title="Удерживать — назад">${icon('up')}</button>
          <button class="icon-btn" data-nudge="1" title="Удерживать — вперёд">${icon('down')}</button>
        </div>
      </div>
      <div class="voice-status"><i></i><span></span></div>
      <div class="voice-transcript" aria-live="polite"></div>
    </section>

    <section class="pane-edit">
      <input class="ed-title" placeholder="Название" maxlength="120" dir="auto">
      <div class="ed-tools">
        <button data-ins="sec" title="Раздел">${icon('list')}<span>Раздел</span></button>
        <button data-ins="note" title="Заметка для ведущего — не читается">[ ]<span>Заметка</span></button>
        <button data-ins="bold" title="Выделить"><b>Ж</b><span>Акцент</span></button>
        <span class="grow"></span>
        <button data-a="export" title="Скачать .txt">${icon('download')}<span>.txt</span></button>
      </div>
      <textarea class="ed-text" spellcheck="true" dir="auto" placeholder="Вставьте или напишите текст. Перетащите сюда файл .txt, .md или .docx.

# Раздел — строка с решёткой
[Заметка для ведущего]
**Акцент**"></textarea>
      <div class="ed-foot"><span class="ed-stats"></span><span class="ed-live"><i></i>правки сразу уходят на суфлёр</span></div>
      ${readerActions}
    </section>
  </main>

  <aside class="settings panel">
    <div class="panel-h"><h3>Настройки</h3><button class="link-btn" data-a="reset">Сбросить</button></div>
    <div class="profile-row"><select class="profile-select" aria-label="Профиль настроек"></select>
      <button class="icon-btn sm" data-a="profile-save" title="Сохранить профиль" aria-label="Сохранить профиль">${icon('plus')}</button>
      <button class="icon-btn sm" data-a="profile-delete" title="Удалить выбранный профиль" aria-label="Удалить выбранный профиль">${icon('trash')}</button></div>
    <div class="set-body"></div>
  </aside>

  <nav class="mnav">
    <button data-view="live"><span>Эфир</span></button>
    <button data-view="edit"><span>Текст</span></button>
    <button data-view="lib"><span>Тексты</span></button>
    <button data-view="set"><span>Настройки</span></button>
  </nav>`;
  root.appendChild(el);
  if (platform.has('navigation')) el.querySelector('.wordmark').onclick = e => { e.preventDefault(); platform.send('back'); };
  const releaseTranslation = translateUI(el);
  const $ = (s) => el.querySelector(s);

  // Preview
  const scaleHost = $('.preview-scale');
  const stage = new Stage(scaleHost);
  stage.setShowMirror(false);
  stage.setSettings(settings);
  stage.setScript(cur.text);
  const engine = new Engine(stage);
  let frames;
  engine.speed = store.speed();

  const box = $('.preview-box'), frame = $('.preview-frame');
  let scale = 1;
  function fitPreview() {
    const [vw, vh] = viewport();
    stage.setViewport(vw, vh);
    const bw = box.clientWidth, bh = box.clientHeight - 30;
    if (!bw || !bh) return;
    scale = Math.min(bw / vw, bh / vh);
    frame.style.width = vw * scale + 'px';
    frame.style.height = vh * scale + 'px';
    scaleHost.style.transform = `scale(${scale})`;
    const p = primaryInfo();
    $('.pm-dev').innerHTML = p
      ? `<b>${escapeHtml(p.name || t('Суфлёр'))}</b><span>${vw}×${vh}</span>`
      : `<b>${t('Нет суфлёра')}</b><span>${vw}×${vh}</span>`;
    el.classList.toggle('has-prompter', !!p);
  }
  const previewObserver = new ResizeObserver(fitPreview);
  previewObserver.observe(box);

  function viewport() {
    const p = primaryInfo();
    if (p && p.vw && p.vh) return [p.vw, p.vh];
    const f = FORMATS.find(f => f.id === fmtId) || FORMATS[0];
    return [f.w, f.h];
  }
  function primaryInfo() {
    if (!primary) return null;
    const m = room.members.get(primary);
    if (!m) return null;
    return { ...(m.hello || {}), ...(remote || {}) };
  }

  $('.pm-fmt').value = fmtId;
  $('.pm-fmt').onchange = (e) => { fmtId = e.target.value; localStorage.setItem('efir.fmt', fmtId); relayout(stage, engine, fitPreview); };
  $('.pm-mirror').onchange = (e) => { showMirror = e.target.checked; stage.setShowMirror(showMirror); };

  // Networking
  const room = new Room(code, 'controller', () => ({ name: platform.native ? platform.name : t('Пульт') }));

  function pickPrimary() {
    const ps = room.peersOf('prompter');
    if (primary && ps.some(p => p.id === primary)) return;
    const prev = primary;
    primary = ps.length ? ps[0].id : null;
    remote = null;
    if (prev !== primary) relayout(stage, engine, fitPreview);
  }

  function renderStatus() {
    const ps = room.peersOf('prompter');
    const link = room.linkInfo();
    let txt, s;
    if (ps.length) {
      const p = primaryInfo() || {};
      const local = ps.some(x => x.local && Date.now() - x.local < 8000);
      const route = local ? t('это же устройство') : link && link.route === 'lan' ? 'LAN' : link && link.route === 'relay' ? t('через релей') : link && link.route ? 'P2P' : '';
      txt = `${ps.length > 1 ? countLabel(ps.length, 'prompters') : (p.name || t('Суфлёр'))}${route ? ' · ' + route : ''}${link && link.rtt != null && !local ? ' · ' + t('{rtt} мс', { rtt: link.rtt }) : ''}`;
      s = 'ok';
    } else {
      txt = room.status === 'offline' ? (localMode ? t('Нет связи с приложением — переподключаюсь…') : t('Нет интернета для рукопожатия'))
        : room.status === 'nop2p' ? t('Прямое соединение не удалось — повторяю…') : t('Суфлёр не подключён');
      s = room.status === 'offline' || room.status === 'nop2p' ? 'bad' : 'wait';
    }
    el.querySelectorAll('.room-chip .dot').forEach(d => d.dataset.s = s);
    $('.room-chip .st').textContent = txt;
    if (connectModal) renderConnectDevices();
    renderReady();
    const active = ps.length > 0;
    if (platform.has('sessionAwake') && active !== lastNativeActive) { lastNativeActive = active; platform.send('sessionActive', { active }); }
  }

  const hasPrompter = () => room.peersOf('prompter').length > 0;
  const lanHelp = mountLanHelp($('.lan-slot'), room, hasPrompter, { eager: false });
  room.addEventListener('status', renderStatus);
  room.addEventListener('link', renderStatus);
  room.addEventListener('join', (e) => {
    if (e.detail.role === 'prompter') {
      const offered = room.peersOf('prompter').find(p => p.id === e.detail.id)?.hello?.session;
      const sid = cur.id + ':' + cur.updated;
      const initial = !sessionEstablished && offered?.sid === sid ? offered : captureSession(stage, engine, sid);
      pickPrimary();
      fitPreview();
      if (!sessionEstablished && offered?.sid === sid) {
        restoreSession(stage, engine, offered);
        tracker.setPosition(engine.voiceIdx);
        if (engine.mode === 'voice' && settings.voiceDevice === 'controller') tracker.start(settings.voiceLang);
      }
      sessionEstablished = true;
      // Send a new reader the settings, script and session.
      const tag = uid(); pendingSync.set(e.detail.id, tag);
      room.send('settings', { s: settings, to: e.detail.id });
      sendScript(e.detail.id);
      room.send('session', { to: e.detail.id, tag, state: { ...initial, voiceState: localVoiceState } });
      if (!e.detail.again) toast(t('Суфлёр подключён'), 'ok');
      fitPreview();
    }
    renderStatus();
  });
  room.addEventListener('leave', (e) => {
    if (e.detail.role === 'prompter') {
      pendingSync.delete(e.detail.id); readiness.delete(e.detail.id);
      if (e.detail.id === primary) { primary = null; pickPrimary(); fitPreview(); toast(t('Суфлёр отключился')); }
    }
    renderStatus();
  });

  let lastScriptPush = 0;
  room.addEventListener('message', (e) => {
    const m = e.detail;
    if (m.role !== 'prompter') return;
    if (m.t === 'control' && (m.c === 'play' || m.c === 'pause')) { cmd(m.c); return; }
    if (m.t === 'mirror' && typeof m.value === 'boolean') { set('mirrorH', m.value); return; }
    if (m.t === 'readiness') { readiness.set(m.from, m.ready); renderReady(); if (connectModal) renderConnectDevices(); return; }
    if (m.t === 'transcript' && m.from === primary && settings.voiceDevice === 'prompter') { showTranscript(m.text); return; }
    if ((m.t === 'hello' || m.t === 'presence') && m.from === primary) {
      const [vw, vh] = [stage.w, stage.h];
      if (m.vw && m.vh && (m.vw !== vw || m.vh !== vh)) relayout(stage, engine, fitPreview);
    }
    if (m.t !== 'state') return;
    if (pendingSync.has(m.from)) {
      if (pendingSync.get(m.from) !== m.sync) return;
      pendingSync.delete(m.from);
    }
    if (!primary) pickPrimary();
    if (m.from !== primary) return;
    if (m.sid !== cur.id + ':' + cur.updated) { if (performance.now() - lastScriptPush > 2500) sendScript(m.from); return; }
    const sizeChanged = !remote || remote.vw !== m.vw || remote.vh !== m.vh;
    remote = m;
    if (sizeChanged) relayout(stage, engine, fitPreview);

    const now = performance.now();
    if (now > holdUntil) {
      engine.playing = m.playing;
      engine.speed = m.speed;
      engine.cd = m.cd;
      if (m.mode !== engine.mode) {
        engine.mode = m.mode;
        if (localMode && nativeVoice && m.mode === 'voice' && !tracker.active) { tracker.setPosition(m.voiceIdx); tracker.start(settings.voiceLang); }
        if (m.mode !== 'voice') stage.setRead(-1);
      }
    }
    if (engine.mode === 'voice' && settings.voiceDevice === 'prompter') engine.voiceIdx = m.voiceIdx;
    if (now > seekHold) {
      const link = room.linkInfo();
      const lat = link && link.rtt != null ? link.rtt / 2000 : 0.01;
      const ahead = m.playing && m.cd <= 0 && m.mode !== 'voice' ? stage.pxPerSec(m.speed) * lat : 0;
      const target = m.pos + ahead;
      const d = target - engine.pos;
      if (Math.abs(d) > stage.h * 0.4) engine.pos = target;
      else engine.pos += d * 0.35;
      if (engine.target != null && Math.abs(engine.target - target) < 2) engine.target = null;
    }
    frames?.request();
    // Resend the current script if a reader reports a stale version.
    const sid = cur.id + ':' + cur.updated;
    if (m.sid !== sid && now - lastScriptPush > 2500) { lastScriptPush = now; sendScript(); }
  });

  function sendScript(to) {
    lastScriptPush = performance.now();
    const sc = { id: cur.id, title: cur.title, text: cur.text, updated: cur.updated };
    const CH = 24000;
    if (sc.text.length <= CH) { room.send('script', { script: sc, to }); return; }
    const n = Math.ceil(sc.text.length / CH);
    for (let i = 0; i < n; i++) room.send('scriptPart', { id: sc.id, upd: sc.updated, title: sc.title, i, n, to, chunk: sc.text.slice(i * CH, (i + 1) * CH) });
  }

  // Commands
  function cmd(c, m = {}) {
    sessionEstablished = true;
    if ((c === 'toggle' || c === 'pause') && engine.mode === 'voice') { voiceToggle(); return; }
    holdUntil = performance.now() + 450;
    switch (c) {
      case 'toggle': engine.toggle(settings.countdown); break;
      case 'play': engine.play(settings.countdown); break;
      case 'pause': engine.pause(); break;
      case 'start': engine.pause(); seekLocal(0, true); m = {}; break;
      case 'speed': engine.speed = clampSpeed(m.v); m.v = engine.speed; store.saveSpeed(engine.speed); break;
      case 'nudge': engine.nudge = m.v; break;
      case 'section': {
        const p = m.k != null ? stage.posForSection(m.k) : stage.sectionStep(engine.pos, m.dir);
        seekLocal(p, true);
        break;
      }
    }
    room.send('cmd', { c, ...m });
    frames?.request();
    updateTransport(true);
  }
  const clampSpeed = (v) => Math.round(Math.max(0.1, Math.min(20, v)) * 10) / 10;

  function seekLocal(p, smooth) {
    seekHold = performance.now() + (smooth ? 700 : 400);
    engine.seek(p, smooth);
    if (engine.mode === 'voice') {
      engine.voiceIdx = stage.wordAt(stage.clamp(p));
      tracker.setPosition(engine.voiceIdx);
    }
    frames?.request();
  }
  let seekSendT = 0, seekPending = null;
  function seekRemote(p, smooth = false) {
    sessionEstablished = true;
    seekLocal(p, smooth);
    const cp = stage.clamp(p);
    seekPending = { c: 'seek', pos: cp, word: stage.wordAt(cp), vw: stage.w, vh: stage.h, smooth };
    const now = performance.now();
    if (now - seekSendT > 30) flushSeek();
    else setTimeout(flushSeek, 30);
  }
  function flushSeek() {
    if (!seekPending) return;
    seekSendT = performance.now();
    room.send('cmd', seekPending);
    seekPending = null;
  }

  // Voice
  const tracker = new VoiceTracker({
    onTranscript: showTranscript,
    onIndex: (i) => {
      engine.voiceIdx = i; frames?.request();
      room.send('cmd', { c: 'voiceIdx', i });
    },
    onState: (s) => { localVoiceState = s; frames?.request(); if (localMode) room.send('cmd', { c: 'voiceState', state: s }); if (s === 'denied') toast(t('Нет доступа к микрофону'), 'bad'); },
  });
  tracker.setWords(stage.words);
  function showTranscript(text) {
    const next = String(text || '').slice(-200);
    if (next === lastTranscript) return;
    lastTranscript = next;
    $('.voice-transcript').textContent = next ? t('Распознано: «{text}»', { text: next }) : '';
  }

  function voiceToggle() {
    const on = engine.mode !== 'voice';
    sessionEstablished = true;
    if (on && localMode && !nativeVoice) { toast(platform.native ? t('В этой версии приложения голос недоступен. Используйте прокрутку с заданной скоростью.') : t('Для голоса откройте пульт в приложении Эфир: микрофон телефона недоступен по HTTP.'), 'bad'); return; }
    if (on && settings.voiceDevice === 'controller' && !voiceSupported) {
      toast(t('Этот браузер не распознаёт речь. Попробуйте Chrome, Edge или Safari.'), 'bad');
      return;
    }
    holdUntil = performance.now() + 800;
    if (on) {
      engine.pause();
      engine.mode = 'voice';
      engine.voiceIdx = stage.wordAt(engine.pos);
      tracker.setPosition(engine.voiceIdx);
      if (settings.voiceDevice === 'controller') tracker.start(settings.voiceLang);
    } else {
      engine.mode = 'scroll';
      engine.target = null;
      tracker.stop();
      showTranscript('');
      stage.setRead(-1);
    }
    room.send('cmd', { c: 'voice', on, idx: engine.voiceIdx });
    frames?.request();
    if (on && !room.peersOf('prompter').length && settings.voiceDevice === 'prompter') {
      toast(t('Суфлёр не подключён — слушаю микрофон пульта'));
      set('voiceDevice', 'controller');
      if (voiceSupported) tracker.start(settings.voiceLang);
    }
    updateTransport(true);
  }

  // Playback controls
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || !el.contains(b)) return;
    const a = b.dataset.a;
    if (a === 'toggle' || a === 'start') cmd(a);
    else if (a === 'prev') cmd('section', { dir: -1 });
    else if (a === 'next') cmd('section', { dir: 1 });
    else if (a === 'slower') cmd('speed', { v: engine.speed - 0.2 });
    else if (a === 'faster') cmd('speed', { v: engine.speed + 0.2 });
    else if (a === 'voice' && engine.mode !== 'voice') voiceToggle();
    else if (a === 'manual' && engine.mode === 'voice') voiceToggle();
    else if (a === 'connect') { if (!platform.has('standalone')) openConnect(); }
    else if (a === 'read') platform.send('showPrompter');
    else if (a === 'mirror') set('mirrorH', !settings.mirrorH);
    else if (a === 'window') openWindow();
    else if (a === 'keys') openKeys();
    else if (a === 'new') addScript(newScript(), true);
    else if (a === 'export') exportScript(cur);
    else if (a === 'backup') openBackup();
    else if (a === 'profile-save') saveProfile();
    else if (a === 'profile-delete') {
      const id = $('.profile-select').value;
      if (store.profiles().some(p => p.id === id) && confirm(t('Удалить этот профиль настроек?'))) { store.deleteProfile(id); renderProfiles(); }
    }
    else if (a === 'reset') {
      if (confirm(t('Вернуть все настройки по умолчанию?'))) { settings = { ...DEFAULTS, voiceLang: settings.voiceLang }; commitSettings(true); renderSettings(); }
    }
  });

  const speedRange = $('.speed-range');
  speedRange.addEventListener('input', () => cmd('speed', { v: +speedRange.value }));

  el.querySelectorAll('[data-nudge]').forEach(b => {
    const dir = +b.dataset.nudge;
    const stop = () => { if (engine.nudge) cmd('nudge', { v: 0 }); };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      cmd('nudge', { v: dir * settings.fontSize * settings.lineHeight * 3.5 });
    });
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', stop);
    b.addEventListener('lostpointercapture', stop);
  });

  // Drag the preview to seek.
  let drag = null;
  frame.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, pos: engine.pos, id: e.pointerId, moved: false };
    frame.setPointerCapture(e.pointerId);
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dy = (e.clientY - drag.y) / scale * (showMirror && settings.mirrorV ? -1 : 1);
    if (!drag.moved && Math.abs(dy) * scale > 4) { drag.moved = true; frame.classList.add('dragging'); }
    if (drag.moved) seekRemote(drag.pos - dy);
  });
  const endDrag = () => { drag = null; frame.classList.remove('dragging'); flushSeek(); };
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);
  frame.addEventListener('wheel', (e) => { e.preventDefault(); seekRemote(engine.pos + e.deltaY / scale * 0.8); }, { passive: false });

  // Progress bar
  const track = $('.scrub-track');
  let scrubbing = false;
  const scrubTo = (e) => {
    const r = track.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    seekRemote(f * stage.max);
  };
  track.addEventListener('pointerdown', (e) => { scrubbing = true; track.setPointerCapture(e.pointerId); scrubTo(e); });
  track.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e); });
  track.addEventListener('pointerup', () => { scrubbing = false; flushSeek(); });

  // Keyboard and presentation remotes
  const onKey = (e) => {
    if (e.target.closest('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]')) return;
    if (document.querySelector('.modal-wrap')) return;
    const k = e.key;
    if (k === ' ' || k === 'b' || k === 'B' || k === '.') { e.preventDefault(); cmd('toggle'); }
    else if (k === 'ArrowUp') { e.preventDefault(); cmd('speed', { v: engine.speed + 0.2 }); }
    else if (k === 'ArrowDown') { e.preventDefault(); cmd('speed', { v: engine.speed - 0.2 }); }
    else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); cmd('section', { dir: 1 }); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); cmd('section', { dir: -1 }); }
    else if (k === 'Home') { e.preventDefault(); cmd('start'); }
    else if (k === 'v' || k === 'V' || k === 'м' || k === 'М') voiceToggle();
    else if (k === 'm' || k === 'M' || k === 'ь' || k === 'Ь') set('mirrorH', !settings.mirrorH);
    else if (k === 'e' || k === 'E' || k === 'у' || k === 'У') setView(el.dataset.view === 'edit' ? 'live' : 'edit');
    else if (k === '=' || k === '+') set('fontSize', Math.min(240, settings.fontSize + 4));
    else if (k === '-' || k === '_') set('fontSize', Math.max(16, settings.fontSize - 4));
  };
  document.addEventListener('keydown', onKey);

  // Tabs
  function setView(v) {
    el.dataset.view = v;
    el.querySelectorAll('[data-view]').forEach(b => { if (b.tagName === 'BUTTON') b.classList.toggle('on', b.dataset.view === v); });
    if (v === 'live') requestAnimationFrame(fitPreview);
    if (v === 'edit') syncEditor();
  }
  el.querySelectorAll('button[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  setView('live');

  // Library
  function renderLib() {
    const list = $('.lib-list');
    list.innerHTML = scripts.slice().sort((a, b) => b.updated - a.updated).map(s => {
      const wc = wordCount(s.text);
      return `<div class="lib-item ${s.id === cur.id ? 'on' : ''}" data-id="${s.id}" tabindex="0">
        <div class="li-main"><b>${escapeHtml(s.title || t('Без названия'))}</b>
        <span>${countLabel(wc, 'words')} · ≈ ${fmt(wc / 130 * 60)}</span></div>
        <div class="li-act">
          <button class="icon-btn sm" data-la="dup" title="${t('Копия')}">${icon('copy')}</button>
          <button class="icon-btn sm" data-la="del" title="${t('Удалить')}">${icon('trash')}</button>
        </div>
      </div>`;
    }).join('');
  }
  $('.lib-list').addEventListener('click', (e) => {
    const item = e.target.closest('.lib-item');
    if (!item) return;
    const s = scripts.find(x => x.id === item.dataset.id);
    const act = e.target.closest('[data-la]');
    if (act && act.dataset.la === 'dup') { addScript({ ...newScript(s.title + t(' (копия)'), s.text) }, false); return; }
    if (act && act.dataset.la === 'del') {
      if (!confirm(t('Удалить «{title}»?', { title: s.title }))) return;
      scripts = scripts.filter(x => x.id !== s.id);
      if (!scripts.length) scripts.push(newScript());
      store.saveScripts(scripts);
      if (s.id === cur.id) selectScript(scripts[0]);
      else renderLib();
      return;
    }
    selectScript(s);
    if (matchMedia('(max-width: 900px)').matches) setView('live');
  });

  function selectScript(s) {
    sessionEstablished = true;
    cur = s;
    store.setCurrentId(s.id);
    engine.pause();
    stage.setScript(s.text);
    tracker.setWords(stage.words);
    engine.pos = 0; engine.target = null;
    if (engine.mode === 'voice') { engine.voiceIdx = 0; tracker.setPosition(0); }
    sendScript();
    room.send('cmd', { c: 'seek', pos: 0, word: 0, vw: stage.w, vh: stage.h });
    renderLib(); renderSections(); syncEditor();
  }
  function addScript(s, edit) {
    scripts.push(s);
    store.saveScripts(scripts);
    selectScript(s);
    if (edit) { setView('edit'); $('.ed-title').select(); }
  }

  // Import
  async function importFile(file) {
    try {
      let text;
      if (/\.docx$/i.test(file.name)) {
        if (!window.mammoth) await loadScript('vendor/mammoth.browser.min.js');
        const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        text = r.value;
      } else {
        text = await file.text();
      }
      text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      addScript(newScript(file.name.replace(/\.[^.]+$/, ''), text), false);
      toast(t('Импортировано: {name}', { name: file.name }), 'ok');
    } catch {
      toast(t('Не удалось прочитать файл'), 'bad');
    }
  }
  $('.imp').addEventListener('change', (e) => { [...e.target.files].forEach(importFile); e.target.value = ''; });
  el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', (e) => { if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); [...e.dataTransfer.files].forEach(importFile); });

  function exportScript(s) {
    download(s.text, (s.title || t('текст')).replace(/[\\/:*?"<>|]/g, '') + '.txt', 'text/plain;charset=utf-8');
  }
  function download(text, name, type) {
    if (platform.has('exportFile')) { platform.send('exportFile', { text, name, type }); return; }
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function openBackup() {
    const dialog = modal(`<h2>Резервная копия библиотеки</h2><p class="muted">Один файл с текстами, настройками и вашими профилями. Его можно перенести на другой компьютер. Аудио и адреса устройств в копию не входят.</p>
      <div class="backup-actions"><button class="pill-btn" data-b="save">${icon('download')}<span>Сохранить копию</span></button>
      <label class="pill-btn">${icon('upload')}<span>Восстановить из файла</span><input class="backup-file" type="file" accept=".json,application/json" hidden></label></div>
      <p class="fine">При восстановлении существующие тексты сохранятся. Настройки заменятся настройками из файла.</p>`);
    dialog.el.querySelector('[data-b="save"]').onclick = () => {
      store.saveScripts(scripts);
      const snapshot = { ...store.backup(), scripts, currentId: cur.id, settings, speed: engine.speed };
      download(JSON.stringify(snapshot, null, 2), `${t('brand.name')}-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      dialog.close();
    };
    dialog.el.querySelector('.backup-file').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error(t('Файл копии слишком большой: максимум 20 МБ.'));
        const data = JSON.parse(await file.text());
        if (!el.isConnected) return;
        if (!confirm(t('Восстановить тексты и настройки из копии? Текущие тексты останутся в библиотеке.'))) return;
        clearTimeout(edTimer); clearTimeout(saveTimer); store.saveScripts(scripts);
        store.restoreBackup(data);
        if (engine.mode === 'voice') voiceToggle();
        scripts = store.scripts(); settings = store.settings(); engine.speed = store.speed();
        cur = scripts.find(s => s.id === store.currentId()) || scripts[0];
        commitSettings(true); selectScript(cur); cmd('speed', { v: engine.speed }); renderSettings(); renderProfiles();
        dialog.close(); toast(t('Библиотека восстановлена'), 'ok');
      } catch (error) { toast(error.message || t('Не удалось восстановить копию'), 'bad'); }
      finally { e.target.value = ''; }
    };
  }

  function renderProfiles(selected = '') {
    const profiles = store.profiles();
    $('.profile-select').innerHTML = `<option value="">${t('Профиль настроек…')}</option>` + PRESETS.map(p => ({ ...p, name: t(p.name) })).concat(profiles).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    $('.profile-select').value = selected;
    $('[data-a="profile-delete"]').disabled = !profiles.some(p => p.id === selected);
  }
  $('.profile-select').onchange = e => {
    const profile = PRESETS.concat(store.profiles()).find(p => p.id === e.target.value);
    if (!profile) return;
    if (engine.mode === 'voice') voiceToggle();
    settings = { ...DEFAULTS, ...profile.settings, ...(localMode ? { voiceDevice: 'controller' } : {}) };
    commitSettings(true); refreshControls(); renderProfiles(profile.id);
    toast(t('Профиль «{name}» применён', { name: PRESETS.includes(profile) ? t(profile.name) : profile.name }), 'ok');
  };
  function saveProfile() {
    const dialog = modal(`<h2>Сохранить профиль</h2><p class="muted">Размер, поля, отражение и остальные настройки будут доступны одним выбором.</p><form class="profile-form"><input aria-label="Название профиля" placeholder="Например: телефон в моём суфлёре" maxlength="40" required><button class="pill-btn" type="submit">Сохранить</button></form>`);
    const input = dialog.el.querySelector('input'); input.focus();
    dialog.el.querySelector('form').onsubmit = e => {
      e.preventDefault(); const name = input.value.trim(); if (!name) return;
      try { store.saveProfile(name, settings); renderProfiles(store.profiles().find(p => p.name === name).id); dialog.close(); toast(t('Профиль сохранён'), 'ok'); }
      catch (error) { toast(error.message, 'bad'); }
    };
  }

  // Sections
  let curSec = -2;
  function renderSections() {
    const ss = stage.sections;
    $('.sec-count').textContent = ss.length || '';
    $('.sec-list').innerHTML = ss.length
      ? ss.map((s, k) => `<button class="sec-item" data-k="${k}"><i>${String(k + 1).padStart(2, '0')}</i><span>${escapeHtml(s.title)}</span></button>`).join('')
      : `<p class="muted pad">${t('Добавьте строки вида # Название, чтобы быстро прыгать по тексту.')}</p>`;
    curSec = -2;
    renderTicks();
  }
  $('.sec-list').addEventListener('click', (e) => {
    const b = e.target.closest('.sec-item');
    if (b) cmd('section', { k: +b.dataset.k });
  });
  function renderTicks() {
    stage.measure();
    $('.scrub-ticks').innerHTML = stage.max
      ? stage.sections.map((_, k) => `<i style="left:${(stage.posForSection(k) / stage.max * 100).toFixed(2)}%"></i>`).join('')
      : '';
  }

  // Editor
  const edTitle = $('.ed-title'), edText = $('.ed-text');
  function syncEditor() {
    if (document.activeElement !== edTitle) edTitle.value = cur.title;
    if (document.activeElement !== edText) edText.value = cur.text;
    renderStats();
  }
  function renderStats() {
    const wc = wordCount(cur.text);
    const dur = stage.max / stage.pxPerSec(engine.speed);
    $('.ed-stats').textContent = t('{words} · {characters} · ≈ {spoken} вслух · {duration} на скорости {speed}', { words: countLabel(wc, 'words'), characters: countLabel(cur.text.length, 'characters'), spoken: fmt(wc / 130 * 60), duration: fmt(dur), speed: engine.speed.toFixed(1) });
  }
  let edTimer = 0, saveTimer = 0;
  const saveBeforeHide = () => {
    if (!platform.visible) { clearTimeout(saveTimer); store.saveScripts(scripts); }
  };
  document.addEventListener('visibilitychange', saveBeforeHide);
  platform.events.addEventListener('visible', saveBeforeHide);
  function onEdit() {
    cur.updated = Date.now();
    clearTimeout(edTimer);
    edTimer = setTimeout(() => {
      relayout(stage, engine, () => stage.setScript(cur.text));
      tracker.setWords(stage.words);
      renderSections(); renderStats();
      sendScript();
    }, 250);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { store.saveScripts(scripts); renderLib(); }, 500);
  }
  edText.addEventListener('input', () => { cur.text = edText.value; onEdit(); });
  edTitle.addEventListener('input', () => { cur.title = edTitle.value; onEdit(); });

  el.querySelectorAll('[data-ins]').forEach(b => b.addEventListener('click', () => {
    const input = edText, a = input.selectionStart, z = input.selectionEnd, v = input.value, sel = v.slice(a, z);
    let rep, caret;
    if (b.dataset.ins === 'sec') {
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      if (v.slice(ls, ls + 2) === '# ') return;
      input.setRangeText('# ', ls, ls, 'end');
      caret = a + 2;
      input.setSelectionRange(caret, caret);
    } else {
      const [o, c] = b.dataset.ins === 'note' ? ['[', ']'] : ['**', '**'];
      rep = o + (sel || (b.dataset.ins === 'note' ? t('пауза') : t('акцент'))) + c;
      input.setRangeText(rep, a, z, 'select');
    }
    input.focus();
    cur.text = input.value; onEdit();
  }));

  // Settings
  let sendSetT = 0, sendSetPending = false;
  function commitSettings(layout) {
    store.saveSettings(settings);
    if (layout) relayout(stage, engine, () => stage.setSettings(settings));
    else stage.setSettings(settings);
    renderTicks();
    const now = performance.now();
    if (now - sendSetT > 50) { sendSetT = now; room.send('settings', { s: settings }); }
    else if (!sendSetPending) {
      sendSetPending = true;
      setTimeout(() => { sendSetPending = false; sendSetT = performance.now(); room.send('settings', { s: settings }); }, 50);
    }
  }
  function set(k, v) {
    const prev = settings[k];
    if (k === 'theme') {
      settings = { ...settings, theme: v, ...stripName(THEMES[v]) };
    } else {
      settings = { ...settings, [k]: v };
      if (['textColor', 'bgColor', 'accentColor', 'noteColor'].includes(k)) settings.theme = 'custom';
    }
    commitSettings(LAYOUT_KEYS.includes(k));
    if (k === 'voiceDevice' && engine.mode === 'voice' && prev !== v) {
      tracker.stop();
      if (v === 'controller') tracker.start(settings.voiceLang);
    }
    if (k === 'voiceLang' && engine.mode === 'voice' && settings.voiceDevice === 'controller') {
      tracker.stop(); tracker.start(v);
    }
    refreshControls();
  }

  function renderSettings() {
    const open = JSON.parse(localStorage.getItem('efir.groups') || '["text","marker","screen"]');
    const groupHtml = g => `
      <details class="grp" data-g="${g.id}" ${open.includes(g.id) ? 'open' : ''}>
        <summary>${g.title}${icon('down')}</summary>
        <div class="grp-body">${g.items.map(renderItem).join('')}${localMode && g.id === 'voice' ? `<p class="hint-s">${t(nativeVoice ? 'Микрофон: {name}. Голос работает без интернета, если установлен язык речи.' : 'Микрофон: {name}. По HTTP микрофон телефона недоступен. Голос работает в приложении Эфир при наличии локального распознавания языка.', { name: escapeHtml(platform.native ? platform.name : hostName) })}</p>${platform.has('speechModels') || platform.has('speechDownload') ? `<button class="pill-btn" data-voice-model>${icon('download')}<span>${t(platform.has('speechModels') ? 'Выбрать офлайн-модель Vosk' : 'Скачать язык речи')}</span></button>` : ''}` : ''}</div>
      </details>`;
    $('.set-body').innerHTML = `<section class="basic-settings"><h3>Основные</h3><div class="grp-body">${GROUPS[0].items.map(renderItem).join('')}</div></section>
      <details class="settings-more" ${localStorage.getItem('efir.advanced') === 'true' ? 'open' : ''}><summary>Дополнительно${icon('down')}</summary>${GROUPS.slice(1).map(groupHtml).join('')}</details>`;
    translateUI($('.set-body'));
    const model = $('.set-body [data-voice-model]');
    if (model) model.onclick = () => { tracker.stop(); platform.send('voiceModel', { lang: settings.voiceLang }); };
    $('.settings-more').addEventListener('toggle', e => localStorage.setItem('efir.advanced', String(e.target.open)));
    $('.set-body').querySelectorAll('details[data-g]').forEach(d => d.addEventListener('toggle', () => {
      const ids = [...$('.set-body').querySelectorAll('details[data-g][open]')].map(x => x.dataset.g);
      localStorage.setItem('efir.groups', JSON.stringify(ids));
    }));
    refreshControls();
  }
  function renderItem([k, type, o]) {
    const def = DEFAULTS[k];
    switch (type) {
      case 'range': return `<div class="ctl-row range" data-k="${k}">
        <label><span>${o.label}</span><output title="${t('Двойной клик — по умолчанию ({value})', { value: def })}"></output></label>
        <input type="range" min="${o.min}" max="${o.max}" step="${o.step}"></div>`;
      case 'select': return `<div class="ctl-row inline" data-k="${k}"><label>${o.label}</label>
        <select>${o.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`;
      case 'seg': return `<div class="ctl-row" data-k="${k}"><label>${o.label}</label>
        <div class="seg sm">${o.options.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div></div>`;
      case 'toggle': return `<label class="ctl-row switch" data-k="${k}"><span>${o.label}</span><input type="checkbox"><i></i></label>`;
      case 'color': return `<label class="ctl-row inline color" data-k="${k}"><span>${o.label}</span><span class="swatch"><input type="color"></span></label>`;
      case 'orient': return `<div class="ctl-row" data-k="orient"><label>${o.label}</label>
        <div class="orient">${ORIENTS.map(([v, l, t]) => `<button data-v="${v}" title="${l}"><span class="og"><i style="transform:${t}">Р</i></span><small>${l}</small></button>`).join('')}</div>
        <p class="hint-s">Посмотрите в стекло и выберите вариант, при котором текст читается нормально. Для большинства суфлёров со стеклом — «Зеркало ↔».</p></div>`;
      case 'themes': return `<div class="themes" data-k="theme">${Object.entries(THEMES).map(([id, t]) =>
        `<button data-v="${id}" style="--t:${t.textColor};--b:${t.bgColor};--a:${t.accentColor}"><span class="th-prev"><b>Аа</b><i></i></span><small>${t.name}</small></button>`).join('')}</div>`;
    }
    return '';
  }
  function refreshControls() {
    el.querySelectorAll('[data-a="mirror"]').forEach(button => {
      button.classList.toggle('on', settings.mirrorH);
      button.setAttribute('aria-pressed', String(settings.mirrorH));
    });
    const body = $('.set-body');
    GROUPS.forEach(g => g.items.forEach(([k, type, o]) => {
      const row = body.querySelector(`[data-k="${k}"]`);
      if (!row) return;
      const v = settings[k];
      if (type === 'orient') { row.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === `${+settings.mirrorH}-${+settings.mirrorV}`)); return; }
      if (type === 'range') {
        const inp = row.querySelector('input');
        if (document.activeElement !== inp) inp.value = v;
        row.querySelector('output').textContent = (o.fmt ? o.fmt(v) : v) + (o.unit || '');
        const pct = (v - o.min) / (o.max - o.min) * 100;
        inp.style.setProperty('--p', pct + '%');
      } else if (type === 'select') row.querySelector('select').value = v;
      else if (type === 'seg' || type === 'themes') row.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', String(v) === b.dataset.v));
      else if (type === 'toggle') row.querySelector('input').checked = !!v;
      else if (type === 'color') { row.querySelector('input').value = v; row.querySelector('.swatch').style.background = v; }
    }));
  }
  const setBody = $('.set-body');
  setBody.addEventListener('input', (e) => {
    const row = e.target.closest('[data-k]'); if (!row) return;
    const k = row.dataset.k;
    if (e.target.type === 'range') set(k, +e.target.value);
    else if (e.target.type === 'color') set(k, e.target.value);
  });
  setBody.addEventListener('change', (e) => {
    const row = e.target.closest('[data-k]'); if (!row) return;
    const k = row.dataset.k;
    if (e.target.type === 'checkbox') set(k, e.target.checked);
    else if (e.target.tagName === 'SELECT') set(k, e.target.value);
  });
  setBody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    const row = b.closest('[data-k]');
    const k = row.dataset.k;
    if (k === 'orient') {
      const [h, v] = b.dataset.v.split('-').map(Number);
      settings = { ...settings, mirrorH: !!h, mirrorV: !!v };
      commitSettings(false); refreshControls();
      return;
    }
    const v = typeof DEFAULTS[k] === 'number' ? +b.dataset.v : b.dataset.v;
    set(k, v);
  });
  setBody.addEventListener('dblclick', (e) => {
    const out = e.target.closest('output'); if (!out) return;
    const k = out.closest('[data-k]').dataset.k;
    set(k, DEFAULTS[k]);
  });

  // Dialogs
  let connectModal = null;
  function openConnect() {
    const url = roomUrl('p', code);
    connectModal = modal(`
      <h2>Подключить суфлёр</h2>
      <p class="muted">${localMode ? t('На телефоне или планшете в той же Wi‑Fi сети отсканируйте QR. Суфлёр откроется сразу; компьютер остаётся пультом.') : t('На устройстве, которое будет показывать текст, откройте этот сайт и выберите «Суфлёр» с кодом комнаты — или просто отсканируйте QR камерой.')}</p>
      <div class="connect-grid">
        <div class="qr-card">${qrSvg(url)}</div>
        <div class="connect-side">
          <div class="big-code">${code.split('').map(c => `<span>${c}</span>`).join('')}</div>
          <button class="pill-btn" data-m="copy">${icon('link')}<span>Скопировать ссылку</span></button>
          ${localMode ? `<p class="connect-address">${escapeHtml(url)}</p>` : ''}
          ${platform.has('networkSettings') && window.efirNative?.addresses?.length > 1 ? `<label class="set-row"><span>${t('Адрес локальной сети')}</span><select data-m="address">${window.efirNative.addresses.map(a => `<option value="${escapeHtml(a.address)}" ${url.includes('//' + a.address + ':') ? 'selected' : ''}>${escapeHtml(a.name)} · ${escapeHtml(a.address)}</option>`).join('')}</select></label>` : ''}
          ${localMode ? '' : `<button class="pill-btn" data-m="win">${icon('window')}<span>Открыть здесь в новом окне</span></button>`}
          <div class="devices"></div>
        </div>
      </div>
      <div class="modal-lan"></div>
      <p class="fine">${localMode ? t('Связь через приложение Эфир по Wi‑Fi. Интернет не нужен. Если включён VPN, разрешите «Доступ к локальной сети / Allow LAN» или исключите браузер из туннеля.') : t('Устройства соединяются напрямую (WebRTC). В одной Wi‑Fi сети данные идут по локальной сети — не через интернет. Интернет нужен только на пару секунд для «знакомства» по коду.')}</p>`,
      { cls: 'connect', onClose: () => { if (connectModal && connectModal.lan) connectModal.lan.destroy(); connectModal = null; } });
    connectModal.el.querySelector('[data-m="copy"]').onclick = () => copyText(url);
    const address = connectModal.el.querySelector('[data-m="address"]');
    if (address) address.onchange = () => platform.send('selectAddress', { address: address.value });
    const win = connectModal.el.querySelector('[data-m="win"]');
    if (win) win.onclick = openWindow;
    const mh = mountLanHelp(connectModal.el.querySelector('.modal-lan'), room, hasPrompter, { always: true });
    connectModal.lan = mh;
    renderConnectDevices();
  }
  function renderConnectDevices() {
    if (!connectModal) return;
    const ps = room.peersOf('prompter');
    const link = room.linkInfo();
    connectModal.el.querySelector('.devices').innerHTML = ps.length
      ? ps.map(p => `<div class="dev"><i class="dot" data-s="ok"></i><b>${escapeHtml((p.hello && p.hello.name) || t('Суфлёр'))}</b><span>${p.hello && p.hello.vw ? p.hello.vw + '×' + p.hello.vh : ''}${p.local ? ' · ' + t('это же устройство') : link && link.route === 'lan' ? ' · LAN' : ''}${link && link.rtt != null && !p.local ? ' · ' + t('{rtt} мс', { rtt: link.rtt }) : ''}</span><span>${escapeHtml(readyText(readiness.get(p.id) || p.hello?.ready))}</span></div>`).join('')
      : `<div class="dev wait"><i class="dot" data-s="wait"></i><span>${t('Ждём суфлёр…')}</span></div>`;
  }
  const onNetwork = () => { if (connectModal) { connectModal.close(); openConnect(); } };
  window.addEventListener('efirnetwork', onNetwork);
  function readyText(ready) {
    if (!ready) return t('Проверяем готовность экрана…');
    if (!ready.visible) return t('Вкладка скрыта — откройте суфлёр');
    return [ready.fullscreen ? t('Полный экран') : t('Полный экран выключен'), ready.awake ? t('Защита экрана активна') : t('Нужно касание для защиты экрана'), ready.locked ? t('Касания заблокированы') : ''].filter(Boolean).join(' · ');
  }
  function renderReady() {
    const ps = room.peersOf('prompter');
    const info = ps.find(p => p.id === primary) || ps[0];
    const text = info ? readyText(readiness.get(info.id) || info.hello?.ready) : t('Подключите телефон по QR. Настройки и текст можно подготовить заранее.');
    if ($('.device-ready').textContent !== text) $('.device-ready').textContent = text;
  }
  function openWindow() {
    const w = window.open(roomUrl('p', code), 'efir-prompter-' + code, 'popup,width=1280,height=760');
    if (!w) toast(t('Браузер заблокировал окно — разрешите всплывающие окна'), 'bad');
  }
  function openKeys() {
    const rows = [
      [t('Пробел · B · .'), t('Пуск / пауза')], ['↑ / ↓', t('Скорость')], ['← / →, PgUp / PgDn', t('Разделы (кликеры презентаций)')],
      ['Home', t('В начало')], ['V', t('Ведение голосом')], ['M', t('Зеркало')], ['+ / −', t('Размер шрифта')], ['E', t('Редактор / эфир')],
    ];
    modal(`<h2>Горячие клавиши</h2><div class="keys">${rows.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
      <p class="fine">Те же клавиши работают на экране суфлёра — можно подключить Bluetooth‑кликер или клавиатуру прямо к нему.</p>`);
  }

  // Drawing
  const playBtn = $('.play-btn'), cdNum = $('.cd-num');
  const tEl = $('.t-el'), tRm = $('.t-rm'), tSec = $('.t-sec'), fill = $('.scrub-fill'), knob = $('.scrub-knob');
  const speedVal = $('.speed-val b'), vStatus = $('.voice-status span');
  let lastUi = '';
  function updateTransport(force) {
    const pps = stage.pxPerSec(engine.speed);
    const f = stage.max ? engine.pos / stage.max : 0;
    fill.style.transform = `scaleX(${f})`;
    knob.style.left = (f * 100) + '%';
    const vState = settings.voiceDevice === 'controller' ? localVoiceState : (remote && remote.voiceState) || 'off';
    const sig = `${engine.playing}|${Math.ceil(engine.cd)}|${engine.mode}|${engine.speed}|${vState}|${Math.round(engine.pos / pps)}|${Math.round((stage.max - engine.pos) / pps)}`;
    if (sig === lastUi && !force) return;
    lastUi = sig;
    el.classList.toggle('playing', engine.playing && engine.cd <= 0);
    el.classList.toggle('counting', engine.cd > 0);
    el.classList.toggle('voice-on', engine.mode === 'voice');
    $('[data-a="manual"]').classList.toggle('on', engine.mode !== 'voice');
    $('[data-a="voice"]').classList.toggle('on', engine.mode === 'voice');
    $('[data-a="manual"]').setAttribute('aria-pressed', String(engine.mode !== 'voice'));
    $('[data-a="voice"]').setAttribute('aria-pressed', String(engine.mode === 'voice'));
    playBtn.disabled = engine.mode === 'voice';
    cdNum.textContent = engine.cd > 0 ? Math.ceil(engine.cd) : '';
    tEl.textContent = fmt(engine.pos / pps);
    tRm.textContent = '−' + fmt((stage.max - engine.pos) / pps);
    const minutes = stage.max / pps / 60;
    const tempo = minutes > 0 ? Math.round(stage.words.length / minutes) : 0;
    speedVal.textContent = tempo || '—';
    speedRange.setAttribute('aria-valuetext', t('Примерно {tempo} слов в минуту', { tempo }));
    $('.speed-val').title = t('Примерный темп для текущего экрана. Скорость прокрутки: {speed}. Длительность: ≈ {duration}', { speed: engine.speed.toFixed(1), duration: fmt(stage.max / pps) });
    if (document.activeElement !== speedRange) speedRange.value = engine.speed;
    speedRange.style.setProperty('--p', ((engine.speed - 0.1) / 11.9 * 100) + '%');
    const vtxt = {
      off: t('Микрофон выключен'), listening: t('Слушаю… начните читать'), hearing: t('Слышу вас — текст идёт за голосом'),
      denied: t('Нет доступа к микрофону'), unsupported: localMode ? t('Распознавание недоступно — проверьте язык и разрешения приложения') : t('Браузер не распознаёт речь'), network: t('Распознаванию нужен интернет'),
    }[vState] || '';
    vStatus.textContent = engine.mode === 'voice' ? `${localMode ? t('Микрофон {name}', { name: platform.native ? platform.name : hostName }) : settings.voiceDevice === 'controller' ? t('Микрофон пульта') : t('Микрофон суфлёра')} · ${vtxt}` : '';
    $('.voice-status').dataset.s = vState;
  }

  frames = new FrameLoop(stage, engine, () => {
    engine.voiceLive = (settings.voiceDevice === 'controller' ? localVoiceState : remote && remote.voiceState) === 'hearing';
    stage.render(engine.snapshot());
    if (engine.mode === 'voice' && settings.dimRead) stage.setRead(engine.voiceIdx);
    else if (stage.readIdx >= 0) stage.setRead(-1);
    updateTransport(false);
    const k = stage.sectionAt(engine.pos);
    if (k !== curSec) {
      curSec = k;
      el.querySelectorAll('.sec-item').forEach((b, i) => b.classList.toggle('on', i === k));
      tSec.textContent = k >= 0 ? stage.sections[k].title : '';
    }
  });

  // Startup
  renderLib();
  renderSections();
  renderSettings();
  renderProfiles(); renderReady();
  syncEditor();
  fitPreview();
  if (document.fonts) document.fonts.ready.then(() => { stage.invalidate(); renderTicks(); });
  const releaseLanguage = onLanguageChange(() => {
    renderSettings();
    renderLib(); renderStats(); renderReady(); renderStatus(); renderConnectDevices(); renderProfiles($('.profile-select').value);
    fitPreview(); updateTransport(true);
    $('.voice-transcript').textContent = lastTranscript ? t('Распознано: «{text}»', { text: lastTranscript }) : '';
  });

  return {
    destroy() {
      releaseLanguage(); releaseTranslation();
      window.removeEventListener('efirnetwork', onNetwork);
      frames.destroy(); stage.destroy();
      previewObserver.disconnect();
      clearTimeout(edTimer); clearTimeout(saveTimer);
      document.removeEventListener('visibilitychange', saveBeforeHide);
      platform.events.removeEventListener('visible', saveBeforeHide);
      document.removeEventListener('keydown', onKey);
      tracker.stop();
      platform.send('sessionActive', { active: false });
      store.saveScripts(scripts);
      lanHelp.destroy();
      room.destroy();
      closeModals();
    },
  };
}

function stripName(t) { const { name, ...rest } = t; return rest; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
