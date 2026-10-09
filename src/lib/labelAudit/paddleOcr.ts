/**
 * Browser OCR with PaddleOCR's PP-OCR models (text detection + English recognition) run through ONNX Runtime Web: free, no
 * key, and far better than Tesseract on photos (curved or tilted packs, glare, light text on colour). The detector finds
 * text boxes (rotated rectangles, so sloping lines are fine), the recognizer reads each box, and every word keeps its own
 * position, so the rules engine can match a nutrient's name to its value even when the rows slope.
 *
 * Models are served from /ocr (Apache-2.0 PP-OCR models, converted to ONNX); the ONNX Runtime script and wasm come from a CDN.
 */

export type PaddleWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type PaddleProgress = { stage: "loading" | "reading"; pct: number };

const ORT_VERSION = "1.22.0";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_BASE = "/ocr/";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ort = any;
type Models = { ort: Ort; det: Ort; rec: Ort; dict: string[] };

let modelsPromise: Promise<Models> | null = null;

function loadOrtScript(): Promise<Ort> {
  const w = window as unknown as { ort?: Ort };
  if (w.ort) return Promise.resolve(w.ort);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${ORT_BASE}ort.min.js`;
    s.onload = () => (w.ort ? resolve(w.ort) : reject(new Error("ONNX Runtime did not load")));
    s.onerror = () => reject(new Error("Could not load ONNX Runtime"));
    document.head.appendChild(s);
  });
}

async function fetchBytes(url: string, onProgress?: (frac: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function loadModels(onProgress?: (p: PaddleProgress) => void): Promise<Models> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const ort = await loadOrtScript();
      ort.env.wasm.wasmPaths = ORT_BASE;
      ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which the site does not set
      let det = 0;
      let rec = 0;
      const report = () => onProgress?.({ stage: "loading", pct: ((det + rec) / 2) * 100 });
      const [detBytes, recBytes, dictText] = await Promise.all([
        fetchBytes(`${MODEL_BASE}det.onnx`, (f) => ((det = f), report())),
        fetchBytes(`${MODEL_BASE}rec.onnx`, (f) => ((rec = f), report())),
        fetch(`${MODEL_BASE}dict.txt`).then((r) => r.text()),
      ]);
      const [detSession, recSession] = await Promise.all([
        ort.InferenceSession.create(detBytes, { executionProviders: ["wasm"] }),
        ort.InferenceSession.create(recBytes, { executionProviders: ["wasm"] }),
      ]);
      const dict = dictText.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
      dict.push(" ");
      return { ort, det: detSession, rec: recSession, dict };
    })().catch((e) => {
      modelsPromise = null; // allow a retry
      throw e;
    });
  }
  return modelsPromise;
}

type Box = { tl: [number, number]; tr: [number, number]; bl: [number, number] };

function findComponents(mask: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h);
  const comps: number[][] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const pts: number[] = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      pts.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    comps.push(pts);
  }
  return comps;
}

const DET_MAX_SIDE = 1600;
const DET_THRESH = 0.3;
const BOX_THRESH = 0.5;
const UNCLIP = 1.5;

async function detectBoxes(m: Models, canvas: HTMLCanvasElement): Promise<Box[]> {
  const W = canvas.width;
  const H = canvas.height;
  const s = Math.min(1, DET_MAX_SIDE / Math.max(W, H));
  const dw = Math.max(32, Math.ceil((W * s) / 32) * 32);
  const dh = Math.max(32, Math.ceil((H * s) / 32) * 32);
  const small = document.createElement("canvas");
  small.width = dw;
  small.height = dh;
  const sctx = small.getContext("2d")!;
  sctx.drawImage(canvas, 0, 0, dw, dh);
  const d = sctx.getImageData(0, 0, dw, dh).data;

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const plane = dw * dh;
  const input = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    for (let ch = 0; ch < 3; ch++) input[(2 - ch) * plane + p] = (d[p * 4 + ch] / 255 - mean[ch]) / std[ch]; // BGR order
  }
  const out = await m.det.run({ [m.det.inputNames[0]]: new m.ort.Tensor("float32", input, [1, 3, dh, dw]) });
  const prob = out[m.det.outputNames[0]].data as Float32Array;
  const mask = new Uint8Array(plane);
  for (let p = 0; p < plane; p++) mask[p] = prob[p] > DET_THRESH ? 1 : 0;

  const fx = W / dw;
  const fy = H / dh;
  const boxes: Box[] = [];
  for (const pts of findComponents(mask, dw, dh)) {
    if (pts.length < 12) continue;
    let sx = 0;
    let sy = 0;
    let sp = 0;
    for (const p of pts) {
      sx += p % dw;
      sy += Math.floor(p / dw);
      sp += prob[p];
    }
    const n = pts.length;
    if (sp / n < BOX_THRESH) continue;
    const mx = sx / n;
    const my = sy / n;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of pts) {
      const x = (p % dw) - mx;
      const y = Math.floor(p / dw) - my;
      sxx += x * x;
      sxy += x * y;
      syy += y * y;
    }
    let ux = Math.cos(0.5 * Math.atan2(2 * sxy, sxx - syy));
    let uy = Math.sin(0.5 * Math.atan2(2 * sxy, sxx - syy));
    let umin = 0;
    let umax = 0;
    let vmin = 0;
    let vmax = 0;
    const project = () => {
      umin = vmin = Infinity;
      umax = vmax = -Infinity;
      for (const p of pts) {
        const x = (p % dw) - mx;
        const y = Math.floor(p / dw) - my;
        const u = x * ux + y * uy;
        const v = -x * uy + y * ux;
        if (u < umin) umin = u;
        if (u > umax) umax = u;
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    };
    project();
    if (umax - umin < 1.5 * (vmax - vmin)) {
      ux = 1; // a roundish blob (a short word): assume it is horizontal
      uy = 0;
      project();
    }
    const L = umax - umin + 1;
    const Hh = vmax - vmin + 1;
    if (Math.min(L, Hh) < 3) continue;
    const dd = (L * Hh * UNCLIP) / (2 * (L + Hh));
    const Lx = L + 2 * dd;
    const Hx = Hh + 2 * dd;
    const vx = -uy;
    const vy = ux;
    const cu = (umin + umax) / 2;
    const cv = (vmin + vmax) / 2;
    const cx = mx + cu * ux + cv * vx;
    const cy = my + cu * uy + cv * vy;
    const corner = (su: number, sv: number): [number, number] => [
      (cx + su * (Lx / 2) * ux + sv * (Hx / 2) * vx) * fx,
      (cy + su * (Lx / 2) * uy + sv * (Hx / 2) * vy) * fy,
    ];
    boxes.push({ tl: corner(-1, -1), tr: corner(1, -1), bl: corner(-1, 1) });
  }
  return boxes;
}

const REC_HEIGHT = 48;

function cropStrip(img: Uint8ClampedArray, W: number, H: number, box: Box) {
  const ux = box.tr[0] - box.tl[0];
  const uy = box.tr[1] - box.tl[1];
  const vx = box.bl[0] - box.tl[0];
  const vy = box.bl[1] - box.tl[1];
  const L = Math.hypot(ux, uy);
  const Hh = Math.hypot(vx, vy);
  const cw = Math.max(16, Math.min(3200, Math.round((L * REC_HEIGHT) / Hh)));
  const out = new Float32Array(3 * REC_HEIGHT * cw);
  const plane = REC_HEIGHT * cw;
  const px = (x: number, y: number, ch: number) => img[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + ch];
  for (let j = 0; j < REC_HEIGHT; j++) {
    for (let i = 0; i < cw; i++) {
      const a = (i + 0.5) / cw;
      const b = (j + 0.5) / REC_HEIGHT;
      const x = box.tl[0] + ux * a + vx * b;
      const y = box.tl[1] + uy * a + vy * b;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fxr = x - x0;
      const fyr = y - y0;
      for (let ch = 0; ch < 3; ch++) {
        const v = px(x0, y0, ch) * (1 - fxr) * (1 - fyr) + px(x0 + 1, y0, ch) * fxr * (1 - fyr) + px(x0, y0 + 1, ch) * (1 - fxr) * fyr + px(x0 + 1, y0 + 1, ch) * fxr * fyr;
        out[(2 - ch) * plane + j * cw + i] = (v / 255 - 0.5) / 0.5; // BGR order
      }
    }
  }
  return { data: out, w: cw };
}

async function recognizeBoxes(m: Models, canvas: HTMLCanvasElement, boxes: Box[], onProgress?: (p: PaddleProgress) => void): Promise<PaddleWord[]> {
  const W = canvas.width;
  const H = canvas.height;
  const img = canvas.getContext("2d")!.getImageData(0, 0, W, H).data;
  const words: PaddleWord[] = [];
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b];
    const strip = cropStrip(img, W, H, box);
    const out = await m.rec.run({ [m.rec.inputNames[0]]: new m.ort.Tensor("float32", strip.data, [1, 3, REC_HEIGHT, strip.w]) });
    const o = out[m.rec.outputNames[0]];
    const T = o.dims[1] as number;
    const C = o.dims[2] as number;
    const data = o.data as Float32Array;

    type Ch = { ch: string; t0: number; t1: number; p: number };
    const chars: Ch[] = [];
    let prev = -1;
    for (let t = 0; t < T; t++) {
      let best = 0;
      let bp = -Infinity;
      for (let c = 0; c < C; c++) {
        const v = data[t * C + c];
        if (v > bp) {
          bp = v;
          best = c;
        }
      }
      if (best !== 0 && best !== prev) chars.push({ ch: m.dict[best - 1] ?? "", t0: t, t1: t, p: bp });
      else if (best !== 0 && best === prev && chars.length) chars[chars.length - 1].t1 = t;
      prev = best;
    }

    const ux = box.tr[0] - box.tl[0];
    const uy = box.tr[1] - box.tl[1];
    const vx = box.bl[0] - box.tl[0];
    const vy = box.bl[1] - box.tl[1];
    const lineW = Math.hypot(ux, uy);
    // the box is padded by the detector's unclip, so use a fraction of its height as the text height
    const wordH = Math.hypot(vx, vy) * 0.7;
    let cur: Ch[] = [];
    const flush = () => {
      if (!cur.length) return;
      const text = cur.map((c) => c.ch).join("");
      const a0 = cur[0].t0 / T;
      const a1 = (cur[cur.length - 1].t1 + 1) / T;
      const am = (a0 + a1) / 2;
      const cx = box.tl[0] + ux * am + vx * 0.5;
      const cy = box.tl[1] + uy * am + vy * 0.5;
      const ww = lineW * (a1 - a0);
      words.push({
        text,
        confidence: (cur.reduce((n, c) => n + c.p, 0) / cur.length) * 100,
        bbox: { x0: cx - ww / 2, x1: cx + ww / 2, y0: cy - wordH / 2, y1: cy + wordH / 2 },
      });
      cur = [];
    };
    for (const c of chars) {
      if (c.ch === " ") flush();
      else cur.push(c);
    }
    flush();
    if (b % 4 === 0) onProgress?.({ stage: "reading", pct: ((b + 1) / boxes.length) * 100 });
  }
  return words;
}

/** Reads one canvas with PaddleOCR. Rejects if the models or the runtime can't be loaded, so the caller can fall back. */
export async function paddleWords(canvas: HTMLCanvasElement, onProgress?: (p: PaddleProgress) => void): Promise<PaddleWord[]> {
  const m = await loadModels(onProgress);
  onProgress?.({ stage: "reading", pct: 0 });
  const boxes = await detectBoxes(m, canvas);
  return recognizeBoxes(m, canvas, boxes, onProgress);
}
