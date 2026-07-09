// functions/src/photobookPdf.ts
//
// P2 — 포토북 PDF 서버 렌더러.
// 클라이언트가 동결(freeze)한 레이아웃(FrozenLayout)을 입력으로 받아, 원본을 조판해 PDF 생성.
// 레이아웃 로직은 재실행하지 않는다(프리뷰가 계산한 pages를 그대로 렌더) → 프리뷰-PDF 100% 일치.
//
// 크롭은 앱의 src/components/photobook/CoverCrop.tsx cover-crop 수식을 sharp로 역산해 재현.
// 규격값(사이즈/bleed/dpi/색)은 아래 PB_SPEC 한 곳에 모아 P3에서 IQLab 답변대로 조정만 하면 됨.
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { getStorage } from "firebase-admin/storage";

// ── IQLab 인쇄 규격 상수 (P3에서 여기만 조정) ──
// ⚠️ IQLab 규격 — 아래 값만 바꾸면 전체 PDF에 반영(코드 수정 불필요).
//    현재는 IQLab 확인 대기 중 → 표준 기본값(3mm bleed / 표지 별도 페이지 / 300dpi).
export const PB_SPEC = {
    dpi: 300,               // 인쇄 해상도
    bleedMm: 3,             // 재단 여백(사방). IQLab 확정.
    spineMm: 5,             // 책등 폭 0.5cm — cover.pdf(앞+책등+뒤)에 포함. IQLab이 미세조정.
    // 물리 크기(cm, 가로형 w×h). ratio는 freeze.ratio와 반드시 일치.
    sizeCm: {
        A4: { w: 27.9, h: 21.5 },
        A3: { w: 38.6, h: 29.7 },
        A5: { w: 19.7, h: 15.2 }, // A4와 동일 비율(27.9/21.5)
    } as Record<string, { w: number; h: number }>,
    accent: "#FF7E66",      // 날짜 라벨 색(프리뷰 c.coral)
    pageBg: "#FFFFFF",
    surface: "#FBF7F2",     // 텍스트/액자 표지 배경(웜톤)
    ink: "#1A1613",         // 진한 텍스트색
    // 럭셔리 세리프(내장 폰트). 날짜·표지 텍스트에 사용. titleFontPath 지정 시 그게 우선(유니코드).
    serifFont: "Times-Italic",
    serifBold: "Times-Bold",
    // 표지 = PDF 첫 페이지. IQLab이 표지를 별도 파일로 요구하면 false로 두고 P4에서 분리 저장.
    coverAsFirstPage: true,
    backPage: true,         // 뒷표지(빈 페이지) 포함 여부
    // 표지 제목 폰트. pdfkit 기본(Helvetica)은 태국어/한글 미지원(두부).
    // 유니코드 제목을 인쇄하려면 functions에 .ttf를 넣고 그 경로를 지정(예: `${__dirname}/fonts/NotoSansThai.ttf`).
    // null이면 라틴(ASCII) 제목만 인쇄하고 비라틴 제목은 스킵(두부 방지).
    titleFontPath: null as string | null,
};

const isAsciiSafe = (s: string) => /^[\x20-\x7E]*$/.test(s);

const PT_PER_INCH = 72;
const MM_PER_INCH = 25.4;
const mmToPt = (mm: number) => (mm / MM_PER_INCH) * PT_PER_INCH;
const cmToPt = (cm: number) => mmToPt(cm * 10);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Crop = { fx: number; fy: number; zoom: number };
type FCell = { idx: number; assetId: string; x: number; y: number; w: number; h: number; aspect: number; crop: Crop };
type FPage = { index: number; kind: string; dateLabel: string; cells: FCell[] };
type FCover = { idx: number | null; assetId: string | null; style?: string; title?: string; dateLabel?: string; crop: Crop };
export type FrozenLayout = {
    version: number;
    size: string;
    ratio: number;
    topBand: number;
    coverPage: FCover;
    pages: FPage[];
};

