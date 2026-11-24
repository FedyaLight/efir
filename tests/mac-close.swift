import AppKit
import WebKit

// Run in the isolated bundle staged by mac-close.sh.
@main
@MainActor
final class MacCloseTest: NSObject, NSApplicationDelegate {
    private let model = AppModel()
    private let mode = CommandLine.arguments.last!
    private var quitStart: ContinuousClock.Instant?
    private var quitWindow: NSWindow?
    private var deferredQuit = false

    static func main() {
        let app = NSApplication.shared
        let test = MacCloseTest()
        app.delegate = test
        DispatchQueue.global().asyncAfter(deadline: .now() + 20) {
            fputs("AppKit close test exceeded its deadline\n", stderr)
            exit(1)
        }
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        Task {
            await until("controller loaded") { self.model.running && self.controller != nil }
            let controller = controller!
            await waitForPage(controller)
            if mode.hasPrefix("quit-") {
                if mode == "quit-confirm" { await showConfirm(controller) }
                if mode == "quit-busy" { await occupyJavaScript(controller) }
                quitWindow = controller.window
                quitStart = .now
                NSApp.terminate(nil)
            } else {
                await testFlush(controller)
                await testBlockedWindows()
                print("PASS close")
                NSApp.terminate(nil)
            }
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        deferredQuit = model.prepareToQuit { sender.reply(toApplicationShouldTerminate: true) }
        return deferredQuit ? .terminateLater : .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let quitStart, let quitWindow {
            let elapsed = quitStart.duration(to: .now)
            require(deferredQuit, "AppKit did not use the deferred quit path")
            let expected = mode == "quit-busy" ? .seconds(2)...Duration.seconds(4) : .zero...Duration.seconds(4)
            require(expected.contains(elapsed), "deferred quit took \(elapsed)")
            require(!quitWindow.isVisible && quitWindow.attachedSheet == nil, "quit left a sheet or window open")
            print("Deferred \(mode): \(elapsed)")
            print("PASS \(mode)")
        }
        model.shutdown()
    }

    private var controller: RoleWindow? {
        NSApp.windows.compactMap { $0.delegate as? RoleWindow }.first
    }

    private func require(_ condition: Bool, _ label: String) {
        guard condition else {
            fputs("\(label)\n", stderr)
            exit(1)
        }
    }

    private func until(_ label: String, timeout: Duration = .seconds(4), _ check: () async -> Bool) async {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if await check() { return }
            try! await Task.sleep(for: .milliseconds(20))
        }
        require(false, "Timed out: \(label)")
    }

    private func evaluate(_ window: RoleWindow, _ script: String) async -> Any? {
        try? await window.webView.evaluateJavaScript(script)
    }

    private func waitForPage(_ window: RoleWindow) async {
        await until("web controller loaded") {
            await evaluate(window, "!!(window.efirNative?.onClose && document.querySelector('.ed-text'))") as? Bool == true
        }
    }

    private func showConfirm(_ window: RoleWindow) async {
        Task { _ = await evaluate(window, "confirm('Pending confirmation')") }
        await until("confirm sheet shown") { window.window.attachedSheet != nil }
    }

    private func occupyJavaScript(_ window: RoleWindow) async {
        _ = await evaluate(window, "setTimeout(() => { const end = performance.now() + 5000; while (performance.now() < end) {} }, 0)")
    }

    private func testFlush(_ window: RoleWindow) async {
        let socket = URLSession.shared.webSocketTask(with: URL(string: "ws://localhost:\(model.port)/ws?room=LOCAL")!)
        socket.resume()
        try! await socket.send(.string("{\"t\":\"__efir_ping\",\"ts\":1}"))
        let bye = Task {
            var ready = false
            while case let .string(message) = try await socket.receive() {
                if message.contains("\"__efir_pong\"") { ready = true }
                if message.contains("\"bye\"") { return ready }
            }
            return false
        }
        let title = UUID().uuidString
        let body = UUID().uuidString
        let start = ContinuousClock.now
        let edited = await evaluate(window, """
            const set = (selector, value) => {
                const field = document.querySelector(selector);
                field.value = value;
                field.dispatchEvent(new Event('input', {bubbles: true}));
            };
            set('.ed-title', '\(title)');
            set('.ed-text', '\(body)');
            set('[data-k=fontSize] input', '59');
            true;
            """) as? Bool
        require(edited == true, "could not edit the controller")
        window.window.performClose(nil)
        await until("successful flush closes immediately", timeout: .seconds(2)) { !window.window.isVisible }
        require((try? await bye.value) == true, "relay did not receive bye")
        socket.cancel()
        print("Normal flush and bye: \(start.duration(to: .now))")

        model.openController()
        let reopened = controller!
        await waitForPage(reopened)
        let persisted = await evaluate(reopened, """
            [document.querySelector('.ed-title').value, document.querySelector('.ed-text').value,
             document.querySelector('[data-k=fontSize] input').value].join('|')
            """) as? String
        require(persisted == "\(title)|\(body)|59", "controller edits were not persisted: \(persisted ?? "missing")")
        reopened.requestClose()
        await until("reopened window closed") { !reopened.window.isVisible }
    }

    private func testBlockedWindows() async {
        let confirm = RoleWindow(code: model.room, port: model.port, origin: model.origin,
                                 addresses: model.addresses, speech: model.speech)
        let busy = RoleWindow(code: model.room, port: model.port, origin: model.origin,
                              addresses: model.addresses, speech: model.speech)
        confirm.show()
        busy.show()
        await waitForPage(confirm)
        await waitForPage(busy)
        await showConfirm(confirm)
        await occupyJavaScript(busy)
        let start = ContinuousClock.now
        var confirmCloses: [Duration] = []
        var busyCloses: [Duration] = []
        confirm.onClose = { confirmCloses.append(start.duration(to: .now)) }
        busy.onClose = { busyCloses.append(start.duration(to: .now)) }
        confirm.requestClose()
        confirm.requestClose()
        busy.window.performClose(nil)
        await until("confirm and busy WebViews both close", timeout: .seconds(4)) {
            !confirm.window.isVisible && !busy.window.isVisible
        }
        require(confirm.window.attachedSheet == nil, "confirm sheet was not dismissed")
        let elapsed = start.duration(to: .now)
        // Keep both owners alive past the late JavaScript completion.
        try! await Task.sleep(until: start + .seconds(6), clock: .continuous)
        require(confirmCloses.count == 1 && busyCloses.count == 1, "close callback should run once per window")
        require(confirmCloses[0] > .seconds(2) && busyCloses[0] > .seconds(2),
                "both blocked windows should reach the flush deadline")
        print("Concurrent close with confirm and busy JS: \(elapsed), one callback each")
    }
}
