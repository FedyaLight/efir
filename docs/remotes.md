# Remote controllers and pedals

Open the keyboard button on the controller, or **Remotes and buttons** on the
reading screen. Pair the remote with the device running that window. Choose an
action, select **Assign button**, then press the remote button. Assignments are
local to that browser/device; they do not change script settings or other readers.
Remove a binding to disable that key, or reset to the built-in keyboard layout.

## Supported input paths

| Input | Setup and limits |
| --- | --- |
| USB/Bluetooth keyboard HID, presentation clicker | Works when its keystrokes reach the active Efir window. Learn unusual buttons. Defaults: Space/Enter/B/`.` play/pause; arrows change speed or section; PageUp/PageDown sections; Home start. |
| Programmable foot pedal | Configure keyboard mode first. For held scrolling, use a mode sending keydown on press and keyup on release, then assign Scroll forward/backward. |
| Media buttons | Play/Pause and previous/next track have defaults, and can be reassigned. The OS or browser may intercept these keys, including volume buttons. |
| Gamepad buttons/axes | Explicitly enable Gamepad, then learn each button or axis direction. Detection shows the number of exposed devices. Browser/WebView support varies; no direct USB/Bluetooth permission or driver integration is added. |
| Mouse wheel/jog mapped to wheel | Existing drag/wheel controls apply. Reader touch protection also blocks wheel seeking during playback until explicitly unlocked. |
| Proprietary BLE, MIDI, serial, app-only remote | Not automatically supported. Use a documented keyboard/Gamepad mode or a manufacturer utility that emits standard keystrokes. |

Play/pause, restart, sections and mirror fire once per press; speed/font keys can
repeat. Held scrolling stops on keyup, Gamepad release/disconnect, window blur,
page hiding or leaving the role. Gamepad ignores axes inside a 0.65 dead zone and
requires neutral input after activation/focus changes. Efir does not install
global system shortcuts. Typing, IME input and Ctrl/Alt/Meta shortcuts remain
available; Space/Enter on a focused button perform its normal action.

## Documented device examples

These are manufacturer-documented input modes, **not physical-device certification**:

- [AirTurn PED500 manual](https://cdn.shopify.com/s/files/1/1109/4160/files/PED500_Manual-English.pdf?v=1732643482), pp. 7–8, 14: Mode 2 Up/Down; Mode 3 PageUp/PageDown; Mode 4 media; Mode 5 Space/Enter. AirDirect and MIDI require separate integrations. Other AirTurn models have different mode numbers.
- [PCsensor manual](https://cdn.pcsensor.com/wp-content/uploads/2025/04/A4-USB%E8%8B%B1%E5%BE%B7-%E8%87%AA%E5%AE%9A%E4%B9%89%E8%84%9A%E8%B8%8F%E5%BC%80%E5%85%B3%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-V1.pdf): programmable HID keys, wheel and media buttons.
- [OM SYSTEM pedal configuration](https://support.jp.omsystem.com/en/support/imsg/vtrek/download/software/rs27h/pdf/Foot_Switch_Configuration_Tool_Help_win_en_v201.pdf), pp. 4–5: Keyboard mode, Single/Double/Long press semantics. Long supports press-and-hold scrolling; Double intentionally emits two separate presses.
- [8BitDo Micro FAQ](https://support.8bitdo.com/faq/micro.html): configurable keyboard mode via Ultimate Software.
- [Elgato Stream Deck Hotkey](https://help.elgato.com/hc/en-us/articles/360027357712-Elgato-Stream-Deck-System-Actions): configure System → Hotkey for the active Efir window.

The need for configurable hardware is reflected in user reports about
[RT113 with another app](https://www.reddit.com/r/neewer/comments/1oc140j/rt113_teleprompter_remote_as_a_standard_controller/)
and [Contour delivery to QPrompt](https://forum.cuperino.com/t/hardware-control-on-windows-using-the-contour-multimedia-controller-xpress/227).
They do not establish a universal protocol for those devices.

If no key appears while assigning, check input in a text editor and the remote's
mode. For Gamepad, press a hardware button to let the browser expose the device.
An OS-intercepted key or private protocol cannot be fixed by assigning it in Efir.