// CoverCrop 수식 그대로: frame(w×h)를 cover하도록 확대/이동한 뒤, 원본에서 잘라낼 정규화 사각형을 구한다.
export function coverCropSourceRect(srcW: number, srcH: number, frameW: number, frameH: number, crop: Crop) {
    const aspect = srcW / srcH;
    const base = aspect > frameW / frameH ? { w: frameH * aspect, h: frameH } : { w: frameW, h: frameW / aspect };
    const dW = base.w * crop.zoom;
    const dH = base.h * crop.zoom;
    const left = Math.min(0, Math.max(frameW - dW, frameW / 2 - crop.fx * dW));
    const top = Math.min(0, Math.max(frameH - dH, frameH / 2 - crop.fy * dH));
    // 프레임에 보이는 영역 = 이미지 로컬좌표 [-left, -left+frameW] × [-top, -top+frameH] → 정규화
    const nx = -left / dW;
    const ny = -top / dH;
    const nw = frameW / dW;
    const nh = frameH / dH;
    // 소스 픽셀 사각형(경계 클램프)
    const eL = clamp(Math.round(nx * srcW), 0, srcW - 1);
    const eT = clamp(Math.round(ny * srcH), 0, srcH - 1);
    const eW = clamp(Math.round(nw * srcW), 1, srcW - eL);
    const eH = clamp(Math.round(nh * srcH), 1, srcH - eT);
    return { left: eL, top: eT, width: eW, height: eH };
}

// 원본 버퍼 → 셀 크기(targetW×targetH px)로 cover-crop한 JPEG 버퍼
async function renderCellJpeg(srcBuf: Buffer, crop: Crop, targetWpx: number, targetHpx: number): Promise<Buffer> {
    const img = sharp(srcBuf, { failOn: "none" }).rotate(); // EXIF 자동회전(앱 썸네일과 방향 일치)
    const meta = await img.metadata();
    const W = meta.width || 1;
    const H = meta.height || 1;
    const rect = coverCropSourceRect(W, H, targetWpx, targetHpx, crop);
    return sharp(srcBuf, { failOn: "none" })
        .rotate()
        .extract(rect)
        .resize(Math.max(1, Math.round(targetWpx)), Math.max(1, Math.round(targetHpx)), { fit: "fill" })
        .jpeg({ quality: 92 })
        .toBuffer();
}

// 셀의 트림 정규화(0~1) 사각형 → 페이지(pt) 좌표. 트림 가장자리에 닿는 셀은 bleed로 확장(풀블리드).
function cellRectPt(c: { x: number; y: number; w: number; h: number }, trimW: number, trimH: number, bleed: number) {
    const EPS = 0.002;
    const tL = c.x <= EPS, tR = c.x + c.w >= 1 - EPS, tT = c.y <= EPS, tB = c.y + c.h >= 1 - EPS;
    let px = bleed + c.x * trimW;
    let py = bleed + c.y * trimH;
    let pw = c.w * trimW;
    let ph = c.h * trimH;
    if (tL) { px -= bleed; pw += bleed; }
    if (tR) { pw += bleed; }
    if (tT) { py -= bleed; ph += bleed; }
    if (tB) { ph += bleed; }
    return { px, py, pw, ph };
}

type Geom = { trimW: number; trimH: number; bleed: number; pxPerPt: number };
function geomFor(frozen: FrozenLayout): Geom {
    const sz = PB_SPEC.sizeCm[frozen.size] || PB_SPEC.sizeCm.A4;
    return { trimW: cmToPt(sz.w), trimH: cmToPt(sz.h), bleed: mmToPt(PB_SPEC.bleedMm), pxPerPt: PB_SPEC.dpi / PT_PER_INCH };
}
function registerTitleFont(doc: any): string {
    let titleFont = "Helvetica";
    if (PB_SPEC.titleFontPath) {
        try { doc.registerFont("pbTitle", PB_SPEC.titleFontPath); titleFont = "pbTitle"; }
        catch (e) { console.warn("[photobookPdf] title font load failed", e); }
    }
    return titleFont;
}

