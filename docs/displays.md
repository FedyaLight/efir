# Several teleprompters in one session

One server can relay to several reading screens. Connect each screen with the
same QR/link; use one controller as the operator. Native local sessions remain
one shared session, without internet. Hosted sessions use the same display
messages over the existing WebRTC transport.

## Leading screen and synchronized reading

**Leading teleprompter** chooses the screen that owns the scrolling position and
pace. Other screens follow its passage, including their own line wrapping. The
protocol carries the words at adjacent source line starts and progress between
them; followers interpolate those word positions in their layout. Matching
viewports and layout settings preserve exact pixels. Different font sizes or
margins use the word anchor even when the screen dimensions are identical.

Play/pause, speed, section jumps, pedal scrolling and seeking from any reader
control the shared session. The controller resolves sections once against the
leading layout. A follower's drag/wheel seek is translated from its own layout.
Only the leading reader uses its microphone when reader-side voice is selected;
controller-side speech is still shared by all readers.

If the leading screen disconnects or becomes hidden, the controller chooses an
available visible reader and keeps its current passage and playback state.
Selecting another leading screen can change the physical scrolling pace because
its wrapping becomes authoritative. A short interruption can leave screens
running from their last state until the connection recovers; they realign from
the leading screen. This is software prompting, not frame-locked video output.

## Exact previews and format comparison

**All screens** shows the leading preview and each other screen at its actual
CSS viewport dimensions, font, margins, marker and orientation. Each preview is
scaled as a whole. It follows that reader's acknowledged state rather than
inventing a common picture. Disconnected secondary displays show a dimmed last
frame with an explicit disconnected label; they do not continue animating.
A preview without state updates for more than 3.5 seconds freezes and is explicitly marked as stale. Turning off the grid stops its animation loops.

**Compare formats** shades the region outside the intersection of the compared
screen formats. Each other rectangle fits inside the target rectangle without
changing its aspect ratio; horizontal centers and reading lines are aligned.
For 1600×1000 (16:10) and 1600×900 (16:9), with reading lines at 40%, the taller
preview has 40 px shaded above and 60 px below the smaller format. The wider
format can show shaded side strips when compared to a taller aspect ratio.
The comparison respects vertical mirroring when mirrored preview is enabled.

This is a geometry guide. Different fonts, margins and wrapping mean it cannot
promise that every word inside a rectangle is visible on every screen. Use the
individual previews to inspect the actual text. The shaded region appears on
the operator preview only; it does not darken the reading screens.

## Independent display settings

Open **Settings for this screen** under a preview or on the reader. Name a
screen (for example Camera 1), and enable overrides for font size, symmetric or
separate left/right margins, top/bottom padding, reading-line position and
horizontal/vertical mirroring. Omitted overrides inherit the shared controller
settings. **Use shared settings** removes overrides while retaining the name.
An explicit left/right margin takes precedence over the symmetric side margin.

The reader URL includes `?screen=…`, a stable display identifier distinct from
its network connection ID. Keep/bookmark this link to reopen the same display
profile. Profiles are saved on the reader and operator, survive reload and are
resent after reconnect. If the same saved reader link is opened concurrently, the newer reader takes a distinct identity and copies the calibration. Different windows opened with the controller's new-window
button receive distinct display IDs. Opening a fresh QR link creates a new
screen identity; it does not silently reuse another screen's calibration.

The server relays profiles but does not persist them. Device-local calibrations
are not part of portable script/settings backups. All clients in a production
session should use the same app version. Real Safari/WKWebView, WebView2,
WebKitGTK and Android hardware still need device checks; browser automation
cannot certify monitor timing or physical screen behavior.

## Verification

Checked on October 12, 2026 with Chromium and the production Swift relay:

- Three independent readers: 1600×1000, 1600×900 and 500×900, including different fonts on equal-size viewports.
- A 2600-word chunked script, 14 seconds of playback at speed 10, per-screen preview geometry and shared follower seeking.
- Display calibration and identity persistence, concurrent duplicate links, rotation, controller reload, leader selection/disconnection and stale previews freezing/recovering for both leading and secondary readers.
- Existing remote, browser, responsive-layout and resource-activity checks. These verify browser behavior, not physical remotes or native rendering engines.

## Evidence behind the workflow

- A [multi-screen operator request](https://www.reddit.com/r/VideoProfessionals/comments/10qf346/multiscreen_teleprompter_options/) describes three readers, different iPad sizes showing different passages, and globally mirrored text breaking ordinary monitors.
- [QPrompt #123](https://github.com/Cuperino/QPrompt-Teleprompter/issues/123) asks for a narrower reading column to reduce eye movement.
- [Teleprompter Pro's remote guide](https://guide.teleprompterpro.com/teleprompter/remote-control/) documents one Master, several receiving devices and independent mirroring; it warns about competing Masters on different display sizes.
- [EasyPrompter remote casting](https://easyprompter.com/features/remote-casting) describes independent display layout, a shared position and reconnection. Its latency claims are product descriptions, not measurements of Efir.

The specific shaded 16:10/16:9 comparison comes from this project's requested
workflow. These sources support the surrounding operator and calibration needs;
they do not establish a quantified market demand for the shading itself.

The [full research report](research-prompters.md) separates user requests, manufacturer documentation and engineering proposals.
