import ExpoModulesCore
import Vision
import UIKit
import CoreML
import CoreVideo
import ImageIO
import Photos

// 검출: Apple Vision (bbox + 품질 + 선명도) — 그대로.
// 임베딩: SFace CoreML (Apache-2.0). 5점 정렬 → 112×112 BGR → 128-d → L2 정규화.
public class VisionFaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisionFace")

    // ── 검출 (앵커 URL 등 임의 이미지용) ──
    AsyncFunction("detectFaces") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let image = Self.loadImage(uri: uri), let cg = image.cgImage else {
          promise.reject("E_IMAGE", "Cannot load image: \(uri)"); return
        }
        promise.resolve(Self.detectFacesIn(cg: cg, orientation: Self.cgOrientation(image.imageOrientation)))
      }
    }

    // ── 스캔 고속 경로: CGImageSource 축소 디코드(원본 풀 디코드 X) + 검출 + 얼굴 있을 때만 썸네일 저장 ──
    // (a)메모리 검출 + (b)저해상도 + (c)네이티브 축소디코드 를 한 콜로. expo-image-manipulator 대체.
    AsyncFunction("scanImage") { (uri: String, maxPixel: Int, thumbPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let cg = Self.downsampledCGImage(uri: uri, maxPixel: maxPixel) else {
          promise.resolve(nil); return // 로드 실패(예: iCloud only는 이미 상위에서 걸러짐)
        }
        // 축소 시 orientation을 이미 반영(transform:true)했으므로 .up로 검출.
        let faces = Self.detectFacesIn(cg: cg, orientation: .up)
        var thumbWritten = false
        if !faces.isEmpty {
          thumbWritten = Self.writeJPEG(cg: cg, toPath: thumbPath, quality: 0.7)
        }
        promise.resolve([
          "faces": faces,
          "width": cg.width,
          "height": cg.height,
          "thumbWritten": thumbWritten,
        ])
      }
    }

    // ── 스캔 최고속: PHAsset localId → PHImageManager로 축소본 직접 요청(getAssetInfoAsync 불필요) ──
    // iCloud-only(isNetworkAccessAllowed=false)면 이미지 nil → 즉시 스킵(다운로드/대기 X). iOS 캐시 썸네일 활용.
    AsyncFunction("scanAsset") { (localId: String, maxPixel: Int, thumbPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [localId], options: nil)
        guard let asset = fetch.firstObject else { promise.resolve(["unavailable": true]); return }
        let opts = PHImageRequestOptions()
        opts.isNetworkAccessAllowed = false // iCloud 다운로드 안 함
        opts.deliveryMode = .highQualityFormat
        opts.resizeMode = .fast
        opts.isSynchronous = true
        var out: [String: Any] = ["unavailable": true]
        PHImageManager.default().requestImage(
          for: asset, targetSize: CGSize(width: maxPixel, height: maxPixel),
          contentMode: .aspectFit, options: opts
        ) { image, _ in
          autoreleasepool { // CGImage/픽셀버퍼 즉시 해제 → 대량 스캔 시 메모리 누적 방지
            guard let image = image, let cg = Self.uprightCG(image) else { return }
            let faces = Self.detectFacesIn(cg: cg, orientation: .up)
            var wrote = false
            if !faces.isEmpty { wrote = Self.writeJPEG(cg: cg, toPath: thumbPath, quality: 0.7) }
            out = ["faces": faces, "width": cg.width, "height": cg.height, "thumbWritten": wrote, "unavailable": false]
          }
        }
        promise.resolve(out)
      }
    }

    // ── 모델 워밍: 더미 추론으로 SFace+Vision을 미리 로드/컴파일 → 콜드/재로딩 스파이크 억제 ──
    AsyncFunction("warmUpFace") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        if let model = Self.model(), let pb = Self.makePixelBuffer(112, 112) {
          _ = Self.runSFace(model: model, pixelBuffer: pb) // SFace 워밍
        }
        if let cg = Self.dummyCGImage(96) {
          let h = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
          _ = try? h.perform([VNDetectFaceRectanglesRequest(), VNDetectFaceLandmarksRequest()]) // Vision 워밍
        }
        promise.resolve(true)
      }
    }

    // ── 임베딩: SFace (5점 정렬 → 추론) ──
    AsyncFunction("embedFace") { (uri: String, x: Double, y: Double, w: Double, h: Double, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let image = Self.loadImage(uri: uri), let cg = image.cgImage else {
          promise.resolve([Double]()); return
        }
        guard let model = Self.model() else {
          promise.reject("E_MODEL", "SFace model not found in bundle"); return
        }
        // 정렬된 112×112 BGRA 픽셀버퍼 (랜드마크 실패 시 bbox 크롭 폴백)
        guard let pb = Self.alignedPixelBuffer(cg: cg, image: image, bbox: CGRect(x: x, y: 1.0 - y - h, width: w, height: h)) else {
          promise.resolve([Double]()); return
        }
        guard let emb = Self.runSFace(model: model, pixelBuffer: pb) else {
          promise.resolve([Double]()); return
        }
        promise.resolve(Self.l2Normalize(emb))
      }
    }
  }

  // MARK: - SFace 모델 로드 (1회)
  private static var _model: MLModel?
  private static func model() -> MLModel? {
    if let m = _model { return m }
    let fw = Bundle(for: VisionFaceModule.self)
    var url: URL? = fw.url(forResource: "SFace", withExtension: "mlmodelc")
      ?? Bundle.main.url(forResource: "SFace", withExtension: "mlmodelc")
    if url == nil {
      // resource_bundles (VisionFace.bundle) 경로
      for b in [fw, Bundle.main] {
        if let bu = b.url(forResource: "VisionFace", withExtension: "bundle"),
           let rb = Bundle(url: bu),
           let u = rb.url(forResource: "SFace", withExtension: "mlmodelc") { url = u; break }
      }
    }
    guard let u = url else { print("[VisionFace] SFace.mlmodelc 못 찾음"); return nil }
    // computeUnits=.cpuAndGPU → ANE 미사용. 지속 부하/메모리압박 시 ANE 모델 축출→재컴파일(1.5~4초) 스파이크 방지.
    let cfg = MLModelConfiguration()
    cfg.computeUnits = .cpuAndGPU
    _model = (try? MLModel(contentsOf: u, configuration: cfg)) ?? (try? MLModel(contentsOf: u))
    return _model
  }

  // MARK: - 검출 공통 (CGImage → 얼굴 dict 배열)
  private static func detectFacesIn(cg: CGImage, orientation: CGImagePropertyOrientation) -> [[String: Any]] {
    let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:])
    let rectReq = VNDetectFaceRectanglesRequest()
    guard (try? handler.perform([rectReq])) != nil else { return [] }
    let faces = (rectReq.results as? [VNFaceObservation]) ?? []
    if faces.isEmpty { return [] }

    var qByIdx: [Int: Float] = [:]
    let qReq = VNDetectFaceCaptureQualityRequest()
    qReq.inputFaceObservations = faces
    if (try? handler.perform([qReq])) != nil, let qf = qReq.results as? [VNFaceObservation] {
      for (i, f) in qf.enumerated() { qByIdx[i] = f.faceCaptureQuality ?? 0 }
    }

    let W = CGFloat(cg.width), H = CGFloat(cg.height)
    var result: [[String: Any]] = []
    for (i, f) in faces.enumerated() {
      let bb = f.boundingBox
      let faceCG = crop(cg, bb: bb, W: W, H: H, pad: 0.25)
      let sharpness = faceCG.map { laplacianVariance($0) } ?? 0
      result.append([
        "x": bb.origin.x, "y": 1.0 - bb.origin.y - bb.size.height,
        "width": bb.size.width, "height": bb.size.height,
        "quality": qByIdx[i].map { Double($0) } as Any,
        "sharpness": sharpness,
      ])
    }
    return result
  }

  // MARK: - 축소 디코드 (풀 디코드 없이 다운샘플) + JPEG 저장
  private static func downsampledCGImage(uri: String, maxPixel: Int) -> CGImage? {
    let path = uri.replacingOccurrences(of: "file://", with: "")
    let url = URL(fileURLWithPath: path)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let opts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixel,
      kCGImageSourceCreateThumbnailWithTransform: true, // orientation 반영 → 결과는 upright
    ]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
  }

  // UIImage를 upright(.up) CGImage로 정규화(다운스케일된 작은 이미지라 저렴). embedFace가 .up 가정.
  private static func uprightCG(_ image: UIImage) -> CGImage? {
    if image.imageOrientation == .up { return image.cgImage }
    let r = UIGraphicsImageRenderer(size: image.size)
    return r.image { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }.cgImage
  }

  // 워밍용 더미 CGImage (얼굴 없어도 Vision 모델은 로드됨)
  private static func dummyCGImage(_ size: Int) -> CGImage? {
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                              space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.setFillColor(gray: 0.5, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
    return ctx.makeImage()
  }

  private static func writeJPEG(cg: CGImage, toPath: String, quality: CGFloat) -> Bool {
    let path = toPath.replacingOccurrences(of: "file://", with: "")
    guard let data = UIImage(cgImage: cg).jpegData(compressionQuality: quality) else { return false }
    do { try data.write(to: URL(fileURLWithPath: path)); return true } catch { return false }
  }

  private static func runSFace(model: MLModel, pixelBuffer: CVPixelBuffer) -> [Double]? {
    guard let inName = model.modelDescription.inputDescriptionsByName.keys.first,
          let outName = model.modelDescription.outputDescriptionsByName.keys.first else { return nil }
    guard let provider = try? MLDictionaryFeatureProvider(dictionary: [inName: MLFeatureValue(pixelBuffer: pixelBuffer)]),
          let out = try? model.prediction(from: provider),
          let arr = out.featureValue(for: outName)?.multiArrayValue else { return nil }
    let count = arr.count
    var v = [Double](repeating: 0, count: count)
    switch arr.dataType {
    case .float32:
      let p = arr.dataPointer.assumingMemoryBound(to: Float32.self)
      for i in 0..<count { v[i] = Double(p[i]) }
    case .double:
      let p = arr.dataPointer.assumingMemoryBound(to: Double.self)
      for i in 0..<count { v[i] = p[i] }
    default: return nil
    }
    return v
  }

  private static func l2Normalize(_ v: [Double]) -> [Double] {
    var n = 0.0
    for x in v { n += x * x }
    n = n.squareRoot()
    if n == 0 { return v }
    return v.map { $0 / n }
  }

  // MARK: - 5점 정렬 → 112×112 BGRA 픽셀버퍼
  // ArcFace 표준 기준점(112×112, 좌상단 원점)
  private static let refLeftEye = CGPoint(x: 38.2946, y: 51.6963)
  private static let refRightEye = CGPoint(x: 73.5318, y: 51.5014)

  private static func alignedPixelBuffer(cg: CGImage, image: UIImage, bbox: CGRect) -> CVPixelBuffer? {
    let W = CGFloat(cg.width), H = CGFloat(cg.height)
    let orientation = cgOrientation(image.imageOrientation)
    let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:])
    let req = VNDetectFaceLandmarksRequest()
    try? handler.perform([req])
    let faces = (req.results as? [VNFaceObservation]) ?? []

    // bbox(좌하단 정규화)와 가장 겹치는 얼굴 선택, 없으면 가장 큰 얼굴
    var chosen: VNFaceObservation?
    var bestIoU: CGFloat = 0
    for f in faces {
      let iou = Self.iou(f.boundingBox, bbox)
      if iou > bestIoU { bestIoU = iou; chosen = f }
    }
    if chosen == nil { chosen = faces.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) }

    // 눈 중심(이미지 픽셀, 좌상단 원점)
    if let face = chosen, let lm = face.landmarks,
       let lEye = eyeCenter(lm.leftEye, face.boundingBox, W, H),
       let rEye = eyeCenter(lm.rightEye, face.boundingBox, W, H) {
      let t = similarity(detL: lEye, detR: rEye, refL: refLeftEye, refR: refRightEye)
      return warp(cg: cg, transform: t)
    }

    // 랜드마크/눈 검출 실패 → 정렬 불가.
    // 폴백(비정렬 크롭)은 정렬 안 된 노이즈 임베딩을 만들어 같은 사진이 스캔마다 다른 점수를 냄
    // (0.65↔0.28 출렁임의 원인). 폴백 대신 nil 반환 → 이 얼굴 스킵(상위에서 [] 처리).
    print("[VisionFace] 정렬 실패(눈 미검출) → 얼굴 스킵")
    return nil
  }

  // Vision 눈 랜드마크 → 이미지 픽셀(좌상단) 평균점
  private static func eyeCenter(_ region: VNFaceLandmarkRegion2D?, _ box: CGRect, _ W: CGFloat, _ H: CGFloat) -> CGPoint? {
    guard let region = region, region.pointCount > 0 else { return nil }
    var sx: CGFloat = 0, sy: CGFloat = 0
    for p in region.normalizedPoints {
      // 박스 정규화(좌하단) → 이미지 픽셀(좌하단) → 좌상단
      let xb = box.origin.x + CGFloat(p.x) * box.size.width
      let yb = box.origin.y + CGFloat(p.y) * box.size.height
      sx += xb * W
      sy += (1.0 - yb) * H
    }
    let n = CGFloat(region.pointCount)
    return CGPoint(x: sx / n, y: sy / n)
  }

  // 2점(눈) 대응 → 닮음변환 (src 좌상단px → dst 좌상단112). 복소수 분할.
  private static func similarity(detL: CGPoint, detR: CGPoint, refL: CGPoint, refR: CGPoint) -> CGAffineTransform {
    let dDetX = detR.x - detL.x, dDetY = detR.y - detL.y
    let dRefX = refR.x - refL.x, dRefY = refR.y - refL.y
    let denom = dDetX * dDetX + dDetY * dDetY
    let aRe = (dRefX * dDetX + dRefY * dDetY) / max(denom, 1e-6)
    let aIm = (dRefY * dDetX - dRefX * dDetY) / max(denom, 1e-6)
    let bRe = refL.x - (aRe * detL.x - aIm * detL.y)
    let bIm = refL.y - (aIm * detL.x + aRe * detL.y)
    return CGAffineTransform(a: aRe, b: aIm, c: -aIm, d: aRe, tx: bRe, ty: bIm)
  }

  // 변환 적용해 112×112 BGRA 픽셀버퍼 렌더
  private static func warp(cg: CGImage, transform t: CGAffineTransform) -> CVPixelBuffer? {
    guard let pb = makePixelBuffer(112, 112) else { return nil }
    CVPixelBufferLockBaseAddress(pb, [])
    defer { CVPixelBufferUnlockBaseAddress(pb, []) }
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
    let bpr = CVPixelBufferGetBytesPerRow(pb)
    guard let ctx = CGContext(data: base, width: 112, height: 112, bitsPerComponent: 8, bytesPerRow: bpr,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return nil }
    // device = flip( t(imagepx) ) : concat(flip) → concat(t)
    let flip = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 112)
    ctx.concatenate(flip)
    ctx.concatenate(t)
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
    return pb
  }

  private static func makePixelBuffer(_ w: Int, _ h: Int) -> CVPixelBuffer? {
    var pb: CVPixelBuffer?
    let attrs: [String: Any] = [kCVPixelBufferCGImageCompatibilityKey as String: true,
                                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true]
    CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pb)
    return pb
  }

  private static func iou(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let ix = max(a.minX, b.minX), iy = max(a.minY, b.minY)
    let ax = min(a.maxX, b.maxX), ay = min(a.maxY, b.maxY)
    let iw = max(0, ax - ix), ih = max(0, ay - iy)
    let inter = iw * ih
    let uni = a.width * a.height + b.width * b.height - inter
    return uni <= 0 ? 0 : inter / uni
  }

  // MARK: - 검출용 크롭/선명도 (변경 없음)
  private static func crop(_ cg: CGImage, bb: CGRect, W: CGFloat, H: CGFloat, pad: Double = 0.25) -> CGImage? {
    var rx = bb.origin.x * W
    var ry = (1 - bb.origin.y - bb.size.height) * H
    var rw = bb.size.width * W
    var rh = bb.size.height * H
    let padX = rw * CGFloat(pad), padY = rh * CGFloat(pad)
    rx = max(0, rx - padX); ry = max(0, ry - padY)
    rw = min(W - rx, rw + 2 * padX); rh = min(H - ry, rh + 2 * padY)
    if rw < 1 || rh < 1 { return nil }
    return cg.cropping(to: CGRect(x: rx, y: ry, width: rw, height: rh))
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
