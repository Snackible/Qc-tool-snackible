export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export type AuditCheck = {
  label: string;
  status: CheckStatus;
  expected?: string;
  found?: string;
  note?: string;
  sop_rule?: boolean;
};

export type AuditStep = { step: number; name: string; checks: AuditCheck[] };

export type AuditReport = {
  product: string;
  pack_size: string;
  overall: CheckStatus;
  steps: AuditStep[];
  mode: "rules" | "ai";
  notes: string[];
};

export type LabelItem = {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
  rotated: boolean;
};

export type ExtractedLabel = {
  items: LabelItem[];
  pageCount: number;
  charCount: number;
  /** where the text came from: the PDF's own text layer, or OCR of the rendered image */
  source: "pdf" | "ocr";
};

export const STEP_NAMES: Record<number, string> = {
  2: "Product Name",
  3: "USPs",
  4: "Grammage",
  5: "Long Description",
  6: "Ingredients",
  7: "Nutritional Values",
  8: "Serving Size",
  9: "MRP",
  10: "Addresses",
};

export function combineStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  if (statuses.includes("pass")) return "pass";
  return "skip";
}

export function stepStatus(step: AuditStep): CheckStatus {
  return combineStatus(step.checks.map((c) => c.status));
}
