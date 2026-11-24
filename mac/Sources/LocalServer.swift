import FlyingFox
import FlyingSocks
import Foundation

// Keep only connections and in-flight packets in memory; never store scripts.
actor RelayHub {
    private final class Client {
        let external: Bool
        var pending: [WSFrame] = []
        var bytes = 0
        var waiter: CheckedContinuation<WSFrame?, Never>?
        var reader: Task<Void, Never>?
        var closing = false

        init(external: Bool) { self.external = external }
    }

    private var clients: [UUID: Client] = [:]
    private var revision = 0
    private let onCount: @MainActor @Sendable (Int, Int) -> Void

    init(onCount: @escaping @MainActor @Sendable (Int, Int) -> Void) { self.onCount = onCount }

    func join(id: UUID, external: Bool) async throws {
        guard clients.count < 32 else { throw WSUpgradeError.capacity }
        clients[id] = Client(external: external)
        await changed()
    }

    func attach(_ reader: Task<Void, Never>, to id: UUID) {
        if let client = clients[id], !client.closing { client.reader = reader }
        else { reader.cancel() }
    }

    func leave(id: UUID) async {
        guard let client = clients.removeValue(forKey: id) else { return }
        client.reader?.cancel()
        client.waiter?.resume(returning: nil)
        await changed()
    }

    func next(for id: UUID) async -> WSFrame? {
        await withCheckedContinuation { waiter in
            guard let client = clients[id] else { waiter.resume(returning: nil); return }
            if !client.pending.isEmpty {
                let frame = client.pending.removeFirst()
                client.bytes -= frame.payload.count
                waiter.resume(returning: frame)
            } else if client.closing {
                waiter.resume(returning: nil)
            } else {
                client.waiter = waiter
            }
        }
    }

    func receive(_ frame: WSFrame, from id: UUID) -> Bool {
        guard let client = clients[id], !client.closing else { return false }
        var outgoing = WSFrame(fin: true, opcode: frame.opcode, mask: nil, payload: frame.payload)
        switch frame.opcode {
        case .close:
            finish(client, with: outgoing)
            return false
        case .ping:
            outgoing.opcode = .pong
            enqueue(outgoing, for: client)
        case .pong:
            break
        case .text, .binary:
            if frame.opcode == .text {
                guard let text = String(data: frame.payload, encoding: .utf8) else {
                    finish(client, with: .close(message: "Invalid UTF-8"))
                    return false
                }
                // Browsers cannot send WebSocket ping frames.
                if text.contains("\"__efir_ping\""),
                    let object = try? JSONSerialization.jsonObject(with: frame.payload) as? [String: Any],
                    object["t"] as? String == "__efir_ping", object["from"] == nil,
                    let ts = object["ts"] as? Double
                {
                    outgoing.payload = Data("{\"t\":\"__efir_pong\",\"ts\":\(ts)}".utf8)
                    enqueue(outgoing, for: client)
                    return true
                }
            }
            for (peer, destination) in clients where peer != id { enqueue(outgoing, for: destination) }
        default:
            finish(client, with: .close(message: "Unexpected frame"))
            return false
        }
        return true
    }

    private func enqueue(_ frame: WSFrame, for client: Client) {
        guard !client.closing else { return }
        if let waiter = client.waiter {
            client.waiter = nil
            waiter.resume(returning: frame)
        } else if client.pending.count >= 256 || client.bytes + frame.payload.count > 32 * 1024 * 1024 {
            finish(client, with: .close(code: .init(1013, reason: "Slow client")))
        } else {
            client.pending.append(frame)
            client.bytes += frame.payload.count
        }
    }

    private func finish(_ client: Client, with frame: WSFrame) {
        client.closing = true
        client.reader?.cancel()
        client.pending = client.waiter == nil ? [frame] : []
        client.bytes = client.waiter == nil ? frame.payload.count : 0
        client.waiter?.resume(returning: frame)
        client.waiter = nil
    }

    private func changed() async {
        revision += 1
        await onCount(revision, clients.values.filter(\.external).count)
    }
}

struct RoomSocket: WSHandler {
    let hub: RelayHub
    let external: Bool
    private let id = UUID()

    func makeFrames(for client: AsyncThrowingStream<WSFrame, any Error>) async throws -> AsyncStream<WSFrame> {
        try await hub.join(id: id, external: external)
        let reader = Task {
            do {
                for try await frame in WSFrameValidator.validateFrames(from: client) {
                    if !(await hub.receive(frame, from: id)) { return }
                }
            } catch { /* Invalid frame, disconnected or timed out. */ }
            // An overloaded client's writer must still get its closing frame.
            if !Task.isCancelled { await hub.leave(id: id) }
        }
        await hub.attach(reader, to: id)
        return AsyncStream(unfolding: { await hub.next(for: id) }, onCancel: {
            Task { await hub.leave(id: id) }
        })
    }

    func didDisconnect() async { await hub.leave(id: id) }
}

struct SiteHandler: HTTPHandler {
    let root: URL
    let hub: RelayHub

    init(root: URL, hub: RelayHub) {
        self.root = root.resolvingSymlinksInPath().standardizedFileURL
        self.hub = hub
    }

