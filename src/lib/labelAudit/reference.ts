import { NutritionBlock, Product, RDABlock } from "../types";
import { words } from "./textUtils";

export type PackOption = { grams: number; price: number | null; source: "mrp" | "pack" | "nutrition" };

export type AuditReference = {
  productName: string;
  usps: string[];
  ingredients: string;
  allergens: string;
  manufacturer: string;
  nutrition: NutritionBlock[];
  rda: RDABlock[];
  packSizeG: number | null;
  expectedMrp: number | null;
  vocabulary: Set<string>;
};

/**
 * The sheet's MRP cell is free text with several layouts, one pack per line, e.g.
 * "80gm for 70/- (per gm 0.87/-)", "50 for 60g", "145 /-for 180g", "34gm-35/-", "60/- for 44 grams".
 */
export function parseMrpEntries(text: string): { grams: number; price: number }[] {
  const out: { grams: number; price: number }[] = [];
  for (const rawLine of (text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\([^)]*\)/g, " ").replace(/rs\.?|₹/gi, " ");
    const w = line.match(/(\d+(?:\.\d+)?)\s*(?:gms?|grams?|g)\b/i);
    if (!w) continue;
    const rest = line.replace(w[0], " ");
    const p = rest.match(/(\d+(?:\.\d+)?)/);
    if (!p) continue;
    const grams = parseFloat(w[1]);
    const price = parseFloat(p[1]);
    if (grams > 0 && price > 0) out.push({ grams, price });
  }
  return out;
}

/** Candidate pack (net weight) sizes for a product, MRP-backed sizes first. */
export function packOptionsFor(p: Product): PackOption[] {
  const byGrams = new Map<number, PackOption>();
  for (const e of parseMrpEntries(p.mrp)) {
    if (!byGrams.has(e.grams)) byGrams.set(e.grams, { grams: e.grams, price: e.price, source: "mrp" });
  }
  for (const g of [p.small_pack_g, p.large_pack_g]) {
    if (g && !byGrams.has(g)) byGrams.set(g, { grams: g, price: null, source: "pack" });
  }
  if (byGrams.size === 0) {
    for (const nb of p.nutrition) {
      if (nb.grammage > 0 && !byGrams.has(nb.grammage)) {
        byGrams.set(nb.grammage, { grams: nb.grammage, price: null, source: "nutrition" });
      }
    }
  }
  return Array.from(byGrams.values()).sort((a, b) => a.grams - b.grams);
}

const GENERIC_WORDS = [
  "ingredients", "nutritional", "information", "energy", "protein", "carbohydrate", "carbohydrates", "total",
  "sugar", "added", "dietary", "fibre", "fiber", "saturated", "trans", "cholesterol", "sodium", "calcium",
  "serving", "approx", "contains", "flavours", "flavour", "flavouring", "nature", "identical", "substances",
  "permitted", "emulsifiers", "stabilizers", "preservatives", "antioxidants", "antioxidant", "sequestrant",
  "regulator", "acidity", "anticaking", "enhancer", "colours", "colour", "natural", "artificial",
  "manufactured", "marketed", "packed", "facility", "processes", "handles", "allergen", "allergens",
];

/** Correctly spelled words known from the sheet (ingredients, allergens, claims, names), used to catch label typos. */
export function buildVocabulary(products: Product[]): Set<string> {
  const vocab = new Set<string>(GENERIC_WORDS);
  for (const p of products) {
    const text = [p.name, p.ingredients, p.allergens, p.brand_usp.join(" ")].join(" ");
    for (const w of words(text)) if (/^[a-z]{3,}$/.test(w)) vocab.add(w);
  }
  return vocab;
}

export function buildReference(
  p: Product,
  packSizeG: number | null,
  expectedMrp: number | null,
  vocabulary: Set<string>
): AuditReference {
  return {
    productName: p.name,
    usps: p.brand_usp,
    ingredients: p.ingredients,
    allergens: p.allergens,
    manufacturer: p.manufacturer,
    nutrition: p.nutrition,
    rda: p.rda,
    packSizeG,
    expectedMrp,
    vocabulary,
  };
}
