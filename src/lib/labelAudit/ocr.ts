/**
 * OCR for labels that have no text layer (photos, screenshots, PDFs with outlined text), using Tesseract in the
 * browser: free, no key. Word boxes are converted into the same positioned text items the rules engine reads from
 * a PDF, so every SOP check works on OCR text too (with lower confidence in the result).
 */
import { paddleWords } from "./paddleOcr";
import type { ExtractedLabel, LabelItem } from "./types";

type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

export type OcrProgress = { stage: "loading" | "reading"; pct: number };

const MIN_WORD_CONFIDENCE = 40;
const MERGE_MIN_CONFIDENCE = 70;
// the rules engine's spacing thresholds assume roughly 7pt text (PDF units), so OCR pixels are scaled to match
const TARGET_TEXT_HEIGHT = 7;

/** Greyscale, stretch contrast, and optionally invert (light text on a dark or coloured background). */
function prepare(source: HTMLCanvasElement, invert: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = g;
    hist[g]++;
  }
  const total = canvas.width * canvas.height;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  while (lo < 255 && acc + hist[lo] < total * 0.02) acc += hist[lo++];
  acc = 0;
  while (hi > 0 && acc + hist[hi] < total * 0.02) acc += hist[hi--];
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let g = ((d[i] - lo) * 255) / range;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
    d[i + 3] = 255;
  }
  removeRules(d, canvas.width, canvas.height);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Table borders and barcode bars confuse Tesseract's layout analysis (a bordered table can come back nearly empty), so long thin dark runs are painted out. */
function removeRules(d: Uint8ClampedArray, w: number, h: number) {
  const thickness = (isInk: (p: number) => boolean, W: number, H: number, x: number, y: number, horizontal: boolean) => {
    let n = 1;
    for (let i = 1; i <= 40; i++) {
      const [px, py] = horizontal ? [x + i, y] : [x, y + i];
      if (px >= W || py >= H || !isInk(py * W + px)) break;
      n++;
    }
    for (let i = 1; i <= 40; i++) {
      const [px, py] = horizontal ? [x - i, y] : [x, y - i];
      if (px < 0 || py < 0 || !isInk(py * W + px)) break;
      n++;
    }
    return n;
  };
  const minRun = Math.round(Math.max(w, h) * 0.025); // longer than any letter stroke
  const kill = new Uint8Array(w * h);
  const maxThick = Math.max(4, Math.round(Math.max(w, h) * 0.004)); // rules are thin; a filled panel or a bold headline is not
  const ink = (p: number) => d[p * 4] < 128;
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!ink(y * w + x)) { x++; continue; }
      let e = x;
      while (e < w && ink(y * w + e)) e++;
      if (e - x >= minRun && thickness(ink, w, h, (x + e) >> 1, y, false) <= maxThick) for (let q = x; q < e; q++) kill[y * w + q] = 1;
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!ink(y * w + x)) { y++; continue; }
      let e = y;
      while (e < h && ink(e * w + x)) e++;
      if (e - y >= minRun && thickness(ink, w, h, x, (y + e) >> 1, true) <= maxThick) for (let q = y; q < e; q++) kill[q * w + x] = 1;
      y = e;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      // the line's anti-aliased edge pixels go too
      const hit = kill[p] || (x > 0 && kill[p - 1]) || (x < w - 1 && kill[p + 1]) || (y > 0 && kill[p - w]) || (y < h - 1 && kill[p + w]);
      if (hit && d[p * 4] < 200) d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255;
    }
  }
}

/** Adds the secondary read's confident words wherever the primary read found nothing. */
function mergeWords(primary: OcrWord[], secondary: OcrWord[]): OcrWord[] {
  const overlaps = (a: OcrWord["bbox"], b: OcrWord["bbox"]) => {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return w > 0 && h > 0 && (w * h) / ((a.x1 - a.x0) * (a.y1 - a.y0)) > 0.2;
  };
  const extra = secondary.filter((w) => w.confidence >= MERGE_MIN_CONFIDENCE && /[A-Za-z0-9]/.test(w.text) && !primary.some((p) => overlaps(w.bbox, p.bbox)));
  return [...primary, ...extra];
}

