// Room transport.
//
// Local hosting uses WebSocket; static hosting uses PeerJS and BroadcastChannel.
// PeerJS exchanges signaling through its broker; scripts use data channels.
// The first peer to claim the room ID relays to the others. If it leaves,
// another peer takes over. BroadcastChannel also connects same-browser tabs.

import { store } from './store.js';
import { localMode, nativeVoice } from './environment.js';
import { rtcConfig, relayConfigured, rtcConfigError } from './rtc.js';

let peerLibrary;
function loadPeer() {
  return peerLibrary ||= new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js'; s.onload = resolve; s.onerror = resolve;
    document.head.appendChild(s);
  });
}

const PREFIX = 'efir-teleprompter-v1-';
const HEARTBEAT = 2000;
const STALE = 7000;
const CONNECT_TIMEOUT = 30000;

export class Room extends EventTarget {
  constructor(code, role, getHello) {
    super();
    this.code = code;
    this.role = role;
    this.getHello = getHello;           // Greeting callback: role and viewport.
    this.id = store.clientId() + '-' + role[0] + Math.random().toString(36).slice(2, 6);
    this.seq = 0;
    this.lastSeq = new Map();           // from -> seq; deduplicate across transports.
    this.conns = new Map();             // peerId -> { conn, rtt, lan, last }
    this.members = new Map();           // clientId -> { role, hello, last, via }
    this.isHost = false;
    this.peer = null;
    this.status = 'connecting';
    this.destroyed = false;
    this.brokerOk = false;
    this.lastError = null;
    this.lastIce = null;

    this.localMode = localMode;
    if (!localMode) this._startBroadcast();
    this._wsDelay = 500;
    if (localMode) this._startSocket();
    else loadPeer().then(() => this._startPeer());
    this._hb = setInterval(() => this._heartbeat(), HEARTBEAT);
  }

  // Public API
  send(type, data = {}) {
    const msg = { ...data, nativeVoice, t: type, from: this.id, role: this.role, seq: ++this.seq };
    this._fanout(msg, null);
    if (this.bc) { try { this.bc.postMessage(msg); } catch { /* */ } }
  }

  peersOf(role) {
    return [...this.members.entries()].filter(([, m]) => m.role === role).map(([id, m]) => ({ id, ...m }));
  }

  linkInfo() {
    // Best direct link: RTT and route.
    if (localMode) return this.ws?.readyState === WebSocket.OPEN ? { route: 'lan', rtt: this._wsRtt ?? null } : null;
    let best = null;
    for (const c of this.conns.values()) {
      if (!c.open) continue;
      if (!best || (c.rtt ?? 1e9) < (best.rtt ?? 1e9)) best = c;
    }
    return best ? { rtt: best.rtt, route: best.route } : null;
  }

  diagnostics() {
    return {
      code: this.code, role: this.role, status: this.status,
      signaling: this.brokerOk && !this.peer?.disconnected && !this.peer?.destroyed,
      members: this.members.size, host: this.isHost, peerId: this.peer?.id || null,
      relay: relayConfigured(), configError: rtcConfigError, error: this.lastError, lastIce: this.lastIce,
      channels: [...this.conns.values()].map(rec => ({
        peerId: rec.conn.peer, open: rec.open, ice: rec.conn.peerConnection?.iceConnectionState || 'new',
        connection: rec.conn.peerConnection?.connectionState || 'new',
      })),
      link: this.linkInfo(),
    };
  }

  // Reconnect after a network or permission change.
  restart() {
    if (this.destroyed) return;
    clearTimeout(this._retry);
    this._setStatus('connecting');
    if (localMode) { this._closeSocket(); this._startSocket(); }
    else this._startPeer();
  }

  destroy() {
    try { this.send('bye'); } catch { /* */ }
    this.destroyed = true;
    clearInterval(this._hb);
    clearTimeout(this._retry);
    clearTimeout(this._connTimeout);
    this._closeSocket();
    try { this.bc && this.bc.close(); } catch { /* */ }
    for (const c of this.conns.values()) { try { c.conn.close(); } catch { /* */ } }
    try { this.peer && this.peer.destroy(); } catch { /* */ }
  }

