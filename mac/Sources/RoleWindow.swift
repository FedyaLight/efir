import AppKit
import WebKit

@MainActor
final class RoleWindow: NSObject, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate,
    WKUIDelegate, WKDownloadDelegate
{
    let window: NSWindow
    let webView: WKWebView
    var onClose: (() -> Void)?
    var onSessionActive: ((Bool) -> Void)?
    var onSelectAddress: ((String) -> Void)?
    private let port: Int
    private let speech: NativeSpeech
    private var originForPage: String
    private var addresses: [LANAddress]
    private var lastVisible: Bool?
    private var closing = false
    private var closeTimeout: Timer?

    init(code: String, port: Int, origin: String, addresses: [LANAddress], speech: NativeSpeech) {
        self.port = port
        self.speech = speech
        self.originForPage = origin
        self.addresses = addresses
        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = true
        webView = WKWebView(frame: .zero, configuration: config)
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 820),
            styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered,
            defer: false, screen: NSScreen.main)
        super.init()
        updateBootstrap()
        window.title = l("Эфир · Пульт")
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.delegate = self
        if let screen = NSScreen.main {
            window.setFrameOrigin(
                NSPoint(
                    x: screen.visibleFrame.midX - window.frame.width / 2,
                    y: screen.visibleFrame.midY - window.frame.height / 2))
        }
        config.userContentController.add(self, name: "efir")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.load(URLRequest(url: URL(string: "http://localhost:\(port)/#/c/\(code)")!))
    }

    func show() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private var networkInfo: [String: Any] {
        ["publicOrigin": originForPage,
         "addresses": addresses.map { ["name": $0.interface, "address": $0.address] }]
    }

    private func updateBootstrap() {
        let json = String(
            data: try! JSONSerialization.data(withJSONObject: networkInfo.merging([
                "version": 1, "platform": "macos",
                "deviceName": "Mac", "role": "controller",
                "uiLanguage": Localization.shared.language,
                "capabilities": ["speech": true, "fullscreen": true, "sessionAwake": true, "networkSettings": true],
            ]) { _, value in value }), encoding: .utf8)!
        let scripts = webView.configuration.userContentController
        scripts.removeAllUserScripts()
        scripts.addUserScript(
            WKUserScript(
                source:
                    "window.efirNative = \(json); window.efirNative.postMessage = message => window.webkit.messageHandlers.efir.postMessage(message);",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func updateNetwork(origin: String, addresses: [LANAddress]) {
        guard origin != originForPage || addresses != self.addresses else { return }
        originForPage = origin
        self.addresses = addresses
        updateBootstrap()
        webView.callAsyncJavaScript(
            "if (window.efirNative) { Object.assign(window.efirNative, info); window.dispatchEvent(new Event('efirnetwork')); }",
            arguments: ["info": networkInfo], in: nil, in: .page, completionHandler: nil)
    }

    func updateLanguage(notifyPage: Bool = true) {
        updateBootstrap()
        window.title = l("Эфир · Пульт")
        if notifyPage {
            webView.callAsyncJavaScript(
                "window.efirNative?.onLanguage?.(language)",
                arguments: ["language": Localization.shared.language], in: nil, in: .page,
                completionHandler: nil)
        }
    }

    func userContentController(
        _ controller: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard !closing, message.frameInfo.isMainFrame,
            message.frameInfo.securityOrigin.host == "localhost",
            message.frameInfo.securityOrigin.port == port,
            let body = message.body as? [String: Any], let action = body["action"] as? String
        else { return }
        switch action {
        case "voiceStart":
            speech.start(lang: body["lang"] as? String ?? "ru-RU", in: webView, bridgeSession: body["session"] as? String)
        case "voiceStop": speech.stop(owner: webView)
        case "fullscreen": window.toggleFullScreen(nil)
        case "sessionActive": onSessionActive?(body["active"] as? Bool ?? false)
        case "selectAddress": onSelectAddress?(body["address"] as? String ?? "")
        case "language":
            Localization.shared.select(body["language"] as? String ?? "")
            updateLanguage(notifyPage: false)
        default: break
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        requestClose()
        return false
    }

    func requestClose() {
        guard !closing else { return }
        closing = true
        speech.stop(owner: webView)

        // A modal JS dialog or unresponsive WebContent can block this evaluation.
        let timeout = Timer(timeInterval: 3, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.finishClose() }
        }
        closeTimeout = timeout
        RunLoop.main.add(timeout, forMode: .common)
        // AppKit runs a modal loop until the reply to .terminateLater.
        RunLoop.main.add(timeout, forMode: .modalPanel)
        webView.evaluateJavaScript("window.efirNative?.onClose?.()") { [weak self] _, _ in
            self?.finishClose()
        }
    }

    private func finishClose() {
        guard let timeout = closeTimeout else { return }
        closeTimeout = nil
        timeout.invalidate()
        window.close()
    }

    func windowWillClose(_ notification: Notification) {
        window.delegate = nil
        if !closing {
            closing = true
            speech.stop(owner: webView)
        }
        closeTimeout?.invalidate()
        closeTimeout = nil
        for sheet in window.sheets { window.endSheet(sheet, returnCode: .cancel) }
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "efir")
        webView.stopLoading()
        window.contentView = nil
        let completion = onClose
        onClose = nil
        completion?()
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        webView.evaluateJavaScript("window.efirNative?.onFullscreen?.(true)")
    }
    func windowDidExitFullScreen(_ notification: Notification) {
        webView.evaluateJavaScript("window.efirNative?.onFullscreen?.(false)")
    }
    func windowDidChangeOcclusionState(_ notification: Notification) { updateVisibility() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        lastVisible = nil
        updateVisibility()
        if window.styleMask.contains(.fullScreen) {
            webView.evaluateJavaScript("window.efirNative?.onFullscreen?.(true)")
        }
    }
    private func updateVisibility() {
        let visible =
            window.isVisible && !window.isMiniaturized && window.occlusionState.contains(.visible)
        guard !closing, lastVisible != visible else { return }
        lastVisible = visible
        webView.evaluateJavaScript("window.efirNative?.onVisible?.(\(visible ? "true" : "false"))")
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "blob" || navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard url.scheme == "http", url.host == "localhost", url.port == port else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void
    ) {
        guard !closing else {
            completionHandler(nil)
            return
        }
        let panel = NSOpenPanel()
        panel.preventsApplicationTerminationWhenModal = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
    ) {
        guard !closing else {
            completionHandler(false)
            return
        }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: l("Да"))
        alert.addButton(withTitle: l("Отмена"))
        // Let AppKit reach applicationShouldTerminate while JavaScript is blocked.
        alert.window.preventsApplicationTerminationWhenModal = false
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(
        _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
    ) { download.delegate = self }
    func download(
        _ download: WKDownload, decideDestinationUsing response: URLResponse,
        suggestedFilename: String, completionHandler: @escaping (URL?) -> Void
    ) {
        guard !closing else {
            completionHandler(nil)
            return
        }
        let panel = NSSavePanel()
        panel.preventsApplicationTerminationWhenModal = false
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.url : nil) }
    }
}
