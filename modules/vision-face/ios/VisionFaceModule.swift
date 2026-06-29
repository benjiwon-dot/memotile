import ExpoModulesCore
import Vision
import UIKit

// 온디바이스 얼굴 검출 (Apple Vision).
// 입력: 로컬 이미지 URI(file:// 또는 경로) — 보통 다운스케일된 썸네일.
// 출력: 정규화(0~1) 좌상단 기준 bbox + 캡처 품질(0~1, 가능할 때).
public class VisionFaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisionFace")

    AsyncFunction("detectFaces") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let image = VisionFaceModule.loadImage(uri: uri), let cg = image.cgImage else {
          promise.reject("E_IMAGE", "Cannot load image: \(uri)")
          return
        }

        let orientation = VisionFaceModule.cgOrientation(image.imageOrientation)
        let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:])

        let rectRequest = VNDetectFaceRectanglesRequest()
        do {
          try handler.perform([rectRequest])
        } catch {
          promise.reject("E_VISION", "Face detection failed: \(error.localizedDescription)")
          return
        }

        let faces = (rectRequest.results as? [VNFaceObservation]) ?? []

        // 캡처 품질(베스트컷 랭킹용) — best-effort
        var qualityByIndex: [Int: Float] = [:]
        if !faces.isEmpty {
          let qualityRequest = VNDetectFaceCaptureQualityRequest()
          qualityRequest.inputFaceObservations = faces
          if (try? handler.perform([qualityRequest])) != nil,
             let qFaces = qualityRequest.results as? [VNFaceObservation] {
            for (i, f) in qFaces.enumerated() {
              qualityByIndex[i] = f.faceCaptureQuality ?? 0
            }
          }
        }

        let result: [[String: Any]] = faces.enumerated().map { (i, f) in
          // Vision bbox: 정규화, 원점 좌하단 → 좌상단으로 변환
          let bb = f.boundingBox
          return [
            "x": bb.origin.x,
            "y": 1.0 - bb.origin.y - bb.size.height,
            "width": bb.size.width,
            "height": bb.size.height,
            "quality": qualityByIndex[i].map { Double($0) } as Any
          ]
        }

        promise.resolve(result)
      }
    }
  }

  private static func loadImage(uri: String) -> UIImage? {
    let path = uri.replacingOccurrences(of: "file://", with: "")
    if let img = UIImage(contentsOfFile: path) {
      return img
    }
    if let url = URL(string: uri), let data = try? Data(contentsOf: url) {
      return UIImage(data: data)
    }
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
