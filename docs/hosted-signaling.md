# Hosted signaling

The static website uses a signaling service to match browsers by code and
exchange WebRTC offers, answers and ICE candidates. Scripts and playback
commands use the resulting data channel. Native LAN sessions use their local
HTTP/WebSocket server and do not contact this service.

A `network` error from PeerJS means it cannot establish or has lost its signaling
connection. Address/STUN checks do not verify signaling, and adding TURN does
not fix an unavailable signaling server. In **Diagnostics**, the WebSocket check
registers a temporary diagnostic peer and waits up to eight seconds for the
broker's `OPEN` response. It sends no room code, script or SDP. Closing the panel
cancels the check. The copied report includes the endpoint and handshake result.

If both devices fail this check, test the broker's HTTPS address in that same
network. HTTPS can work while WebSocket connections are filtered. The browser
cannot reliably distinguish DNS, TLS, firewall and service failures; use its
network console or compare another network when investigating the cause.

## Using your own PeerServer

GitHub Pages serves static files; a persistent signaling service needs a
separate host. The public deployment still uses `0.peerjs.com`; the following
example is a setup recipe, not an already deployed replacement.

On a server you control, install Node.js and run the official
[PeerServer](https://github.com/peers/peerjs-server), using a process manager for
production:

```sh
npx --yes peer@1.0.2 --host 127.0.0.1 --port 9000 --path /efir \
  --key efir --proxied --concurrent_limit 100 \
  --cors https://fedyalight.github.io https://efir-314.netlify.app
```

Point a domain you control at the server. Expose HTTPS on port 443 through a
reverse proxy with WebSocket upgrades. For example, with
[Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy):

```caddyfile
signaling.example.com {
    reverse_proxy 127.0.0.1:9000
}
```

Caddy manages HTTPS certificates when its
[automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https)
are met. The PeerServer listener remains on loopback. Keep process supervision,
connection limits and host-level rate limits appropriate to your deployment.
The PeerServer key is a public client identifier, not an administrator secret.

In `web/rtc-config.json`, replace `peerServer` with:

```json
{
  "host": "signaling.example.com",
  "port": 443,
  "path": "/efir/",
  "secure": true,
  "key": "efir"
}
```

Keep the existing `iceServers` and `credentialsUrl` fields. Both browsers must
load the same configuration; reload existing tabs after publishing it. HTTPS
websites require secure signaling. The local browser test uses HTTP loopback
and an unencrypted test broker, which should not be copied into production.

This replaces signaling only. If negotiation succeeds but ICE fails, the
network may also need a TURN relay. See
[WebRTC configuration](development.md#hosted-webrtc-configuration).
