# Tests

Run from the repository root. Browser profiles are isolated, but tests change
the connected session. Use a dedicated server and emulator or OS account;
do not point them at a controller containing real scripts.

## HTTP, WebSocket and browser behavior

Start either harness on a separate port. Both import the production server:

```sh
swift run --package-path tests/ServerHarness --scratch-path work/server-build \
  EfirServerHarness "$PWD/web" 18765
# Or:
cargo run --locked --manifest-path tests/RustServerHarness/Cargo.toml \
  -- "$PWD/web" 18765
```

In another terminal:

```sh
npm install --prefix work/testing playwright
work/testing/node_modules/.bin/playwright install chromium
EFIR_URL=http://localhost:18765 node tests/relay.mjs
EFIR_URL=http://localhost:18765 EFIR_LAN_URL=http://YOUR_WIFI_IP:18765 \
  node tests/browser.mjs
EFIR_URL=http://localhost:18765 EFIR_LAN_URL=http://YOUR_WIFI_IP:18765 \
  node tests/performance.mjs
EFIR_URL=http://localhost:18765 node tests/layout.mjs
node tests/hosting.mjs
```

On macOS, `http://0.0.0.0:18765` can provide an insecure Chromium context for
`EFIR_LAN_URL`. A real phone needs the host's Wi-Fi/Ethernet IP.

| Test | Boundary |
| --- | --- |
| `relay.mjs` | MIME, ETag/HEAD, exact relay, no echo, ping/pong, fragmented messages |
| `browser.mjs` | Sync, preview, reconnect, tap playback, mirror, voice, languages, backups, HTTP screen protection |
| `hosting.mjs` | Static hosting without marker, real PeerJS broker and cross-profile WebRTC |
| `performance.mjs` | Actual frame, storage, transport and main-thread activity in Chromium |
| `layout.mjs` | Six UI languages, light/dark, narrow/landscape/tablet/desktop, dialogs, icon-only exit and fullscreen labels |

`hosting.mjs` needs internet for signaling. Local browser checks reject external
requests. Browser bridge adapters check the shared JS contract; actual native
implementations are exercised separately.

## Android lifecycle and native WebView

Use a dedicated emulator or test phone. Debug and release signatures differ:
do not replace a working release installation with Debug.

```sh
python3 script/build_android.py --debug --test
adb -s SERIAL install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL install -r \
  android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s SERIAL shell am instrument -w \
  app.efir.android.test/app.efir.android.EfirTestRunner
```

Flows use actual touch events and check visible Read controls, fullscreen,
mirror, screen flags, hidden WebView drawing, back navigation, language
persistence and service lifetime across mode changes.

To run the shared protocol check against Android, start instrumentation with
`-e efirServerFixture true`. In another terminal:

```sh
adb -s SERIAL forward tcp:19877 tcp:8765
EFIR_URL=http://localhost:19877 node tests/relay.mjs
```

The fixture holds the service for 180 seconds with its controller closed.
Protocol assertions remain in `relay.mjs`.

## Linux native WebView and speech runtime

Install Efir, `tauri-driver`, `WebKitWebDriver` and Xvfb in a separate test profile.
Start the driver, then run the native check in another terminal:

```sh
xvfb-run -a dbus-run-session -- tauri-driver --port 4444 --native-port 4445
EFIR_DRIVER=http://localhost:4444 EFIR_APP=/usr/bin/efir \
  EFIR_LAN_URL=http://localhost:8765 node tests/native-desktop.mjs
```

`EFIR_LAN_URL` enables a WebKitGTK/Chromium layout comparison. In a VM, forward
the app's HTTP port to a separate host port, avoiding a running personal app.

The ignored Vosk check requires an official model, runtime library and PCM WAV:

```sh
EFIR_VOSK_MODEL=/path/to/vosk-model-small-en-us-0.15 \
EFIR_VOSK_RUNTIME=/path/to/libvosk.so EFIR_VOSK_WAV=/path/to/test.wav \
  cargo test --locked --release --manifest-path desktop/Cargo.toml --lib \
  offline_runtime_decodes_pcm -- --ignored --nocapture
```

See [verification](../docs/verification.md) for results and remaining device
checks. Performance figures are browser measurements, not battery measurements.
