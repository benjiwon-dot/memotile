// functions/src/photobookJpg.ts
//
// 인쇄용 JPG 산출물: 기존 인쇄용 PDF(cover.pdf + pages/page_NN.pdf)를 300dpi JPG로 래스터.
// PDF가 진실의 원천 → 레이아웃·폰트·크롭이 PDF와 100% 동일(별도 재구현 없음 = 프리뷰 불일치 리스크 0).
// JPG를 원하는 프린팅 업체용. 기존 PDF 경로는 무변경(추가 산출물).
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { pdfToPng } from "pdf-to-png-converter";

const JPG_DPI = 300;
const VIEWPORT_SCALE = JPG_DPI / 72; // PDF pt(72/inch) → 300dpi

export interface OrderJpgFile {
    name: string; // cover.jpg / page_01.jpg ...
    path: string; // Storage 경로
}

/** PDF 버퍼(1~N페이지) → 300dpi JPG 버퍼 배열 */
async function pdfToJpgs(pdfBuf: Buffer): Promise<Buffer[]> {
    const pages = await pdfToPng(pdfBuf, { viewportScale: VIEWPORT_SCALE });
    const out: Buffer[] = [];
    for (const p of pages) {
        out.push(await sharp(p.content).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer());
    }
    return out;
}

/**
 * 주문의 인쇄용 JPG 세트 보장(lazy): {base}/jpg/cover.jpg + page_NN.jpg.
 * 이미 만들어져 있으면 재사용(재래스터 안 함). PDF 미생성 주문이면 에러.
 */
export async function ensureOrderJpgs(orderData: any): Promise<OrderJpgFile[]> {
    const pb = orderData?.photobook;
    const originalsBasePath: string | undefined = pb?.originalsBasePath;
    if (!originalsBasePath) throw new Error("not a photobook order (no originalsBasePath)");
    const base = originalsBasePath.replace(/\/originals$/, "");
    const bucket = getStorage().bucket();
    const jpgBase = `${base}/jpg`;

    // 이미 생성됐으면 재사용 (cover.jpg 존재 = 세트 완성 마커; 아래에서 cover를 마지막에 저장)
    const coverJpg = bucket.file(`${jpgBase}/cover.jpg`);
    const [coverExists] = await coverJpg.exists();
    if (coverExists) {
        const [files] = await bucket.getFiles({ prefix: `${jpgBase}/` });
        return files
            .map((f) => ({ name: f.name.slice(jpgBase.length + 1), path: f.name }))
            .filter((f) => f.name.endsWith(".jpg"))
            .sort((a, b) => (a.name === "cover.jpg" ? -1 : b.name === "cover.jpg" ? 1 : a.name.localeCompare(b.name)));
    }

    const saveJpg = async (name: string, buf: Buffer) => {
        await bucket.file(`${jpgBase}/${name}`).save(buf, {
            contentType: "image/jpeg", resumable: false,
            metadata: { cacheControl: "public,max-age=31536000" },
        });
    };

    const out: OrderJpgFile[] = [];

    // 1) 내지: pages/page_NN.pdf → page_NN.jpg (페이지 순서 = 파일명 순서)
    const [pageFiles] = await bucket.getFiles({ prefix: `${base}/pages/` });
    const pagePdfs = pageFiles.filter((f) => f.name.endsWith(".pdf")).sort((a, b) => a.name.localeCompare(b.name));
    if (pagePdfs.length === 0) throw new Error("no page PDFs — PDF 생성이 먼저 필요");
    for (const f of pagePdfs) {
        const [buf] = await f.download();
        const jpgs = await pdfToJpgs(buf); // 페이지별 PDF = 1페이지
        const name = f.name.split("/").pop()!.replace(/\.pdf$/, ".jpg");
        await saveJpg(name, jpgs[0]);
        out.push({ name, path: `${jpgBase}/${name}` });
    }

    // 2) 표지(랩어라운드 뒤+책등+앞 한 장) — 마지막에 저장(완성 마커 역할)
    const coverPdf = bucket.file(`${base}/cover.pdf`);
    const [cExists] = await coverPdf.exists();
    if (cExists) {
        const [cBuf] = await coverPdf.download();
        const cJpgs = await pdfToJpgs(cBuf);
        await saveJpg("cover.jpg", cJpgs[0]);
        out.unshift({ name: "cover.jpg", path: `${jpgBase}/cover.jpg` });
    }

    return out;
}
