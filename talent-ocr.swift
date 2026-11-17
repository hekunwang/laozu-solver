import AppKit
import Foundation
import Vision

// Both protocols receive images only through stdin. The service protocol keeps
// Vision warm without retaining the image or writing any screenshot to disk.
enum OCRFailure: LocalizedError {
    case invalidImage, invalidFrame
    var errorDescription: String? {
        switch self {
        case .invalidImage: return "无法读取或解码图片"
        case .invalidFrame: return "图片传输帧无效"
        }
    }
}
func milliseconds(_ started: UInt64) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
}
func recognize(_ cgImage: CGImage) throws -> [[String: Any]] {
    var observations = [[String: Any]]()
    // A second pass over the lower central portion makes small acquisition
    // result labels readable. It supplements, never replaces, the full pass.
    for pass in 0...1 {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true
        if pass == 1 { request.regionOfInterest = CGRect(x: 0.15, y: 0.22, width: 0.7, height: 0.27) }
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        observations += (request.results ?? []).compactMap { observation -> [String: Any]? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return ["text": candidate.string, "confidence": candidate.confidence, "pass": pass,
                    "bbox": ["x": box.origin.x, "y": box.origin.y, "width": box.width, "height": box.height]]
        }
    }
    return observations
}
func decodeAndRecognize(_ data: Data) throws -> ([[String: Any]], [String: Double]) {
    let started = DispatchTime.now().uptimeNanoseconds
    guard !data.isEmpty, let image = NSImage(data: data) else { throw OCRFailure.invalidImage }
    var rect = NSRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { throw OCRFailure.invalidImage }
    let decodeMs = milliseconds(started), visionStarted = DispatchTime.now().uptimeNanoseconds
    let lines = try recognize(cgImage)
    return (lines, ["decodeMs": decodeMs, "visionMs": milliseconds(visionStarted), "totalMs": milliseconds(started)])
}
func send(_ value: [String: Any]) throws {
    var output = try JSONSerialization.data(withJSONObject: value)
    output.append(0x0a)
    FileHandle.standardOutput.write(output)
}
func readExactly(_ count: Int, cleanEOF: Bool = false) throws -> Data? {
    var result = Data()
    while result.count < count {
        let part = try FileHandle.standardInput.read(upToCount: count - result.count) ?? Data()
        if part.isEmpty {
            if cleanEOF && result.isEmpty { return nil }
            throw OCRFailure.invalidFrame
        }
        result.append(part)
    }
    return result
}
func warmVision() throws -> Double {
    let started = DispatchTime.now().uptimeNanoseconds
    let image = NSImage(size: NSSize(width: 480, height: 100))
    image.lockFocus()
    NSColor.white.setFill(); NSBezierPath(rect: NSRect(x: 0, y: 0, width: 480, height: 100)).fill()
    ("弟子天赋 全能大师 后天天赋" as NSString).draw(at: NSPoint(x: 12, y: 30), withAttributes: [.font: NSFont.systemFont(ofSize: 26), .foregroundColor: NSColor.black])
    image.unlockFocus()
    var rect = NSRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { throw OCRFailure.invalidImage }
    _ = try recognize(cgImage)
    return milliseconds(started)
}

if CommandLine.arguments.contains("--server") {
    do {
        let warmupMs = try autoreleasepool { try warmVision() }
        try send(["type": "ready", "protocol": 1, "warmupMs": warmupMs])
        var requestID = 0
        while let header = try readExactly(4, cleanEOF: true) {
            let size = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            guard size > 0 && size <= 12 * 1024 * 1024 else { throw OCRFailure.invalidFrame }
            guard let data = try readExactly(Int(size)) else { throw OCRFailure.invalidFrame }
            requestID += 1
            try autoreleasepool {
                do {
                    let (lines, timing) = try decodeAndRecognize(data)
                    try send(["type": "result", "id": requestID, "lines": lines, "timing": timing])
                } catch {
                    try send(["type": "error", "id": requestID, "error": error.localizedDescription])
                }
            }
        }
    } catch {
        try? send(["type": "fatal", "error": error.localizedDescription])
        FileHandle.standardError.write(Data("本机文字识别服务失败：\(error.localizedDescription)\n".utf8))
        exit(4)
    }
} else {
    // Preserve the original one-image CLI used by fixtures and offline audits.
    do {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        let (lines, _) = try autoreleasepool { try decodeAndRecognize(data) }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: lines))
    } catch {
        FileHandle.standardError.write(Data("本机文字识别失败：\(error.localizedDescription)\n".utf8)); exit(4)
    }
}
