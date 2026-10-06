/**
 * OCR for labels that have no text layer (photos, screenshots, PDFs with outlined text), using Tesseract in the
 * browser: free, no key. Word boxes are converted into the same positioned text items the rules engine reads from
 * a PDF, so every SOP check works on OCR text too (with lower confidence in the result).
 */
import type { ExtractedLabel, LabelItem } from "./types";

type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

export type OcrProgress = { stage: "loading" | "reading"; pct: number };

const MIN_WORD_CONFIDENCE = 40;
const GOOD_ENOUGH_SCORE = 150;
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
  ctx.putImageData(img, 0, 0);
  return canvas;
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

export async function ocrCanvases(canvases: HTMLCanvasElement[], onProgress?: (p: OcrProgress) => void): Promise<ExtractedLabel> {
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
      let result = await run(false);
      // light text on a dark or coloured panel often reads badly the normal way round: try inverted and keep the better read
      if (score(result.words) < GOOD_ENOUGH_SCORE) {
        const inverted = await run(true);
        if (score(inverted.words) > score(result.words)) result = inverted;
      }
      items.push(...wordsToItems(result.words, result.height, page + 1));
    }
    return { items, pageCount: canvases.length, charCount: items.reduce((n, i) => n + i.s.length, 0), source: "ocr" };
  } finally {
    await worker.terminate();
  }
}
