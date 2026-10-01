# Using Efir

## Connecting devices

The desktop application opens its controller immediately. Put the phone on the
same Wi-Fi network, select **Connect teleprompter**, and scan the QR code. The
phone opens the reader without a role chooser or room code. Internet access is
not needed. Several readers share the same script and controls.

The server chooses port 8765 or the next free port. Use the address shown by the
app. QR links use private Wi-Fi/Ethernet addresses, excluding VPN interfaces.
Choose an address in connection settings if the computer has more than one.

Closing the desktop window leaves the server running. Its menu-bar/tray icon
shows status and lets you reopen or quit. A connected external reader prevents
idle sleep of the server; it does not override a closed laptop lid or manual sleep.

If devices cannot connect, check their Wi-Fi network, firewall and VPN's
**Allow LAN** setting. Some guest networks isolate clients. Android VPNs can
also exclude the browser from the tunnel.

## Android modes

| Mode | Behaviour |
| --- | --- |
| Read on this device | Edit locally; select **Read here** to open the reader. The server listens only on loopback. |
| Start server | The Android device is the controller and serves other devices over Wi-Fi. It can also read locally. |
| Connect to server | Scan a QR, select a discovered server, or enter its local address. This device opens only the reader. |

The arrow returns from local reading to the editor. The fullscreen control
also becomes an arrow while fullscreen is active; its accessible label describes
the action in the selected language. On short screens, scroll the controller
panel to reach the remaining controls. Back from the controller opens
mode selection. The notification can reopen or stop a hosted server; the exit
dialog also has a stop action when notifications are denied. Switching to local
reading closes the public listener.

## Reading controls

**Read here** is available in the mobile editor and preview. Its adjacent mirror
button switches horizontal reflection for camera glass. The full reader has the
same mirror and fullscreen controls on its paused panel.

Tap the text to start or pause. Playback hides quick controls; pausing restores
them. A swipe scrolls the paused text, rather than starting it. Touch protection
blocks accidental scrolling while reading. The lock icon or a 0.7-second hold
unlocks manual scrolling; a hold is not treated as a tap.

The fullscreen button is an icon without a text label. Its floating version is
faint during playback; the paused toolbar lets you enter or leave fullscreen.
The native Android reader keeps the screen on, including while paused, and
releases the screen flag when backgrounded. In an HTTP browser, touch the reader
once if prompted to enable the local video fallback. Keep that tab foregrounded.

| Shortcut | Action |
| --- | --- |
| Space, B, period | Play/pause |
| Up/Down | Speed |
| Left/Right, PgUp/PgDn | Section |
| Home | Beginning |
| V | Voice mode on the controller |
| M | Mirror on the controller |
| +/− | Font size on the controller |
| E | Editor/preview |
| F | Fullscreen on the reader |

Bluetooth clickers can send the same keys to the reader.

## Scripts and settings

Import `.txt`, `.md` or `.docx`, or edit in the Text tab. A line beginning with
`#` creates a section; `[brackets]` mark presenter notes; `**asterisks**` add emphasis.
Edits go to connected readers. New or reloaded readers receive the current state
and reconnect after a short network interruption.

The preview matches the primary reader's dimensions. Its mirror checkbox shows
how the physical display looks; leave it off for an easily readable controller.
Profiles save display and voice settings. Library backups include scripts,
settings, speed and profiles; restoring merges scripts and replaces settings.
Keep a backup before moving to another device.

Choose a UI language from the header or paused reader panel. Each device stores
its choice independently. This does not translate scripts or change the speech
language. Arabic UI is right-to-left; script direction follows its own text.

## Offline speech

| Platform | Setup |
| --- | --- |
| macOS | Allow microphone and speech access. Install the selected language under System Settings → Keyboard → Dictation if needed. |
| Windows/Linux | Download and extract a [Vosk model](https://alphacephei.com/vosk/models), then select its folder in voice settings. |
| Android | Requires Android 12+ with an on-device recognition service. On Android 13+, the voice settings can request a language download. |

Models may require internet to install. Recognition itself uses only the device;
there is no cloud fallback. Availability depends on the language and installed
system service. A browser opened over local HTTP cannot use its microphone; use
the controller application's microphone instead.

Speed mode, manual scrolling and clickers remain available without recognition.
The on-screen transcript helps check what the recognizer heard; rereading a phrase
moves the reader back through the same word matcher.
