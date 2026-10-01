# Development

Run commands from the repository root unless a different directory is shown.
Native shells package the same `web/` files. No Chromium engine or language model
is bundled. First builds need installed SDKs and dependency caches; running a
local session does not require internet.

## macOS

Install Xcode with its macOS SDK. XcodeGen is optional when using the checked-in
project, and required when changing `mac/project.yml`:

```sh
brew install xcodegen
xcodegen generate --spec mac/project.yml
./script/build_and_run.sh --build
open mac/build/Build/Products/Debug/Efir.app
```

Direct build:

```sh
xcodebuild -project mac/Efir.xcodeproj -scheme Efir -configuration Debug \
  -derivedDataPath mac/build build
```

Release (both Apple Silicon and Intel):

```sh
./script/build_and_run.sh --release
```

The helper's default action rebuilds and restarts Efir. `--build` and `--release`
only build. `--debug` opens LLDB, `--logs` streams process logs, and `--telemetry`
filters Efir's logging subsystem. Products are in `mac/build/Build/Products/`;
debug symbols stay outside the app bundle.

FlyingFox 0.27.1 is vendored so the Swift package does not need a network fetch.
The build phase copies `web/` into app resources, excluding hosting configuration,
hidden files, documentation and PeerJS. Entitlements enable sandboxed network
server/client, audio input and user-selected files.

Local builds are ad hoc signed. See [macOS distribution](macos-distribution.md)
for Developer ID signing, Hardened Runtime and notarization.

## Windows and Linux

Install Rust and Node.js. Locked Cargo and npm dependencies are included.
Windows needs the MSVC build tools and WebView2 described in
[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

Ubuntu build dependencies:

```sh
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev libasound2-dev librsvg2-dev patchelf
```

Fetch the official Vosk runtime for the build target. The script verifies its
SHA-256 before extracting it:

```sh
node script/fetch_speech_runtime.mjs windows-x64
# Or: linux-x64 / linux-arm64
cd desktop
npm ci
npm run build -- --bundles nsis   # Windows
# npm run build -- --bundles deb  # Linux
```

Packages are under `desktop/target/release/bundle/`. For a portable Windows ZIP,
keep the EXE, WebView2Loader, any compiler runtime DLLs, `web/` and `speech/`
together. Linux uses the system WebKitGTK. The speech runtime is lazy-loaded;
language models are selected by the user and are not distributed with Efir.

Rust sources use `cargo fmt`. The shell's native command handler only accepts
the local controller URL and its own window label. Keep this boundary when
adding native actions.

## Android

Use JDK 17 and Android SDK platform/build-tools 35. The SDK license must be
accepted by its owner. Gradle Wrapper 8.14.3 checks the distribution checksum.

```sh
export JAVA_HOME=/path/to/jdk17
export ANDROID_HOME=/path/to/android-sdk
python3 script/build_android.py --debug --test
python3 script/build_android.py --local-sign --output ./work/releases/Efir-Android.apk
```

`--local-sign` creates or reuses a key under `.private/android/`. Back up that
folder: updates must keep the same signing key. Passwords are passed through
environment variables, not command-line arguments. For an existing key, set
`EFIR_KEYSTORE`, `EFIR_STORE_PASSWORD`, `EFIR_KEY_ALIAS`, `EFIR_KEY_PASSWORD` and
omit `--local-sign`. Without a key, release output is explicitly named unsigned.
The helper also runs Android lint.

`MainActivity` owns mode selection and WebViews. `ServerService` owns hosting,
notifications and the foreground lifecycle. Standalone mode binds only loopback;
host mode listens on all interfaces. The native bridge uses WebMessageListener
and origin checks, not JavaScriptInterface. Java `NanoWSD` is vendored with Efir's
frame limits and close handling; its upstream license is retained.

Kotlin uses `ktfmt --kotlinlang-style`; Swift uses `swift-format` with the
checked-in configuration. Keep browser code's existing two-space ES-module style.

## Hosted WebRTC configuration

`web/rtc-config.json` supplies the static website's `iceServers` to PeerJS. The
checked-in configuration uses only STUN; it does not provide a TURN fallback.
To run a relay, configure your own TURN service. PeerJS's bundled default TURN
addresses are not used as a reliability guarantee.

For short-lived credentials, set `credentialsUrl` to an HTTPS endpoint you own.
It must allow the website's origin through CORS and return either an array of
`RTCIceServer` objects or `{ "iceServers": [...] }`. Relative URLs resolve against
`rtc-config.json`. Return STUN and TURN entries, including a TLS/TCP TURN endpoint
for networks that block UDP. The request times out after three seconds; invalid
or unavailable configuration falls back to STUN and is reported in Diagnostics.
Do not commit API keys, TURN shared secrets or credential-generation secrets.
Browser-facing credentials must be suitable for public clients, short-lived and
quota-limited. Existing sessions keep their configuration until a page reload.

Native local sessions skip this configuration fetch and credential endpoint;
they continue to work without internet. The relay is a deployment service and
is not needed to build or run any native app.

## Assets and localization

- `web/locales/messages.json` is shared by the browser and native shells. Keep all
  six translations and substitution tokens when adding a message. Existing Russian
  UI strings serve as lookup keys; documentation and code comments are in English.
- `web/icon.svg` is the source brand mark. `swift script/make_app_icon.swift`
  regenerates native PNGs. `docs/assets/efir-icon.png` displays it in the README.
- WOFF2 files and JavaScript dependencies include licenses and source hashes in
  `web/vendor/`. Font subsets load only for the characters being used.
- `script/make_wake_video.sh` regenerates the small HTTP screen-protection videos
  with FFmpeg. Normal builds use checked-in videos and do not require FFmpeg.

The Xcode project is generated from `mac/project.yml`. Do not hand-edit the
project file; regenerate it after changing build settings. Vendored dependencies,
generated files, caches, local assistant settings and signing material are marked
or excluded from version control.

## Tests and CI

See [tests/README.md](../tests/README.md) for isolated protocol, browser and native
checks. Do not run session-mutating tests against a controller with real scripts.
[Release verification](verification.md) records actual runs and remaining
physical-device checks.

`.github/workflows/build.yml` builds macOS, Windows, Linux x64/ARM64 and an unsigned
Android APK. It does not publish releases or submit notarization. Signing credentials
must remain in local Keychain/private storage or explicitly configured CI secrets.