const score = (words: OcrWord[]) => words.reduce((n, w) => n + (w.confidence >= 60 ? w.text.length : 0), 0);

export function wordsToItems(words: OcrWord[], canvasHeight: number, page: number): LabelItem[] {
  const kept = words.filter((w) => w.confidence >= MIN_WORD_CONFIDENCE && /[A-Za-z0-9]/.test(w.text));
  if (kept.length === 0) return [];
  const heights = kept.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  const k = TARGET_TEXT_HEIGHT / median;
  return kept.map((w) => ({
    s: w.text.trim(),
    x: w.bbox.x0 * k,
    // PDF y grows upward and rows are matched on y, so flip it; the box centre is steadier than the bottom edge (descenders)
    y: (canvasHeight - (w.bbox.y0 + w.bbox.y1) / 2) * k,
    w: (w.bbox.x1 - w.bbox.x0) * k,
    h: (w.bbox.y1 - w.bbox.y0) * k,
    page,
    rotated: false,
  }));
}

/**
 * Reads the canvases with PaddleOCR (much better on photos, and about ten times faster); if its models or runtime can't
 * be loaded (offline, blocked CDN) it falls back to Tesseract.
 */
export async function ocrCanvases(canvases: HTMLCanvasElement[], onProgress?: (p: OcrProgress) => void): Promise<ExtractedLabel> {
  try {
    const items: LabelItem[] = [];
    let photoTextPx: number | undefined;
    for (let page = 0; page < canvases.length; page++) {
      const words = await paddleWords(canvases[page], (p) => onProgress?.({ stage: p.stage, pct: ((page + p.pct / 100) / canvases.length) * 100 }));
      items.push(...wordsToItems(words, canvases[page].height, page + 1));
      const scale = Number(canvases[page].dataset.scale);
      if (scale > 0 && words.length >= 10) {
        const hs = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
        const px = hs[Math.floor(hs.length / 2)] / scale;
        photoTextPx = photoTextPx === undefined ? px : Math.min(photoTextPx, px);
      }
    }
    return { items, pageCount: canvases.length, charCount: items.reduce((n, i) => n + i.s.length, 0), source: "ocr", photoTextPx };
  } catch {
    return tesseractCanvases(canvases, onProgress);
  }
}

async function tesseractCanvases(canvases: HTMLCanvasElement[], onProgress?: (p: OcrProgress) => void): Promise<ExtractedLabel> {
  const { createWorker } = await import("tesseract.js");
  let page = 0;
  let best = 0;
  const report = (stage: OcrProgress["stage"], pct: number) => {
    best = Math.max(best, pct);
    onProgress?.({ stage, pct: best });
  };

  const worker = await createWorker("eng", 1, {
    logger: (m) => {
      if (/recogni/i.test(m.status)) report("reading", ((page + m.progress) / canvases.length) * 100);
      else report("loading", m.progress * 100);
    },
  });
  try {
    // sparse mode: labels are tables and separate text blocks, not running prose
    await worker.setParameters({ tessedit_pageseg_mode: "11" as never, preserve_interword_spaces: "1" });

    const items: LabelItem[] = [];
    for (page = 0; page < canvases.length; page++) {
      const run = async (invert: boolean) => {
        const prepared = prepare(canvases[page], invert);
        const { data } = await worker.recognize(prepared, {}, { blocks: true });
        const words: OcrWord[] = [];
        for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push(w);
        return { words, height: prepared.height };
      };
      // a label mixes dark-on-light and light-on-dark panels, and each reads well only the right way round: read both ways,
      // keep the better read, and fill its gaps with confident words from the other
      const normal = await run(false);
      const inverted = await run(true);
      const [best, other] = score(inverted.words) > score(normal.words) ? [inverted, normal] : [normal, inverted];
      // a much weaker other read is mostly noise (the wrong polarity), so it is only merged when it found a fair amount of real text too
      const useOther = score(other.words) >= score(best.words) * 0.4;
      const result = { words: useOther ? mergeWords(best.words, other.words) : best.words, height: best.height };
      items.push(...wordsToItems(result.words, result.height, page + 1));
    }
    return { items, pageCount: canvases.length, charCount: items.reduce((n, i) => n + i.s.length, 0), source: "ocr" };
  } finally {
    await worker.terminate();
  }
}
