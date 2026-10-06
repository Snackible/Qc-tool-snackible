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

/**
 * Turns an uploaded label (image or PDF) into JPEGs small enough to send to the server: a request body
 * over ~4.5 MB is rejected by Vercel, and print-ready label PDFs are often tens of MB.
 */
export async function fileToJpegs(file: File, maxTotalBytes = 3_900_000): Promise<Blob[]> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  let render: (side: number) => Promise<HTMLCanvasElement[]>;
  let cleanup = async () => {};

  if (isPdf) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const doc = await task.promise;
    cleanup = async () => {
      await task.destroy();
    };
    render = async (side) => {
      const canvases: HTMLCanvasElement[] = [];
      for (let p = 1; p <= Math.min(doc.numPages, MAX_PDF_PAGES); p++) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: side / Math.max(base.width, base.height) });
        const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        canvases.push(canvas);
      }
      return canvases;
    };
  } else {
    const bitmap = await createImageBitmap(file);
    cleanup = async () => bitmap.close();
    render = async (side) => {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const { canvas, ctx } = whiteCanvas(bitmap.width * scale, bitmap.height * scale);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return [canvas];
    };
  }

  try {
    let blobs: Blob[] = [];
    for (const { side, quality } of ATTEMPTS) {
      const canvases = await render(side);
      blobs = await Promise.all(canvases.map((c) => canvasToJpeg(c, quality)));
      if (blobs.reduce((n, b) => n + b.size, 0) <= maxTotalBytes) return blobs;
    }
    throw new Error("The label is too large to send even after shrinking it. Upload a smaller export.");
  } finally {
    await cleanup();
  }
}
