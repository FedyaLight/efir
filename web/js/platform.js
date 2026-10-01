// Shared shell contract. Platform adapters expose capabilities;
// the interface does not branch on OS names.
const legacy = window.webkit?.messageHandlers?.efir;
const host = () => window.efirNative || {};
let fullscreen = false;
let foreground = true;
const events = new EventTarget();
if (typeof host().postMessage === 'function' || legacy) {
  window.efirNative = { ...host(),
    onFullscreen(active) { fullscreen = active === true; events.dispatchEvent(new Event('fullscreen')); },
    onAwake(active) { events.dispatchEvent(new CustomEvent('awake', { detail: active === true })); },
    onVisible(active) { foreground = active === true; events.dispatchEvent(new Event('visible')); },
  };
}

export const platform = {
  events,
  get fullscreen() { return fullscreen; },
  get visible() { return foreground && !document.hidden; },
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
