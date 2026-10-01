import { localMode } from './environment.js';

const fallback = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

async function readConfig(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error('ICE configuration unavailable');
    return await response.json();
  } finally { clearTimeout(timer); }
}

// Native LAN sessions never contact hosted signaling or credential services.
export const rtcConfig = { iceServers: fallback };
export const peerServer = { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' };
export let rtcConfigError = false;
if (!localMode) {
  try {
    const configUrl = new URL('../rtc-config.json', import.meta.url);
    const config = await readConfig(configUrl);
    if (config.peerServer) {
      const server = { ...peerServer, ...config.peerServer };
      if (typeof server.host !== 'string' || !/^[a-z0-9.-]+$/i.test(server.host)
        || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535
        || typeof server.path !== 'string' || !/^\/[^?#]*$/.test(server.path)
        || typeof server.secure !== 'boolean' || (location.protocol === 'https:' && !server.secure)
        || typeof server.key !== 'string' || !/^[a-z0-9_-]+$/i.test(server.key)) throw new Error('Invalid signaling configuration');
      Object.assign(peerServer, { host: server.host, port: server.port,
        path: server.path.endsWith('/') ? server.path : server.path + '/', secure: server.secure, key: server.key });
    }
    const servers = config.credentialsUrl ? await readConfig(new URL(config.credentialsUrl, configUrl)) : config.iceServers;
    const iceServers = Array.isArray(servers) ? servers : servers?.iceServers;
    if (!Array.isArray(iceServers) || !iceServers.length || !iceServers.every(server => {
      const urls = [server?.urls].flat();
      return urls.length && urls.every(url => typeof url === 'string' && /^(stun|stuns|turn|turns):/.test(url));
    })) throw new Error('Invalid ICE configuration');
    rtcConfig.iceServers = iceServers;
  } catch { rtcConfigError = true; }
}

export function relayConfigured() {
  return rtcConfig.iceServers.some(server => [server.urls].flat().some(url => /^turns?:/.test(url)));
}

export function signalingEndpoint() {
  return `${peerServer.secure ? 'wss' : 'ws'}://${peerServer.host}:${peerServer.port}${peerServer.path}peerjs`;
}

// Check a real broker handshake on demand; no room, script or SDP is sent.
export function probeSignaling(signal) {
  if (localMode) return Promise.resolve({ state: 'local' });
  return new Promise(resolve => {
    let socket, timer, settled = false;
    const cancel = () => finish('cancelled');
    const finish = (state, detail = {}) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try { socket.close(); } catch { /* Already closed. */ }
      }
      resolve({ state, ...detail });
    };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const url = new URL(signalingEndpoint());
      const nonce = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
      url.searchParams.set('key', peerServer.key);
      url.searchParams.set('id', 'efir-probe-' + nonce());
      url.searchParams.set('token', nonce());
      url.searchParams.set('version', '1.5.4');
      socket = new WebSocket(url);
      timer = setTimeout(() => finish('timeout'), 8000);
      socket.onmessage = event => {
        try {
          const reply = JSON.parse(event.data).type;
          if (reply === 'OPEN') finish('connected');
          else finish('rejected', { reply });
        } catch { finish('rejected'); }
      };
      socket.onclose = event => finish('failed', { closeCode: event.code });
      socket.onerror = () => finish('failed');
    } catch { finish('failed'); }
  });
}
