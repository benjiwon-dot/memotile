import { FILTERS } from "../components/editor/filters";

/**
 * Applies a filter to a canvas context
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} filterName
 */
export function applyFilterToContext(ctx, filterName) {
    const filterDef = FILTERS.find((f) => f.name === filterName);
    ctx.filter = filterDef?.style?.filter || "none";
}

/**
 * Clamp helper
 */
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

/**
 * Generates a cropped image (preview + print)
 * IMPORTANT:
 * - Must match Editor CropFrame math exactly.
 * - Crop UI:
 *   - preview area = 400x400 (PREVIEW_SIZE)
 *   - crop window  = 300x300 (CROP_SIZE)
 *   - baseScale is "cover" relative to PREVIEW_SIZE (NOT 300)
 *   - crop.x / crop.y are px offsets in the rendered (preview) space
 */
export async function generateCrops(imageSrc, crop, filterName) {
    const CROP_SIZE = 300;       // crop window size
    const PREVIEW_SIZE = 400;    // previewWrap size in UI (400x400)
    const PREVIEW_OUT = 900;     // preview export
    const PRINT_OUT = 3200;      // print export (>=3000)

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";

        img.onload = () => {
            const imgW = img.naturalWidth;
            const imgH = img.naturalHeight;

            const x = crop?.x || 0;
            const y = crop?.y || 0;
            const zoom = crop?.scale || 1;

            // ✅ MUST match UI: cover scale based on PREVIEW_SIZE (400)
            const baseScale = Math.max(PREVIEW_SIZE / imgW, PREVIEW_SIZE / imgH);

            // rendered pixels -> source pixels conversion factor
            const denom = baseScale * zoom;

            // ✅ Source rect calculation (center origin, matches your transform)
            // UI view: image centered, then translate(x,y), scale(zoom)
            // Crop frame is centered at (0,0) in that rendered coordinate system.
            // Convert crop window corners from rendered space to source space.
            const srcLeft = imgW / 2 + (-CROP_SIZE / 2 - x) / denom;
            const srcTop = imgH / 2 + (-CROP_SIZE / 2 - y) / denom;
            const srcSize = CROP_SIZE / denom; // square

            // ✅ HARD CLAMP to avoid out-of-bounds (this is what removes white borders)
            const sSize = clamp(srcSize, 1, Math.min(imgW, imgH));
            const sx = clamp(srcLeft, 0, imgW - sSize);
            const sy = clamp(srcTop, 0, imgH - sSize);

            const createOutput = (outPx, quality) => {
                const canvas = document.createElement("canvas");
                canvas.width = outPx;
                canvas.height = outPx;

                const ctx = canvas.getContext("2d", { alpha: false });
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";

                // ✅ Apply filter (from FILTERS)
                applyFilterToContext(ctx, filterName);

                // ✅ Draw EXACTLY to fill the output square (no padding/contain)
                ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, outPx, outPx);

                // reset filter
                ctx.filter = "none";

                return canvas.toDataURL("image/jpeg", quality);
            };

            resolve({
                preview: createOutput(PREVIEW_OUT, 0.9),
                print: createOutput(PRINT_OUT, 0.95), // ✅ >= 3000px
                meta: { sx, sy, sw: sSize, sh: sSize, baseScale, denom },
            });
        };

        img.onerror = reject;
        img.src = imageSrc;
    });
}