// 앞표지를 현재 페이지의 트림 원점 (originX, bleed)에 그린다. sides = 바깥 bleed 방향(좌/우; 상·하는 항상 bleed).
async function drawFrontCoverInto(doc: any, cp: FCover, originals: Map<number, Buffer>, g: Geom, originX: number, sides: { left: boolean; right: boolean }, titleFont: string) {
    const { trimW, trimH, bleed, pxPerPt } = g;
    const style = cp?.style || "photo";
    const title = (cp?.title || "").trim();
    const dateLabel = (cp?.dateLabel || "").trim();
    const cBuf = cp?.idx != null && cp.idx >= 0 ? originals.get(cp.idx) : undefined;
    const bx = originX, by = bleed;
    const pageH = bleed * 2 + trimH;
    const SANS_B = "Helvetica-Bold", SANS = "Helvetica";

    const drawText = (txt: string, o: { x: number; y: number; w: number; size: number; color: string; align?: "left" | "right" | "center"; font?: string; ls?: number }) => {
        if (!txt) return;
        let useFont = o.font || SANS_B;
        if (!isAsciiSafe(txt)) { if (titleFont === "Helvetica") return; useFont = titleFont; }
        try {
            doc.font(useFont).fillColor(o.color).fontSize(o.size)
                .text(txt, bx + o.x, by + o.y, { width: o.w, align: o.align || "left", lineBreak: false, characterSpacing: o.ls || 0 });
        } catch (e) { console.warn("[photobookPdf] cover text skipped", e); }
    };

    // 사진/배경 채움 영역: 트림 + 바깥 bleed(상·하 항상, 좌·우는 sides)
    const paintX = originX - (sides.left ? bleed : 0);
    const paintW = trimW + (sides.left ? bleed : 0) + (sides.right ? bleed : 0);

    if (style === "logo") {
        doc.save().rect(paintX, 0, paintW, pageH).fill(PB_SPEC.surface).restore();
        drawText("memotile", { x: 0, y: trimH * 0.36, w: trimW, size: trimH * 0.095, color: PB_SPEC.ink, align: "center", font: SANS_B });
        drawText("PHOTO BOOK", { x: 0, y: trimH * 0.50, w: trimW, size: trimH * 0.024, color: "#9A8E82", align: "center", font: SANS, ls: 4 });
        drawText(title, { x: 0, y: trimH * 0.60, w: trimW, size: trimH * 0.042, color: "#6B5F55", align: "center", font: SANS });
        drawText(dateLabel, { x: 0, y: trimH * 0.68, w: trimW, size: trimH * 0.03, color: "#9A8E82", align: "center", font: SANS, ls: 1 });
    } else if (style === "text") {
        doc.save().rect(paintX, 0, paintW, pageH).fill(PB_SPEC.surface).restore();
        drawText(title, { x: trimW * 0.06, y: trimH * 0.78, w: trimW * 0.88, size: trimH * 0.058, color: PB_SPEC.ink, align: "right", font: SANS_B });
        drawText(dateLabel, { x: trimW * 0.06, y: trimH * 0.87, w: trimW * 0.88, size: trimH * 0.03, color: "#9A8E82", align: "right", font: SANS, ls: 1 });
    } else if (style === "style") {
        doc.save().rect(paintX, 0, paintW, pageH).fill(PB_SPEC.surface).restore();
        const frameW = trimW * 0.868, frameH = trimH * 0.586;
        const frameX = (trimW - frameW) / 2, frameY = trimH * 0.08;
        if (cBuf) {
            const j = await renderCellJpeg(cBuf, cp.crop, frameW * pxPerPt, frameH * pxPerPt);
            doc.image(j, bx + frameX, by + frameY, { width: frameW, height: frameH });
        }
        drawText(title, { x: 0, y: frameY + frameH + trimH * 0.03, w: trimW, size: trimH * 0.05, color: PB_SPEC.ink, align: "center", font: SANS_B });
        drawText(dateLabel, { x: 0, y: frameY + frameH + trimH * 0.11, w: trimW, size: trimH * 0.026, color: "#9A8E82", align: "center", font: SANS, ls: 2 });
    } else {
        // photo(기본): 풀블리드 사진 + 하단 반투명 밴드(글자 hug)
        if (cBuf) {
            const j = await renderCellJpeg(cBuf, cp.crop, paintW * pxPerPt, pageH * pxPerPt);
            doc.image(j, paintX, 0, { width: paintW, height: pageH });
        }
        const padH = trimW * 0.045, padV = trimH * 0.03;
        const titleFs = trimH * 0.058, dateFs = trimH * 0.032, gap = trimH * 0.012;
        const hasT = !!title, hasD = !!dateLabel;
        const contentH = (hasT ? titleFs * 1.1 : 0) + (hasT && hasD ? gap : 0) + (hasD ? dateFs * 1.1 : 0);
        const bandH = contentH + padV * 2;
        const bandY = trimH - bandH;
        // 밴드는 바깥 bleed(우/하, 그리고 combined는 좌까지)와 하단 페이지 끝까지 확장 → 재단 후 가장자리에 깔끔히 붙음.
        const bandTop = by + bandY;
        const bandLeft = bx - (sides.left ? bleed : 0);
        const bandRight = bx + trimW + (sides.right ? bleed : 0);
        doc.save().fillColor("#14100E").fillOpacity(0.34).rect(bandLeft, bandTop, bandRight - bandLeft, pageH - bandTop).fill().restore();
        let ty = bandY + padV;
        if (hasT) { drawText(title, { x: padH, y: ty, w: trimW - 2 * padH, size: titleFs, color: "#FFFFFF", font: SANS_B }); ty += titleFs * 1.1 + gap; }
        if (hasD) { drawText(dateLabel, { x: padH, y: ty, w: trimW - 2 * padH, size: dateFs, color: "#F0EAE2", font: SANS, ls: 1.5 }); }
    }
}

