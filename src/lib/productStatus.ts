import { ProductStatus } from "./types";
import {
  NutritionOverride,
  updateProductNutritionInSheet,
  updateProductStatusInSheet,
} from "./googleSheets";

export const VALID_STATUSES: ProductStatus[] = [
  "not_launched",
  "under_review",
  "needs_verification",
  "launched",
];

export type { NutritionOverride };

export async function updateProductStatus(sheet: string, name: string, status: ProductStatus) {
  await updateProductStatusInSheet(sheet, name, status);
  return { ok: true };
}

export async function updateProductNutrition(sheet: string, name: string, override: NutritionOverride | null) {
  await updateProductNutritionInSheet(sheet, name, override);
  return { ok: true };
}
