<img src="docs/assets/efir-icon.png" width="96" height="96" alt="Efir icon">

# Efir — Free Teleprompter with Remote Control

[![Build Efir](https://github.com/FedyaLight/efir/actions/workflows/build.yml/badge.svg)](https://github.com/FedyaLight/efir/actions/workflows/build.yml)

A free, open-source teleprompter with a remote controller for macOS, Windows, Linux and Android.
The computer serves the app over local Wi-Fi; a phone opens the reading screen
from a QR code. The local session works without internet or WebRTC.

Android can also edit and read a script on its own, or host a session for other
phones. The static web version uses PeerJS/WebRTC and runs on ordinary HTTPS hosting.
It currently requires a working direct device connection; see
[web connection diagnostics and relay limitations](docs/usage.md#connecting-through-the-website).

[Open in your browser](https://fedyalight.github.io/efir/) ·
[Apps and installation](https://fedyalight.github.io/efir/download/) ·
[All releases](https://github.com/FedyaLight/efir/releases) ·
[User guide](docs/usage.md)

## Download

[![Download for macOS](docs/assets/download-macos.svg)](https://github.com/FedyaLight/efir/releases/latest/download/Efir-macOS.zip)
[![Download for Windows x64](docs/assets/download-windows.svg)](https://github.com/FedyaLight/efir/releases/latest/download/Efir-Windows-x64.zip)
[![Download for Linux x64](docs/assets/download-linux-x64.svg)](https://github.com/FedyaLight/efir/releases/latest/download/Efir-Linux-x64.deb)
[![Download for Linux ARM64](docs/assets/download-linux-arm64.svg)](https://github.com/FedyaLight/efir/releases/latest/download/Efir-Linux-arm64.deb)
[![Download for Android](docs/assets/download-android.svg)](https://github.com/FedyaLight/efir/releases/latest/download/Efir-Android.apk)

Downloads and SHA-256 checksums are attached to each [release](https://github.com/FedyaLight/efir/releases/latest).
Speech language models are installed separately.

> **macOS:** the current build is ad hoc signed and **not notarized by Apple**.
> After trying to open the app, go to **System Settings → Privacy & Security → Open Anyway**, then confirm **Open**.
> Only do this for a download you trust. See [opening the Mac build](docs/macos-distribution.md#opening-the-current-build).

## Getting started

1. Open Efir on the computer. It starts in the controller.
2. Connect the phone to the same Wi-Fi network.
3. Select **Connect teleprompter** and scan the QR code.
4. Edit the script, choose its size and orientation, then press Play.

On Android, choose **Read on this device**, **Start server**, or **Connect to
server**. **Read here** opens the reading screen from the editor or preview.
Tap the text to play or pause. Controls hide during playback and return on pause;
the mirror and fullscreen buttons are available there.

If a VPN blocks the connection, enable **Allow LAN** or exclude the browser from
the tunnel. Guest Wi-Fi with client isolation prevents devices from connecting.

## Platforms

| Platform | Install or run | Requirements |
| --- | --- | --- |
| macOS | Open `Efir.app` | macOS 14+, Apple Silicon or Intel |
| Windows | Extract the whole ZIP; run `efir.exe` | Windows 10/11 x64, [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| Linux | `sudo apt install ./Efir-Linux-x64.deb` or the ARM64 package | Ubuntu 24.04+ |
| Android | Install `Efir-Android.apk` | Android 8+, a recent System WebView |
| Browser | Serve `web/` on HTTPS | A browser with WebRTC; speech support varies |

**The local macOS build is ad hoc signed and is not notarized.** Public
Developer ID distribution needs a separate signed build and Apple notarization.
See [macOS distribution](docs/macos-distribution.md) for the workflow and checks.

Windows packages keep `web/`, `speech/` and the DLLs beside `efir.exe`.
Closing a desktop window leaves its server running; use the menu-bar or tray
icon to reopen the controller or quit. On Android, a notification controls the
host service.

## Features

- Shared text layout in the controller preview and reading screen.
- Speed control, sections, horizontal/vertical mirrors, countdown and keyboard shortcuts.
- Offline native speech on macOS; Vosk on Windows/Linux; on-device recognition on supported Android devices.
- Script library, TXT/Markdown/DOCX import, settings profiles and portable JSON backups.
- English, Russian, Spanish, Simplified Chinese, Hindi and Arabic interfaces.
- Native screen protection on Android; browser fallback for local HTTP sessions.

Scripts stay in device storage. The server serves files and relays packets; it
has one shared session and does not save scripts. Speech models are installed
separately, and system WebViews keep the application packages small.

## Repository

| Path | Contents |
| --- | --- |
| `web/` | Shared UI, rendering, speech matching and transports; ES modules without a build step |
| `mac/` | Swift/SwiftUI shell, WKWebView, local server and native speech |
| `desktop/` | Rust/Tauri shell for Windows and Linux |
| `android/` | Kotlin shell, WebView and foreground server service |
| `script/` | Build and asset-generation utilities |
| `tests/` | Protocol, browser, performance and native integration checks |
| `docs/` | Usage, development, platform contracts and release verification |
| `site/` | Static multilingual project website; published with GitHub Pages |

## Development

On a Mac with Xcode installed:

```sh
./script/build_and_run.sh --build
open mac/build/Build/Products/Debug/Efir.app
```

The checked-in Xcode project works without manual setup. XcodeGen regenerates
it from `mac/project.yml`. Build products, local tools and signing keys are
excluded from Git.

- [Usage and troubleshooting](docs/usage.md)
- [Building each platform](docs/development.md)
- [Platform bridge and protocol](docs/platforms.md)
- [Running tests](tests/README.md)
- [Release verification](docs/verification.md)
- [Website and search discovery](docs/website.md)

Dependency licenses and provenance are kept beside the vendored sources:
[web assets](web/vendor/README.md), [FlyingFox](mac/Vendor/README.md),
[desktop runtime](desktop/licenses/THIRD-PARTY.txt) and
[Android dependencies](android/app/src/main/assets/licenses/THIRD-PARTY.txt).

## License

Efir's original code is licensed under [MIT](LICENSE). Third-party code, fonts
and bundled runtimes retain their own licenses; see the notices linked above.