// 내지 한 페이지를 현재 페이지에 그린다(셀 + 날짜 라벨).
async function drawInteriorPageInto(doc: any, pg: FPage, originals: Map<number, Buffer>, g: Geom, topBand: number) {
    const { trimW, trimH, bleed, pxPerPt } = g;
    for (const cell of pg.cells) {
        if (cell.idx < 0) continue;
        const buf = originals.get(cell.idx);
        if (!buf) continue;
        const r = cellRectPt(cell, trimW, trimH, bleed);
        const jpeg = await renderCellJpeg(buf, cell.crop, r.pw * pxPerPt, r.ph * pxPerPt);
        doc.image(jpeg, r.px, r.py, { width: r.pw, height: r.ph });
    }
    if (pg.dateLabel) {
        try {
            const fs = clamp(Math.round(trimH * 0.04), 8, 36);
            const minX = pg.cells.length ? Math.min(...pg.cells.map((c) => c.x)) : 0.055;
            const dateX = bleed + trimW * minX;
            const dateY = Math.max(bleed + 2, bleed + trimH * topBand - fs * 1.2);
            doc.font(PB_SPEC.serifFont).fillColor(PB_SPEC.accent).fontSize(fs)
                .text(pg.dateLabel, dateX, dateY, { lineBreak: false, characterSpacing: 1 });
        } catch { /* noop */ }
    }
}

/** 통합 프리뷰 PDF(어드민 iframe용) — 표지+내지+뒤표지 한 파일. 프리뷰와 픽셀 일치. */
export async function renderPhotobookPdfBuffer(frozen: FrozenLayout, originals: Map<number, Buffer>): Promise<Buffer> {
    const g = geomFor(frozen);
    const pageW = g.trimW + 2 * g.bleed, pageH = g.trimH + 2 * g.bleed;
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    const titleFont = registerTitleFont(doc);
    const newPage = () => { doc.addPage({ size: [pageW, pageH], margin: 0 }); doc.save().rect(0, 0, pageW, pageH).fill(PB_SPEC.pageBg).restore(); };

    if (PB_SPEC.coverAsFirstPage) { newPage(); await drawFrontCoverInto(doc, frozen.coverPage, originals, g, g.bleed, { left: true, right: true }, titleFont); }
    for (const pg of frozen.pages) { newPage(); await drawInteriorPageInto(doc, pg, originals, g, frozen.topBand); }
    if (PB_SPEC.backPage) newPage();

    doc.end();
    return done;
}

