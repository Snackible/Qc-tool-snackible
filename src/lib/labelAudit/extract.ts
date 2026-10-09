import { ExtractedLabel, LabelItem } from "./types";

type RawTextItem = { str?: unknown; transform?: number[]; width?: number; height?: number };

/** Converts pdf.js text-content items to positioned items. Shared by the browser and the node test harness. */
export function itemsFromTextContent(rawItems: unknown[], page: number): LabelItem[] {
  const out: LabelItem[] = [];
  for (const raw of rawItems as RawTextItem[]) {
    if (typeof raw.str !== "string" || !raw.str.trim() || !raw.transform) continue;
    const [a, b, , d, e, f] = raw.transform;
    out.push({
      s: raw.str,
      x: e,
      y: f,
      w: raw.width ?? 0,
      h: raw.height || Math.abs(d) || 0,
      page,
      rotated: Math.abs(b) > 0.25 * (Math.abs(a) + Math.abs(b)),
    });
  }
  return out;
}

export function summarize(items: LabelItem[], pageCount: number): ExtractedLabel {
  return { items, pageCount, charCount: items.reduce((n, i) => n + i.s.trim().length, 0), source: "pdf" };
}

/**
 * Combines several labels (e.g. the front and back of a pack, uploaded separately) into one. Pages are renumbered so
 * each file's rows and columns stay separate from the others' — the rules engine groups both by page — while a
 * phrase search (product name, a USP claim) still looks across every file, since it reads all pages' text together.
 */
export function mergeLabels(labels: ExtractedLabel[]): ExtractedLabel {
  const items: LabelItem[] = [];
  let pageOffset = 0;
  for (const label of labels) {
    for (const it of label.items) items.push({ ...it, page: it.page + pageOffset });
    pageOffset += label.pageCount;
  }
  return {
    items,
    pageCount: pageOffset,
    charCount: labels.reduce((n, l) => n + l.charCount, 0),
    source: labels.some((l) => l.source === "ocr") ? "ocr" : "pdf",
  };
}

export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
}

const MAX_PAGES = 6;

export async function extractPdfText(file: File): Promise<ExtractedLabel> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const items: LabelItem[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      items.push(...itemsFromTextContent(content.items, p));
    }
    return summarize(items, doc.numPages);
  } finally {
    await task.destroy();
  }
}
