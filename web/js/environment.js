import { platform } from './platform.js';

// Detect local hosting once at startup; static hosting keeps WebRTC.
const environment = await (async () => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 2500);
  try {
    const r = await fetch('/efir-local.json', { cache: 'no-store', signal: abort.signal });
    return r.ok ? (await r.json()) || {} : {};
  } catch { return {}; }
  finally { clearTimeout(timer); }
})();

export const localMode = environment.local === true;
export const hostName = environment.hostName || 'Компьютер';
export const nativeVoice = platform.has('speech');