/** 🔴 IQLab 인쇄용: 표지 별도 PDF — 뒤표지 + 책등(spineMm) + 앞표지 한 장으로 이어서. */
export async function renderCoverPdf(frozen: FrozenLayout, originals: Map<number, Buffer>): Promise<Buffer> {
    const g = geomFor(frozen);
    const spine = mmToPt(PB_SPEC.spineMm);
    const pageW = g.bleed * 2 + g.trimW * 2 + spine;
    const pageH = g.bleed * 2 + g.trimH;
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    const titleFont = registerTitleFont(doc);

    doc.addPage({ size: [pageW, pageH], margin: 0 });
    doc.save().rect(0, 0, pageW, pageH).fill(PB_SPEC.pageBg).restore();

    const spineX = g.bleed + g.trimW;
    const frontTrimX = spineX + spine;

    // 뒤표지: 흰 바탕 + memotile 브랜딩(중앙). 좌·상·하 bleed 포함.
    doc.save().rect(0, 0, spineX, pageH).fill(PB_SPEC.surface).restore();
    try {
        doc.font("Helvetica-Bold").fillColor(PB_SPEC.ink).fontSize(g.trimH * 0.05)
            .text("memotile", g.bleed, g.bleed + g.trimH * 0.46, { width: g.trimW, align: "center", lineBreak: false });
        doc.font("Helvetica").fillColor("#9A8E82").fontSize(g.trimH * 0.02)
            .text("PHOTO BOOK", g.bleed, g.bleed + g.trimH * 0.53, { width: g.trimW, align: "center", lineBreak: false, characterSpacing: 3 });
    } catch { /* noop */ }

    // 책등(spine): surface 띠 — IQLab이 미세조정.
    doc.save().rect(spineX, 0, spine, pageH).fill(PB_SPEC.surface).restore();

    // 앞표지: 우·상·하 bleed, 좌(책등측)는 hard.
    await drawFrontCoverInto(doc, frozen.coverPage, originals, g, frontTrimX, { left: false, right: true }, titleFont);

    doc.end();
    return done;
}

/** 🔴 IQLab 인쇄용: 속지 한 페이지 = PDF 1개(export in single page). */
export async function renderInteriorPagePdf(frozen: FrozenLayout, pg: FPage, originals: Map<number, Buffer>): Promise<Buffer> {
    const g = geomFor(frozen);
    const pageW = g.trimW + 2 * g.bleed, pageH = g.trimH + 2 * g.bleed;
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    registerTitleFont(doc);
    doc.addPage({ size: [pageW, pageH], margin: 0 });
    doc.save().rect(0, 0, pageW, pageH).fill(PB_SPEC.pageBg).restore();
    await drawInteriorPageInto(doc, pg, originals, g, frozen.topBand);
    doc.end();
    return done;
}

