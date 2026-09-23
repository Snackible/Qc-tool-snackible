/**
 * Google Sheets data layer — backed by a single tab (imported from
 * data/products_export.csv): one row per (product, grammage), with
 * product-level fields repeated across a product's grammage rows.
 *
 * Env vars required:
 *   GOOGLE_SHEETS_SPREADSHEET_ID        — the id in the sheet's URL
 *   GOOGLE_SHEETS_TAB_GID                — the gid= param in the sheet's URL
 *
 * Plus service account credentials, either of:
 *   GOOGLE_SERVICE_ACCOUNT_KEY_BASE64    — (recommended) the whole downloaded
 *                                          service account JSON file,
 *                                          base64-encoded into one line —
 *                                          avoids PEM newline-mangling
 *                                          issues in dashboard env-var UIs
 *   or the pair:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL         — service account client_email
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   — service account private_key
 *                                          (real "\n" line breaks, or
 *                                          "\\n" escaped — both handled)
 *
 * A product's identity is the (sheet, name) pair — "sheet" here means the
 * product category/grouping column value (e.g. "Launched products"), not
 * the spreadsheet tab.
 */
import { google, sheets_v4 } from "googleapis";
import { Product, NutritionBlock, RDABlock, ProductStatus } from "./types";

export type NutritionOverride = { nutrition: NutritionBlock[]; rda: RDABlock[] };

export type NewProduct = {
  sheet: string;
  name: string;
  brand_usp: string[];
  ingredients: string;
  nutrition: NutritionBlock[];
  rda: RDABlock[];
  serving_size_g: number;
  allergens: string;
  shelf_life: string;
  small_pack_g: number | null;
  large_pack_g: number | null;
  manufacturer: string;
  mrp: string;
};

const COLUMNS = [
  "sheet", "name", "brand_usp", "ingredients", "serving_size_g",
  "allergens", "shelf_life", "small_pack_g", "large_pack_g",
  "manufacturer", "mrp", "status", "grammage",
  "energy_kcal", "protein_g", "carbohydrate_g", "total_sugar_g", "added_sugar_g",
  "dietary_fibre_g", "total_fat_g", "saturated_fat_g", "unsaturated_fat_g",
  "trans_fat_g", "cholesterol_mg", "sodium_mg", "calcium_mg",
  "energy_pct", "protein_pct", "added_sugar_pct", "dietary_fibre_pct",
  "total_fat_pct", "saturated_fat_pct", "trans_fat_pct", "sodium_pct", "calcium_pct",
] as const;
type Column = (typeof COLUMNS)[number];
const COL_INDEX: Record<Column, number> = Object.fromEntries(
  COLUMNS.map((c, i) => [c, i])
) as Record<Column, number>;

const VALID_STATUSES: ProductStatus[] = ["not_launched", "under_review", "needs_verification", "launched"];

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

let cachedClient: sheets_v4.Sheets | null = null;
function getClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;
  const { email, key } = getCredentials();
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  // Some env-var UIs preserve literal surrounding quotes if they were pasted in.
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  // A JSON key file escapes newlines as literal "\n" — convert those to real line breaks.
  // (A no-op if the value already has real newlines.)
  key = key.replace(/\\n/g, "\n");
  return key;
}

/**
 * Prefers GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 (the whole downloaded service
 * account JSON file, base64-encoded into one line) when set — this avoids
 * the newline-mangling that's a common source of PEM decode errors when
 * pasting a multi-line private key into a dashboard env-var field. Falls
 * back to the separate email/key pair otherwise.
 */
function getCredentials(): { email: string; key: string } {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (b64) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(Buffer.from(b64.trim(), "base64").toString("utf-8"));
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON — " +
        "it should be the full service account JSON key file, base64-encoded."
      );
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 JSON is missing client_email or private_key.");
    }
    return { email: parsed.client_email, key: parsed.private_key };
  }

  const email = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const key = normalizePrivateKey(requiredEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"));
  if (!key.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY doesn't look like a valid PEM key " +
      "(missing 'BEGIN PRIVATE KEY' header) — it was likely truncated or mangled " +
      "when pasted. Consider using GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 instead: " +
      "base64-encode the entire downloaded service account JSON file and set that " +
      "as one env var — it sidesteps newline/quoting issues entirely."
    );
  }
  return { email, key };
}

