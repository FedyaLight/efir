// Shared shell contract. Platform adapters expose capabilities;
// the interface does not branch on OS names.
const legacy = window.webkit?.messageHandlers?.efir;
const host = () => window.efirNative || {};
let nativeFullscreen = false;
let foreground = true;
const events = new EventTarget();
const fullscreenActive = () => nativeFullscreen || !!(document.fullscreenElement || document.webkitFullscreenElement);
let visible = !document.hidden, fullscreen = fullscreenActive();
function updateVisible() {
  const active = foreground && !document.hidden;
  if (active === visible) return;
  visible = active;
  events.dispatchEvent(new Event('visible'));
}
function updateFullscreen() {
  const active = fullscreenActive();
  if (active === fullscreen) return;
  fullscreen = active;
  events.dispatchEvent(new Event('fullscreen'));
}
document.addEventListener('visibilitychange', updateVisible);
document.addEventListener('fullscreenchange', updateFullscreen);
document.addEventListener('webkitfullscreenchange', updateFullscreen);
if (typeof host().postMessage === 'function' || legacy) {
  Object.assign(window.efirNative ||= {}, {
    onFullscreen(active) { nativeFullscreen = active === true; updateFullscreen(); },
    onAwake(active) { events.dispatchEvent(new CustomEvent('awake', { detail: active === true })); },
    onVisible(active) { foreground = active === true; updateVisible(); },
  });
}

export const platform = {
  events,
  get fullscreen() { return fullscreen; },
  get visible() { return visible; },
  get native() { return typeof host().postMessage === 'function' || !!legacy; },
  get role() { return host().role || (legacy ? 'controller' : null); },
  get name() { return host().deviceName || (legacy ? 'Mac' : 'Компьютер'); },
  has(capability) {
    return host().capabilities?.[capability] === true || (!host().capabilities && !!legacy && ['speech', 'fullscreen'].includes(capability));
  },
  send(action, data = {}) {
    const message = { ...data, action };
    if (typeof host().postMessage === 'function') host().postMessage(message);
    else legacy?.postMessage(message);
  },
};
