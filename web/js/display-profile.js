// Per-display overrides; all omitted values inherit the session settings.
export const DISPLAY_FIELDS = {
  fontSize: ['Размер', 16, 240], sidePad: ['Боковые поля', 0, 35],
  leftPad: ['Левое поле', 0, 35], rightPad: ['Правое поле', 0, 35],
  topPad: ['Сверху до текста', 0, 100], bottomPad: ['Снизу после текста', 0, 150],
  markerPos: ['Положение линии чтения', 5, 95],
  mirrorH: ['Зеркало ↔'], mirrorV: ['Зеркало ↕'],
};
export function cleanDisplayProfile(value) {
  const result = { name: '', overrides: {} };
  if (!value || typeof value !== 'object') return result;
  if (typeof value.name === 'string') result.name = value.name.trim().slice(0, 60);
  for (const [key, [, min, max]] of Object.entries(DISPLAY_FIELDS)) {
    const v = value.overrides?.[key];
    if (min == null) { if (typeof v === 'boolean') result.overrides[key] = v; }
    else if (Number.isFinite(v)) result.overrides[key] = Math.max(min, Math.min(max, v));
  }
  return result;
}
export function displaySettings(settings, profile) {
  return { ...settings, ...cleanDisplayProfile(profile).overrides };
}
// Geometry, not color/mirror, decides whether a pixel position can be reused.
export function layoutSignature(settings) {
  return JSON.stringify(['fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing',
    'uppercase', 'sidePad', 'leftPad', 'rightPad', 'topPad', 'bottomPad', 'markerPos', 'align']
    .map(key => settings[key] ?? null));
}
