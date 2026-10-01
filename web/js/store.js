import { t } from './i18n.js';
import { wordChunks } from './words.js';
import { localMode } from './environment.js';

// Browser storage for settings, scripts and the last room.
// The relay does not store scripts.

export const DEFAULTS = {
  fontSize: 64,
  fontFamily: 'Onest',
  fontWeight: 500,
  lineHeight: 1.4,
  letterSpacing: 0,
  uppercase: false,
  align: 'left',
  sidePad: 8,       // Percent of screen width.
  topPad: 40,       // Percent of screen height before the text.
  bottomPad: 70,    // Percent of screen height after the text.
  theme: 'studio',
  textColor: '#f4efe6',
  bgColor: '#0a0908',
  accentColor: '#ffb547',
  noteColor: '#7fb4ff',
  marker: true,
  markerPos: 40,    // Percent from the top.
  markerStyle: 'band', // band | line | arrows
  markerColor: '#ff4b3e',
  fade: true,
  mirrorH: false,
  mirrorV: false,
  countdown: 3,
  showProgress: true,
  showTimer: true,
  dimRead: true,
  touchLock: true,
  voiceLang: 'ru-RU',
  voiceDevice: localMode ? 'controller' : 'prompter', // prompter | controller
};

export const THEMES = {
  studio: { name: 'Студия', textColor: '#f4efe6', bgColor: '#0a0908', accentColor: '#ffb547', noteColor: '#7fb4ff' },
  amber:  { name: 'Янтарь', textColor: '#ffc46b', bgColor: '#0c0703', accentColor: '#ffffff', noteColor: '#8a6a44' },
  paper:  { name: 'Бумага', textColor: '#161412', bgColor: '#f3eee4', accentColor: '#c2410c', noteColor: '#2563eb' },
  mint:   { name: 'Мята',   textColor: '#b6ffd9', bgColor: '#03110b', accentColor: '#ffe66b', noteColor: '#5aa98a' },
  night:  { name: 'Ночь',   textColor: '#fff36b', bgColor: '#0a1030', accentColor: '#ffffff', noteColor: '#8fa3ff' },
};

export const FONTS = [
  { id: 'Onest', label: 'Onest' },
  { id: 'Inter', label: 'Inter' },
  { id: 'PT Sans', label: 'PT Sans' },
  { id: 'Montserrat', label: 'Montserrat' },
  { id: 'Merriweather', label: 'Merriweather', serif: true },
  { id: 'Roboto Slab', label: 'Roboto Slab', serif: true },
  { id: 'JetBrains Mono', label: 'JetBrains Mono', mono: true },
];

const K = {
  settings: 'efir.settings.v1',
  scripts: 'efir.scripts.v1',
  current: 'efir.current.v1',
  room: 'efir.room.v1',
  speed: 'efir.speed.v1',
  cached: 'efir.prompter.cache.v1',
  position: 'efir.prompter.position.v1',
  prompterSettings: 'efir.prompter.settings.v1',
  id: 'efir.client.v1',
  profiles: 'efir.profiles.v1',
};
let savedPrompter = null, savedPosition = null;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; /* Storage may be unavailable. */ }
}

