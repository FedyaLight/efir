# Platform architecture

`web/` owns the editor, library, roles, layout, scrolling, voice matching and
session protocol. Native shells host these files and supply OS capabilities.
The HTTP/WebSocket implementations serve files and relay packets; they neither
store scripts nor interpret playback commands.

## Native bridge, version 1

The shell installs this object before loading ES modules:

```js
window.efirNative = {
  version: 1,
  platform: 'macos',
  deviceName: 'Mac',
  role: 'controller',
  uiLanguage: 'en',
  publicOrigin: 'http://192.168.1.23:8765',
  capabilities: { speech: true, fullscreen: true, sessionAwake: true },
  postMessage(message) { /* Send a structured message to the shell. */ },
};
```

Web code selects behavior through capabilities, not OS names. An optional
`ready` promise supplies fresh settings before startup, also after reload.
`web/js/platform.js` adapts this contract and the legacy macOS bridge.

| JS → shell action | Fields | Purpose |
| --- | --- | --- |
| `voiceStart` | `lang`, such as `ru-RU` | Start offline recognition |
| `voiceStop` | — | Release recognition and microphone |
| `fullscreen` | — | Toggle native fullscreen |
| `sessionActive` | `active` | Hold the host system awake for readers |
| `screenAwake` | `active` | Hold the native reader display awake |
| `language` | `language`: `ru/en/es/zh/hi/ar` | Persist UI language |
| `selectAddress` | `address` | Select a validated hardware LAN address |
| `voiceModel` | `lang` | Choose Vosk model or request Android offline language |
| `showPrompter` | — | Open Android's own reading screen |
| `back` | — | Return to Android editor or mode selection |
| `exportFile` | `name`, `type`, `text` | Save through Android's file picker |

Once the page is ready, the shell delivers these events:

```js
window.efirNative.onTranscript(text, isFinal);
window.efirNative.onState('listening');
window.efirNative.onState('unsupported', 'This language is not available offline.');
window.efirNative.onFullscreen(true);
window.efirNative.onAwake(true);
window.efirNative.onLanguage('es');
window.efirNative.onVisible(false);
window.efirNative.onAddress('http://192.168.1.23:8765', addresses);
```

Microphone states are `listening/hearing/denied/unsupported`. All transcript
sources use `VoiceTracker._hear`; native recognition keeps the shared matcher.

## Transport and session state

- `GET /efir-local.json` returns `{local: true, version, hostName, platform}`.
  Without it, static hosting uses PeerJS/WebRTC and BroadcastChannel.
- Files have MIME types, ETags, HEAD support and immutable font caching.
- `/ws?room=LOCAL` relays unchanged messages to every other client. Local hosting
  has one session; the query parameter does not isolate rooms.
- `__efir_ping` without `from` receives `__efir_pong` with the original `ts`.
- Other packets have `t/from/role/seq`. `Room` owns deduplication, heartbeat and
  exponential reconnect. QR addresses exclude VPN interfaces.

The port is 8765 or the next free port. Hosts publish `_efir._tcp` with Bonjour.
Android uses NsdManager during mode selection; browsers use QR or a URL.
Windows/Linux refresh hardware addresses every three seconds; Android receives
ConnectivityManager events. Standalone Android binds only loopback, without
Bonjour or a server notification.

A reader greeting includes viewport, script version (`sid`), `session` and
`ready`. An existing reader can restore a reopened controller. New readers
receive targeted `settings`, `script`/`scriptPart`, then `session` with
`to/tag/state`. They wait for the complete matching script before restoring.
`state.sync` acknowledges the tag, blocking stale preview state until then.
Equal viewports use exact pixels; different viewports use word and line offsets.
Playback, countdown, speed and voice index resume.

Reader taps apply play/pause and send that absolute command to the controller,
so multiple controllers cannot toggle it twice. Quick mirror changes
apply locally, then the controller persists and distributes them. Fullscreen is
device-local. Readiness changes are event-driven, without a polling timer.

## Resource ownership and trust

macOS keeps its server alive independently of windows. System sleep prevention
allows the Mac display to sleep. Windows/Linux close to tray, stop the microphone
and report hidden state; reopening restores the existing window.

Android preserves the controller WebView while reading and stops its render
loop. The visible reader uses `FLAG_KEEP_SCREEN_ON`, without wake video.
Public hosting runs in a foreground service; only external clients hold its
CPU WakeLock. Mode changes replace the listener and release the old lifecycle.
A generation check prevents stale asynchronous server starts.

All servers bound message sizes and slow-client queues. Bridges accept trusted
main-frame origins and the intended role. Android uses a document-start script
and WebMessageListener with exact origin checks; Tauri checks its local controller
URL and window label. Owners stop speech when closed.

`Stage` uses integral vertical dimensions locally to prevent WebKit/Chromium drift.
Linux disables GTK glyph-width rounding within its own process. Preview dimensions
match the reader's CSS viewport before scaling.

## Localization and portable data

`web/locales/messages.json` is shared by web and native shells. Russian UI strings
are lookup keys; rows follow the declared language order. Keep substitutions such
as `{name}` intact. Plural forms use `Intl.PluralRules`. Scripts, titles,
transcripts and user profiles are excluded. Shell language has priority over a
web preference; changing it does not restart transport, scrolling or recognition.

`web/js/words.js` supplies matching word indices without ICU-dependent segmentation.
Han characters are tokens, Hindi vowel marks remain within words and Arabic
diacritics are normalized. Script direction follows content, independently of UI.

Backups are UTF-8 JSON: `format: "efir-backup"`, `version: 1`, `scripts/settings/
speed/profiles/currentId`. Profiles contain `id/name/settings`. The file excludes
OS paths, URLs, device IDs and audio. Import validates first, preserves scripts,
merges duplicates and rolls back on storage failure. Data currently lives in
localStorage; shells can migrate storage without changing the portable format.
