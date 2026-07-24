export type NutritionBlock = {
  grammage: number;
  energy_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  total_sugar_g: number;
  added_sugar_g: number | null;
  dietary_fibre_g: number | null;
  total_fat_g: number;
  saturated_fat_g: number | null;
  unsaturated_fat_g: number | null;
  trans_fat_g: number | null;
  cholesterol_mg: number | null;
  sodium_mg: number | null;
  calcium_mg: number | null;
};

export type RDABlock = {
  grammage: number;
  energy_pct: number | null;
  protein_pct: number | null;
  added_sugar_pct: number | null;
  dietary_fibre_pct: number | null;
  total_fat_pct: number | null;
  saturated_fat_pct: number | null;
  trans_fat_pct: number | null;
  sodium_pct: number | null;
  calcium_pct: number | null;
};

export type ProductStatus = "not_launched" | "under_review" | "needs_verification" | "launched";

export type Product = {
  id: string;
  name: string;
  sheet: string;
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
  status: ProductStatus;
};
