import AppKit
import Foundation

// Render web/icon.svg as PNG assets for native app icons.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let directory = root.appendingPathComponent("mac/Resources/Assets.xcassets/AppIcon.appiconset")
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(
        red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
        blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
for size in [16, 32, 64, 128, 256, 512, 1024] {
    let context = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.translateBy(x: 0, y: CGFloat(size))
    context.scaleBy(x: CGFloat(size) / 1024, y: -CGFloat(size) / 1024)
    context.translateBy(x: 64, y: 64)
    context.scaleBy(x: 896 / 512, y: 896 / 512)
    let outline = CGPath(
        roundedRect: CGRect(x: 0, y: 0, width: 512, height: 512), cornerWidth: 112,
        cornerHeight: 112, transform: nil)
    context.addPath(outline)
    context.setFillColor(color(0x0b0a09))
    context.fillPath()
    context.addPath(outline)
    context.clip()
    func bar(
        _ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ radius: CGFloat,
        _ fill: CGColor
    ) {
        context.setFillColor(fill)
        context.addPath(
            CGPath(
                roundedRect: CGRect(x: x, y: y, width: width, height: height), cornerWidth: radius,
                cornerHeight: radius, transform: nil))
        context.fillPath()
    }
    bar(72, 150, 300, 34, 17, color(0xf1ebe1, 0.35))
    bar(0, 222, 512, 68, 0, color(0xff4b3e, 0.18))
    bar(72, 239, 368, 34, 17, color(0xffb547))
    bar(72, 328, 240, 34, 17, color(0xf1ebe1, 0.35))
    context.setFillColor(color(0xff4b3e))
    for points: [CGPoint] in [
        [CGPoint(x: 0, y: 222), CGPoint(x: 44, y: 256), CGPoint(x: 0, y: 290)],
        [CGPoint(x: 512, y: 222), CGPoint(x: 468, y: 256), CGPoint(x: 512, y: 290)],
    ] {
        context.beginPath()
        context.move(to: points[0])
        for point in points.dropFirst() { context.addLine(to: point) }
        context.closePath()
        context.fillPath()
    }
    context.fillEllipse(in: CGRect(x: 394, y: 70, width: 52, height: 52))
    let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
    try bitmap.representation(using: .png, properties: [:])!.write(
        to: directory.appendingPathComponent("icon-\(size).png"))
}
var images: [[String: String]] = []
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        images.append([
            "idiom": "mac", "size": "\(points)x\(points)", "scale": "\(scale)x",
            "filename": "icon-\(points * scale).png",
        ])
    }
}
let catalog: [String: Any] = ["images": images, "info": ["author": "xcode", "version": 1]]
try JSONSerialization.data(withJSONObject: catalog, options: [.prettyPrinted, .sortedKeys]).write(
    to: directory.appendingPathComponent("Contents.json"))
