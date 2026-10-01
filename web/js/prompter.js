import { t, translateUI, onLanguageChange, languagePicker } from './i18n.js';
import { localMode, hostName } from './environment.js';
import { platform } from './platform.js';
import { captureSession, restoreSession } from './session.js';

// Reader: owns scroll position. The controller sends commands and receives
// state at up to 30 updates per second.

import { store, DEFAULTS } from './store.js';
import { Stage, Engine } from './stage.js';
import { FrameLoop } from './frames.js';
import { Room } from './net.js';
import { VoiceTracker, voiceSupported } from './voice.js';
import { mountLanHelp } from './lan.js';
import { icon, qrSvg, toggleFullscreen, keepAwake, roomUrl, toast } from './ui.js';

const LAYOUT_KEYS = ['fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing', 'uppercase', 'sidePad', 'topPad', 'bottomPad', 'markerPos', 'align'];

export function deviceName() {
  if (platform.native) return platform.name;
  const ua = navigator.userAgent;
  const dev = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : t('Android‑планшет'))
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : t('Устройство');
  return dev;
}

// Keep the same word at the reading line when layout changes.
export function relayout(stage, engine, apply) {
  let anchor = null;
  if (engine.pos > 1 && stage.s) stage.measure();
  if (engine.pos > 1 && stage.tops && stage.tops.length) {
    const i = stage.wordAt(engine.pos);
    anchor = { i, off: engine.pos + stage.markerY - stage.tops[i], lh: stage.s.fontSize * stage.s.lineHeight };
  }
  apply();
  if (anchor) {
    stage.measure();
    const lh = stage.s.fontSize * stage.s.lineHeight;
    const t = stage.tops[Math.min(anchor.i, stage.tops.length - 1)] || 0;
    engine.pos = stage.clamp(t + anchor.off * (lh / anchor.lh) - stage.markerY);
    engine.target = null;
  }
}

