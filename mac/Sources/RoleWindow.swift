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
    private let port: Int
    private let speech: NativeSpeech
    private var originForPage: String

    init(code: String, port: Int, publicOrigin: String?, speech: NativeSpeech) {
        self.port = port
        self.speech = speech
        originForPage = publicOrigin ?? "http://localhost:\(port)"
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

    private func updateBootstrap() {
        let json = String(
            data: try! JSONSerialization.data(withJSONObject: [
                "version": 1, "publicOrigin": originForPage, "platform": "macos",
                "deviceName": "Mac", "role": "controller",
                "uiLanguage": Localization.shared.language,
                "capabilities": ["speech": true, "fullscreen": true, "sessionAwake": true],
            ]), encoding: .utf8)!
        let scripts = webView.configuration.userContentController
        scripts.removeAllUserScripts()
        scripts.addUserScript(
            WKUserScript(
                source:
                    "window.efirNative = \(json); window.efirNative.postMessage = message => window.webkit.messageHandlers.efir.postMessage(message);",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func updateOrigin(_ value: String?) {
        let origin = value ?? "http://localhost:\(port)"
        guard origin != originForPage else { return }
        webView.callAsyncJavaScript(
            "if (window.efirNative) window.efirNative.publicOrigin = origin",
            arguments: ["origin": origin], in: nil, in: .page
        ) { [weak self] result in
            if case .success = result {
                self?.originForPage = origin
                self?.updateBootstrap()
            }
        }
    }

    func updateLanguage() {
        updateBootstrap()
        window.title = l("Эфир · Пульт")
        webView.callAsyncJavaScript(
            "window.efirNative?.onLanguage?.(language)",
            arguments: ["language": Localization.shared.language], in: nil, in: .page,
            completionHandler: nil)
    }

    func userContentController(
        _ controller: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard message.frameInfo.isMainFrame,
            message.frameInfo.securityOrigin.host == "localhost",
            message.frameInfo.securityOrigin.port == port,
            let body = message.body as? [String: Any], let action = body["action"] as? String
        else { return }
        switch action {
        case "voiceStart": speech.start(lang: body["lang"] as? String ?? "ru-RU", in: webView)
        case "voiceStop": speech.stop(owner: webView)
        case "fullscreen": window.toggleFullScreen(nil)
        case "sessionActive": onSessionActive?(body["active"] as? Bool ?? false)
        case "language":
            Localization.shared.select(body["language"] as? String ?? "")
            updateLanguage()
        default: break
        }
    }

    func windowWillClose(_ notification: Notification) {
        speech.stop(owner: webView)
        webView.evaluateJavaScript("window.dispatchEvent(new Event('pagehide'))")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "efir")
        webView.stopLoading()
        onClose?()
    }
    func windowDidEnterFullScreen(_ notification: Notification) {
        webView.evaluateJavaScript("window.efirNative?.onFullscreen?.(true)")
    }
    func windowDidExitFullScreen(_ notification: Notification) {
        webView.evaluateJavaScript("window.efirNative?.onFullscreen?.(false)")
    }
    func windowDidChangeOcclusionState(_ notification: Notification) { updateVisibility() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { updateVisibility() }
    private func updateVisibility() {
        let visible =
            window.isVisible && !window.isMiniaturized && window.occlusionState.contains(.visible)
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
        let panel = NSOpenPanel()
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
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: l("Да"))
        alert.addButton(withTitle: l("Отмена"))
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(
        _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
    ) { download.delegate = self }
    func download(
        _ download: WKDownload, decideDestinationUsing response: URLResponse,
        suggestedFilename: String, completionHandler: @escaping (URL?) -> Void
    ) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.url : nil) }
    }
}
