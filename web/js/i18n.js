import { platform } from './platform.js';
await window.efirNative?.ready;

export const LANGUAGES = [
  ['ru', 'Русский'], ['en', 'English'], ['es', 'Español'],
  ['zh', '简体中文'], ['hi', 'हिन्दी'], ['ar', 'العربية'],
];
const KEY = 'efir.uiLanguage.v1';
const supported = code => LANGUAGES.some(([id]) => id === code);
const normalize = code => String(code || '').toLowerCase().split(/[-_]/)[0];
let saved;
try { saved = localStorage.getItem(KEY); } catch { /* Storage may be unavailable. */ }
let language = [window.efirNative?.uiLanguage, saved, ...(navigator.languages || [navigator.language])]
  .map(normalize).find(supported) || 'en';
const catalogue = await fetch(new URL('../locales/messages.json', import.meta.url)).then(r => {
  if (!r.ok) throw new Error('localization');
  return r.json();
}).catch(() => ({ languages: [], messages: {} }));
const listeners = new Set(), roots = new Map(), sources = new WeakMap();
let numberFormat, plurals;

export function uiLanguage() { return language; }
export function t(source, values = {}) {
  const index = catalogue.languages.indexOf(language);
  const message = catalogue.messages[source]?.[index] || source;
  return message.replace(/\{(\w+)\}/g, (token, key) => values[key] == null ? token : String(values[key]));
}
export function countLabel(count, kind) {
  return t(`${kind}.${plurals.select(count)}`, { count: numberFormat.format(count) });
}
export function onLanguageChange(callback) { listeners.add(callback); return () => listeners.delete(callback); }
export function setLanguage(code, notify = true) {
  if (!supported(code) || code === language) return;
  language = code;
  try { localStorage.setItem(KEY, code); } catch { /* Storage may be unavailable. */ }
  applyLanguage();
  for (const [root, records] of roots) {
    if (!root.isConnected) { roots.delete(root); continue; }
    applyRecords(records);
  }
  document.querySelectorAll('.ui-language').forEach(select => { select.value = code; select.setAttribute('aria-label', t('Язык интерфейса')); });
  listeners.forEach(callback => callback());
  if (notify && platform.native) platform.send('language', { language: code });
}
function applyLanguage() {
  document.documentElement.lang = language === 'zh' ? 'zh-Hans' : language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.title = t('Эфир — суфлёр');
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', language === 'ru' ? 'manifest.webmanifest' : `locales/manifest.${language}.webmanifest`);
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('Эфир — веб-суфлёр с удалённым пультом. Два устройства соединяются напрямую по локальной сети.'));
  for (const [key, source] of Object.entries({ drop: 'Отпустите файл — он добавится в тексты', preview: 'превью', live: 'эфир', count: 'отсчёт', voice: 'голос', play: 'пуск', pause: 'пауза' })) document.documentElement.style.setProperty('--label-' + key, JSON.stringify(t(source)));
  numberFormat = new Intl.NumberFormat(language);
  plurals = new Intl.PluralRules(language);
}
function applyRecords(records) {
  for (const { node, attr, source } of records) {
    if (!node.isConnected) continue;
    if (attr) node.setAttribute(attr, t(source));
    else node.textContent = node.textContent.replace(node.textContent.trim(), t(source));
  }
}
// Translate only explicitly registered UI, excluding scripts and transcripts.
// No DOM observers or background timers are needed.
export function translateUI(root) {
  const records = [];
  const visit = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const source = sources.get(node) || node.textContent.trim().replace(/\s+/g, ' ');
      if (catalogue.messages[source]) { sources.set(node, source); records.push({ node, source }); }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches('[data-user-content],script,style,svg,.text,.lib-list,.sec-list,.voice-transcript,.devices')) return;
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const key = node.getAttribute('data-i18n-' + attr) || node.getAttribute(attr);
      if (catalogue.messages[key]) { node.setAttribute('data-i18n-' + attr, key); records.push({ node, attr, source: key }); }
    }
    node.childNodes.forEach(visit);
  };
  visit(root); roots.set(root, records); applyRecords(records);
  return () => { for (const scope of roots.keys()) if (scope === root || root.contains(scope)) roots.delete(scope); };
}
export function languagePicker() {
  return `<select class="ui-language" aria-label="${t('Язык интерфейса')}" dir="ltr">${LANGUAGES.map(([code, name]) => `<option value="${code}" ${code === language ? 'selected' : ''}>${name}</option>`).join('')}</select>`;
}
document.addEventListener('change', event => { if (event.target.matches('.ui-language')) setLanguage(event.target.value); });
window.addEventListener('storage', event => {
  if (event.key !== KEY) return;
  // A queued event may describe an older choice made in another window.
  let latest;
  try { latest = localStorage.getItem(KEY); } catch { return; }
  if (supported(latest)) setLanguage(latest, false);
});
if (platform.native) window.efirNative = { ...window.efirNative, onLanguage: code => setLanguage(code, false) };
applyLanguage();
