# Efir web client

The shared teleprompter UI. Serve this directory as a static site; it uses
ES modules and does not require a JavaScript build step.

```sh
python3 -m http.server 8080 --directory web
```

Open `http://localhost:8080` for local development. Use HTTPS for a hosted site
that needs microphone and Wake Lock access. Netlify should publish `web/`, not
the repository root; `netlify.toml` is relative to this directory.

## Transports

`GET /efir-local.json` selects the transport. Native servers return a JSON marker
with `local: true`; the static site has no marker and uses PeerJS/WebRTC.

- Local: WebSocket on the same host, automatic reconnection, one shared session.
- Hosted: PeerJS, host election, relay and BroadcastChannel for tabs on one device.

`Room` exposes the same events and methods in both modes. PeerJS and LAN discovery
help are only loaded for the hosted mode. Fonts, QR generation and DOCX import
are served from `vendor/`; the local mode makes no external requests.

## Modules

| Module | Responsibility |
| --- | --- |
| `app.js` | Routing and home screen |
| `controller.js`, `prompter.js` | Role UI, script delivery and controls |
| `net.js`, `environment.js`, `lan.js` | Transport, local detection and WebRTC help |
| `stage.js`, `frames.js`, `session.js` | Shared rendering, scroll loop and position restoration |
| `voice.js`, `words.js` | Speech sources, word matching and script segmentation |
| `store.js` | Library, profiles, settings and backups |
| `platform.js` | Native capabilities and callbacks |
| `i18n.js`, `locales/` | Interface languages; script text is not translated |
| `ui.js` | Icons, dialogs, QR, fullscreen and screen protection |

The controller renders a `Stage` at the reader's CSS dimensions, then scales
the whole preview. Keep layout changes shared between roles. Local sessions
round line and paragraph spacing to whole CSS pixels to avoid cumulative
WebKit/Chromium differences.

See [platform contracts](../docs/platforms.md), [tests](../tests/README.md)
and [usage](../docs/usage.md). Dependency sources, hashes and licenses are in
[vendor/README.md](vendor/README.md).
