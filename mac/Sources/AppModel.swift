import AppKit
import FlyingFox
import FlyingSocks
import SwiftUI
import SystemConfiguration

@MainActor
final class AppModel: ObservableObject {
    @Published var port = 8765
    @Published var running = false { didSet { updateActivity() } }
    @Published var status = "Запуск сервера…"
    @Published var statusError = ""
    @Published private(set) var prompterClients = 0 { didSet { updateActivity() } }
    @Published var addresses: [LANAddress] = []
    @Published private(set) var selectedAddress = ""
    let room = "LOCAL"
    let speech = NativeSpeech()
    private var windows: [RoleWindow] = []
    private var quitCompletion: (() -> Void)?
    private var preferredAddress = UserDefaults.standard.string(forKey: "efir.lanAddress")
    private var server: HTTPServer?
    private var serverTask: Task<Void, Error>?
    private var publication: NetService?
    private var addressStore: SCDynamicStore?
    private var activity: NSObjectProtocol?
    private var sessionActive = false
    private var clientCountRevision = 0

    var publicOrigin: String? {
        selectedAddress.isEmpty ? nil : "http://\(selectedAddress):\(port)"
    }
    var origin: String { publicOrigin ?? "http://localhost:\(port)" }

    init() {
        observeNetwork()
        refreshNetwork()
        Task { await start() }
    }

    private final class NetworkObserver {
        weak var model: AppModel?
        init(_ model: AppModel) { self.model = model }
    }

    private func observeNetwork() {
        let observer = NetworkObserver(self)
        var context = SCDynamicStoreContext(
            version: 0, info: Unmanaged.passUnretained(observer).toOpaque(),
            retain: { pointer in
                return UnsafeRawPointer(Unmanaged<NetworkObserver>.fromOpaque(pointer).retain().toOpaque())
            },
            release: { pointer in
                Unmanaged<NetworkObserver>.fromOpaque(pointer).release()
            },
            copyDescription: nil
        )
        let retainedStore = withExtendedLifetime(observer) {
            SCDynamicStoreCreate(nil, "Efir LAN" as CFString, { _, _, info in
                guard let info else { return }
                let observer = Unmanaged<NetworkObserver>.fromOpaque(info).takeUnretainedValue()
                MainActor.assumeIsolated { observer.model?.refreshNetwork() }
            }, &context)
        }
        guard let store = retainedStore else { return }
        let patterns = ["State:/Network/Global/IPv4", "State:/Network/Interface/[^/]+/(IPv4|Link)"]
        guard SCDynamicStoreSetNotificationKeys(store, nil, patterns as CFArray),
            SCDynamicStoreSetDispatchQueue(store, .main)
        else { return }
        addressStore = store
    }

    func refreshNetwork() {
        let next = LANAddress.available()
        if addresses != next { addresses = next }
        if let preferredAddress, next.contains(where: { $0.address == preferredAddress }) {
            if selectedAddress != preferredAddress { selectedAddress = preferredAddress }
        } else if !next.contains(where: { $0.address == selectedAddress }) {
            selectedAddress = next.first?.address ?? ""
        }
        updateNetworkBridge()
    }

    func selectAddress(_ value: String) {
        guard value != preferredAddress, addresses.contains(where: { $0.address == value }) else { return }
        preferredAddress = value
        UserDefaults.standard.set(value, forKey: "efir.lanAddress")
        selectedAddress = value
        updateNetworkBridge()
    }

    private func updateNetworkBridge() {
        for window in windows { window.updateNetwork(origin: origin, addresses: addresses) }
    }

    func start() async {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("web"),
            FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path)
        else {
            status = "В приложении не найдены файлы web"
            return
        }
        let hub = RelayHub { [weak self] revision, external in
            guard let self, revision > self.clientCountRevision else { return }
            self.clientCountRevision = revision
            if self.prompterClients != external { self.prompterClients = external }
        }
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
        service.setTXTRecord(NetService.data(fromTXTRecord: ["version": Data(SiteHandler.version.utf8)]))
        service.publish()
        publication = service
    }

    func openController() {
        guard running, quitCompletion == nil else { return }
        if let existing = windows.first {
            existing.show()
            return
        }
        let window = RoleWindow(code: room, port: port, origin: origin, addresses: addresses, speech: speech)
        window.onSelectAddress = { [weak self] address in self?.selectAddress(address) }
        window.onSessionActive = { [weak self] active in self?.setSessionActive(active) }
        window.onClose = { [weak self, weak window] in
            self?.windows.removeAll { $0 === window }
            self?.setSessionActive(false)
            if self?.windows.isEmpty == true { self?.quitCompletion?() }
        }
        windows.append(window)
        window.show()
    }

    func prepareToQuit(_ completion: @escaping () -> Void) -> Bool {
        guard !windows.isEmpty else { return false }
        if quitCompletion == nil {
            quitCompletion = completion
            for window in windows { window.requestClose() }
        }
        return true
    }

    func shutdown() {
        running = false
        if let addressStore { SCDynamicStoreSetDispatchQueue(addressStore, nil) }
        addressStore = nil
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
        let needed = running && (sessionActive || prompterClients > 0)
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