  // ——— BroadcastChannel ———
  _startBroadcast() {
    if (!('BroadcastChannel' in window)) return;
    this.bc = new BroadcastChannel(PREFIX + this.code);
    this.bc.onmessage = (e) => this._receive(e.data, null, 'local');
    // Introduce this peer to neighboring tabs.
    setTimeout(() => this.send('hello', this.getHello()), 50);
  }

  // Local WebSocket
  _closeSocket() {
    clearTimeout(this._wsTimeout);
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* */ } }
  }

  _startSocket() {
    if (this.destroyed) return;
    this._closeSocket();
    this._setStatus('connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${encodeURIComponent(this.code)}`);
    this.ws = ws;
    this._wsTimeout = setTimeout(() => { if (ws === this.ws) ws.close(); }, 8000);
    ws.onopen = () => {
      if (ws !== this.ws || this.destroyed) return;
      clearTimeout(this._wsTimeout);
      this._wsDelay = 500;
      this._wsLast = Date.now();
      this._wsRtt = null;
      // Reintroduce after reconnecting; roles restore scripts and settings.
      for (const [id, m] of this.members) { this.members.delete(id); this.dispatchEvent(new CustomEvent('leave', { detail: { id, role: m.role } })); }
      this.members.clear(); this.lastSeq.clear();
      this._setStatus('waiting');
      this.send('hello', this.getHello());
      this._socketPing();
    };
    ws.onmessage = e => {
      if (ws !== this.ws) return;
      this._wsLast = Date.now();
      try {
        const msg = JSON.parse(e.data);
        if (msg.t === '__efir_pong') {
          if (msg.ts === this._wsPingAt) this._wsRtt = Math.round(performance.now() - msg.ts);
          this._emitLink(); return;
        }
        this._receive(msg, null, 'ws');
        this._setStatus(this.members.size ? 'connected' : 'waiting');
      } catch { /* Ignore unrecognized packets. */ }
    };
    ws.onerror = () => { if (ws === this.ws) ws.close(); };
    ws.onclose = () => {
      if (ws !== this.ws || this.destroyed) return;
      clearTimeout(this._wsTimeout);
      this.ws = null;
      this._setStatus('offline'); this._emitLink();
      const delay = this._wsDelay;
      this._wsDelay = Math.min(15000, delay * 2);
      this._retry = setTimeout(() => this._startSocket(), delay + Math.random() * delay * 0.2);
    };
  }

  _socketPing() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this._wsPingAt = performance.now();
    try { this.ws.send(JSON.stringify({ t: '__efir_ping', ts: this._wsPingAt })); } catch { /* */ }
  }

  // ——— PeerJS ———
  _peerOptions() {
    return {
      debug: 0,
      config: rtcConfig,
    };
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.dispatchEvent(new CustomEvent('status', { detail: s }));
  }

  _startPeer() {
    if (this.destroyed) return;
    if (typeof window.Peer !== 'function') {
      // If PeerJS is unavailable, keep BroadcastChannel.
      this._setStatus('offline');
      this._retry = setTimeout(() => this._startPeer(), 4000);
      return;
    }
    this._cleanupPeer();
    this.isHost = false;
    const hostId = PREFIX + this.code;
    const peer = new window.Peer(hostId, this._peerOptions());
    this.peer = peer;

    peer.on('open', () => {
      if (peer !== this.peer) return;
      this.isHost = true;
      this.brokerOk = true;
      this._setStatus([...this.conns.values()].some(c => c.open) ? 'connected' : 'waiting');
    });
    peer.on('connection', (conn) => { if (peer === this.peer && !this.destroyed) this._setupConn(conn); else conn.close(); });
    peer.on('disconnected', () => {
      // Reconnect signaling without closing live data channels.
      if (peer !== this.peer || this.destroyed) return;
      this.brokerOk = false;
      this._emitLink();
      this._retry = setTimeout(() => { if (peer === this.peer && !peer.destroyed) { try { peer.reconnect(); } catch { /* */ } } }, 1500);
    });
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      if (err.type !== 'unavailable-id') this.lastError = err.type;
      if (err.type === 'unavailable-id') {
        // Connect to the existing room host.
        this._startClient();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.brokerOk = false;
        if ([...this.conns.values()].some(c => c.open)) return;
        if (!this.conns.size) this._setStatus('offline');
        this._scheduleRestart(3000);
      }
    });
  }

  _startClient() {
    if (this.destroyed) return;
    this._cleanupPeer();
    this.isHost = false;
    const peer = new window.Peer(undefined, this._peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      if (peer !== this.peer) return;
      this.brokerOk = true;
      // A broker reconnect must preserve an established data channel.
      if ([...this.conns.values()].some(c => c.open)) return;
      const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this._setupConn(conn);
      // Give ICE gathering and negotiation time to finish.
      clearTimeout(this._connTimeout);
      this._connTimeout = setTimeout(() => {
        if (!conn.open && peer === this.peer) {
          this.lastError = 'connection-timeout';
          this.lastIce = conn.peerConnection?.iceConnectionState || 'new';
          // Signaling succeeded but the direct connection failed.
          if (!this.conns.size || ![...this.conns.values()].some(c => c.open)) this._setStatus('nop2p');
          this._scheduleRestart(200);
        }
      }, CONNECT_TIMEOUT);
    });
    peer.on('disconnected', () => {
      if (peer !== this.peer || this.destroyed) return;
      this.brokerOk = false; this._emitLink();
      this._retry = setTimeout(() => { if (peer === this.peer && !peer.destroyed) { try { peer.reconnect(); } catch { /* */ } } }, 1500);
    });
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      this.lastError = err.type;
      if (err.type === 'peer-unavailable') {
        // Try to take over from the missing host.
        this._scheduleRestart(200 + Math.random() * 600);
      } else if (err.type === 'webrtc' || err.type === 'negotiation-failed') {
        this._setStatus('nop2p');
        this._scheduleRestart(2500);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.brokerOk = false;
        if ([...this.conns.values()].some(c => c.open)) return;
        if (!this.conns.size) this._setStatus('offline');
        this._scheduleRestart(2500);
      }
    });
  }

  _scheduleRestart(ms) {
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._startPeer(), ms);
  }

  _cleanupPeer() {
    clearTimeout(this._connTimeout);
    clearTimeout(this._retry);
    this.brokerOk = false;
    // Detach before close callbacks: an old connection must not restart a new peer.
    const records = [...this.conns.values()], peer = this.peer;
    this.conns.clear(); this.peer = null;
    for (const c of records) { try { c.conn.close(); } catch { /* */ } }
    if (peer) { try { peer.destroy(); } catch { /* */ } }
  }

  _setupConn(conn) {
    const rec = { conn, open: false, rtt: null, route: null, last: Date.now() };
    const previous = this.conns.get(conn.peer);
    this.conns.set(conn.peer, rec);
    if (previous) { try { previous.conn.close(); } catch { /* */ } }
    conn.on('open', () => {
      if (this.destroyed || this.conns.get(conn.peer) !== rec) return;
      rec.open = true;
      this.lastError = null;
      this.lastIce = null;
      rec.last = Date.now();
      clearTimeout(this._connTimeout);
      this._setStatus('connected');
      this._direct(conn, { t: 'hello', ...this.getHello(), from: this.id, role: this.role, seq: ++this.seq });
      this._detectRoute(rec);
      this._ping(rec);
    });
    conn.on('data', (msg) => {
      if (this.destroyed || this.conns.get(conn.peer) !== rec) return;
      rec.last = Date.now();
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === '__ping') { this._direct(conn, { t: '__pong', ts: msg.ts }); return; }
      if (msg.t === '__pong') { rec.rtt = Math.round(performance.now() - msg.ts); this._emitLink(); return; }
      this._receive(msg, conn.peer, 'p2p');
    });
    const drop = () => this._dropConn(conn.peer, conn);
    conn.on('close', drop);
    conn.on('error', drop);
  }

  _dropConn(peerId, conn) {
    const rec = this.conns.get(peerId);
    if (!rec || rec.conn !== conn) return;
    this.lastIce = conn.peerConnection?.iceConnectionState || this.lastIce;
    if (!rec.open && !this.lastError) this.lastError = 'connection-closed';
    this.conns.delete(peerId);
    try { conn.close(); } catch { /* */ }
    this._emitLink();
    if (this.destroyed) return;
    if (!this.isHost) {
      // Elect a new host after disconnection.
      this._setStatus('connecting');
      this._scheduleRestart(300 + Math.random() * 900);
    } else if (!this.conns.size) {
      this._setStatus('waiting');
    }
  }

  async _detectRoute(rec) {
    // Inspect the selected ICE route; host means a direct LAN candidate.
    try {
      await new Promise(r => setTimeout(r, 600));
      const pc = rec.conn.peerConnection;
      if (!pc) return;
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach(s => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
      });
      if (!pair) stats.forEach(s => { if (s.type === 'candidate-pair' && (s.selected || s.nominated) && s.state === 'succeeded') pair = pair || s; });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const types = [local && local.candidateType, remote && remote.candidateType];
      rec.route = types.includes('relay') ? 'relay' : (types.every(t => t === 'host') ? 'lan' : 'p2p');
      this._emitLink();
    } catch { /* Stats unavailable. */ }
  }

  _ping(rec) {
    if (!rec.open) return;
    this._direct(rec.conn, { t: '__ping', ts: performance.now() });
  }

  _emitLink() {
    this.dispatchEvent(new CustomEvent('link', { detail: this.linkInfo() }));
  }

  _direct(conn, msg) {
    try { if (conn.open) conn.send(msg); } catch { /* */ }
  }

  _fanout(msg, exceptPeer) {
    if (localMode) {
      try { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); } catch { /* */ }
      return;
    }
    for (const [pid, rec] of this.conns) {
      if (pid === exceptPeer || !rec.open) continue;
      this._direct(rec.conn, msg);
    }
  }

  _receive(msg, viaPeer, transport) {
    if (!msg || typeof msg.from !== 'string' || !Number.isFinite(msg.seq) || msg.from === this.id) return;
    const last = this.lastSeq.get(msg.from) || 0;
    if (msg.seq <= last) return; // Duplicate received through both transports.
    this.lastSeq.set(msg.from, msg.seq);

    // Relay from the host to other peers.
    if (this.isHost && transport === 'p2p') this._fanout(msg, viaPeer);

    if (msg.t === 'bye') {
      const m = this.members.get(msg.from);
      this.members.delete(msg.from);
      if (m) this.dispatchEvent(new CustomEvent('leave', { detail: { id: msg.from, role: m.role } }));
      return;
    }

    const known = this.members.get(msg.from);
    const m = known || { role: msg.role, hello: null, last: 0 };
    m.last = Date.now();
    m.role = msg.role;
    if (transport === 'local') m.local = Date.now();
    if (msg.t === 'hello' || msg.t === 'presence') m.hello = { ...m.hello, ...msg };
    this.members.set(msg.from, m);
    if (!known) this.dispatchEvent(new CustomEvent('join', { detail: { id: msg.from, role: msg.role } }));
    if (msg.t === 'hello' && known) this.dispatchEvent(new CustomEvent('join', { detail: { id: msg.from, role: msg.role, again: true } }));

    this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    if (transport === 'ws' && msg.t === 'hello' && !known) this.send('hello', this.getHello());
  }

  _heartbeat() {
    this.send('presence', this.getHello());
    const now = Date.now();
    if (localMode) {
      if (this.ws?.readyState === WebSocket.OPEN && now - this._wsLast > STALE) this.ws.close();
      else this._socketPing();
    }
    for (const rec of this.conns.values()) {
      if (!rec.open && rec.conn.peerConnection) this.iceState = rec.conn.peerConnection.iceConnectionState;
      this._ping(rec);
      if (rec.open && now - rec.last > STALE) this._dropConn(rec.conn.peer, rec.conn);
      else if (!rec.open && this.isHost && now - rec.last > CONNECT_TIMEOUT) {
        this.lastError = 'connection-timeout';
        this.lastIce = rec.conn.peerConnection?.iceConnectionState || 'new';
        this.conns.delete(rec.conn.peer); try { rec.conn.close(); } catch { /* */ }
      }
    }
    for (const [id, m] of this.members) {
      if (now - m.last > STALE) {
        this.members.delete(id);
        this.lastSeq.delete(id);
        this.dispatchEvent(new CustomEvent('leave', { detail: { id, role: m.role } }));
      }
    }
    if (localMode) {
      if (this.ws?.readyState === WebSocket.OPEN) this._setStatus(this.members.size ? 'connected' : 'waiting');
      return;
    }
    if (this.brokerOk === false && !this.conns.size && this.status !== 'offline') this._setStatus('offline');
  }
}