export function mountPrompter(root, code) {
  document.body.className = 'is-prompter';
  const cache = store.prompterCache() || {};
  let settings = { ...DEFAULTS, ...(cache.settings || {}) };
  let script = cache.script || null;
  let voiceState = 'off';
  let syncTag = '', pendingSession = null;
  let awake = false, touchUnlocked = false, lockState = false, wasReading = false;
  let lastReady = '', lastTranscript = '', transcriptAt = 0;

  const el = document.createElement('div');
  el.className = 'prompter ui-hidden' + (platform.has('navigation') ? ' native-reader' : '');
  el.innerHTML = `
    <div class="p-stage"></div>
    <button class="icon-btn p-fullscreen" title="Полный экран" aria-label="Полный экран">${icon('fullscreen')}</button>
    <button class="icon-btn p-lock" title="Защита от касаний" aria-label="Защита от касаний" hidden>${icon('lock')}</button>
    <button class="pill-btn p-awake" hidden>Коснитесь экрана, чтобы он не гас</button>
    <div class="p-wait">
      <div class="p-wait-card">
        <a class="wordmark" href="#" title="На главную">ЭФИР<span>/суфлёр</span></a>
        <p class="p-wait-lead">${localMode ? t('Ждём пульт. Оставьте приложение Эфир на компьютере запущенным.') : t('Ждём пульт. Откройте сайт на втором устройстве и введите код комнаты')}</p>
        <div class="p-code">${code.split('').map(c => `<span>${c}</span>`).join('')}</div>
        <div class="p-wait-or"><span>или наведите камеру</span></div>
        <div class="p-qr">${localMode ? '' : qrSvg(roomUrl('c', code))}</div>
        <div class="p-wait-status"><i class="dot"></i><span class="st">Подключение…</span></div>
        <div class="p-lan"></div>
        <button class="pill-btn p-skip">Показать последний текст</button>
      </div>
    </div>
    <div class="p-ui">
      <div class="p-top">
        <a class="icon-btn p-back" href="#" title="Выход" aria-label="Выход">${icon('back')}</a>
        <div class="p-chip"><i class="dot"></i><b>${code}</b><span class="st"></span></div>
        <div class="p-top-r">
          ${languagePicker()}
          <button class="icon-btn" data-a="qr" title="QR для пульта">${icon('qr')}</button>
          <button class="icon-btn" data-a="mirror" title="Зеркало ↔" aria-label="Зеркало ↔" aria-pressed="false">${icon('mirror')}</button>
          <button class="icon-btn" data-a="fs" title="Полный экран" aria-label="Полный экран" aria-pressed="false">${icon('fullscreen')}</button>
        </div>
      </div>
      <div class="p-bottom">
        <button class="icon-btn lg" data-a="start" title="В начало">${icon('start')}</button>
        <button class="icon-btn lg" data-a="prev" title="Предыдущий раздел">${icon('prev')}</button>
        <button class="play-btn" data-a="toggle" title="Пуск / пауза (пробел)">${icon('play', 'i-play')}${icon('pause', 'i-pause')}</button>
        <button class="icon-btn lg" data-a="next" title="Следующий раздел">${icon('next')}</button>
        <div class="p-speed">
          <button class="icon-btn" data-a="slower">${icon('minus')}</button>
          <span class="p-speed-v">3.0</span>
          <button class="icon-btn" data-a="faster">${icon('plus')}</button>
        </div>
      </div>
    </div>
    <div class="p-qr-pop"><div>${localMode ? '' : qrSvg(roomUrl('c', code))}<p>Пульт · комната <b>${code}</b></p></div></div>
    <button class="p-mic">${icon('mic')}<span>Нажмите, чтобы включить микрофон</span></button>
    <div class="p-lost"><i class="dot"></i>Пульт не подключён${localMode ? '' : ` · <b>${code}</b>`}</div>`;
  root.appendChild(el);
  if (platform.has('navigation')) el.querySelectorAll('.wordmark, .p-top > a').forEach(a => { a.onclick = e => { e.preventDefault(); platform.send('back'); }; });
  const releaseTranslation = translateUI(el);

  const stage = new Stage(el.querySelector('.p-stage'), { fill: true });
  stage.setSettings(settings);
  if (script) stage.setScript(script.text);
  const engine = new Engine(stage);
  let frames;
  engine.speed = cache.speed ?? 3;
  requestAnimationFrame(() => { engine.pos = stage.clamp(cache.pos || 0); });

  const $ = (s) => el.querySelector(s);
  const speedV = $('.p-speed-v');

  // Networking
  const room = new Room(code, 'prompter', () => ({
    vw: stage.w, vh: stage.h, name: deviceName(),
    sid: script ? script.id + ':' + script.updated : null,
    session: captureSession(stage, engine, script ? script.id + ':' + script.updated : null), ready: currentReady(),
  }));
  const setStatus = () => {
    const ctl = room.peersOf('controller').length;
    const link = room.linkInfo();
    const s = ctl ? 'ok' : (room.status === 'offline' || room.status === 'nop2p' ? 'bad' : 'wait');
    const txt = ctl
      ? `${t('пульт подключён')}${link && link.route === 'lan' ? ' · LAN' : ''}${link && link.rtt != null ? ' · ' + t('{rtt} мс', { rtt: link.rtt }) : ''}`
      : room.status === 'offline' ? (localMode ? t('нет связи с компьютером — переподключаюсь…') : t('нет связи с интернетом для рукопожатия'))
        : room.status === 'nop2p' ? t('прямое соединение не удалось — устройства в одной сети?') : t('ждём пульт…');
    el.querySelectorAll('.dot').forEach(d => d.dataset.s = s);
    el.querySelectorAll('.st').forEach(d => d.textContent = txt);
    el.classList.toggle('has-ctl', ctl > 0);
    if (ctl > 0) el.classList.add('met');
    el.classList.toggle('has-script', !!script);
  };
  const lanHelp = mountLanHelp(el.querySelector('.p-lan'), room, () => room.peersOf('controller').length > 0);
  room.addEventListener('status', setStatus);
  room.addEventListener('link', setStatus);
  room.addEventListener('leave', setStatus);
  room.addEventListener('join', (e) => {
    setStatus();
    if (e.detail.role === 'controller' && !e.detail.again) toast(t('Пульт подключён'));
    lastSent = 0;
    frames?.request();
  });
  setStatus();

  const parts = new Map();
  room.addEventListener('message', (e) => {
    const m = e.detail;
    if (m.role !== 'controller') return;
    if (m.to && m.to !== room.id) return;
    switch (m.t) {
      case 'script': setScript(m.script); break;
      case 'scriptPart': {
        let p = parts.get(m.id);
        if (!p || p.upd !== m.upd) { p = { upd: m.upd, got: new Array(m.n), cnt: 0 }; parts.set(m.id, p); }
        if (!p.got[m.i]) { p.got[m.i] = m.chunk; p.cnt++; }
        if (p.cnt === m.n) { parts.delete(m.id); setScript({ id: m.id, title: m.title, updated: m.upd, text: p.got.join('') }); }
        break;
      }
      case 'settings': applySettings(m.s); break;
      case 'session':
        pendingSession = m;
        applySession();
        break;
      case 'cmd': command(m.c, m); break;
    }
  });

  function setScript(sc) {
    const same = script && script.id === sc.id;
    if (same && script.updated === sc.updated) return;
    const apply = () => stage.setScript(sc.text);
    if (same) relayout(stage, engine, apply);
    else { apply(); engine.pos = 0; engine.target = null; engine.pause(); }
    script = sc;
    tracker.setWords(stage.words);
    if (engine.mode === 'voice') tracker.setPosition(stage.wordAt(engine.pos));
    setStatus();
    persist(true);
    applySession();
  }

  function applySession() {
    if (!pendingSession || pendingSession.state.sid !== script?.id + ':' + script?.updated) return;
    const { state, tag } = pendingSession; pendingSession = null;
    restoreSession(stage, engine, state); syncTag = tag;
    tracker.setPosition(engine.voiceIdx);
    voiceState = state.voiceState || 'off';
    if (engine.mode === 'voice' && settings.voiceDevice === 'prompter') startVoice();
    speedV.textContent = engine.speed.toFixed(1);
    refreshTouchLock(); persist(); sendState(true); frames?.request();
  }

  function applySettings(s) {
    const next = { ...DEFAULTS, ...s };
    const layout = LAYOUT_KEYS.some(k => next[k] !== settings[k]);
    const prevLang = settings.voiceLang, prevDev = settings.voiceDevice;
    settings = next;
    if (layout) relayout(stage, engine, () => stage.setSettings(settings));
    else stage.setSettings(settings);
    if (engine.mode === 'voice' && (prevLang !== settings.voiceLang || prevDev !== settings.voiceDevice)) {
      tracker.stop();
      if (settings.voiceDevice === 'prompter') startVoice();
    }
    persist(true);
    refreshTouchLock();
    refreshMirror();
  }

  // Controller and keyboard commands
  function seekTo(p, smooth = true) {
    engine.seek(p, smooth);
    if (engine.mode === 'voice') {
      const i = stage.wordAt(stage.clamp(p));
      engine.voiceIdx = i;
      tracker.setPosition(i);
    }
    frames?.request();
  }
  function section(dir) {
    seekTo(stage.sectionStep(engine.pos, dir));
  }

  function command(c, m = {}) {
    switch (c) {
      case 'toggle': engine.toggle(settings.countdown); break;
      case 'play': engine.play(settings.countdown); break;
      case 'pause': engine.pause(); if (engine.mode === 'voice') voiceOff(); break;
      case 'start': engine.pause(); seekTo(0); break;
      case 'speed': engine.speed = clampSpeed(m.v); break;
      case 'speedBy': engine.speed = clampSpeed(engine.speed + m.v); break;
      case 'nudge': engine.nudge = m.v || 0; break;
      case 'seek': {
        const same = m.vw === stage.w && m.vh === stage.h;
        seekTo(same || m.word == null ? m.pos : stage.posForWord(m.word), !!m.smooth);
        break;
      }
      case 'section': m.k != null ? seekTo(stage.posForSection(m.k)) : section(m.dir); break;
      case 'voice': m.on ? voiceOn(m.idx) : voiceOff(); break;
      case 'voiceState':
        if (localMode && settings.voiceDevice === 'controller') voiceState = m.state;
        break;
      case 'voiceIdx':
        if (engine.mode === 'voice' && settings.voiceDevice === 'controller') { engine.voiceIdx = m.i; }
        break;
    }
    speedV.textContent = engine.speed.toFixed(1);
    lastSent = 0; frames?.request(); // Send updated state promptly.
  }
  const clampSpeed = (v) => Math.round(Math.max(0.1, Math.min(20, v)) * 10) / 10;

  // Voice
  const tracker = new VoiceTracker({
    onTranscript: text => {
      const next = String(text || '').slice(-200), now = performance.now();
      if (next !== lastTranscript && now - transcriptAt > 250) { lastTranscript = next; transcriptAt = now; room.send('transcript', { text: next }); }
    },
    onIndex: (i) => { engine.voiceIdx = i; frames?.request(); },
    onState: (s) => {
      voiceState = s;
      clearTimeout(micTimer);
      if (s === 'listening' || s === 'hearing') el.classList.remove('need-mic');
      if (s === 'denied') { el.classList.add('need-mic'); }
      lastSent = 0; frames?.request();
    },
  });
  tracker.setWords(stage.words);
  let micTimer = 0;

  function voiceOn(idx) {
    engine.pause();
    engine.mode = 'voice';
    engine.voiceIdx = idx != null ? idx : stage.wordAt(engine.pos);
    tracker.setPosition(engine.voiceIdx);
    if (settings.voiceDevice === 'prompter') startVoice();
  }
  function startVoice() {
    if (!voiceSupported) { voiceState = 'unsupported'; toast(localMode ? t('По HTTP микрофон телефона недоступен. Используйте микрофон пульта ({name}).', { name: hostName }) : t('Этот браузер не умеет распознавать речь'), 'bad'); return; }
    tracker.start(settings.voiceLang);
    // Some browsers require a user gesture to start the microphone.
    clearTimeout(micTimer);
    micTimer = setTimeout(() => { if (voiceState !== 'listening' && voiceState !== 'hearing') el.classList.add('need-mic'); }, 2500);
  }
  function voiceOff() {
    engine.mode = 'scroll';
    engine.target = null;
    tracker.stop();
    el.classList.remove('need-mic');
    stage.setRead(-1);
  }
  $('.p-fullscreen').onclick = () => toggleFullscreen();
  const fullscreenChanged = () => {
    const active = !!(platform.fullscreen || document.fullscreenElement || document.webkitFullscreenElement);
    el.classList.toggle('is-fullscreen', active);
    const button = $('[data-a="fs"]');
    button.setAttribute('aria-pressed', String(active));
    button.innerHTML = icon(active ? 'back' : 'fullscreen');
    button.title = t(active ? 'Выйти из полного экрана' : 'Полный экран');
    button.setAttribute('aria-label', button.title);
    reportReady();
  };
  platform.events.addEventListener('fullscreen', fullscreenChanged);
  document.addEventListener('fullscreenchange', fullscreenChanged);
  document.addEventListener('webkitfullscreenchange', fullscreenChanged);
  fullscreenChanged();
  $('.p-skip').onclick = () => el.classList.add('met');
  $('.p-mic').onclick = () => { el.classList.remove('need-mic'); tracker.stop(); if (engine.mode === 'voice') startVoice(); };

  // Reading controls
  const showUI = () => {
    if (engine.playing || engine.mode === 'voice') return;
    el.classList.remove('ui-hidden');
    $('.p-ui').inert = false;
  };
  const hideUI = () => {
    el.classList.add('ui-hidden'); el.classList.remove('show-qr');
    $('.p-ui').inert = true;
  };
  let uiReading = false;
  function syncReadingUI() {
    const reading = engine.playing || engine.mode === 'voice';
    if (reading === uiReading) return;
    uiReading = reading;
    reading ? hideUI() : showUI();
  }
  function togglePlayback() {
    const c = engine.playing || engine.mode === 'voice' ? 'pause' : 'play';
    command(c);
    // Absolute commands also work when several controllers receive the request.
    if (room.peersOf('controller').length) room.send('control', { c });
  }
  function refreshMirror() {
    $('[data-a="mirror"]').setAttribute('aria-pressed', String(settings.mirrorH));
    $('[data-a="mirror"]').classList.toggle('on', settings.mirrorH);
  }
  el.querySelector('.p-ui').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    showUI();
    const a = b.dataset.a;
    if (a === 'fs') toggleFullscreen();
    else if (a === 'mirror') {
      applySettings({ ...settings, mirrorH: !settings.mirrorH });
      room.send('mirror', { value: settings.mirrorH });
    }
    else if (a === 'toggle') togglePlayback();
    else if (a === 'qr') el.classList.toggle('show-qr');
    else if (a === 'prev') section(-1);
    else if (a === 'next') section(1);
    else if (a === 'slower') command('speedBy', { v: -0.2 });
    else if (a === 'faster') command('speedBy', { v: 0.2 });
    else command(a);
  });
  el.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) showUI(); });

  // Touch and wheel scrolling
  const stageHost = el.querySelector('.p-stage');
  let drag = null, longPress = 0;
  stageHost.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    clearTimeout(longPress);
    drag = { y: e.clientY, pos: engine.pos, moved: false, held: false, id: e.pointerId };
    if (isTouchLocked()) longPress = setTimeout(() => { if (drag) drag.held = true; touchUnlocked = true; refreshTouchLock(); showUI(); toast(t('Прокрутка пальцем разрешена')); }, 700);
  });
  stageHost.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = (e.clientY - drag.y) * (settings.mirrorV ? -1 : 1);
    if (!drag.moved && Math.abs(dy) > 8) { clearTimeout(longPress); drag.moved = true; stageHost.setPointerCapture(e.pointerId); }
    if (isTouchLocked()) return;
    if (drag.moved) seekTo(drag.pos - dy, false);
  });
  stageHost.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    clearTimeout(longPress);
    if (!drag.moved && !drag.held && script) togglePlayback();
    drag = null;
  });
  stageHost.addEventListener('pointercancel', () => { drag = null; clearTimeout(longPress); });
  stageHost.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (isTouchLocked()) return;
    seekTo(engine.pos + e.deltaY * (settings.mirrorV ? -1 : 1), false);
  }, { passive: false });
  el.querySelector('.p-qr-pop').onclick = () => el.classList.remove('show-qr');
  $('.p-lock').onclick = () => { touchUnlocked = !touchUnlocked; refreshTouchLock(); if (!lockState) showUI(); };
  function isTouchLocked() { return settings.touchLock && (engine.playing || engine.mode === 'voice') && !touchUnlocked; }
  function refreshTouchLock(force = false) {
    const reading = engine.playing || engine.mode === 'voice';
    if (reading && !wasReading) touchUnlocked = false;
    wasReading = reading;
    const locked = isTouchLocked();
    const hidden = !reading || !settings.touchLock;
    if ($('.p-lock').hidden !== hidden) $('.p-lock').hidden = hidden;
    if (locked !== lockState || force) {
      lockState = locked; el.classList.toggle('touch-locked', locked);
      $('.p-lock').innerHTML = icon(locked ? 'lock' : 'unlock');
      $('.p-lock').setAttribute('aria-label', locked ? t('Разрешить касания. Также можно удерживать текст.') : t('Заблокировать касания'));
      reportReady();
    }
  }
  function currentReady() {
    return { awake, fullscreen: !!(platform.fullscreen || document.fullscreenElement || document.webkitFullscreenElement), visible: platform.visible, locked: isTouchLocked() };
  }
  function reportReady() {
    const ready = currentReady(), sig = JSON.stringify(ready);
    if (sig === lastReady) return;
    lastReady = sig; room.send('readiness', { ready });
  }

  // Keyboard and presentation remotes
  const onKey = (e) => {
    if (e.target.closest('input,textarea,select')) return;
    const k = e.key;
    if (k === ' ' || k === 'b' || k === 'B' || k === '.' || k === 'Enter') { e.preventDefault(); togglePlayback(); }
    else if (k === 'ArrowUp') { e.preventDefault(); command('speedBy', { v: 0.2 }); }
    else if (k === 'ArrowDown') { e.preventDefault(); command('speedBy', { v: -0.2 }); }
    else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); section(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); section(-1); }
    else if (k === 'Home') { command('start'); }
    else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') toggleFullscreen();
    else return;
    speedV.textContent = engine.speed.toFixed(1);
  };
  document.addEventListener('keydown', onKey);

  // Drawing and state exchange
  let lastSent = 0, prevSig = '';
  function sendState(force = false) {
    if (!room.peersOf('controller').length || document.hidden) return;
    const now = performance.now();
    const sig = `${engine.pos.toFixed(1)}|${engine.playing}|${engine.speed}|${Math.ceil(engine.cd)}|${engine.mode}|${engine.voiceIdx}|${voiceState}|${stage.w}x${stage.h}|${stage.max}`;
    if (!force && (sig === prevSig || now - lastSent < 33)) return;
    prevSig = sig; lastSent = now;
    room.send('state', {
      pos: engine.pos, playing: engine.playing, speed: engine.speed, cd: engine.cd,
      mode: engine.mode, voiceIdx: engine.voiceIdx, voiceState, max: stage.max,
      vw: stage.w, vh: stage.h, sid: script ? script.id + ':' + script.updated : null,
      sync: syncTag,
    });
  }
  frames = new FrameLoop(stage, engine, () => {
    engine.voiceLive = voiceState === 'hearing';
    stage.render(engine.snapshot());
    if (engine.mode === 'voice' && settings.dimRead) stage.setRead(engine.voiceIdx);
    else if (stage.readIdx >= 0) stage.setRead(-1);
    el.classList.toggle('playing', engine.playing);
    el.classList.toggle('voice-active', engine.mode === 'voice');
    refreshTouchLock();
    syncReadingUI();
    sendState();
    if (!engine.moving) persist();
  });
  // Paused views do not draw; sparse state updates let controllers recover.
  const stateTimer = setInterval(() => { if (!engine.moving) sendState(true); }, 2000);
  const saveTimer = setInterval(persist, 10000);
  const onVisibility = () => { if (!platform.visible) persist(); reportReady(); };
  document.addEventListener('visibilitychange', onVisibility);
  platform.events.addEventListener('visible', onVisibility);

  function persist() {
    store.setPrompterCache({ script, settings, speed: engine.speed, pos: engine.pos });
  }

  speedV.textContent = engine.speed.toFixed(1);
  const release = keepAwake(active => { awake = active; $('.p-awake').hidden = active; reportReady(); });
  showUI();
  refreshMirror();
  const releaseLanguage = onLanguageChange(() => { setStatus(); refreshTouchLock(true); refreshMirror(); fullscreenChanged(); frames.request(); });

  return {
    destroy() {
      releaseTranslation(); releaseLanguage();
      persist();
      frames.destroy(); stage.destroy();
      clearInterval(stateTimer); clearInterval(saveTimer);
      clearTimeout(micTimer);
      clearTimeout(longPress);
      document.removeEventListener('visibilitychange', onVisibility);
      platform.events.removeEventListener('visible', onVisibility);
      document.removeEventListener('keydown', onKey);
      tracker.stop();
      release();
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      document.removeEventListener('webkitfullscreenchange', fullscreenChanged);
      platform.events.removeEventListener('fullscreen', fullscreenChanged);
      lanHelp.destroy();
      room.destroy();
    },
  };
}
