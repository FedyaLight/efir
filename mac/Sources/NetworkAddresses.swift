import Darwin
import Foundation
import SystemConfiguration

struct LANAddress: Hashable, Identifiable {
    let interface: String
    let address: String
    var id: String { interface + ":" + address }
    var label: String { "\(interface) · \(address)" }

    static func available() -> [LANAddress] {
        // Check hardware type too: a private IP alone does not exclude VPNs.
        let physical = Set(
            (SCNetworkInterfaceCopyAll() as? [SCNetworkInterface] ?? []).compactMap {
                item -> String? in
                let kind = SCNetworkInterfaceGetInterfaceType(item)
                guard
                    kind == kSCNetworkInterfaceTypeEthernet
                        || kind == kSCNetworkInterfaceTypeIEEE80211
                else { return nil }
                return SCNetworkInterfaceGetBSDName(item) as String?
            })
        var first: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&first) == 0 else { return [] }
        defer { freeifaddrs(first) }
        var result: [LANAddress] = []
        var ptr = first
        while let item = ptr {
            defer { ptr = item.pointee.ifa_next }
            let entry = item.pointee
            let name = String(cString: entry.ifa_name)
            guard name.hasPrefix("en"), physical.contains(name),
                entry.ifa_flags & UInt32(IFF_UP) != 0,
                let addr = entry.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET)
            else { continue }
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard
                getnameinfo(
                    addr, socklen_t(addr.pointee.sa_len), &buffer, socklen_t(buffer.count), nil, 0,
                    NI_NUMERICHOST) == 0
            else { continue }
            let ip = String(cString: buffer)
            let octets = ip.split(separator: ".").compactMap { Int($0) }
            guard octets.count == 4,
                octets[0] == 10 || (octets[0] == 192 && octets[1] == 168)
                    || (octets[0] == 172 && (16...31).contains(octets[1]))
            else { continue }
            result.append(LANAddress(interface: name, address: ip))
        }
        return result.sorted { $0.id < $1.id }
    }
}
