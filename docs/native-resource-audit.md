# Native resource changes

Checked October 12, 2026, against main `2dead9b`. These changes accompany the shared web resource audit and keep the existing relay and prompting behavior.

| Platform | Finding | Change |
| --- | --- | --- |
| Windows / Linux server | GET reads an entire asset, then copies its requested range; large slow downloads retain whole buffers. | Seek to the requested offset and stream up to 64 KiB at a time under HTTP backpressure. HEAD, ETag, Content-Length, MIME and byte ranges remain intact. No new dependency. |
| Windows / Linux shell | The full translation JSON is parsed for each native menu or speech status translation. | Initialize one read-only catalogue with OnceLock; continue reading the current language on each call. |
| Windows / Linux shell | Explicit WebView visibility is sent on tray hide/reopen, but minimized-window transitions have no adapter message. | Report actual visibility/minimization on focus and resize events, only when that state changes. Losing focus while still visible keeps previews active. |
| Android server | Each send has a necessary five-second watchdog, but cancelled watchdog tasks stay in the scheduled executor queue until their deadline. | Enable remove-on-cancel on the same single executor. Retain socket deadlines, bounded packet/byte queues, idle-client expiry and shutdown behavior. |
| macOS speech | The microphone/speech state is delivered repeatedly even when unchanged, including one-second listening timer updates. | Send changed state/message pairs only. Reset for a new recognition session; preserve transcripts, final results, retry logic, rereading and microphone release. |

## Verification

- macOS app builds through the existing `script/build_and_run.sh --build`; this does not launch or replace the personal running app.
- The full Tauri shell checks locally with Cargo on macOS, and the production Rust relay builds/runs through `tests/RustServerHarness`.
- HTTP/WebSocket tests run against the original and changed Rust servers. Asset bytes are compared with a local fixture; supported ranges cover prefix, open-ended, suffix and unsatisfiable requests. Exact relay, no echo, fragmentation, shared-session semantics, conditional requests and HEAD remain covered.
- An additional 64 MiB patterned fixture verifies range bytes across a 64 KiB chunk boundary.
- Four concurrent paused downloads of that fixture produced these process RSS samples on the same Mac, using debug server binaries and the same files:

| Sample | Original | Streaming |
| --- | ---: | ---: |
| Initial RSS | 8.2 MiB | 8.3 MiB |
| Peak RSS with four slow downloads | 393.3 MiB | 12.5 MiB |

This is a deliberately large stress asset, not a typical bundled font. The numbers measure process memory, not battery use or all operating systems. Small real assets benefit from avoiding whole-file/range copies, but the exact RSS reduction depends on workload and allocator.

Android release/lint and Windows/Linux builds are run by the repository's normal PR CI matrix. Native minimize/restore behavior and actual Android executor/battery use still require physical or VM lifecycle checks; compilation and shared browser adapter tests do not certify those devices. Speech transcript matching and microphone processing are preserved, rather than reduced in quality or frequency.
