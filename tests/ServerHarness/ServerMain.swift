import FlyingFox
import Foundation

@main
struct ServerMain {
    static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let port = UInt16(CommandLine.arguments[2])!
        let hub = RelayHub { _ in }
        let server = HTTPServer(port: port, handler: SiteHandler(root: root, hub: hub))
        print("Test server: \(port)")
        try await server.run()
    }
}
