import { LabelItem } from "./types";

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function words(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

/** Optimal-string-alignment distance (counts a transposition as one edit); returns max+1 once it exceeds max. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return Math.min(d[a.length][b.length], max + 1);
}

export type Row = { page: number; y: number; items: LabelItem[] };

/** Groups upright text items into visual rows (same page, same baseline), items ordered left to right. */
export function buildRows(items: LabelItem[], tol = 2.5): Row[] {
  const rows: Row[] = [];
  const pages = Array.from(new Set(items.map((i) => i.page))).sort((a, b) => a - b);
  for (const page of pages) {
    const pageRows: Row[] = [];
    const sorted = items.filter((i) => i.page === page && !i.rotated).sort((a, b) => b.y - a.y);
    for (const it of sorted) {
      const row = pageRows.find((r) => Math.abs(r.y - it.y) <= tol);
      if (row) row.items.push(it);
      else pageRows.push({ page, y: it.y, items: [it] });
    }
    for (const r of pageRows) r.items.sort((a, b) => a.x - b.x);
    rows.push(...pageRows.sort((a, b) => b.y - a.y));
  }
  return rows;
}

/** Joins items into text, inserting a space only where there is a visible gap between them. */
export function joinItems(items: LabelItem[]): string {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (i > 0) {
      const prev = items[i - 1];
      const gap = it.x - (prev.x + prev.w);
      if (gap > 0.15 * Math.max(it.h, 1) || !/\S$/.test(out)) out += " ";
    }
    out += it.s;
  }
  return out.replace(/\s+/g, " ").trim();
}

export function rowText(r: Row): string {
  return joinItems(r.items);
}

/**
 * Text "views" used for phrase searches. A sleeve/box PDF has several panels, so reading order
 * is scrambled; a phrase may sit on consecutive lines of one column but not in any single row.
 * Views: the page rows joined, each x-aligned column read top to bottom, and rotated text.
 */
export function buildViews(items: LabelItem[], rows: Row[]): string[] {
  const views: string[] = [normalize(rows.map(rowText).join(" "))];

  const upright = items.filter((i) => !i.rotated);
  const columns: { x: number; page: number; items: LabelItem[] }[] = [];
  for (const it of [...upright].sort((a, b) => a.x - b.x)) {
    const col = columns.find((c) => c.page === it.page && Math.abs(c.x - it.x) <= 6);
    if (col) col.items.push(it);
    else columns.push({ x: it.x, page: it.page, items: [it] });
  }
  for (const c of columns) {
    if (c.items.length < 2) continue;
    views.push(normalize([...c.items].sort((a, b) => b.y - a.y).map((i) => i.s).join(" ")));
  }

  const rotated = items.filter((i) => i.rotated);
  if (rotated.length) views.push(normalize(rotated.map((i) => i.s).join(" ")));
  return views;
}

export function viewsContain(views: string[], phraseNorm: string): boolean {
  if (!phraseNorm) return false;
  const needle = ` ${phraseNorm} `;
  return views.some((v) => ` ${v} `.includes(needle));
}
