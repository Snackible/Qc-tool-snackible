import * as XLSX from "xlsx";
import path from "path";
import { Product, NutritionBlock, RDABlock } from "./types";
import { fetchProductStatuses, resolveStatus } from "./productStatus";

let cache: Product[] | null = null;

// ── Value parsers ─────────────────────────────────────────────────────────────

function parseNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const s = String(val).trim().toLowerCase();
  if (s === "" || s === "nil" || s === "nd" || s === "blq" || s === "trace" || s === "-" || s === "n/a") return 0;
  if (/^nd\s*[<≤]/.test(s) || /^blq/.test(s)) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseNumNullable(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().toLowerCase();
  if (s === "" || s === "-") return null;
  if (s === "nil" || s === "nd" || s === "blq" || s === "trace" || s === "n/a") return 0;
  if (/^nd\s*[<≤]/.test(s) || /^blq/.test(s)) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function parsePackSize(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || s === "-" || s === "N/A") return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function parseUSP(val: unknown): string[] {
  if (!val) return [];
  return String(val)
    .split(/[\n,•\|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Attribute normalizer (handles all 66 spelling variants) ───────────────────

const ATTR_MAP: Record<string, keyof NutritionBlock | "mono" | "poly"> = {
  "energy":                  "energy_kcal",
  "energy value":            "energy_kcal",
  "energy (kcal)":           "energy_kcal",
  "protein":                 "protein_g",
  "proteins":                "protein_g",
  "protein (g)":             "protein_g",
  "protein (gm)":            "protein_g",
  "carbohydrate":            "carbohydrate_g",
  "carbohydrates":           "carbohydrate_g",
  "carbohydrates (g)":       "carbohydrate_g",
  "carbohydrates (gm)":      "carbohydrate_g",
  "total carbohydrates":     "carbohydrate_g",
  "carbohydrat0es":          "carbohydrate_g",
  "total sugar":             "total_sugar_g",
  "total sugar (g)":         "total_sugar_g",
  "total sugar (gm)":        "total_sugar_g",
  "total sugars":            "total_sugar_g",
  "total sugar as sucrose":  "total_sugar_g",
  "sugar":                   "total_sugar_g",
  "sugar (gm)":              "total_sugar_g",
  "sugar as sucrose":        "total_sugar_g",
  "otal sugar":              "total_sugar_g",
  "added sugar":             "added_sugar_g",
  "added sugars":            "added_sugar_g",
  "added sugar (gm)":        "added_sugar_g",
  "dietary fiber":           "dietary_fibre_g",
  "dietary fibre":           "dietary_fibre_g",
  "dietary fibre(gm)":       "dietary_fibre_g",
  "dietery fibre":           "dietary_fibre_g",
  "dietary fibre (g)":       "dietary_fibre_g",
  "total fat":               "total_fat_g",
  "total fat (g)":           "total_fat_g",
  "total fat (gm)":          "total_fat_g",
  "fat":                     "total_fat_g",
  "fat (g)":                 "total_fat_g",
  "fat (gm)":                "total_fat_g",
  "totalfat":                "total_fat_g",
  "saturated fat":           "saturated_fat_g",
  "saturated fat (g)":       "saturated_fat_g",
  "saturated fat (gm)":      "saturated_fat_g",
  "trans fat":               "trans_fat_g",
  "trans fat (g)":           "trans_fat_g",
  "trans fat (gm)":          "trans_fat_g",
  "transfat":                "trans_fat_g",
  "transfat (gm)":           "trans_fat_g",
  "cholesterol":             "cholesterol_mg",
  "cholesterol (mg)":        "cholesterol_mg",
  "cholestrol":              "cholesterol_mg",
  "sodium":                  "sodium_mg",
  "sodium (mg)":             "sodium_mg",
  "calcium":                 "calcium_mg",
  "calcium (mg)":            "calcium_mg",
  "unsaturated fat":         "unsaturated_fat_g",
  "unsaturated fats":        "unsaturated_fat_g",
  "unsaturated fat (g)":     "unsaturated_fat_g",
  "monounsaturated fat":     "mono",
  "monounsaturated fats":    "mono",
  "monounsaturated fat (g)": "mono",
  "monounsaturated fat (gm)":"mono",
  "polyunsaturated fat":     "poly",
  "polyunsaturated fats":    "poly",
  "polyunsaturated fat (g)": "poly",
  "polyunsaturated fat (gm)":"poly",
};

const RDA_ATTR_MAP: Record<string, keyof RDABlock> = {
  "energy":         "energy_pct",
  "energy value":   "energy_pct",
  "protein":        "protein_pct",
  "proteins":       "protein_pct",
  "protein (g)":    "protein_pct",
  "protein (gm)":   "protein_pct",
  "added sugar":    "added_sugar_pct",
  "added sugars":   "added_sugar_pct",
  "dietary fiber":  "dietary_fibre_pct",
  "dietary fibre":  "dietary_fibre_pct",
  "dietery fibre":  "dietary_fibre_pct",
  "total fat":      "total_fat_pct",
  "fat":            "total_fat_pct",
  "saturated fat":  "saturated_fat_pct",
  "trans fat":      "trans_fat_pct",
  "transfat":       "trans_fat_pct",
  "sodium":         "sodium_pct",
  "calcium":        "calcium_pct",
};

// ── Load unpivoted nutrition data ─────────────────────────────────────────────

type GramMap = Map<number, { attrs: Partial<Record<string, number>>; mono: number; poly: number }>;
type RdaGramMap = Map<number, Partial<Record<keyof RDABlock, number | null>>>;

function loadUnpivoted(wb: XLSX.WorkBook): {
  nutrition: Map<string, GramMap>;
  rda: Map<string, RdaGramMap>;
} {
  const nutritionMap = new Map<string, GramMap>();
  const rdaMap = new Map<string, RdaGramMap>();

  const ws = wb.Sheets["Unpivoted Nutrition Data (2)"];
  if (!ws) return { nutrition: nutritionMap, rda: rdaMap };

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }) as unknown[][];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const productName = row[0] ? String(row[0]).trim().replace(/\s+/g, " ") : "";
    const grammage = parseFloat(String(row[1] ?? "").trim());
    const attrRaw = row[2] ? String(row[2]).trim() : "";
    const valueRaw = row[3];
    const rdaRaw = row[4];

    if (!productName || isNaN(grammage) || !attrRaw) continue;

    const attrKey = attrRaw.toLowerCase();
    const canonKey = ATTR_MAP[attrKey];
    const rdaKey = RDA_ATTR_MAP[attrKey];

    // Nutrition
    if (canonKey) {
      if (!nutritionMap.has(productName)) nutritionMap.set(productName, new Map());
      const gramMap = nutritionMap.get(productName)!;
      if (!gramMap.has(grammage)) gramMap.set(grammage, { attrs: {}, mono: 0, poly: 0 });
      const entry = gramMap.get(grammage)!;

      const numVal = parseNum(valueRaw);
      if (canonKey === "mono") {
        entry.mono += numVal;
      } else if (canonKey === "poly") {
        entry.poly += numVal;
      } else {
        const key = canonKey as string;
        if (entry.attrs[key] == null || numVal > 0) entry.attrs[key] = numVal;
      }
    }

    // RDA
    if (rdaKey && rdaRaw !== null && rdaRaw !== undefined) {
      const rdaNum = parseNumNullable(rdaRaw);
      if (rdaNum !== null) {
        if (!rdaMap.has(productName)) rdaMap.set(productName, new Map());
        const rdaGramMap = rdaMap.get(productName)!;
        if (!rdaGramMap.has(grammage)) rdaGramMap.set(grammage, {});
        rdaGramMap.get(grammage)![rdaKey] = rdaNum;
      }
    }
  }

  return { nutrition: nutritionMap, rda: rdaMap };
}

function buildNutritionBlocks(gramMap: GramMap): NutritionBlock[] {
  const blocks: NutritionBlock[] = [];
  for (const [grammage, { attrs, mono, poly }] of Array.from(gramMap)) {
    const unsat =
      attrs["unsaturated_fat_g"] != null
        ? attrs["unsaturated_fat_g"]!
        : mono + poly > 0
        ? parseFloat((mono + poly).toFixed(2))
        : null;

    blocks.push({
      grammage,
      energy_kcal:     attrs["energy_kcal"]     ?? 0,
      protein_g:       attrs["protein_g"]       ?? 0,
      carbohydrate_g:  attrs["carbohydrate_g"]  ?? 0,
      total_sugar_g:   attrs["total_sugar_g"]   ?? 0,
      added_sugar_g:   attrs["added_sugar_g"]   ?? null,
      dietary_fibre_g: attrs["dietary_fibre_g"] ?? null,
      total_fat_g:     attrs["total_fat_g"]     ?? 0,
      saturated_fat_g: attrs["saturated_fat_g"] ?? null,
      unsaturated_fat_g: unsat,
      trans_fat_g:     attrs["trans_fat_g"]     ?? null,
      cholesterol_mg:  attrs["cholesterol_mg"]  ?? null,
      sodium_mg:       attrs["sodium_mg"]       ?? null,
      calcium_mg:      attrs["calcium_mg"]      ?? null,
    });
  }
  // Sort grammages ascending
  return blocks.sort((a, b) => a.grammage - b.grammage);
}

function buildRDABlocks(rdaGramMap: RdaGramMap): RDABlock[] {
  const blocks: RDABlock[] = [];
  for (const [grammage, pcts] of Array.from(rdaGramMap)) {
    blocks.push({
      grammage,
      energy_pct:        pcts.energy_pct        ?? null,
      protein_pct:       pcts.protein_pct       ?? null,
      added_sugar_pct:   pcts.added_sugar_pct   ?? null,
      dietary_fibre_pct: pcts.dietary_fibre_pct ?? null,
      total_fat_pct:     pcts.total_fat_pct     ?? null,
      saturated_fat_pct: pcts.saturated_fat_pct ?? null,
      trans_fat_pct:     pcts.trans_fat_pct     ?? null,
      sodium_pct:        pcts.sodium_pct        ?? null,
      calcium_pct:       pcts.calcium_pct       ?? null,
    });
  }
  return blocks.sort((a, b) => a.grammage - b.grammage);
}

// ── Fallback: text-based nutrition parser (for products not in unpivoted) ─────

function extractVal(section: string, ...patterns: RegExp[]): number {
  for (const pat of patterns) {
    const m = pat.exec(section);
    if (m) {
      const n = parseFloat(m[1].trim().replace(/[^0-9.]/g, ""));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function extractValNullable(section: string, ...patterns: RegExp[]): number | null {
  for (const pat of patterns) {
    const m = pat.exec(section);
    if (m) {
      const raw = m[1].trim().toLowerCase();
      if (raw === "nil" || raw === "nd" || raw === "blq" || raw === "trace" || raw === "-") return 0;
      if (/^nd\s*[<≤]/.test(raw) || /^blq/.test(raw)) return 0;
      const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
      if (!isNaN(n)) return n;
      return null;
    }
  }
  return null;
}

function parseNutrientSection(section: string, grammage: number): NutritionBlock {
  return {
    grammage,
    energy_kcal:     extractVal(section, /energy[^:\-\n]*[\-:]\s*([\d.]+)/i),
    protein_g:       extractVal(section, /protein[^:\-\n]*[\-:]\s*([\d.]+)/i),
    carbohydrate_g:  extractVal(section, /carbohydrat[^\-:\n]*[\-:]\s*([\d.]+)/i, /carbs?[^\-:\n]*[\-:]\s*([\d.]+)/i),
    total_sugar_g:   extractVal(section, /total\s*sugar[^\-:\n]*[\-:]\s*([\d.]+)/i, /\bsugars?[^\-:\n]*[\-:]\s*([\d.]+)/i),
    added_sugar_g:   extractValNullable(section, /added\s*sugar[^\-:\n]*[\-:]\s*([\d.]+)/i),
    dietary_fibre_g: extractValNullable(section, /dietary\s*fib(?:re|er)[^\-:\n]*[\-:]\s*([\d.]+)/i, /fib(?:re|er)[^\-:\n]*[\-:]\s*([\d.]+)/i),
    total_fat_g:     extractVal(section, /total\s*fat[^\-:\n]*[\-:]\s*([\d.]+)/i, /(?:^|\n)\s*fat[^\-:\n]*[\-:]\s*([\d.]+)/im),
    saturated_fat_g: extractValNullable(section, /saturated\s*fat[^\-:\n]*[\-:]\s*([\d.]+)/i),
    unsaturated_fat_g: extractValNullable(section, /unsaturated\s*fat[^\-:\n]*[\-:]\s*([\d.]+)/i, /mono\s*unsaturated[^\-:\n]*[\-:]\s*([\d.]+)/i),
    trans_fat_g:     extractValNullable(section, /trans\s*fat[^\-:\n]*[\-:]\s*([\d.]+)/i),
    cholesterol_mg:  extractValNullable(section, /cholesterol[^\-:\n]*[\-:]\s*([\d.]+)/i),
    sodium_mg:       extractValNullable(section, /sodium[^\-:\n]*[\-:]\s*([\d.]+)/i),
    calcium_mg:      extractValNullable(section, /calcium[^\-:\n]*[\-:]\s*([\d.]+)/i),
  };
}

function extractNutritionBlocks(text: string): NutritionBlock[] {
  if (!text) return [];

  const headerRegex =
    /(?:nutritional\s*(?:information|info|value|facts?)\s*[-–]?\s*(?:per\s+)?|(?:^|\n)\s*per\s+)([\d.]+)\s*g(?:rams?|ms?)?/gi;

  const matches: Array<{ index: number; grammage: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(text)) !== null) {
    matches.push({ index: m.index, grammage: parseFloat(m[1]) });
  }

  const altRegex = /\bper\s+([\d.]+)\s*g(?:m|rams?)?\b/gi;
  while ((m = altRegex.exec(text)) !== null) {
    const g = parseFloat(m[1]);
    if (!matches.some((x) => Math.abs(x.grammage - g) < 0.1 && Math.abs(x.index - m!.index) < 50)) {
      matches.push({ index: m.index, grammage: g });
    }
  }

  matches.sort((a, b) => a.index - b.index);

  if (matches.length === 0) {
    const block = parseNutrientSection(text, 100);
    if (block.energy_kcal > 0 || block.protein_g > 0) return [block];
    return [];
  }

  return matches.map(({ index, grammage }, i) => {
    const section = text.slice(index, i + 1 < matches.length ? matches[i + 1].index : text.length);
    return parseNutrientSection(section, grammage);
  });
}

function extractRDABlocks(text: string): RDABlock[] {
  if (!text) return [];

  const rdaRegex = /(?:per\s+serving\s+|for\s+|rda[-–\s]*)([\d.]+)\s*g(?:rams?|ms?)?/gi;
  const matches: Array<{ index: number; grammage: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = rdaRegex.exec(text)) !== null) {
    matches.push({ index: m.index, grammage: parseFloat(m[1]) });
  }
  matches.sort((a, b) => a.index - b.index);

  function extractPct(section: string, ...patterns: RegExp[]): number | null {
    for (const pat of patterns) {
      const mx = pat.exec(section);
      if (mx) {
        const raw = mx[1].trim().toLowerCase();
        if (raw === "nil" || raw === "nd" || raw === "blq" || raw === "-") return null;
        const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
        if (!isNaN(n)) return n;
      }
    }
    return null;
  }

  function parseRDASection(section: string, grammage: number): RDABlock {
    return {
      grammage,
      energy_pct:        extractPct(section, /energy[^\n%]*?([\d.]+)\s*%/i, /energy[^\n]*[\-:]\s*([\d.]+)/i),
      protein_pct:       extractPct(section, /protein[^\n%]*?([\d.]+)\s*%/i, /protein[^\n]*[\-:]\s*([\d.]+)/i),
      added_sugar_pct:   extractPct(section, /added\s*sugar[^\n%]*?([\d.]+)\s*%/i, /added\s*sugar[^\n]*[\-:]\s*([\d.]+)/i),
      dietary_fibre_pct: extractPct(section, /dietary\s*fib(?:re|er)[^\n%]*?([\d.]+)\s*%/i, /fib(?:re|er)[^\n]*[\-:]\s*([\d.]+)/i),
      total_fat_pct:     extractPct(section, /total\s*fat[^\n%]*?([\d.]+)\s*%/i, /(?:^|\n)\s*fat[^\n%]*?([\d.]+)\s*%/im),
      saturated_fat_pct: extractPct(section, /saturated\s*fat[^\n%]*?([\d.]+)\s*%/i),
      trans_fat_pct:     extractPct(section, /trans\s*fat[^\n%]*?([\d.]+)\s*%/i),
      sodium_pct:        extractPct(section, /sodium[^\n%]*?([\d.]+)\s*%/i),
      calcium_pct:       extractPct(section, /calcium[^\n%]*?([\d.]+)\s*%/i),
    };
  }

  if (matches.length === 0) {
    const block = parseRDASection(text, 0);
    const hasAny = block.energy_pct !== null || block.protein_pct !== null || block.total_fat_pct !== null;
    if (hasAny) return [block];
    return [];
  }

  return matches.map(({ index, grammage }, i) => {
    const section = text.slice(index, i + 1 < matches.length ? matches[i + 1].index : text.length);
    return parseRDASection(section, grammage);
  });
}

// ── Sheet parsers ─────────────────────────────────────────────────────────────

const SHEETS_WITH_SERVING_SIZE = ["Launched products", "New launches", "First Club", "Nuts", "Sheet1"];

function parseSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  unpivotedNutrition: Map<string, GramMap>,
  unpivotedRDA: Map<string, RdaGramMap>
): Product[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const hasServingSize = SHEETS_WITH_SERVING_SIZE.includes(sheetName);

  const products: Product[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const name = row[0] ? String(row[0]).trim().replace(/\s+/g, " ") : "";
    if (!name || name.toLowerCase() === "products" || name.toLowerCase() === "product name") continue;

    let servingSize = 0;
    let nutritionText = "";
    let rdaText = "";
    let allergens = "";
    let shelfLife = "";
    let smallPack: number | null = null;
    let largePack: number | null = null;
    let manufacturer = "";
    let mrp = "";

    if (hasServingSize) {
      servingSize    = parseNum(row[4]);
      nutritionText  = row[3] ? String(row[3]) : "";
      rdaText        = row[5] ? String(row[5]) : "";
      allergens      = row[6] ? String(row[6]) : "";
      shelfLife      = row[8] ? String(row[8]) : "";
      smallPack      = parsePackSize(row[10]);
      largePack      = parsePackSize(row[11]);
      manufacturer   = row[13] ? String(row[13]) : "";
      mrp            = row[14] ? String(row[14]) : "";
    } else {
      nutritionText  = row[3] ? String(row[3]) : "";
      rdaText        = row[4] ? String(row[4]) : "";
      allergens      = row[5] ? String(row[5]) : "";
      shelfLife      = row[7] ? String(row[7]) : "";
      smallPack      = parsePackSize(row[9]);
      largePack      = parsePackSize(row[10]);
      manufacturer   = row[12] ? String(row[12]) : "";
      mrp            = row[13] ? String(row[13]) : "";
    }

    // Use unpivoted nutrition if available, else fall back to text parsing
    let nutrition: NutritionBlock[];
    let rda: RDABlock[];

    const gramMap = unpivotedNutrition.get(name);
    if (gramMap && gramMap.size > 0) {
      nutrition = buildNutritionBlocks(gramMap);
    } else {
      nutrition = extractNutritionBlocks(nutritionText);
    }

    const rdaGramMap = unpivotedRDA.get(name);
    if (rdaGramMap && rdaGramMap.size > 0) {
      rda = buildRDABlocks(rdaGramMap);
    } else {
      rda = extractRDABlocks(rdaText);
    }

    if (!servingSize) {
      servingSize = smallPack ?? (nutrition.length > 0 ? nutrition[0].grammage : 0);
    }

    const id = `${sheetName}-${i}-${name.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`;

    products.push({
      id,
      name,
      sheet: sheetName,
      brand_usp: parseUSP(row[1]),
      ingredients: row[2] ? String(row[2]) : "",
      nutrition,
      rda,
      serving_size_g: servingSize,
      allergens,
      shelf_life: shelfLife,
      small_pack_g: smallPack,
      large_pack_g: largePack,
      manufacturer,
      mrp,
      status: "not_launched",
    });
  }

  return products;
}

// ── Public API ────────────────────────────────────────────────────────────────

function parseProductsFromDisk(): Product[] {
  const productsPath  = path.join(process.cwd(), "data", "products.xlsx");
  const unpivotedPath = path.join(process.cwd(), "data", "unpivoted.xlsx");

  const productWb  = XLSX.readFile(productsPath);
  const unpivotedWb = XLSX.readFile(unpivotedPath);

  const { nutrition: unpivotedNutrition, rda: unpivotedRDA } = loadUnpivoted(unpivotedWb);

  const allProducts: Product[] = [];
  for (const sheetName of productWb.SheetNames) {
    const products = parseSheet(productWb, sheetName, unpivotedNutrition, unpivotedRDA);
    allProducts.push(...products);
  }

  return allProducts;
}

export async function parseProducts(): Promise<Product[]> {
  if (!cache) cache = parseProductsFromDisk();

  const statusMap = await fetchProductStatuses();
  return cache.map((p) => ({
    ...p,
    status: resolveStatus(statusMap, p.sheet, p.name),
  }));
}
