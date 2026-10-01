// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EfirServerHarness", platforms: [.macOS(.v14)],
    dependencies: [.package(path: "../../mac/Vendor/FlyingFox")],
    targets: [
        .executableTarget(
            name: "EfirServerHarness",
            dependencies: [.product(name: "FlyingFox", package: "FlyingFox")], path: ".",
            sources: ["ServerMain.swift", "LocalServer.swift"])
    ])