/** 주문 doc → 원본 다운로드 → PDF 생성 → Storage 저장. 반환: pdfPath + previewBasePath(고객 뷰어용 미드해상도) */
export async function generateAndStorePhotobookPdf(orderData: any): Promise<{ pdfPath: string; coverPdfPath: string; pagesBasePath: string; pageCount: number; previewBasePath: string; coverRenderPath: string | null }> {
    const pb = orderData?.photobook;
    const frozen: FrozenLayout | undefined = pb?.frozen;
    const originalsBasePath: string | undefined = pb?.originalsBasePath;
    if (!frozen || !originalsBasePath) throw new Error("missing frozen layout or originalsBasePath");

    const bucket = getStorage().bucket();

    // 필요한 원본 인덱스 수집(내지 + 표지) → 중복 제거 후 병렬 다운로드
    const needIdx = new Set<number>();
    for (const p of frozen.pages) for (const c of p.cells) if (c.idx >= 0) needIdx.add(c.idx);
    if (frozen.coverPage?.idx != null && frozen.coverPage.idx >= 0) needIdx.add(frozen.coverPage.idx);

    const originals = new Map<number, Buffer>();
    await Promise.all([...needIdx].map(async (idx) => {
        const f = bucket.file(`${originalsBasePath}/${idx}.jpg`);
        const [exists] = await f.exists();
        if (!exists) { console.warn(`[photobookPdf] original missing: ${idx}.jpg`); return; }
        const [buf] = await f.download();
        originals.set(idx, buf);
    }));

    const base = originalsBasePath.replace(/\/originals$/, "");

    // 1) 통합 프리뷰 PDF(어드민 iframe·고객 확인용). 인쇄 산출물은 아래 cover.pdf + pages.
    const pdfBuf = await renderPhotobookPdfBuffer(frozen, originals);
    const pdfPath = `${base}/photobook.pdf`;
    await bucket.file(pdfPath).save(pdfBuf, { contentType: "application/pdf", resumable: false });

    // 2) 🔴 IQLab 인쇄용 표지 PDF(앞+책등+뒤 한 장)
    const coverBuf = await renderCoverPdf(frozen, originals);
    const coverPdfPath = `${base}/cover.pdf`;
    await bucket.file(coverPdfPath).save(coverBuf, { contentType: "application/pdf", resumable: false });

    // 3) 🔴 IQLab 인쇄용 속지 페이지별 PDF (page_01.pdf ...)
    const pagesBasePath = `${base}/pages`;
    let pageCount = 0;
    for (const pg of frozen.pages) {
        pageCount++;
        const buf = await renderInteriorPagePdf(frozen, pg, originals);
        const name = `page_${String(pageCount).padStart(2, "0")}.pdf`;
        await bucket.file(`${pagesBasePath}/${name}`).save(buf, { contentType: "application/pdf", resumable: false });
    }

    // 4) 고객 앱 뷰어용 미드해상도 프리뷰(빠른 로딩). 원본=인쇄용, preview=화면용(≤1200px, q68).
    const previewBasePath = `${base}/preview`;
    await Promise.all([...originals.entries()].map(async ([idx, buf]) => {
        try {
            const small = await sharp(buf, { failOn: "none" }).rotate()
                .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
                .jpeg({ quality: 68 }).toBuffer();
            await bucket.file(`${previewBasePath}/${idx}.jpg`).save(small, {
                contentType: "image/jpeg", resumable: false, metadata: { cacheControl: "public,max-age=31536000" },
            });
        } catch (e) { console.warn("[photobookPdf] preview gen failed", idx, e); }
    }));

    // 5) 어드민용 크롭된 표지 썸네일(가로) — 실제 crop 반영(CSS로는 재현 불가).
    let coverRenderPath: string | null = null;
    const cIdxR = frozen.coverPage?.idx;
    const cBufR = cIdxR != null && cIdxR >= 0 ? originals.get(cIdxR) : undefined;
    if (cBufR) {
        try {
            // 작게(장변 600px) — 어드민·마이오더에서 즉시 로딩. 크롭은 정확히 반영.
            const tw = 600, th = Math.max(1, Math.round(600 / (frozen.ratio || 27.9 / 21.5)));
            const jpg = await renderCellJpeg(cBufR, frozen.coverPage.crop, tw, th);
            coverRenderPath = `${base}/cover_render.jpg`;
            await bucket.file(coverRenderPath).save(jpg, {
                contentType: "image/jpeg", resumable: false, metadata: { cacheControl: "public,max-age=31536000" },
            });
        } catch (e) { console.warn("[photobookPdf] cover render failed", e); }
    }

    return { pdfPath, coverPdfPath, pagesBasePath, pageCount, previewBasePath, coverRenderPath };
}