function a1Quote(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

let cachedTab: { sheetId: number; title: string } | null = null;
async function getTab(): Promise<{ sheetId: number; title: string }> {
  if (cachedTab) return cachedTab;
  const spreadsheetId = requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const gid = parseInt(requiredEnv("GOOGLE_SHEETS_TAB_GID"), 10);
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const match = meta.data.sheets?.find((s) => s.properties?.sheetId === gid);
  if (!match?.properties?.title || match.properties.sheetId == null) {
    throw new Error(`No sheet tab found with gid=${gid} in spreadsheet ${spreadsheetId}`);
  }
  cachedTab = { sheetId: match.properties.sheetId, title: match.properties.title };
  return cachedTab;
}

function num(v: string | undefined): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? 0 : n;
}
function numOrNull(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function rowToRecord(row: string[]): Record<Column, string> {
  const rec = {} as Record<Column, string>;
  COLUMNS.forEach((c, i) => { rec[c] = row[i] ?? ""; });
  return rec;
}

function productRowValues(base: {
  sheet: string; name: string; brand_usp: string[]; ingredients: string;
  serving_size_g: number; allergens: string; shelf_life: string;
  small_pack_g: number | null; large_pack_g: number | null;
  manufacturer: string; mrp: string; status: ProductStatus;
}, nb: NutritionBlock, rb: RDABlock | undefined): string[] {
  const rec: Record<Column, string | number> = {
    sheet: base.sheet, name: base.name, brand_usp: base.brand_usp.join(" | "),
    ingredients: base.ingredients, serving_size_g: base.serving_size_g,
    allergens: base.allergens, shelf_life: base.shelf_life,
    small_pack_g: base.small_pack_g ?? "", large_pack_g: base.large_pack_g ?? "",
    manufacturer: base.manufacturer, mrp: base.mrp, status: base.status,
    grammage: nb.grammage,
    energy_kcal: nb.energy_kcal, protein_g: nb.protein_g,
    carbohydrate_g: nb.carbohydrate_g, total_sugar_g: nb.total_sugar_g,
    added_sugar_g: nb.added_sugar_g ?? "", dietary_fibre_g: nb.dietary_fibre_g ?? "",
    total_fat_g: nb.total_fat_g, saturated_fat_g: nb.saturated_fat_g ?? "",
    unsaturated_fat_g: nb.unsaturated_fat_g ?? "", trans_fat_g: nb.trans_fat_g ?? "",
    cholesterol_mg: nb.cholesterol_mg ?? "", sodium_mg: nb.sodium_mg ?? "",
    calcium_mg: nb.calcium_mg ?? "",
    energy_pct: rb?.energy_pct ?? "", protein_pct: rb?.protein_pct ?? "",
    added_sugar_pct: rb?.added_sugar_pct ?? "", dietary_fibre_pct: rb?.dietary_fibre_pct ?? "",
    total_fat_pct: rb?.total_fat_pct ?? "", saturated_fat_pct: rb?.saturated_fat_pct ?? "",
    trans_fat_pct: rb?.trans_fat_pct ?? "", sodium_pct: rb?.sodium_pct ?? "",
    calcium_pct: rb?.calcium_pct ?? "",
  };
  return COLUMNS.map((c) => String(rec[c]));
}

/** Fetches raw rows plus each row's 1-indexed sheet row number (accounting for the header row). */
async function fetchRawRows(): Promise<{ header: string[]; rows: { rowNumber: number; values: string[] }[]; title: string }> {
  const spreadsheetId = requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const { title } = await getTab();
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: a1Quote(title),
  });
  const values = res.data.values ?? [];
  if (values.length === 0) return { header: [...COLUMNS], rows: [], title };
  const [header, ...dataRows] = values;
  const rows = dataRows.map((values, i) => ({ rowNumber: i + 2, values: values as string[] }));
  return { header, rows, title };
}

export async function fetchProductsFromSheet(): Promise<Product[]> {
  const { rows } = await fetchRawRows();

  type Group = { base: Record<Column, string>; nutrition: NutritionBlock[]; rda: RDABlock[] };
  const grouped = new Map<string, Group>();
  const order: string[] = [];

  for (const { values } of rows) {
    const rec = rowToRecord(values);
    if (!rec.sheet || !rec.name) continue;
    const key = `${rec.sheet}\u0000${rec.name}`;
    if (!grouped.has(key)) {
      grouped.set(key, { base: rec, nutrition: [], rda: [] });
      order.push(key);
    }
    const entry = grouped.get(key)!;
    const grammage = num(rec.grammage);

    if (rec.energy_kcal || rec.protein_g || rec.total_fat_g || rec.carbohydrate_g) {
      entry.nutrition.push({
        grammage,
        energy_kcal: num(rec.energy_kcal),
        protein_g: num(rec.protein_g),
        carbohydrate_g: num(rec.carbohydrate_g),
        total_sugar_g: num(rec.total_sugar_g),
        added_sugar_g: numOrNull(rec.added_sugar_g),
        dietary_fibre_g: numOrNull(rec.dietary_fibre_g),
        total_fat_g: num(rec.total_fat_g),
        saturated_fat_g: numOrNull(rec.saturated_fat_g),
        unsaturated_fat_g: numOrNull(rec.unsaturated_fat_g),
        trans_fat_g: numOrNull(rec.trans_fat_g),
        cholesterol_mg: numOrNull(rec.cholesterol_mg),
        sodium_mg: numOrNull(rec.sodium_mg),
        calcium_mg: numOrNull(rec.calcium_mg),
      });
    }
    if (rec.energy_pct || rec.protein_pct || rec.total_fat_pct || rec.sodium_pct) {
      entry.rda.push({
        grammage,
        energy_pct: numOrNull(rec.energy_pct),
        protein_pct: numOrNull(rec.protein_pct),
        added_sugar_pct: numOrNull(rec.added_sugar_pct),
        dietary_fibre_pct: numOrNull(rec.dietary_fibre_pct),
        total_fat_pct: numOrNull(rec.total_fat_pct),
        saturated_fat_pct: numOrNull(rec.saturated_fat_pct),
        trans_fat_pct: numOrNull(rec.trans_fat_pct),
        sodium_pct: numOrNull(rec.sodium_pct),
        calcium_pct: numOrNull(rec.calcium_pct),
      });
    }
  }

  return order.map((key, i) => {
    const { base, nutrition, rda } = grouped.get(key)!;
    const status = (VALID_STATUSES as string[]).includes(base.status) ? (base.status as ProductStatus) : "not_launched";
    return {
      id: `${base.sheet}-${i}-${base.name.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`,
      name: base.name,
      sheet: base.sheet,
      brand_usp: base.brand_usp ? base.brand_usp.split("|").map((s) => s.trim()).filter(Boolean) : [],
      ingredients: base.ingredients ?? "",
      nutrition: nutrition.sort((a, b) => a.grammage - b.grammage),
      rda: rda.sort((a, b) => a.grammage - b.grammage),
      serving_size_g: num(base.serving_size_g),
      allergens: base.allergens ?? "",
      shelf_life: base.shelf_life ?? "",
      small_pack_g: numOrNull(base.small_pack_g),
      large_pack_g: numOrNull(base.large_pack_g),
      manufacturer: base.manufacturer ?? "",
      mrp: base.mrp ?? "",
      status,
      hasCustomNutrition: false,
    };
  });
}

