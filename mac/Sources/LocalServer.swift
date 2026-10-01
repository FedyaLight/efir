import FlyingFox
import FlyingSocks
import Foundation

// Keep only connections and in-flight packets in memory; never store scripts.
actor RelayHub {
    typealias Output = AsyncStream<WSMessage>.Continuation
    private var clients: [UUID: Output] = [:]
    let onCount: @Sendable (Int) async -> Void

    init(onCount: @escaping @Sendable (Int) async -> Void) { self.onCount = onCount }

    func join(id: UUID, output: Output) async {
        clients[id] = output
        await changed()
    }

    func leave(id: UUID) async {
        clients.removeValue(forKey: id)?.finish()
        await changed()
    }

    func relay(_ message: WSMessage, from: UUID) async {
        // Browsers cannot send WebSocket ping frames. Echo a protocol ping
        // to measure the complete browser-server round trip.
        if case .text(let text) = message,
            text.contains("\"__efir_ping\""),
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            object["t"] as? String == "__efir_ping", object["from"] == nil,
            let ts = object["ts"] as? Double
        {
            clients[from]?.yield(.text("{\"t\":\"__efir_pong\",\"ts\":\(ts)}"))
            return
        }
        var slow: [UUID] = []
        for (id, output) in clients where id != from {
            switch output.yield(message) {
            case .dropped, .terminated: slow.append(id)
            case .enqueued: break
            @unknown default: break
            }
        }
        // Slow clients reconnect and request fresh state.
        for id in slow { await leave(id: id) }
    }

    private func changed() async { await onCount(clients.count) }
}

struct RoomSocket: WSMessageHandler {
    let hub: RelayHub

    func makeMessages(for client: AsyncStream<WSMessage>) async throws -> AsyncStream<WSMessage> {
        let id = UUID()
        let pair = AsyncStream<WSMessage>.makeStream(bufferingPolicy: .bufferingOldest(256))
        await hub.join(id: id, output: pair.continuation)
        let task = Task {
            for await message in client {
                if Task.isCancelled { break }
                if case .close = message { break }
                await hub.relay(message, from: id)
            }
            await hub.leave(id: id)
        }
        pair.continuation.onTermination = { _ in
            task.cancel()
            Task { await hub.leave(id: id) }
        }
        return pair.stream
    }
}

struct SiteHandler: HTTPHandler {
    let root: URL
    let hub: RelayHub

    func handleRequest(_ request: HTTPRequest) async throws -> HTTPResponse {
        if request.path == "/ws" {
            return try await WebSocketHTTPHandler(
                handler: MessageFrameWSHandler(handler: RoomSocket(hub: hub))
            ).handleRequest(request)
        }
        guard request.method == .GET || request.method == .HEAD else {
            return HTTPResponse(statusCode: .methodNotAllowed)
        }
        if request.path == "/efir-local.json" {
            let info: [String: Any] = [
                "local": true,
                "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
                    as? String ?? "development",
                "hostName": "Mac", "platform": "macos",
            ]
            let data = try JSONSerialization.data(withJSONObject: info)
            return response(data, mime: "application/json", head: request.method == .HEAD)
        }
        guard let path = request.path.removingPercentEncoding,
            !path.split(separator: "/").contains(where: { $0 == ".." || $0.hasPrefix(".") })
        else {
            return HTTPResponse(statusCode: .notFound)
        }
        let relative = path == "/" ? "index.html" : String(path.dropFirst())
        let file = root.appendingPathComponent(relative).resolvingSymlinksInPath()
            .standardizedFileURL
        guard file.path.hasPrefix(root.resolvingSymlinksInPath().path + "/"),
            let values = try? file.resourceValues(forKeys: [
                .isRegularFileKey, .fileSizeKey, .contentModificationDateKey,
            ]),
            values.isRegularFile == true, let size = values.fileSize,
            let modified = values.contentModificationDate
        else { return HTTPResponse(statusCode: .notFound) }
        let mime =
            [
                "html": "text/html; charset=utf-8", "css": "text/css; charset=utf-8",
                "js": "text/javascript; charset=utf-8",
                "json": "application/json", "webmanifest": "application/manifest+json",
                "svg": "image/svg+xml",
                "woff2": "font/woff2", "png": "image/png", "mp4": "video/mp4", "webm": "video/webm",
                "txt": "text/plain; charset=utf-8",
            ][file.pathExtension] ?? "application/octet-stream"
        // Font filenames are hashes; other assets revalidate through ETags.
        let immutable =
            file.pathExtension == "woff2"
            && file.deletingLastPathComponent().lastPathComponent == "fonts"
        let cache = immutable ? "public, max-age=31536000, immutable" : "no-cache"
        let tag = "\"\(size)-\(modified.timeIntervalSince1970.bitPattern)\""
        let headers = HTTPHeaders([
            .contentType: mime, .contentLength: String(size), .cacheControl: cache,
            .eTag: "W/" + tag,
            HTTPHeader("X-Content-Type-Options"): "nosniff",
            HTTPHeader("Referrer-Policy"): "no-referrer",
        ])
        if request.headers[.ifNoneMatch]?.split(separator: ",").contains(where: {
            let value = $0.trimmingCharacters(in: .whitespaces)
            return value == "*" || value == tag || value == "W/" + tag
        }) == true {
            return HTTPResponse(statusCode: .notModified, headers: headers, body: Data())
        }
        if request.method == .HEAD {
            return HTTPResponse(statusCode: .ok, headers: headers, body: Data())
        }
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            return HTTPResponse(statusCode: .notFound)
        }
        return HTTPResponse(statusCode: .ok, headers: headers, body: data)
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
