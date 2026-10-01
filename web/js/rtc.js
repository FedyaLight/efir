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
export let rtcConfigError = false;
if (!localMode) {
  try {
    const configUrl = new URL('../rtc-config.json', import.meta.url);
    const config = await readConfig(configUrl);
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
