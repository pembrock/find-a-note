import AppKit

let size = CGSize(width: 600, height: 360)
let colors = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

func render(scale: Int, destination: URL) throws {
    let width = Int(size.width) * scale
    let height = Int(size.height) * scale
    let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: 0, space: colors,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    context.setFillColor(color(0x10111e).cgColor)
    context.fill(CGRect(origin: .zero, size: size))

    let glow = CGGradient(colorsSpace: colors,
                          colors: [color(0x463066, alpha: 0.78).cgColor,
                                   color(0x241c3c, alpha: 0.35).cgColor,
                                   color(0x10111e, alpha: 0).cgColor] as CFArray,
                          locations: [0, 0.48, 1])!
    let glowCenter = CGPoint(x: 300, y: 209)
    context.drawRadialGradient(glow, startCenter: glowCenter, startRadius: 0,
                               endCenter: glowCenter, endRadius: 327, options: [])

    // Finder places the bundle icons on either side of this arrow.
    let shaft = CGMutablePath()
    shaft.move(to: CGPoint(x: 264, y: 192))
    shaft.addLine(to: CGPoint(x: 335, y: 192))
    shaft.move(to: CGPoint(x: 321, y: 205))
    shaft.addLine(to: CGPoint(x: 335, y: 192))
    shaft.addLine(to: CGPoint(x: 321, y: 179))
    context.setStrokeColor(color(0xb38aff).cgColor)
    context.setLineWidth(3)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.addPath(shaft)
    context.strokePath()

    // Finder uses dark labels over image backgrounds on the tested macOS.
    for center in [172.0, 428.0] {
        let label = CGRect(x: center - 66, y: 108, width: 132, height: 29)
        let pill = CGPath(roundedRect: label, cornerWidth: 14, cornerHeight: 14,
                          transform: nil)
        context.setFillColor(color(0xd6c4f1).cgColor)
        context.addPath(pill)
        context.fillPath()
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    func drawCentered(_ text: String, at y: CGFloat, font: NSFont, ink: NSColor) {
        let title = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: ink])
        title.draw(at: CGPoint(x: (size.width - title.size().width) / 2, y: y))
    }
    drawCentered("Find a Note", at: 279, font: .systemFont(ofSize: 32, weight: .semibold),
                 ink: color(0xf5f3fc))
    drawCentered("Drag to Applications", at: 59, font: .systemFont(ofSize: 15, weight: .medium),
                 ink: color(0xd6c4f1))
    NSGraphicsContext.restoreGraphicsState()

    let image = NSBitmapImageRep(cgImage: context.makeImage()!)
    image.size = size
    try image.representation(using: .png, properties: [:])!.write(to: destination)
}

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try render(scale: 1, destination: output.appendingPathComponent("background.png"))
try render(scale: 2, destination: output.appendingPathComponent("background@2x.png"))
