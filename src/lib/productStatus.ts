import { NutritionBlock, ProductStatus, RDABlock } from "./types";

export const VALID_STATUSES: ProductStatus[] = [
  "not_launched",
  "under_review",
  "needs_verification",
  "launched",
];

export type NutritionOverride = { nutrition: NutritionBlock[]; rda: RDABlock[] };

type ProductMeta = { status: string; nutrition: NutritionOverride | null };
type MetaMap = Record<string, Record<string, ProductMeta>>;

export async function fetchProductMeta(): Promise<MetaMap> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return {};

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return {};
    return (await res.json()) as MetaMap;
  } catch {
    return {};
  }
}

export function resolveStatus(map: MetaMap, sheet: string, name: string): ProductStatus {
  const raw = map[sheet]?.[name]?.status;
  return (VALID_STATUSES as string[]).includes(raw as string) ? (raw as ProductStatus) : "not_launched";
}

export function resolveNutritionOverride(map: MetaMap, sheet: string, name: string): NutritionOverride | null {
  return map[sheet]?.[name]?.nutrition ?? null;
}

async function postToAppsScript(body: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) throw new Error("APPS_SCRIPT_URL is not configured");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `Apps Script returned ${res.status}`);
  }
  return data;
}

export async function updateProductStatus(sheet: string, name: string, status: ProductStatus) {
  return postToAppsScript({ sheet, name, status });
}

export async function updateProductNutrition(sheet: string, name: string, override: NutritionOverride | null) {
  return postToAppsScript({ sheet, name, nutrition: override });
}
