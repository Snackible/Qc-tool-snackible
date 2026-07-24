import { ProductStatus } from "./types";

export const VALID_STATUSES: ProductStatus[] = [
  "not_launched",
  "under_review",
  "needs_verification",
  "launched",
];

type StatusMap = Record<string, Record<string, string>>;

export async function fetchProductStatuses(): Promise<StatusMap> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return {};

  try {
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) return {};
    return (await res.json()) as StatusMap;
  } catch {
    return {};
  }
}

export function resolveStatus(map: StatusMap, sheet: string, name: string): ProductStatus {
  const raw = map[sheet]?.[name];
  return (VALID_STATUSES as string[]).includes(raw) ? (raw as ProductStatus) : "not_launched";
}

export async function updateProductStatus(sheet: string, name: string, status: ProductStatus) {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) throw new Error("APPS_SCRIPT_URL is not configured");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet, name, status }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `Apps Script returned ${res.status}`);
  }
  return data as { ok: true; sheet: string; name: string; status: ProductStatus };
}
