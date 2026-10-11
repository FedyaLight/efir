import { t } from './i18n.js';
import { Stage, Engine } from './stage.js';
import { FrameLoop } from './frames.js';
import { platform } from './platform.js';
import { restoreSession } from './session.js';
import { cleanDisplayProfile, displaySettings, DISPLAY_FIELDS } from './display-profile.js';
import { modal } from './ui.js';

const esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function restorePreview(record) {
  restoreSession(record.stage, record.engine, record.state);
  record.engine.voiceLive = record.state.voiceState === 'hearing';
}
export const screenId = peer => peer?.hello?.displayId || peer?.id;
export function profileDialog(profile, settings, change) {
  let current = cleanDisplayProfile(profile);
  const dialog = modal(`<h2>${t('Настройки этого экрана')}</h2>
    <label class="set-row"><span>${t('Название экрана')}</span><input class="display-name" maxlength="60" value="${esc(current.name)}"></label>
    <p class="muted">${t('Без отдельной настройки экран использует общие значения с пульта.')}</p>
    <div class="display-fields"></div><button class="pill-btn" data-display-reset>${t('Использовать общие настройки')}</button>`);
  const fields = dialog.el.querySelector('.display-fields');
  function render() {
    const effective = displaySettings(settings, current);
    fields.innerHTML = Object.entries(DISPLAY_FIELDS).map(([key, [name, min, max]]) => {
      const own = Object.hasOwn(current.overrides, key), value = effective[key] ?? effective.sidePad;
      return `<div class="display-field" data-display-field="${key}"><label class="chk"><input type="checkbox" class="display-own" ${own ? 'checked' : ''}>${t(name)}</label>
        ${min == null ? `<input type="checkbox" class="display-value" aria-label="${t(name)}" ${value ? 'checked' : ''} ${own ? '' : 'disabled'}>`
          : `<input type="number" class="display-value" required aria-label="${t(name)}" min="${min}" max="${max}" step="${key === 'fontSize' || key === 'markerPos' ? 1 : .5}" value="${value}" ${own ? '' : 'disabled'}>`}</div>`;
    }).join('');
  }
  render();
  dialog.el.querySelector('.display-name').oninput = e => { current = { ...current, name: e.target.value }; change(cleanDisplayProfile(current)); };
  fields.onchange = e => {
    const row = e.target.closest('[data-display-field]'); if (!row) return;
    const key = row.dataset.displayField, input = row.querySelector('.display-value');
    if (e.target.matches('.display-own')) {
      if (e.target.checked) current.overrides[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      else delete current.overrides[key];
      change(cleanDisplayProfile(current)); render();
    } else if (input.type === 'checkbox' || input.validity.valid) {
      current.overrides[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      current = cleanDisplayProfile(current); change(current);
    }
  };
  dialog.el.querySelector('[data-display-reset]').onclick = () => { current.overrides = {}; change(cleanDisplayProfile(current)); render(); };
  return dialog;
}

// Geometry comparison only. Independent layouts need their own exact previews.
export function formatRect(target, others, mirror) {
  let left = 0, top = 0, right = target.w, bottom = target.h;
  const marker = screen => screen.h * (mirror && screen.s.mirrorV ? 100 - screen.s.markerPos : screen.s.markerPos) / 100;
  for (const other of others) {
    if (!other.w || !other.h) continue;
    const scale = Math.min(target.w / other.w, target.h / other.h);
    const w = other.w * scale, h = other.h * scale;
    const x = (target.w - w) / 2, y = marker(target) - marker(other) * scale;
    left = Math.max(left, x); top = Math.max(top, y);
    right = Math.min(right, x + w); bottom = Math.min(bottom, y + h);
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
export function showFormatRegion(region, stage, others, scale, enabled, mirror) {
  region.hidden = !enabled || !others.length;
  if (region.hidden) return;
  const rect = formatRect(stage, others, mirror);
  for (const key of ['left', 'top', 'width', 'height']) region.style[key] = rect[key] * scale + 'px';
}

export class DisplayViews {
  constructor(host, { configure, profile, ready }) {
    this.host = host; this.configure = configure; this.profile = profile; this.ready = ready;
    this.active = true; this.records = new Map(); this.primary = null; this.script = ''; this.settings = null;
    this.staleTimer = setInterval(() => this.checkStale(), 1000);
    this.onVisible = () => {
      if (!platform.visible || !this.active) return;
      for (const record of this.records.values()) if (record.peer && record.state && !record.stale) restorePreview(record);
    };
    document.addEventListener('visibilitychange', this.onVisible);
    platform.events.addEventListener('visible', this.onVisible);
  }
  sync(peers, primary, settings, script, mirror) {
    this.primary = primary; this.settings = settings; this.script = script; this.mirror = mirror;
    for (const record of this.records.values()) record.peer = null;
    for (const peer of peers) {
      const id = screenId(peer);
      if (peer.id === primary) {
        const old = this.records.get(id);
        if (old) { old.frames.destroy(); old.stage.destroy(); old.el.remove(); this.records.delete(id); }
        continue;
      }
      let record = this.records.get(id);
      if (!record) {
        const el = document.createElement('div'); el.className = 'monitor screen-card'; el.dataset.screenId = id;
        el.innerHTML = `<div class="screen-canvas"><div class="screen-frame"><div class="preview-scale"></div><div class="format-region" hidden></div></div></div>
          <div class="screen-label"></div><div class="screen-ready"></div><button class="link-btn screen-config">${t('Настройки этого экрана')}</button>`;
        this.host.appendChild(el);
        const stage = new Stage(el.querySelector('.preview-scale')), engine = new Engine(stage);
        record = { el, stage, engine, peer, state: null, text: null, settingsKey: null, seen: 0 };
        record.frames = new FrameLoop(stage, engine, () => {
          stage.render(engine.snapshot()); stage.setRead(engine.mode === 'voice' && stage.s.dimRead ? engine.voiceIdx : -1);
        });
        record.frames.setActive(false);
        el.querySelector('.screen-config').onclick = () => { if (record.peer) this.configure(record.peer); };
        this.records.set(id, record);
      }
      if (record.connectionId !== peer.id) {
        record.connectionId = peer.id; record.state = null; record.seen = 0; record.stale = false;
        record.el.classList.remove('stale'); record.frames.setActive(false);
      }
      record.peer = peer;
      record.el.hidden = peer.id === primary;
      const s = displaySettings(settings, this.profile(peer));
      const key = JSON.stringify(s);
      if (record.settingsKey !== key) { record.stage.setSettings(s); record.settingsKey = key; }
      if (record.text !== script) { record.stage.setScript(script); record.text = script; }
      const info = { ...peer.hello, ...record.state };
      record.stage.setViewport(info.vw || 1280, info.vh || 720);
      record.stage.setShowMirror(mirror);
      this.label(record);
    }
    for (const record of this.records.values()) {
      if (record.peer) continue;
      record.frames.setActive(false);
      record.el.hidden = false; this.label(record);
    }
    // Retain a small number of disconnected displays for a truthful last preview.
    for (const [id, record] of this.records) {
      if (this.records.size <= 16) break;
      if (!record.peer) { record.frames.destroy(); record.stage.destroy(); record.el.remove(); this.records.delete(id); }
    }
  }
  label(record) {
    const p = record.peer, profile = p ? this.profile(p) : null;
    if (p) record.name = profile.name || p.hello?.name || t('Суфлёр');
    record.el.classList.toggle('offline', !p);
    const text = (selector, value) => { const el = record.el.querySelector(selector); if (el.textContent !== value) el.textContent = value; };
    text('.screen-label', `${record.name || t('Суфлёр')} · ${record.stage.w}×${record.stage.h}`);
    text('.screen-ready', !p ? t('Отключён — последний кадр') : !record.state ? t('Синхронизация…') : record.stale ? t('Нет свежих данных — последний кадр') : this.ready(p));
    const button = record.el.querySelector('.screen-config');
    if (button.disabled !== !p) button.disabled = !p;
    text('.screen-config', t('Настройки этого экрана'));
  }
  state(peer, state) {
    const record = this.records.get(screenId(peer)); if (!record) return;
    record.state = state; record.seen = performance.now();
    if (record.stale) { record.stale = false; record.el.classList.remove('stale'); }
    record.stage.setViewport(state.vw, state.vh); this.label(record);
    if (!this.active || !platform.visible) return;
    record.frames.setActive(true);
    restorePreview(record);
    record.frames.request();
  }
  fit(width, height, others, compare) {
    for (const record of this.records.values()) {
      const { el, stage } = record;
      const scale = Math.min(Math.max(1, width - 12) / stage.w, Math.max(1, height - 70) / stage.h);
      const frame = el.querySelector('.screen-frame'); frame.style.width = stage.w * scale + 'px'; frame.style.height = stage.h * scale + 'px';
      el.querySelector('.screen-canvas').style.height = Math.max(1, height - 70) + 'px';
      el.querySelector('.preview-scale').style.transform = `scale(${scale})`;
      showFormatRegion(el.querySelector('.format-region'), stage, others.filter(s => s !== stage), scale, compare && !!record.peer, this.mirror);
    }
  }
  setActive(active) {
    this.active = active;
    for (const record of this.records.values()) {
      const enabled = active && !!record.peer && !!record.state && !record.stale;
      if (enabled && !record.frames.active) {
        record.stage.invalidate();
        if (record.state && record.peer) restorePreview(record);
      }
      record.frames.setActive(enabled);
    }
  }
  checkStale() {
    if (!this.active) return;
    for (const record of this.records.values()) {
      if (!record.peer || !record.state) continue;
      if (performance.now() - record.seen > 3500 && !record.stale) {
        record.stale = true; record.el.classList.add('stale'); record.frames.setActive(false); this.label(record);
      }
    }
  }
  stages() { return [...this.records.values()].filter(r => r.peer).map(r => r.stage); }
  destroy() {
    clearInterval(this.staleTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    platform.events.removeEventListener('visible', this.onVisible);
    for (const r of this.records.values()) { r.frames.destroy(); r.stage.destroy(); } this.records.clear();
  }
}