    private static let mimeTypes = [
        "html": "text/html; charset=utf-8", "css": "text/css; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "json": "application/json", "webmanifest": "application/manifest+json",
        "svg": "image/svg+xml", "woff2": "font/woff2", "png": "image/png",
        "mp4": "video/mp4", "webm": "video/webm", "txt": "text/plain; charset=utf-8",
    ]
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
        as? String ?? "development"
    private static let localInfo = try! JSONSerialization.data(withJSONObject: [
        "local": true, "version": version, "hostName": "Mac", "platform": "macos",
    ])

    func handleRequest(_ request: HTTPRequest) async throws -> HTTPResponse {
        if request.path == "/ws" {
            return try await WebSocketHTTPHandler(
                handler: RoomSocket(hub: hub, external: Self.isExternal(request.remoteAddress))
            ).handleRequest(request)
        }
        guard request.method == .GET || request.method == .HEAD else {
            return HTTPResponse(statusCode: .methodNotAllowed)
        }
        if request.path == "/efir-local.json" {
            return response(Self.localInfo, mime: "application/json", head: request.method == .HEAD)
        }
        guard let path = request.path.removingPercentEncoding,
            !path.split(separator: "/").contains(where: { $0 == ".." || $0.hasPrefix(".") })
        else {
            return HTTPResponse(statusCode: .notFound)
        }
        let relative = path == "/" ? "index.html" : String(path.dropFirst())
        let file = root.appendingPathComponent(relative).resolvingSymlinksInPath()
            .standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"),
            let values = try? file.resourceValues(forKeys: [
                .isRegularFileKey, .fileSizeKey, .contentModificationDateKey,
            ]),
            values.isRegularFile == true, let size = values.fileSize,
            let modified = values.contentModificationDate
        else { return HTTPResponse(statusCode: .notFound) }
        let mime = Self.mimeTypes[file.pathExtension] ?? "application/octet-stream"
        // Font filenames are hashes; other assets revalidate through ETags.
        let immutable =
            file.pathExtension == "woff2"
            && file.deletingLastPathComponent().lastPathComponent == "fonts"
        let cache = immutable ? "public, max-age=31536000, immutable" : "no-cache"
        let tag = "\"\(size)-\(modified.timeIntervalSince1970.bitPattern)\""
        var headers = HTTPHeaders([
            .contentType: mime, .contentLength: String(size), .cacheControl: cache,
            .eTag: "W/" + tag, .acceptRanges: "bytes",
            HTTPHeader("X-Content-Type-Options"): "nosniff",
            HTTPHeader("Referrer-Policy"): "no-referrer",
        ])
        if request.headers[.ifNoneMatch]?.split(separator: ",").contains(where: {
            let value = $0.trimmingCharacters(in: .whitespaces)
            return value == "*" || value == tag || value == "W/" + tag
        }) == true {
            return HTTPResponse(statusCode: .notModified, headers: headers, body: Data())
        }
        var status = HTTPStatusCode.ok
        var start = 0, length = size
        if let range = request.headers[.range], range.hasPrefix("bytes=") {
            guard let bounds = Self.byteRange(range.dropFirst(6), size: size) else {
                headers[.contentRange] = "bytes */\(size)"
                headers[.contentLength] = "0"
                return HTTPResponse(statusCode: .rangeNotSatisfiable, headers: headers)
            }
            status = .partialContent
            start = bounds.lowerBound
            length = bounds.count
            headers[.contentLength] = String(length)
            headers[.contentRange] = "bytes \(start)-\(bounds.upperBound)/\(size)"
        }
        if request.method == .HEAD || length == 0 {
            return HTTPResponse(statusCode: status, headers: headers)
        }
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe),
            start <= data.count, length <= data.count - start
        else { return HTTPResponse(statusCode: .notFound) }
        let body = start == 0 && length == data.count ? data : data.subdata(in: start..<(start + length))
        return HTTPResponse(statusCode: status, headers: headers, body: body)
    }

    private static func byteRange(_ range: Substring, size: Int) -> ClosedRange<Int>? {
        let parts = range.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard size > 0, parts.count == 2 else { return nil }
        if parts[0].isEmpty {
            guard let suffix = Int(parts[1]), suffix > 0 else { return nil }
            return max(0, size - suffix)...(size - 1)
        }
        guard let start = Int(parts[0]), start >= 0, start < size else { return nil }
        let end = parts[1].isEmpty ? size - 1 : min(Int(parts[1]) ?? -1, size - 1)
        return start <= end ? start...end : nil
    }

    private static func isExternal(_ address: HTTPRequest.Address?) -> Bool {
        switch address {
        case let .ip4(ip, port: _): return !ip.hasPrefix("127.")
        case let .ip6(ip, port: _): return ip != "::1" && !ip.hasPrefix("::ffff:127.")
        case .unix, .none: return false
        }
    }

    private func response(_ data: Data, mime: String, head: Bool) -> HTTPResponse {
        HTTPResponse(
            statusCode: .ok,
            headers: HTTPHeaders([
                .contentType: mime, .contentLength: String(data.count), .cacheControl: "no-store",
                HTTPHeader("X-Content-Type-Options"): "nosniff",
                HTTPHeader("Referrer-Policy"): "no-referrer",
            ]), body: head ? Data() : data)
    }
}
