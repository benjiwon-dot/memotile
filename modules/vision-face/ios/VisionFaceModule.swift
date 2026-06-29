import ExpoModulesCore
import Vision
import UIKit

// 온디바이스 얼굴 검출 + 임베딩 + 선명도 (Apple Vision, 모델 번들 없음).
// 입력: 로컬/원격 이미지 URI(보통 다운스케일 썸네일 또는 앵커 URL).
// 출력(얼굴별): 정규화 좌상단 bbox, 캡처 품질, embedding(FeaturePrint 벡터), sharpness(라플라시안 분산).
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

        // 캡처 품질 (베스트컷 랭킹용)
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
          let bb = f.boundingBox  // 정규화, 원점 좌하단

          // 얼굴 픽셀 영역(좌상단 기준) + 25% 패딩 → 임베딩/선명도 품질↑
          var rx = bb.origin.x * W
          var ry = (1 - bb.origin.y - bb.size.height) * H
          var rw = bb.size.width * W
          var rh = bb.size.height * H
          let padX = rw * 0.25, padY = rh * 0.25
          rx = max(0, rx - padX); ry = max(0, ry - padY)
          rw = min(W - rx, rw + 2 * padX); rh = min(H - ry, rh + 2 * padY)
          let faceCG = cg.cropping(to: CGRect(x: rx, y: ry, width: rw, height: rh)) ?? cg

          let embedding = Self.featurePrint(faceCG) ?? []
          let sharpness = Self.laplacianVariance(faceCG)

          result.append([
            "x": bb.origin.x,
            "y": 1.0 - bb.origin.y - bb.size.height,
            "width": bb.size.width,
            "height": bb.size.height,
            "quality": qByIdx[i].map { Double($0) } as Any,
            "embedding": embedding,
            "sharpness": sharpness,
          ])
        }

        promise.resolve(result)
      }
    }
  }

  // VNGenerateImageFeaturePrint → Double 벡터 (Core ML 모델 없이 온디바이스)
  private static func featurePrint(_ cg: CGImage) -> [Double]? {
    let req = VNGenerateImageFeaturePrintRequest()
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { return nil }
    guard let obs = req.results?.first as? VNFeaturePrintObservation else { return nil }
    let count = obs.elementCount
    switch obs.elementType {
    case .float:
      var arr = [Float](repeating: 0, count: count)
      obs.data.withUnsafeBytes { raw in
        if let base = raw.baseAddress { memcpy(&arr, base, count * MemoryLayout<Float>.size) }
      }
      return arr.map { Double($0) }
    case .double:
      var arr = [Double](repeating: 0, count: count)
      obs.data.withUnsafeBytes { raw in
        if let base = raw.baseAddress { memcpy(&arr, base, count * MemoryLayout<Double>.size) }
      }
      return arr
    default:
      return nil
    }
  }

  // 라플라시안 분산(흔들림/선명도 지표) — 64x64 그레이스케일에서 계산
  private static func laplacianVariance(_ cg: CGImage) -> Double {
    let size = 64
    let cs = CGColorSpaceCreateDeviceGray()
    var pixels = [UInt8](repeating: 0, count: size * size)
    guard let ctx = CGContext(
      data: &pixels, width: size, height: size, bitsPerComponent: 8,
      bytesPerRow: size, space: cs, bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else { return 0 }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: size, height: size))

    var sum = 0.0, sumSq = 0.0
    var n = 0.0
    for y in 1..<(size - 1) {
      for x in 1..<(size - 1) {
        let c = Int(pixels[y * size + x])
        let up = Int(pixels[(y - 1) * size + x])
        let dn = Int(pixels[(y + 1) * size + x])
        let lf = Int(pixels[y * size + (x - 1)])
        let rt = Int(pixels[y * size + (x + 1)])
        let lap = Double(4 * c - up - dn - lf - rt)
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
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    case .upMirrored: return .upMirrored
    case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
