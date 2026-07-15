package expo.modules.visionface

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.content.ContentUris
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import android.net.Uri
import android.provider.MediaStore
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.InputStream
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

// 안드로이드 얼굴 인식 (iOS VisionFaceModule.swift의 안드로이드 대응).
//  - 검출: ML Kit Face Detection (bbox + 눈 랜드마크). iOS Apple Vision 대응.
//  - 임베딩: SFace ONNX (iOS와 동일 가중치). 1-a에서 코사인 0.999995 검증. → 1-c에서 구현.
//  - 정렬: 눈 2점 → ArcFace 5점 닮음변환. iOS similarity()/warp() 1:1 포팅. → 1-c에서 구현.
//  - 스캔 경로: MediaLibrary file URI 축소디코드. iOS PHImageManager 대응. → 1-d에서 구현.
// DetectedFace 계약(iOS와 동일): { x, y, width, height (정규화 좌상단), quality: Double?, sharpness: Double }
class VisionFaceModule : Module() {

  // 검출 전용(빠름): 랜드마크 없이 bbox만. iOS VNDetectFaceRectangles 대응.
  private val fastDetector: FaceDetector by lazy {
    FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
        .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
        .setMinFaceSize(0.05f) // 작은 얼굴도(iOS와 게이팅은 상위 JS에서)
        .build()
    )
  }

  // 정렬용(임베딩): 눈 랜드마크 포함. iOS VNDetectFaceLandmarks 대응. 1-c embedFace에서 사용.
  private val landmarkDetector: FaceDetector by lazy {
    FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
        .build()
    )
  }

  // ── SFace ONNX (iOS와 동일 가중치, 1-a 검증). ORT 세션은 최초 사용 시 1회 로드. ──
  private val ortEnv: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
  private val ortSession: OrtSession by lazy {
    val ctx = appContext.reactContext!!
    val bytes = ctx.assets.open("sface.onnx").use { it.readBytes() }
    val opts = OrtSession.SessionOptions().apply {
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      setIntraOpNumThreads(4) // 멀티코어 활용(iOS ANE 대비 CPU 병렬)
      // XNNPACK(모바일 CPU SIMD 가속) — 소형 MobileFaceNet에 NNAPI보다 안정적으로 빠름.
      // AAR에 미포함이면 예외 → 기본 CPU로 폴백(스레드/최적화는 유지).
      try { addXnnpack(mapOf("intra_op_num_threads" to "4")) } catch (t: Throwable) { /* 폴백 */ }
    }
    ortEnv.createSession(bytes, opts)
  }

  // ArcFace 112 template 기준점 (iOS refLeftEye/refRightEye와 동일값).
  private val REF_L = PointF(38.2946f, 51.6963f)
  private val REF_R = PointF(73.5318f, 51.5014f)
  // 눈 좌/우 매핑: iOS는 leftEye→refL, rightEye→refR. ML Kit LEFT_EYE/RIGHT_EYE도 같은 해부학적 정의.
  // 만약 1-e 실측에서 iOS와 임베딩이 뒤집혀 나오면 이 값만 true로. (1-e 검증 대상)
  private val SWAP_EYES = false

  override fun definition() = ModuleDefinition {
    Name("VisionFace")

    // ── 검출 (앵커 URL 등 임의 이미지용). iOS detectFaces 대응. ──
    AsyncFunction("detectFaces") { uri: String, promise: Promise ->
      val bmp = loadUprightBitmap(uri)
      if (bmp == null) { promise.reject("E_IMAGE", "Cannot load image: $uri", null); return@AsyncFunction }
      try {
        promise.resolve(detectFacesOn(bmp))
      } catch (e: Exception) {
        promise.reject("E_DETECT", e.message ?: "detect failed", e)
      } finally {
        bmp.recycle()
      }
    }

    // ── 스캔 고속 경로: file/content URI 축소디코드 + 검출 + 얼굴 있으면 썸네일 저장. iOS scanImage 대응. ──
    AsyncFunction("scanImage") { uri: String, maxPixel: Int, thumbPath: String, promise: Promise ->
      val bmp = loadDownsampledUpright(uri, maxPixel)
      if (bmp == null) { promise.resolve(null); return@AsyncFunction } // 로드 실패
      try {
        val faces = detectFacesOn(bmp)
        val wrote = if (faces.isNotEmpty()) writeJpeg(bmp, thumbPath, 70) else false
        promise.resolve(mapOf("faces" to faces, "width" to bmp.width, "height" to bmp.height, "thumbWritten" to wrote))
      } catch (e: Exception) {
        promise.resolve(null)
      } finally {
        bmp.recycle()
      }
    }

    // ── 스캔 최고속: iOS는 PHImageManager(PhotoKit). 안드로이드는 MediaStore id → content URI 축소디코드. ──
    // localId = expo-media-library asset.id (안드로이드는 MediaStore _ID). 해석 실패 시 unavailable(스킵).
    AsyncFunction("scanAsset") { localId: String, maxPixel: Int, thumbPath: String, promise: Promise ->
      val uri = resolveAssetUri(localId)
      val bmp = if (uri != null) loadDownsampledUpright(uri, maxPixel) else null
      if (bmp == null) { promise.resolve(mapOf("unavailable" to true)); return@AsyncFunction }
      try {
        val faces = detectFacesOn(bmp)
        val wrote = if (faces.isNotEmpty()) writeJpeg(bmp, thumbPath, 70) else false
        promise.resolve(mapOf(
          "faces" to faces, "width" to bmp.width, "height" to bmp.height,
          "thumbWritten" to wrote, "unavailable" to false
        ))
      } catch (e: Exception) {
        promise.resolve(mapOf("unavailable" to true))
      } finally {
        bmp.recycle()
      }
    }

    // ── 모델 워밍: SFace ORT + ML Kit 검출기(2종) 프리로드 → 첫 앵커의 모델 로드 지연 제거. iOS warmUpFace 대응. ──
    AsyncFunction("warmUpFace") { promise: Promise ->
      try { runSFace(FloatArray(3 * 112 * 112)) } catch (e: Exception) { /* noop */ }
      try {
        val dummy = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888)
        val img = InputImage.fromBitmap(dummy, 0)
        Tasks.await(fastDetector.process(img))      // ML Kit 검출기 로드
        Tasks.await(landmarkDetector.process(img))  // ML Kit 랜드마크 검출기 로드
        dummy.recycle()
      } catch (e: Exception) { /* noop */ }
      promise.resolve(true)
    }

    // ── 임베딩: 정렬(눈 2점→ArcFace 5점 닮음변환) → SFace 128-d → L2. iOS embedFace 1:1 대응. ──
    // 정렬 실패(눈 미검출) 시 iOS와 동일하게 빈 벡터 반환 → 상위에서 이 얼굴 스킵(비정렬 폴백 금지).
    AsyncFunction("embedFace") { uri: String, x: Double, y: Double, w: Double, h: Double, promise: Promise ->
      val bmp = loadUprightBitmap(uri)
      if (bmp == null) { promise.resolve(emptyList<Double>()); return@AsyncFunction }
      try {
        val faces = Tasks.await(landmarkDetector.process(InputImage.fromBitmap(bmp, 0)))
        if (faces.isEmpty()) { promise.resolve(emptyList<Double>()); return@AsyncFunction }
        val face = pickFace(faces, bmp.width, bmp.height, x, y, w, h)
        val eyes = eyeCenters(face)
        if (eyes == null) { promise.resolve(emptyList<Double>()); return@AsyncFunction } // 정렬 불가 → 스킵
        val (lp, rp) = eyes
        val detL = if (SWAP_EYES) PointF(rp[0], rp[1]) else PointF(lp[0], lp[1])
        val detR = if (SWAP_EYES) PointF(lp[0], lp[1]) else PointF(rp[0], rp[1])
        val aligned = alignFace(bmp, detL, detR)
        val nchw = toBGRNCHW(aligned); aligned.recycle()
        val emb = runSFace(nchw)
        promise.resolve(l2Normalize(emb))
      } catch (e: Exception) {
        promise.resolve(emptyList<Double>())
      } finally {
        bmp.recycle()
      }
    }
  }

  // ML Kit Face → DetectedFace map (정규화 좌상단 + 품질 + 선명도). iOS detectFacesIn 대응.
  private fun faceToMap(face: Face, bmp: Bitmap): Map<String, Any?> {
    val W = bmp.width.toDouble(); val H = bmp.height.toDouble()
    val box = face.boundingBox // 픽셀, 좌상단 원점 (upright 비트맵 기준)
    val nx = (box.left / W).coerceIn(0.0, 1.0)
    val ny = (box.top / H).coerceIn(0.0, 1.0)
    val nw = (box.width() / W).coerceIn(0.0, 1.0)
    val nh = (box.height() / H).coerceIn(0.0, 1.0)
    val sharp = sharpnessOf(bmp, nx, ny, nw, nh)
    // quality: iOS는 Vision faceCaptureQuality(0~1). ML Kit엔 직접 대응 없음 →
    // null 반환(상위 게이팅에서 품질 컷 스킵). 1-e에서 프록시 도입/보정 검토.
    return mapOf(
      "x" to nx, "y" to ny, "width" to nw, "height" to nh,
      "quality" to null,
      "sharpness" to sharp
    )
  }

  // 라플라시안 분산 선명도. iOS laplacianVariance와 동일 알고리즘(64×64 gray, 4c-이웃).
  private fun sharpnessOf(bmp: Bitmap, nx: Double, ny: Double, nw: Double, nh: Double): Double {
    val W = bmp.width; val H = bmp.height
    // 얼굴 크롭(pad 0.25) — iOS crop(pad:0.25)와 동일.
    var rx = nx * W; var ry = ny * H; var rw = nw * W; var rh = nh * H
    val padX = rw * 0.25; val padY = rh * 0.25
    rx = max(0.0, rx - padX); ry = max(0.0, ry - padY)
    rw = min(W - rx, rw + 2 * padX); rh = min(H - ry, rh + 2 * padY)
    if (rw < 1 || rh < 1) return 0.0
    val crop = try {
      Bitmap.createBitmap(bmp, rx.toInt(), ry.toInt(), rw.toInt(), rh.toInt())
    } catch (e: Exception) { return 0.0 }

    val size = 64
    val gray = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(gray)
    val paint = Paint().apply {
      colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) })
      isFilterBitmap = true
    }
    canvas.drawBitmap(crop, android.graphics.Rect(0, 0, crop.width, crop.height),
      android.graphics.Rect(0, 0, size, size), paint)
    crop.recycle()

    val px = IntArray(size * size)
    gray.getPixels(px, 0, size, 0, 0, size, size)
    gray.recycle()
    // 채널 하나(gray라 R=G=B) → 0~255
    val g = IntArray(size * size) { Color.red(px[it]) }
    var sum = 0.0; var sumSq = 0.0; var n = 0.0
    for (yy in 1 until size - 1) {
      for (xx in 1 until size - 1) {
        val c = g[yy * size + xx]
        val lap = (4 * c - g[(yy - 1) * size + xx] - g[(yy + 1) * size + xx]
          - g[yy * size + (xx - 1)] - g[yy * size + (xx + 1)]).toDouble()
        sum += lap; sumSq += lap * lap; n += 1
      }
    }
    if (n == 0.0) return 0.0
    val mean = sum / n
    return sumSq / n - mean * mean
  }

  // 검출 공통: ML Kit로 얼굴 검출 → DetectedFace map 리스트. detectFaces/scanImage/scanAsset 공용.
  private fun detectFacesOn(bmp: Bitmap): List<Map<String, Any?>> {
    val faces = Tasks.await(fastDetector.process(InputImage.fromBitmap(bmp, 0)))
    return faces.map { faceToMap(it, bmp) }
  }

  // 얼굴 있는 사진만 썸네일 저장. iOS writeJPEG(quality 0.7) 대응.
  private fun writeJpeg(bmp: Bitmap, path: String, quality: Int): Boolean {
    return try {
      java.io.File(path.removePrefix("file://")).outputStream().use {
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, it)
      }
      true
    } catch (e: Exception) { false }
  }

  // expo-media-library asset.id(안드로이드=MediaStore _ID) → content URI. 이미 uri/경로면 그대로.
  private fun resolveAssetUri(localId: String): String? {
    if (localId.startsWith("content://") || localId.startsWith("file://") || localId.startsWith("/")) return localId
    val id = localId.toLongOrNull() ?: return null
    return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString()
  }

  // 원본 바이트 + EXIF orientation. file:// / content:// / 경로 지원.
  private fun readBytesAndOrientation(uri: String): Pair<ByteArray, Int>? {
    val ctx = appContext.reactContext ?: return null
    return try {
      if (uri.startsWith("content://")) {
        val u = Uri.parse(uri)
        val data = ctx.contentResolver.openInputStream(u)?.use { it.readBytes() } ?: return null
        val ori = ctx.contentResolver.openInputStream(u)?.use { readExifOrientation(it) } ?: ExifInterface.ORIENTATION_NORMAL
        data to ori
      } else {
        val path = uri.removePrefix("file://")
        val f = java.io.File(path)
        if (!f.exists()) return null
        val data = f.readBytes()
        data to data.inputStream().use { readExifOrientation(it) }
      }
    } catch (e: Exception) { null }
  }

  // 원본을 upright(EXIF 회전 반영) ARGB로 풀 디코드. embedFace/detectFaces용(정확한 좌표).
  private fun loadUprightBitmap(uri: String): Bitmap? {
    val (bytes, ori) = readBytesAndOrientation(uri) ?: return null
    val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
    val raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return null
    return applyOrientation(raw, ori)
  }

  // 축소 디코드(풀 디코드 X) + upright. 스캔 대량처리용. iOS downsampledCGImage(maxPixel) 대응.
  private fun loadDownsampledUpright(uri: String, maxPixel: Int): Bitmap? {
    val (bytes, ori) = readBytesAndOrientation(uri) ?: return null
    val bmp = decodeDownsampledUpright(bytes, maxPixel) ?: return null
    return applyOrientation(bmp, ori)
  }

  private fun decodeDownsampledUpright(bytes: ByteArray, maxPixel: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val w = bounds.outWidth; val h = bounds.outHeight
    if (w <= 0 || h <= 0) return null
    var sample = 1
    while (max(w, h) / (sample * 2) >= maxPixel) sample *= 2 // 목표보다 약간 크게 디코드 후 정밀 축소
    val opts = BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 }
    var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return null
    val longSide = max(bmp.width, bmp.height)
    if (longSide > maxPixel) {
      val scale = maxPixel.toFloat() / longSide
      val sw = (bmp.width * scale).toInt().coerceAtLeast(1)
      val sh = (bmp.height * scale).toInt().coerceAtLeast(1)
      val scaled = Bitmap.createScaledBitmap(bmp, sw, sh, true)
      if (scaled != bmp) bmp.recycle()
      bmp = scaled
    }
    return bmp
  }

  private fun readExifOrientation(input: InputStream): Int =
    try { ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    catch (e: Exception) { ExifInterface.ORIENTATION_NORMAL }

  private fun applyOrientation(bmp: Bitmap, orientation: Int): Bitmap {
    val m = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
      else -> return bmp
    }
    return try {
      val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
      if (rotated != bmp) bmp.recycle()
      rotated
    } catch (e: Exception) { bmp }
  }

  // 전달된 bbox(정규화 좌상단)와 가장 겹치는 얼굴 선택, 없으면 가장 큰 얼굴. iOS IoU 선택과 동일.
  private fun pickFace(faces: List<Face>, W: Int, H: Int, x: Double, y: Double, w: Double, h: Double): Face {
    var best: Face? = null; var bestIoU = -1.0
    for (f in faces) {
      val b = f.boundingBox
      val iou = iou(x, y, w, h, b.left / W.toDouble(), b.top / H.toDouble(), b.width() / W.toDouble(), b.height() / H.toDouble())
      if (iou > bestIoU) { bestIoU = iou; best = f }
    }
    if (best == null || bestIoU <= 0.0) {
      best = faces.maxByOrNull { it.boundingBox.width().toLong() * it.boundingBox.height() }
    }
    return best!!
  }

  private fun iou(ax: Double, ay: Double, aw: Double, ah: Double, bx: Double, by: Double, bw: Double, bh: Double): Double {
    val ix = max(ax, bx); val iy = max(ay, by)
    val axx = min(ax + aw, bx + bw); val ayy = min(ay + ah, by + bh)
    val iw = max(0.0, axx - ix); val ih = max(0.0, ayy - iy); val inter = iw * ih
    val uni = aw * ah + bw * bh - inter
    return if (uni <= 0) 0.0 else inter / uni
  }

  // 눈 2점 → ArcFace ref 닮음변환. iOS similarity() 1:1 포팅(복소수 분할). 반환: [aRe, aIm, bRe, bIm].
  // 매핑: x' = aRe*x - aIm*y + bRe ; y' = aIm*x + aRe*y + bIm
  private fun similarityTransform(detL: PointF, detR: PointF): DoubleArray {
    val dDetX = (detR.x - detL.x).toDouble(); val dDetY = (detR.y - detL.y).toDouble()
    val dRefX = (REF_R.x - REF_L.x).toDouble(); val dRefY = (REF_R.y - REF_L.y).toDouble()
    val denom = max(dDetX * dDetX + dDetY * dDetY, 1e-6)
    val aRe = (dRefX * dDetX + dRefY * dDetY) / denom
    val aIm = (dRefY * dDetX - dRefX * dDetY) / denom
    val bRe = REF_L.x - (aRe * detL.x - aIm * detL.y)
    val bIm = REF_L.y - (aIm * detL.x + aRe * detL.y)
    return doubleArrayOf(aRe, aIm, bRe, bIm)
  }

  // 닮음변환을 적용해 112×112 정렬 크롭 생성. 안드로이드 Canvas는 좌상단 원점이라 iOS의 flip 불필요.
  private fun alignFace(src: Bitmap, detL: PointF, detR: PointF): Bitmap {
    val t = similarityTransform(detL, detR)
    val m = Matrix()
    // Android Matrix: [MSCALE_X, MSKEW_X, MTRANS_X, MSKEW_Y, MSCALE_Y, MTRANS_Y, 0,0,1]
    //   = [aRe, -aIm, bRe,  aIm, aRe, bIm]
    m.setValues(floatArrayOf(
      t[0].toFloat(), (-t[1]).toFloat(), t[2].toFloat(),
      t[1].toFloat(), t[0].toFloat(), t[3].toFloat(),
      0f, 0f, 1f
    ))
    val out = Bitmap.createBitmap(112, 112, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawBitmap(src, m, Paint().apply { isFilterBitmap = true; isAntiAlias = true })
    return out
  }

  // 112×112 → SFace 입력 텐서. ⚠️ 1-a 검증 전처리: BGR 채널, 0~255 원시값, 정규화 없음, NCHW.
  private fun toBGRNCHW(bmp112: Bitmap): FloatArray {
    val plane = 112 * 112
    val px = IntArray(plane)
    bmp112.getPixels(px, 0, 112, 0, 0, 112, 112)
    val out = FloatArray(3 * plane)
    for (i in 0 until plane) {
      val p = px[i]
      out[i] = (p and 0xFF).toFloat()             // B
      out[plane + i] = ((p shr 8) and 0xFF).toFloat()   // G
      out[2 * plane + i] = ((p shr 16) and 0xFF).toFloat() // R
    }
    return out
  }

  // SFace 추론: NCHW float → 128-d. 입력명 "data", 출력명 "fc1".
  private fun runSFace(nchw: FloatArray): FloatArray {
    val shape = longArrayOf(1, 3, 112, 112)
    OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(nchw), shape).use { input ->
      ortSession.run(mapOf("data" to input)).use { res ->
        @Suppress("UNCHECKED_CAST")
        val out = res[0].value as Array<FloatArray>
        return out[0]
      }
    }
  }

  private fun l2Normalize(v: FloatArray): List<Double> {
    var n = 0.0; for (x in v) n += x.toDouble() * x
    n = sqrt(n)
    return if (n == 0.0) v.map { it.toDouble() } else v.map { it.toDouble() / n }
  }

  // 눈 중심 추출 헬퍼. ML Kit LEFT_EYE/RIGHT_EYE 랜드마크 → 이미지 픽셀(좌상단).
  internal fun eyeCenters(face: Face): Pair<FloatArray, FloatArray>? {
    val l = face.getLandmark(FaceLandmark.LEFT_EYE)?.position
    val r = face.getLandmark(FaceLandmark.RIGHT_EYE)?.position
    if (l == null || r == null) return null
    return floatArrayOf(l.x, l.y) to floatArrayOf(r.x, r.y)
  }
}
