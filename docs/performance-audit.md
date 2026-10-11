# Resource audit from startup to shutdown

Baseline: main `2dead9b`, October 12, 2026. The audit follows the browser app, macOS shell/Swift relay, Windows and Linux Tauri shell/Rust relay, and Android Activity/WebView/service/relay. The homepage star link is a separate PR; the [native resource changes](https://github.com/FedyaLight/efir/pull/4) are independent of the shared renderer changes.

## Lifecycle coverage and decisions

| Stage | Owners inspected | Result |
| --- | --- | --- |
| Startup and website entry | `app.js`, `environment.js`, `rtc.js`, site generation, all native bootstraps | Local hosting still avoids PeerJS and external discovery. Stop homepage animation when reduced motion is requested, its demo is outside the viewport, or the page is hidden. Resume immediately when appropriate. |
| HTTP assets | Swift `SiteHandler`, Rust `site`, Android `serveHttp` | Preserve ETag/HEAD, hashed-font caching and existing path handling. Rust whole-file/range copies are replaced with bounded streaming in the native PR. Swift mapping and Android InputStream delivery already avoid that particular double copy. |
| Connections and relay | `net.js`, Swift `RelayHub`, Rust `Hub`, Android `Client` | Keep exact relay, shared native sessions, packet queues, socket deadlines, heartbeat, sequence deduplication and reconnect. Heartbeats are needed for presence and failure detection; lowering their rate would change recovery behavior. |
| Script import, parsing and storage | controller library/editor/import/backups, `store.js`, `words.js`, `Stage` | Preserve local scripts, portable backups, word spans and Unicode segmentation used by speech/seeking. Existing separate position storage avoids rewriting the full script every frame. Do not add unbounded caches or virtualize away words needed for exact layout and speech. |
| Settings and layout | `Stage.setSettings`, per-display overrides, fonts, viewport/rotation handling | Cache the layout signature until settings change. Reuse measured geometry for appearance-only changes and identical settings, while redraws still apply colors/visibility. Real font/margin/marker/text/viewport changes continue to invalidate geometry. |
| Live prompting and preview | `Engine`, `FrameLoop`, controller, reader, `DisplayViews` | Keep frame-rate scrolling and the existing state-send cadence. Stop rewriting unchanged screen labels. Omit redundant profile/display identifiers from high-rate state packets; they remain in hello/presence and dedicated profile messages. Update previews from the latest state after returning to a visible view. |
| Voice and hardware controls | browser/native speech, `VoiceTracker`, `remotes.js` | Keep recognition, transcript cadence, rereading, neutral arming, held-button release and keyboard/media behavior. Stop Gamepad polling when unfocused or hidden, including native visibility signals. Resume on focus/foreground; update diagnostic text only when it changes. Native PR caches translations and removes duplicate speech-state IPC. |
| Hidden views and connection help | platform adapter, macOS occlusion, Tauri hide/minimize, Android pause/read-here, LAN diagnostics | Skip hidden secondary-preview restoration and stationary reader-state sends; transport presence continues. Suspend hidden connection-help UI work and refresh on return. Tauri minimize/restore visibility is forwarded in the native PR. |
| Screen/system protection | browser Wake Lock or 1 fps fallback video, macOS activity, Tauri keepawake, Android flags/service WakeLock | Preserve protection during reading and pause. Removing it can let screens or the host sleep during a live session. Android already uses its screen flag instead of browser video; external-client service CPU protection remains bounded and released when unnecessary. |
| Teardown and retries | role destroy/pagehide, frame loops, timers, speech stop, socket disconnect, service destroy | New observers/listeners/timers are removed with their owner. Keep existing retry backoff, generation guards, bounded audio queues and cancellation. Android cancelled send-watchdog tasks are removed immediately in the native PR. |

## Shared renderer measurements

The expanded `tests/performance.mjs` uses one controller and three isolated Chromium readers (844×390, 1600×900, 500×900), a long script, and eight-second samples. It measures real animation callbacks, DOM mutations, storage writes, WebSocket bytes and Chromium main-thread task time. HTTP screen protection remains active on the primary reader.

| Eight-second sample | Baseline | Changed |
| --- | ---: | ---: |
| Unchanged secondary-screen label mutations, scrolling | 1476 | 0 |
| Unchanged secondary-screen label mutations, paused / settled voice | 24 / 24 | 0 / 0 |
| Controller main-thread CPU, scrolling | 9.23% | 7.86–8.33% in two samples |
| Bytes sent by controller + three readers, scrolling | 499523 | 449451 in the final sample |
| Primary reader animation callbacks, paused / settled voice | 0 / 0 | 0 / 0 |
| Hidden native controller with Gamepad enabled, 600 ms | 36 callbacks | 0 |
| Reduced-motion homepage demo, 600 ms | 36 callbacks | 0 |
| Offscreen homepage demo, 600 ms | Continuous loop in baseline | 0 |

CPU timing is noisy and workload-dependent; these are individual runs on the same Mac, not a guaranteed percentage on every device. The robust improvements are elimination of redundant label writes, hidden polling and oversized server buffers. Wire-byte measurements cover sends by the four clients, not total network-interface traffic or a battery estimate. The server still fans out packets using its existing relay semantics.

The [native audit](https://github.com/FedyaLight/efir/pull/4) records a deliberately large slow-download stress case: peak Rust relay RSS changed from 393.3 MiB to 12.5 MiB. Normal bundled assets are much smaller.

## Behavioral proof

- `tests/performance.mjs` protects three-screen resource activity, pause/voice idle behavior, screen protection, native hidden Gamepad polling, reduced-motion changes, offscreen demo suspension and resume. The baseline fails the label-churn and hidden-poll regressions for the intended reasons; the reduced-motion baseline also produces continuous frames.
- `tests/remotes.mjs` covers learning, saved keys, repeated/held input, editing/dialog protection, release and browser Gamepad signals.
- `tests/browser.mjs` covers script/settings synchronization, pause/play, mirrors, sections, reconnect, native transcript delivery/rereading, backups, wake protection and six-language behavior. Maximum measured preview error remains below one CSS pixel, with no external requests in local mode.
- `tests/displays.mjs` covers different wraps and fonts, precise previews, format shading, per-screen calibration, follower seeking, duplicate links, reload/rotation, leader failover and stale-state recovery. Its source screen is selected by its user-visible name after reconnect, rather than assuming connection arrival order.
- The responsive matrix covers six languages, two themes, seven sizes and Android hosting/standalone, desktop, local browser and hosted adapters.
- `tests/hosting.mjs` uses real PeerJS/WebRTC, delayed negotiation, broker loss and a configurable PeerServer.
- Native HTTP/WebSocket tests, Cargo and macOS builds are described in the native audit. Repository CI builds Android release/lint, macOS, Windows x64 and Linux x64/ARM64.

## Limits of the audit

Shared browser behavior is exercised with actual pages and production relays. Platform adapters in Chromium are contract checks, not substitute native rendering engines. The local native builds run on macOS; other compilation checks come from CI. Physical phone battery, GPU/compositor cost, real keyboard/Gamepad hardware and minimize/restore on every Windows/Linux desktop environment are not measured here.

A long physical reading session with the intended devices is still the right boundary for battery and display timing. It should cover foreground, screen rotation, minimizing/reopening the operator, network loss and voice use. The changes do not lower scrolling frame rate, recognition quality, synchronization cadence, keep-awake protection or supported script functions to obtain the measured reductions.
