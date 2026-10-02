# Verification

Last checked: October 1, 2026. Tests use isolated profiles and dedicated
servers; the personal Mac library is excluded. Commands and test boundaries
are in [tests/README.md](../tests/README.md).

## Automated and local checks

| Platform or boundary | Evidence and limits |
| --- | --- |
| macOS | Release xcodebuild; universal arm64/x86_64 executable; bundle integrity; direct controller launch; HTTP marker and relay |
| Windows x64 | Release cross-build and native MSVC/NSIS CI build, runtime DLL and resource inspection; no Windows GUI run yet |
| Linux ARM64 | Release package; actual WebKitGTK, native IPC, fullscreen, language reload and connected Chromium reader |
| Linux x64 | Release DEB and ELF inspection; no x64 GUI run yet |
| Android API 35 | Actual Activity/WebView/service instrumentation, standalone, hosting and mode changes; release APK signing and launch |
| Local protocol | Same HTTP/WebSocket contract against Swift, Rust and Android servers |
| Shared web | Offline requests, sync, profiles/backups, reload/reconnect, voice forwarding, rereading and six UI languages |
| Static hosting | Real PeerJS/WebRTC between separate Chromium profiles without the local marker |
| Offline speech | Linux Vosk decodes official PCM using a real model; microphone quality remains a device check |

The mobile regression originally failed because Read here was hidden at narrow
widths and tapping text did not start playback. Updated flows check visible
touch-sized controls, tap play/pause, hidden controls during playback, quick
mirror and fullscreen. Connection-screen fade no longer intercepts taps.

The 1.3.2 layout checks cover six languages, light/dark themes and seven viewport
sizes from 320×640 to 1440×900. They exercise Android standalone/hosting, desktop,
local browser and static-hosting interfaces, plus connection dialogs, home and
waiting screens. Exit controls use icons with translated accessible labels;
long dialog buttons wrap and short controller panels scroll. Android shows one
Read action per visible pane. This is responsive-browser coverage, not a claim
that every physical device or operating-system version has been tested.

The local Chromium preview differs by less than one CSS pixel. Actual
WebKitGTK/Chromium comparisons across portrait, landscape and multilingual
scripts remain within two CSS pixels.

macOS artifacts are ad hoc signed and **not notarized**. Windows artifacts have
no Authenticode signature. See [macOS distribution](macos-distribution.md) before
shipping a Developer ID release. Remote build results are available in
[GitHub Actions](https://github.com/FedyaLight/efir/actions/workflows/build.yml).
All five platform jobs passed in the [October 1 run](https://github.com/FedyaLight/efir/actions/runs/36852451392):
macOS universal, Windows x64, Linux x64, Linux ARM64 and Android release/lint.
The CI Android artifact is unsigned; the public release APK uses the local
release key. A successful CI build does not replace the device checks below.

## Published website

The [project website](https://fedyalight.github.io/efir/) was checked on October 1,
2026: six languages render without JavaScript at mobile, tablet and desktop
widths. Internal links, downloads, canonical/language alternatives and structured
data were inspected. The hosted browser files match `web/` byte for byte.
Two independent Chromium profiles on the public HTTPS site synchronized a script
through real WebRTC; reader links preserve the `/efir/app/` path. These are
publication checks, not proof of search-engine indexing or ranking.

On October 2, the app replaced the product landing page at the website root.
A Chromium check at 390 pixels verified direct entry at `/`, legacy `/app/`
and `/ru/`, all six translated download notes, and script synchronization from
the root controller to a root reader using BroadcastChannel. The six static
download pages loaded their assets and linked back to the app. No horizontal
overflow or JavaScript errors were observed. This is an entry-point and layout
check, not another cross-device WebRTC verification.

## Hosted connection recovery (October 1)

The hosting regression delays real PeerJS negotiation messages by 12 seconds.
The pre-fix client repeatedly abandons negotiation at eight seconds and fails to
pair; the updated client pairs and delivers script messages. A second check
blocks signaling after pairing and verifies that the established data channel
still delivers messages. These are Chromium checks, not Safari/Android network
reproductions.

The connection report was checked in all six languages at a 390-pixel viewport,
including clipboard output from a real Room. A local-marker startup check made
no external or ICE-configuration requests. The public deployment remains
STUN-only: networks blocking direct WebRTC still require a TURN service or the
native local mode. Safari on Mac with Chrome on a physical Android device
remains a user-side check.

The follow-up signaling checks distinguish a closed WebSocket from a responding
broker rejecting a key; they no longer suggest TURN while signaling is down.
Custom host/port/path/key options were exercised against official PeerServer
1.0.2 with two independent Chromium profiles and the public broker blocked.
The connection report was checked in six languages at 390 pixels. This verifies
configuration and reporting, not access from the reported Mac/Android network.
The public site still uses `0.peerjs.com`; no replacement service was deployed.

A first failed broker dial exposed competing `error` and `disconnected` retry
timers: a stale restart could destroy negotiation after signaling recovered.
The regression closes the first socket, delays real negotiation, and refuses
new sockets after the recovered offer. The previous version fails to pair;
the fixed version pairs and delivers the script over the recovered connection.
Retries use one timer with exponential delays, capped at a 15-second base plus
jitter. This check uses the actual public broker and Chromium data channels.

## Resource activity

An eight-second Chromium sample from the 1.3.1 verification run:

| Reader state | Animation frames | localStorage writes | Main-thread CPU |
| --- | ---: | ---: | ---: |
| Paused | 0 | 0 | 0.072% |
| Scrolling | 481 | 1, 54 bytes | 1.325% |
| Voice position settled | 0 | 0 | 0.085% |

The HTTP fallback is local 16×16 video at 1 fps with silent audio. Native Android
uses `FLAG_KEEP_SCREEN_ON`, without decoding video. Hidden native WebViews stop
drawing. Server WakeLock and host sleep prevention depend on external clients;
message sizes and slow-client queues are bounded.

These figures establish idle behavior, not battery consumption. Build/test
logs are in ignored `work/platform-builds/` and `work/repo-cleanup/`.

## Physical-device checklist

- [ ] Windows 10/11 x64: launch, icon, tray, reopening, import/export, QR, LAN
      address selection, Vosk microphone and private-network firewall access.
- [ ] Ubuntu 24.04 x64 and Intel Mac: install, launch and connect a phone.
- [ ] Disable internet but keep Wi-Fi. Connect Android to each desktop host;
      check text, settings, speed, sections, mirrors and viewport alignment.
- [ ] Enable VPN on host and phone; test Allow LAN or browser split tunneling.
- [ ] Android standalone: import, Read here, mirror, fullscreen, tap play/pause,
      return to editor and retain scripts after restarting.
- [ ] Android hosting: connect a second device, close Activity, stop through the
      notification, switch to standalone and confirm public hosting stops.
- [ ] Grant and deny camera, microphone and notification permissions.
- [ ] Two readers, reload either side and interrupt Wi-Fi; recovery needs no code.
- [ ] Native Android and HTTP browser: read and pause for 10+ minutes with a
      30-second display timeout. Touch the browser once to activate protection.
- [ ] Compare battery usage over 20–30 minutes at fixed brightness and network,
      both paused and scrolling; check background/resume behavior.
- [ ] Install an offline language/model and test the microphone with internet
      off. Missing models must show a useful installation hint.
