// Generates the app icons in public/ (macOS only; uses Apple's built-in
// CoreGraphics/CoreText, nothing to install):
//
//   swift scripts/make-icons.swift
//
// Design: the app's dial. A full sage ring around "READY" and "01:00" on warm
// sand, in the same fonts as the app (loaded from node_modules/@fontsource, so
// run `npm install` first). Colors match the light-mode tokens in
// src/style.css. The ring stays inside the central 80% so the icon survives
// "maskable" cropping on Android.

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let sand = CGColor(srgbRed: 0xF3 / 255, green: 0xEE / 255, blue: 0xE6 / 255, alpha: 1)
let glow = CGColor(srgbRed: 0xFB / 255, green: 0xF8 / 255, blue: 0xF3 / 255, alpha: 1)
let sage = CGColor(srgbRed: 0x7F / 255, green: 0x94 / 255, blue: 0x79 / 255, alpha: 1)
let ink = CGColor(srgbRed: 0x4A / 255, green: 0x45 / 255, blue: 0x40 / 255, alpha: 1)

// Geometry, as fractions of the icon size.
let ringRadius = 0.355
let ringStroke = 0.03
let clockWidth = 0.47      // "01:00" spans this much of the icon
let readySize = 0.052      // "READY" font size
let readyTracking = 0.35   // letter-spacing in em, as in the app
let gap = 0.05             // space between "READY" and the clock

func loadFont(_ path: String, size: CGFloat) -> CTFont {
  guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) as CFData,
        let descs = CTFontManagerCreateFontDescriptorsFromData(data) as? [CTFontDescriptor],
        let desc = descs.first
  else { fatalError("Could not load \(path). Run `npm install` first.") }
  // Lining figures, like `font-variant-numeric: lining-nums` in the app.
  // Cormorant's default old-style figures make "01:00" read as "OI:OO".
  let lining = CTFontDescriptorCreateCopyWithAttributes(desc, [
    kCTFontFeatureSettingsAttribute: [[
      kCTFontOpenTypeFeatureTag: "lnum",
      kCTFontOpenTypeFeatureValue: 1,
    ]],
  ] as CFDictionary)
  return CTFontCreateWithFontDescriptor(lining, size, nil)
}

let fontDir = "node_modules/@fontsource"
let serifPath = "\(fontDir)/cormorant-garamond/files/cormorant-garamond-latin-300-normal.woff2"
let sansPath = "\(fontDir)/jost/files/jost-latin-400-normal.woff2"

func line(_ text: String, font: CTFont, color: CGColor, kern: CGFloat = 0) -> CTLine {
  let attrs: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    NSAttributedString.Key(kCTKernAttributeName as String): kern,
  ]
  return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
}

func render(size: Int) -> CGImage {
  let s = CGFloat(size)
  let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  let center = CGPoint(x: s / 2, y: s / 2)

  // Background: sand with a soft lighter glow toward the top, like the app.
  ctx.setFillColor(sand)
  ctx.fill(CGRect(x: 0, y: 0, width: s, height: s))
  let gradient = CGGradient(colorsSpace: nil, colors: [glow, sand] as CFArray, locations: [0, 1])!
  ctx.drawRadialGradient(
    gradient, startCenter: CGPoint(x: s / 2, y: s * 0.75), startRadius: 0,
    endCenter: CGPoint(x: s / 2, y: s * 0.75), endRadius: s * 0.75, options: [])

  // Ring.
  ctx.setStrokeColor(sage)
  ctx.setLineWidth(s * ringStroke)
  ctx.strokeEllipse(in: CGRect(
    x: center.x - s * ringRadius, y: center.y - s * ringRadius,
    width: 2 * s * ringRadius, height: 2 * s * ringRadius))

  // "01:00": size the font so the visible digits span `clockWidth`.
  let probe = line("01:00", font: loadFont(serifPath, size: 100), color: ink)
  let probeWidth = CTLineGetImageBounds(probe, nil).width
  let clockFont = loadFont(serifPath, size: 100 * (s * clockWidth) / probeWidth)
  let clock = line("01:00", font: clockFont, color: ink)
  let clockBox = CTLineGetImageBounds(clock, nil)

  // "READY", letter-spaced. CoreText adds the kern after the last letter too,
  // so leave that off when centering.
  let readyFontSize = s * readySize
  let readyKern = readyFontSize * readyTracking
  let ready = line("READY", font: loadFont(sansPath, size: readyFontSize), color: sage, kern: readyKern)
  let readyBox = CTLineGetImageBounds(ready, nil)

  // Center the READY + gap + clock group vertically (y grows upward in CG).
  let groupHeight = readyBox.height + s * gap + clockBox.height
  let clockBottom = center.y - groupHeight / 2
  let readyBottom = clockBottom + clockBox.height + s * gap

  ctx.textPosition = CGPoint(x: center.x - clockBox.width / 2 - clockBox.minX, y: clockBottom - clockBox.minY)
  CTLineDraw(clock, ctx)
  ctx.textPosition = CGPoint(
    x: center.x - (readyBox.width - readyKern) / 2 - readyBox.minX, y: readyBottom - readyBox.minY)
  CTLineDraw(ready, ctx)

  return ctx.makeImage()!
}

func writePNG(_ image: CGImage, to path: String) {
  let url = URL(fileURLWithPath: path)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { fatalError("Could not write \(path)") }
}

try FileManager.default.createDirectory(atPath: "public/icons", withIntermediateDirectories: true)
writePNG(render(size: 180), to: "public/icons/apple-touch-icon.png")
writePNG(render(size: 192), to: "public/icons/icon-192.png")
writePNG(render(size: 512), to: "public/icons/icon-512.png")
writePNG(render(size: 64), to: "public/favicon.png")
print("Wrote public/icons/*.png and public/favicon.png")
