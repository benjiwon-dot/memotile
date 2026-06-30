import ExpoModulesCore
import Vision
import UIKit

// 온디바이스 얼굴 검출 + (분리된) 임베딩 (Apple Vision, 모델 번들 없음).
//  detectFaces(uri): bbox + 품질 + 선명도 (빠름) — 스캔 단계에서 전부.
//  embedFace(uri,x,y,w,h): 지정 얼굴 영역의 FeaturePrint 임베딩 (무거움) — 매칭 후보에만.
public class VisionFaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisionFace")

    AsyncFunction("detectFaces") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let image = Self.loadImage(uri: uri), let cg = image.cgImage else {
          promise.reject("E_IMAGE", "Cannot load image: \(uri)")
          return
        }
        let orientation = Self.cgOrientation(image.imageOrientation)
        let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:])

        let rectReq = VNDetectFaceRectanglesRequest()
        do { try handler.perform([rectReq]) }
        catch { promise.reject("E_VISION", "Face detection failed: \(error.localizedDescription)"); return }
        let faces = (rectReq.results as? [VNFaceObservation]) ?? []

        var qByIdx: [Int: Float] = [:]
        if !faces.isEmpty {
          let qReq = VNDetectFaceCaptureQualityRequest()
          qReq.inputFaceObservations = faces
          if (try? handler.perform([qReq])) != nil, let qf = qReq.results as? [VNFaceObservation] {
            for (i, f) in qf.enumerated() { qByIdx[i] = f.faceCaptureQuality ?? 0 }
          }
        }

        let W = CGFloat(cg.width), H = CGFloat(cg.height)
        var result: [[String: Any]] = []
        for (i, f) in faces.enumerated() {
          let bb = f.boundingBox
          let faceCG = Self.crop(cg, bb: bb, W: W, H: H)
          let sharpness = faceCG.map { Self.laplacianVariance($0) } ?? 0
          result.append([
            "x": bb.origin.x,
            "y": 1.0 - bb.origin.y - bb.size.height,
            "width": bb.size.width,
            "height": bb.size.height,
            "quality": qByIdx[i].map { Double($0) } as Any,
            "sharpness": sharpness,
          ])
        }
        promise.resolve(result)
      }
    }

    // 지정 얼굴(정규화 좌상단 x,y,w,h)의 FeaturePrint 임베딩
    AsyncFunction("embedFace") { (uri: String, x: Double, y: Double, w: Double, h: Double, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let image = Self.loadImage(uri: uri), let cg = image.cgImage else {
          promise.reject("E_IMAGE", "Cannot load image: \(uri)"); return
        }
        let W = CGFloat(cg.width), H = CGFloat(cg.height)
        // 좌상단 정규화 → Vision 좌하단 정규화로 변환해 crop 재사용
        let bb = CGRect(x: x, y: 1.0 - y - h, width: w, height: h)
        guard let faceCG = Self.crop(cg, bb: bb, W: W, H: H) else { promise.resolve([Double]()); return }
        promise.resolve(Self.featurePrint(faceCG) ?? [Double]())
      }
    }
  }

  // 정규화(좌하단) bbox → 픽셀 crop + 25% 패딩
  private static func crop(_ cg: CGImage, bb: CGRect, W: CGFloat, H: CGFloat) -> CGImage? {
    var rx = bb.origin.x * W
    var ry = (1 - bb.origin.y - bb.size.height) * H
    var rw = bb.size.width * W
    var rh = bb.size.height * H
    let padX = rw * 0.25, padY = rh * 0.25
    rx = max(0, rx - padX); ry = max(0, ry - padY)
    rw = min(W - rx, rw + 2 * padX); rh = min(H - ry, rh + 2 * padY)
    if rw < 1 || rh < 1 { return nil }
    return cg.cropping(to: CGRect(x: rx, y: ry, width: rw, height: rh))
  }

  private static func featurePrint(_ cg: CGImage) -> [Double]? {
    let req = VNGenerateImageFeaturePrintRequest()
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { return nil }
    guard let obs = req.results?.first as? VNFeaturePrintObservation else { return nil }
    let count = obs.elementCount
    switch obs.elementType {
    case .float:
      var arr = [Float](repeating: 0, count: count)
      obs.data.withUnsafeBytes { raw in if let b = raw.baseAddress { memcpy(&arr, b, count * MemoryLayout<Float>.size) } }
      return arr.map { Double($0) }
    case .double:
      var arr = [Double](repeating: 0, count: count)
      obs.data.withUnsafeBytes { raw in if let b = raw.baseAddress { memcpy(&arr, b, count * MemoryLayout<Double>.size) } }
      return arr
    default:
      return nil
    }
  }

  private static func laplacianVariance(_ cg: CGImage) -> Double {
    let size = 64
    let cs = CGColorSpaceCreateDeviceGray()
    var pixels = [UInt8](repeating: 0, count: size * size)
    guard let ctx = CGContext(data: &pixels, width: size, height: size, bitsPerComponent: 8,
                              bytesPerRow: size, space: cs, bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return 0 }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: size, height: size))
    var sum = 0.0, sumSq = 0.0, n = 0.0
    for y in 1..<(size - 1) {
      for x in 1..<(size - 1) {
        let c = Int(pixels[y * size + x])
        let lap = Double(4 * c - Int(pixels[(y - 1) * size + x]) - Int(pixels[(y + 1) * size + x])
                          - Int(pixels[y * size + (x - 1)]) - Int(pixels[y * size + (x + 1)]))
        sum += lap; sumSq += lap * lap; n += 1
      }
    }
    if n == 0 { return 0 }
    let mean = sum / n
    return sumSq / n - mean * mean
  }

  private static func loadImage(uri: String) -> UIImage? {
    let path = uri.replacingOccurrences(of: "file://", with: "")
    if let img = UIImage(contentsOfFile: path) { return img }
    if let url = URL(string: uri), let data = try? Data(contentsOf: url) { return UIImage(data: data) }
    return nil
  }

  private static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch o {
    case .up: return .up; case .down: return .down; case .left: return .left; case .right: return .right
    case .upMirrored: return .upMirrored; case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored; case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