export const store = {
  settings() { const s = read(K.settings, {}); return { ...DEFAULTS, ...s, ...(localMode ? { voiceDevice: 'controller' } : {}) }; },
  saveSettings(s) { write(K.settings, s); },
  speed() { return read(K.speed, 3); },
  saveSpeed(v) { write(K.speed, v); },
  profiles() { const profiles = read(K.profiles, []); return Array.isArray(profiles) ? profiles : []; },
  saveProfile(name, settings) {
    const profiles = this.profiles().filter(p => p.name !== name);
    if (profiles.length >= 30) throw new Error(t('Сохранено 30 профилей. Удалите ненужный профиль.'));
    profiles.push({ id: uid(), name, settings: cleanSettings(settings) });
    if (!write(K.profiles, profiles)) throw new Error(t('Не удалось сохранить профиль: хранилище недоступно или заполнено.'));
  },
  deleteProfile(id) { write(K.profiles, this.profiles().filter(p => p.id !== id)); },
  backup() {
    return { format: 'efir-backup', version: 1, scripts: this.scripts(), settings: this.settings(),
      speed: this.speed(), profiles: this.profiles(), currentId: this.currentId() };
  },
  restoreBackup(data) {
    if (data?.format !== 'efir-backup' || data.version !== 1 || !Array.isArray(data.scripts) || !data.scripts.length || data.scripts.length > 1000) {
      throw new Error(t('Это не резервная копия Эфира поддерживаемой версии.'));
    }
    const imported = data.scripts.map(s => {
      if (!s || typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' || typeof s.text !== 'string' || s.text.length > 2000000) throw new Error(t('В копии повреждён текст.'));
      return { ...newScript(s.title.slice(0, 120), s.text), sourceId: s.id };
    });
    const profiles = (Array.isArray(data.profiles) ? data.profiles : []).slice(0, 30).map(p => {
      if (typeof p?.name !== 'string') throw new Error(t('В копии повреждён профиль.'));
      return { id: uid(), name: p.name.slice(0, 40), settings: cleanSettings(p.settings) };
    });
    const scripts = this.scripts().slice(), ids = new Map();
    for (const { sourceId, ...s } of imported) {
      const existing = scripts.find(v => v.title === s.title && v.text === s.text);
      if (!existing) scripts.push(s);
      ids.set(sourceId, existing?.id || s.id);
    }
    const mergedProfiles = this.profiles().filter(p => !profiles.some(v => v.name === p.name)).concat(profiles).slice(-30);
    const current = ids.get(data.currentId) || ids.get(imported[0].sourceId);
    const values = [[K.scripts, scripts], [K.settings, cleanSettings(data.settings)], [K.profiles, mergedProfiles],
      [K.speed, Number.isFinite(data.speed) ? Math.max(.1, Math.min(20, data.speed)) : 3], [K.current, current]];
    // Roll back all values if storage is full.
    const before = values.map(([key]) => [key, localStorage.getItem(key)]);
    try { for (const [key, value] of values) localStorage.setItem(key, JSON.stringify(value)); }
    catch (error) {
      for (const [key, value] of before) { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      throw new Error(t('Недостаточно места для восстановления библиотеки.'));
    }
    return scripts.length;
  },

  scripts() {
    let list = read(K.scripts, null);
    if (!list || !list.length) {
      list = [sampleScript()];
      write(K.scripts, list);
    }
    return list;
  },
  saveScripts(list) { write(K.scripts, list); },
  currentId() { return read(K.current, null); },
  setCurrentId(id) { write(K.current, id); },

  room() { return read(K.room, null); },
  setRoom(r) { write(K.room, r); },

  prompterCache() {
    const c = read(K.cached, null), p = read(K.position, null);
    const sid = c?.script ? c.script.id + ':' + c.script.updated : null;
    if (!c) return null;
    const settings = read(K.prompterSettings, c.settings);
    return { ...c, settings, ...(p?.sid === sid ? { pos: p.pos, speed: p.speed } : {}) };
  },
  setPrompterCache(c) {
    // Write scripts and settings only on changes; save position separately.
    if (!savedPrompter || c.script !== savedPrompter.script) write(K.cached, { script: c.script });
    if (!savedPrompter || c.settings !== savedPrompter.settings) write(K.prompterSettings, c.settings);
    savedPrompter = { script: c.script, settings: c.settings };
    const p = { sid: c.script ? c.script.id + ':' + c.script.updated : null, pos: Math.round(c.pos * 100) / 100, speed: c.speed };
    if (!savedPosition || p.sid !== savedPosition.sid || p.pos !== savedPosition.pos || p.speed !== savedPosition.speed) {
      write(K.position, p); savedPosition = p;
    }
  },

  clientId() {
    let id = sessionStorageGet(K.id);
    if (!id) { id = uid(); sessionStorageSet(K.id, id); }
    return id;
  },
};

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* */ } }

export function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return Array.from(a, n => ROOM_ALPHABET[n % ROOM_ALPHABET.length]).join('');
}
export function cleanRoom(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function newScript(title = t('Новый текст'), text = '') {
  const now = Date.now();
  return { id: uid(), title, text, created: now, updated: now };
}

function sampleScript() {
  return newScript(t('Добро пожаловать в Эфир'), t(localMode ? 'sample.local' : 'sample.online'));
}

export function wordCount(text) {
  return wordChunks(text).reduce((n, chunk) => n + (chunk.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) || []).length, 0);
}

function cleanSettings(value) {
  const result = { ...DEFAULTS };
  if (!value || typeof value !== 'object') return result;
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const v = value[key];
    if (typeof v !== typeof def) continue;
    if (typeof def === 'number') { if (Number.isFinite(v)) result[key] = v; }
    else if (typeof def === 'boolean') result[key] = v;
    else if (key.endsWith('Color')) { if (/^#[\da-f]{6}$/i.test(v)) result[key] = v; }
    else if (key === 'fontFamily') { if (FONTS.some(f => f.id === v)) result[key] = v; }
    else if (key === 'voiceLang') { if (/^[a-z]{2,3}-[a-zA-Z]{2,8}$/.test(v)) result[key] = v; }
    else if (['align', 'theme', 'markerStyle', 'voiceDevice'].includes(key)) {
      const allowed = { align: ['left', 'center', 'right', 'justify'], theme: [...Object.keys(THEMES), 'custom'], markerStyle: ['band', 'line', 'arrows'], voiceDevice: ['controller', 'prompter'] };
      if (allowed[key].includes(v)) result[key] = v;
    }
  }
  const ranges = { fontSize: [16, 240], fontWeight: [300, 700], lineHeight: [1, 2.4], letterSpacing: [-.04, .2], sidePad: [0, 35], topPad: [0, 100], bottomPad: [0, 150], markerPos: [5, 95], countdown: [0, 10] };
  for (const [key, [lo, hi]] of Object.entries(ranges)) result[key] = Math.max(lo, Math.min(hi, result[key]));
  if (localMode) result.voiceDevice = 'controller';
  return result;
}
