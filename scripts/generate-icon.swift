import AppKit
import Foundation

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()
let tile = NSBezierPath(roundedRect: NSRect(x: 40, y: 40, width: 944, height: 944), xRadius: 212, yRadius: 212)
NSGradient(starting: NSColor(srgbRed: 0.77, green: 0.94, blue: 0.84, alpha: 1), ending: NSColor(srgbRed: 0.45, green: 0.72, blue: 0.56, alpha: 1))!.draw(in: tile, angle: -65)
NSColor(srgbRed: 0.90, green: 1, blue: 0.94, alpha: 0.35).setStroke()
tile.lineWidth = 3
tile.stroke()
let glyph = NSBezierPath()
glyph.move(to: NSPoint(x: 272, y: 650))
glyph.line(to: NSPoint(x: 455, y: 512))
glyph.line(to: NSPoint(x: 272, y: 374))
glyph.lineWidth = 64
glyph.lineCapStyle = .round
glyph.lineJoinStyle = .round
NSColor(srgbRed: 0.10, green: 0.23, blue: 0.16, alpha: 1).setStroke()
glyph.stroke()
let underline = NSBezierPath()
underline.move(to: NSPoint(x: 544, y: 374))
underline.line(to: NSPoint(x: 760, y: 374))
underline.lineWidth = 62
underline.lineCapStyle = .round
underline.stroke()
image.unlockFocus()
let representation = NSBitmapImageRep(data: image.tiffRepresentation!)!
let data = representation.representation(using: .png, properties: [:])!
try FileManager.default.createDirectory(atPath: "assets", withIntermediateDirectories: true)
try data.write(to: URL(fileURLWithPath: "assets/icon.png"))