export async function addProductToSheet(product: NewProduct): Promise<void> {
  const spreadsheetId = requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const { title } = await getTab();
  const sheets = getClient();

  const base = { ...product, status: "not_launched" as ProductStatus };
  const rdaByGram = new Map(product.rda.map((r) => [r.grammage, r]));
  const values = product.nutrition.map((nb) => productRowValues(base, nb, rdaByGram.get(nb.grammage)));

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: a1Quote(title),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

async function findRowsFor(sheetName: string, name: string) {
  const { rows } = await fetchRawRows();
  return rows.filter((r) => r.values[COL_INDEX.sheet] === sheetName && r.values[COL_INDEX.name] === name);
}

export async function updateProductStatusInSheet(
  sheetName: string,
  name: string,
  status: ProductStatus
): Promise<void> {
  const spreadsheetId = requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const { title } = await getTab();
  const matches = await findRowsFor(sheetName, name);
  if (matches.length === 0) throw new Error(`Product not found: ${sheetName} / ${name}`);

  const sheets = getClient();
  const statusColLetter = columnLetter(COL_INDEX.status);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: matches.map((m) => ({
        range: `${a1Quote(title)}!${statusColLetter}${m.rowNumber}`,
        values: [[status]],
      })),
    },
  });
}

export async function updateProductNutritionInSheet(
  sheetName: string,
  name: string,
  override: NutritionOverride | null
): Promise<void> {
  if (override === null) {
    // Single-sheet model: the sheet IS the source of truth, so there is no
    // separate "original" to revert to. Nothing to do.
    return;
  }

  const spreadsheetId = requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const { title, sheetId } = await getTab();
  const matches = await findRowsFor(sheetName, name);
  if (matches.length === 0) throw new Error(`Product not found: ${sheetName} / ${name}`);

  const base = matches[0].values;
  const rowBase = {
    sheet: sheetName,
    name,
    brand_usp: (base[COL_INDEX.brand_usp] ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    ingredients: base[COL_INDEX.ingredients] ?? "",
    serving_size_g: num(base[COL_INDEX.serving_size_g]),
    allergens: base[COL_INDEX.allergens] ?? "",
    shelf_life: base[COL_INDEX.shelf_life] ?? "",
    small_pack_g: numOrNull(base[COL_INDEX.small_pack_g]),
    large_pack_g: numOrNull(base[COL_INDEX.large_pack_g]),
    manufacturer: base[COL_INDEX.manufacturer] ?? "",
    mrp: base[COL_INDEX.mrp] ?? "",
    status: ((VALID_STATUSES as string[]).includes(base[COL_INDEX.status]) ? base[COL_INDEX.status] : "not_launched") as ProductStatus,
  };

  const rdaByGram = new Map(override.rda.map((r) => [r.grammage, r]));
  const newValues = override.nutrition.map((nb) => productRowValues(rowBase, nb, rdaByGram.get(nb.grammage)));

  const sheets = getClient();

  // Delete the product's existing rows (descending order so earlier row
  // numbers stay valid as later ones are removed), then append fresh rows.
  const deleteRequests = matches
    .map((m) => m.rowNumber)
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
      },
    }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: deleteRequests },
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: a1Quote(title),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: newValues },
  });
}

function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
