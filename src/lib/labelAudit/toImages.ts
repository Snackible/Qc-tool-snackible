import { loadPdfjs } from "./extract";

const MAX_PDF_PAGES = 3;
const ATTEMPTS: { side: number; quality: number }[] = [
  { side: 2000, quality: 0.85 },
  { side: 1600, quality: 0.8 },
  { side: 1280, quality: 0.75 },
  { side: 1024, quality: 0.7 },
];

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/jpeg", quality);
  });
}

function whiteCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Bounding box of everything that is not near-white (a pack mock-up on a white page leaves the label a small part of the image). */
function contentBox(bitmap: ImageBitmap): { x: number; y: number; w: number; h: number } {
  const k = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const { canvas, ctx } = whiteCanvas(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const cols = new Uint32Array(w);
  const rows = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 215) {
        cols[x]++;
        rows[y]++;
      }
    }
  }
  // ignore stray specks: a column/row needs a few dark pixels to count as content
  const first = (a: Uint32Array, min: number) => a.findIndex((n) => n >= min);
  const last = (a: Uint32Array, min: number) => {
    for (let i = a.length - 1; i >= 0; i--) if (a[i] >= min) return i;
    return -1;
  };
  const x0 = first(cols, 3);
  const x1 = last(cols, 3);
  const y0 = first(rows, 3);
  const y1 = last(rows, 3);
  if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  const pad = 6;
  const bx = Math.max(0, x0 - pad) / k;
  const by = Math.max(0, y0 - pad) / k;
  const bw = Math.min(w, x1 + pad + 1) / k - bx;
  const bh = Math.min(h, y1 + pad + 1) / k - by;
  return { x: bx, y: by, w: Math.min(bitmap.width - bx, bw), h: Math.min(bitmap.height - by, bh) };
}

export type PageRenderer = {
  /** Renders each page (or the image) with its longest side at `side` px. Images are only enlarged when `upscale` is set. */
  render: (side: number, opts?: { upscale?: boolean; crop?: boolean }) => Promise<HTMLCanvasElement[]>;
  close: () => Promise<void>;
};

/** Opens an image or PDF so its pages can be drawn to canvases at any size. */
export async function openRenderer(file: File, maxPages = MAX_PDF_PAGES): Promise<PageRenderer> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (isPdf) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const doc = await task.promise;
    return {
      render: async (side) => {
        const canvases: HTMLCanvasElement[] = [];
        for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
          const page = await doc.getPage(p);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: side / Math.max(base.width, base.height) });
          const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          canvases.push(canvas);
        }
        return canvases;
      },
      close: async () => {
        await task.destroy();
      },
    };
  }

  const bitmap = await createImageBitmap(file);
  return {
    render: async (side, opts) => {
      const box = opts?.crop ? contentBox(bitmap) : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
      const fit = side / Math.max(box.w, box.h);
      const scale = opts?.upscale ? fit : Math.min(1, fit);
      const { canvas, ctx } = whiteCanvas(box.w * scale, box.h * scale);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
      return [canvas];
    },
    close: async () => bitmap.close(),
  };
}

/**
 * Turns an uploaded label (image or PDF) into JPEGs small enough to send to the server: a request body
 * over ~4.5 MB is rejected by Vercel, and print-ready label PDFs are often tens of MB.
 */
export async function fileToJpegs(file: File, maxTotalBytes = 3_900_000): Promise<Blob[]> {
  const renderer = await openRenderer(file);
  try {
    for (const { side, quality } of ATTEMPTS) {
      const canvases = await renderer.render(side);
      const blobs = await Promise.all(canvases.map((c) => canvasToJpeg(c, quality)));
      if (blobs.reduce((n, b) => n + b.size, 0) <= maxTotalBytes) return blobs;
    }
    throw new Error("The label is too large to send even after shrinking it. Upload a smaller export.");
  } finally {
    await renderer.close();
  }
}
