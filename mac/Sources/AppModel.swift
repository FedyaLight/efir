import AppKit
import FlyingFox
import FlyingSocks
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var port = 8765
    @Published var running = false { didSet { updateActivity() } }
    @Published var status = "Запуск сервера…"
    @Published var statusError = ""
    @Published var clients = 0 { didSet { updateActivity() } }
    @Published var addresses: [LANAddress] = []
    @Published var selectedAddress = ""
    let room = "LOCAL"
    let speech = NativeSpeech()
    private var windows: [RoleWindow] = []
    private var server: HTTPServer?
    private var serverTask: Task<Void, Error>?
    private var publication: NetService?
    private var addressTimer: Timer?
    private var activity: NSObjectProtocol?
    private var sessionActive = false

    var publicOrigin: String? {
        selectedAddress.isEmpty ? nil : "http://\(selectedAddress):\(port)"
    }
    var origin: String { publicOrigin ?? "http://localhost:\(port)" }
    var prompterClients: Int { max(0, clients - windows.count) }

    init() {
        refreshNetwork()
        addressTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshNetwork() }
        }
        addressTimer?.tolerance = 1
        Task { await start() }
    }

    func refreshNetwork() {
        let next = LANAddress.available()
        if addresses != next { addresses = next }
        if !next.contains(where: { $0.address == selectedAddress }) {
            selectedAddress = next.first?.address ?? ""
        }
        for window in windows { window.updateOrigin(publicOrigin) }
    }

    func start() async {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("web"),
            FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path)
        else {
            status = "В приложении не найдены файлы web"
            return
        }
        let hub = RelayHub { [weak self] count in await MainActor.run { self?.clients = count } }
        // Bind through the server itself; a separate probe would race other processes.
        for candidate in 8765...8865 {
            let server = HTTPServer(
                port: UInt16(candidate), handler: SiteHandler(root: root, hub: hub))
            let task = Task { try await server.run() }
            do {
                try await server.waitUntilListening(timeout: 2)
                self.server = server
                serverTask = task
                port = candidate
                running = true
                status = "Сервер работает"
                publishBonjour()
                openController()
                Task {
                    let result = await task.result
                    if self.running && self.port == candidate {
                        self.running = false
                        if case .failure(let error) = result {
                            self.statusError = error.localizedDescription
                            self.status = "Сервер остановлен: {error}"
                        } else {
                            self.status = "Сервер остановлен"
                        }
                        self.publication?.stop()
                    }
                }
                return
            } catch {
                task.cancel()
                await server.stop()
                let result = await task.result
                let cause: Error
                if case .failure(let failure) = result { cause = failure } else { cause = error }
                // Try the next port only when this one is already in use.
                if case SocketError.failed(_, let code, _) = cause, code == EADDRINUSE { continue }
                statusError = cause.localizedDescription
                status = "Не удалось запустить сервер: {error}"
                return
            }
        }
        status = "Порты 8765–8865 заняты. Освободите один порт и перезапустите Эфир."
    }

    private func publishBonjour() {
        let service = NetService(
            domain: "local.", type: "_efir._tcp.",
            name: "Эфир — \(Host.current().localizedName ?? "Mac")", port: Int32(port))
        service.setTXTRecord(NetService.data(fromTXTRecord: ["version": Data("1.2.0".utf8)]))
        service.publish()
        publication = service
    }

    func openController() {
        guard running else { return }
        if let existing = windows.first {
            existing.show()
            return
        }
        let window = RoleWindow(code: room, port: port, publicOrigin: publicOrigin, speech: speech)
        window.onSessionActive = { [weak self] active in self?.setSessionActive(active) }
        window.onClose = { [weak self, weak window] in
            self?.windows.removeAll { $0 === window }
            self?.setSessionActive(false)
        }
        windows.append(window)
        window.show()
    }

    func shutdown() {
        running = false
        addressTimer?.invalidate()
        speech.stop()
        publication?.stop()
        serverTask?.cancel()
    }

    func setLanguage(_ value: String) {
        Localization.shared.select(value)
        for window in windows { window.updateLanguage() }
    }

    private func setSessionActive(_ active: Bool) {
        sessionActive = active
        updateActivity()
    }

    private func updateActivity() {
        // Allow display sleep, but keep the system awake for a connected reader.
        let needed = running && (sessionActive || clients > windows.count)
        if needed && activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(
                options: [.userInitiated, .idleSystemSleepDisabled],
                reason: l("Суфлёр подключён к Эфиру"))
        } else if !needed, let current = activity {
            ProcessInfo.processInfo.endActivity(current)
            activity = nil
        }
    }

}
