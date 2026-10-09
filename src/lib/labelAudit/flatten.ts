import { LabelItem } from "./types";

/**
 * OCR on a photo of a tilted, handheld or curved pack gives words whose baselines slope, and the row grouping in the
 * rules engine (which matches a nutrient's name to its value by y) then pairs names with the wrong values. This
 * flattens the *positions* of the words (not the image): it estimates how text lines slope across the label from the
 * words themselves, and shifts each word's y by the slope integrated along x. Only used for OCR text, and only kept
 * when it makes the words fall into visibly sharper rows.
 */

type Pt = { x: number; y: number; w: number };

const GRID_X = 4;
const GRID_Y = 8;
const MIN_WORDS = 10;
const MIN_CONF = 1.3;
const MAX_SLOPE = 0.3; // ~17 degrees
const MIN_GAIN = 1.08;

/** Best text-line slope (dy/dx) for some word centres: the shear that makes them fall into the sharpest rows. */
export function bestSlope(pts: Pt[], binH: number, range = MAX_SLOPE, step = 0.01): { slope: number; conf: number } {
  if (pts.length < MIN_WORDS) return { slope: 0, conf: 0 };
  let best = 0;
  let bestScore = -1;
  let total = 0;
  let n = 0;
  for (let s = -range; s <= range + 1e-9; s += step) {
    const sc = sharpness(pts, binH, s);
    total += sc;
    n++;
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return { slope: best, conf: bestScore / (total / n) };
}

/** How concentrated the words are into rows once sheared by `slope` (higher is sharper). */
function sharpness(pts: Pt[], binH: number, slope: number): number {
  const bins = new Map<number, number>();
  for (const p of pts) {
    const k = Math.round((p.y - slope * p.x) / binH);
    bins.set(k, (bins.get(k) ?? 0) + p.w);
  }
  let sc = 0;
  bins.forEach((v) => (sc += v * v));
  return sc;
}

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export function flattenItems(items: LabelItem[]): LabelItem[] {
  const upright = items.filter((i) => !i.rotated);
  if (upright.length < 40) return items;
  const out: LabelItem[] = [];
  // each page (a separate photo) is flattened on its own
  const pages = Array.from(new Set(items.map((i) => i.page)));
  for (const page of pages) out.push(...flattenPage(items.filter((i) => i.page === page)));
  return out;
}

function flattenPage(items: LabelItem[]): LabelItem[] {
  const up = items.filter((i) => !i.rotated);
  if (up.length < 40) return items;
  const H = median(up.map((i) => i.h)) || 7;
  const binH = Math.max(1, H * 0.5);
  const centres = up.map((i) => ({ x: i.x + i.w / 2, y: i.y, w: i.w }));

  const xs = centres.map((c) => c.x);
  const ys = centres.map((c) => c.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  if (x1 - x0 < H * 10 || y1 - y0 < H * 6) return items;

  const global = bestSlope(centres, binH, MAX_SLOPE, 0.005);
  const globalSlope = global.conf >= MIN_CONF ? global.slope : 0;

  // slope per grid cell from the words near it; weak cells fall back to the page-wide slope
  const cellW = (x1 - x0) / GRID_X;
  const cellH = (y1 - y0) / GRID_Y;
  const slopes: number[] = [];
  for (let j = 0; j < GRID_Y; j++) {
    for (let i = 0; i < GRID_X; i++) {
      const cx = x0 + (i + 0.5) * cellW;
      const cy = y0 + (j + 0.5) * cellH;
      const pts = centres
        .filter((c) => Math.abs(c.x - cx) <= cellW * 0.9 && Math.abs(c.y - cy) <= cellH)
        .map((c) => ({ x: c.x - cx, y: c.y - cy, w: c.w }));
      const r = bestSlope(pts, binH);
      slopes.push(r.conf >= MIN_CONF ? r.slope : globalSlope);
    }
  }
  // smooth: each cell averaged with its neighbours
  const smooth = slopes.map((s, p) => {
    const i = p % GRID_X;
    const j = Math.floor(p / GRID_X);
    let sum = s * 2;
    let cnt = 2;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= GRID_X || jj >= GRID_Y) continue;
      sum += slopes[jj * GRID_X + ii];
      cnt++;
    }
    return sum / cnt;
  });

  const slopeAt = (x: number, y: number) => {
    const fx = Math.min(GRID_X - 1, Math.max(0, (x - x0) / cellW - 0.5));
    const fy = Math.min(GRID_Y - 1, Math.max(0, (y - y0) / cellH - 0.5));
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const i1 = Math.min(GRID_X - 1, i0 + 1);
    const j1 = Math.min(GRID_Y - 1, j0 + 1);
    const ax = fx - i0;
    const ay = fy - j0;
    const v = (i: number, j: number) => smooth[j * GRID_X + i];
    return v(i0, j0) * (1 - ax) * (1 - ay) + v(i1, j0) * ax * (1 - ay) + v(i0, j1) * (1 - ax) * ay + v(i1, j1) * ax * ay;
  };

  // y shift for a word: the slope integrated along x from the page centre, along that word's height
  const xc = (x0 + x1) / 2;
  const shift = (x: number, y: number) => {
    const steps = Math.max(1, Math.ceil(Math.abs(x - xc) / (H * 4)));
    const dx = (x - xc) / steps;
    let d = 0;
    for (let k = 0; k < steps; k++) d += slopeAt(xc + (k + 0.5) * dx, y) * dx;
    return d;
  };

  const moved = items.map((it) => (it.rotated ? it : { ...it, y: it.y - shift(it.x + it.w / 2, it.y) }));

  // keep the flattening only if the words really do fall into sharper rows
  const before = sharpness(centres, binH, 0);
  const after = sharpness(
    moved.filter((i) => !i.rotated).map((i) => ({ x: i.x + i.w / 2, y: i.y, w: i.w })),
    binH,
    0
  );
  return after >= before * MIN_GAIN ? moved : items;
}
