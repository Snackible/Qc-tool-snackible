import { NutritionBlock } from "../types";

export type NutrientDef = {
  key: keyof NutritionBlock;
  label: string;
  names: string[];
  unit: string;
  floor: number;
};

// floor = absolute difference always accepted (rounding on the label)
export const NUTRIENTS: NutrientDef[] = [
  { key: "energy_kcal", label: "Energy", names: ["energy"], unit: "kcal", floor: 1 },
  { key: "protein_g", label: "Protein", names: ["protein", "proteins"], unit: "g", floor: 0.05 },
  { key: "carbohydrate_g", label: "Carbohydrate", names: ["carbohydrate", "carbohydrates", "total carbohydrate", "total carbohydrates", "carbs"], unit: "g", floor: 0.05 },
  { key: "total_sugar_g", label: "Total Sugar", names: ["total sugar", "total sugars", "sugar", "sugars"], unit: "g", floor: 0.05 },
  { key: "added_sugar_g", label: "Added Sugar", names: ["added sugar", "added sugars"], unit: "g", floor: 0.05 },
  { key: "dietary_fibre_g", label: "Dietary Fibre", names: ["dietary fibre", "dietary fiber", "fibre", "fiber"], unit: "g", floor: 0.05 },
  { key: "total_fat_g", label: "Total Fat", names: ["total fat", "fat"], unit: "g", floor: 0.05 },
  { key: "saturated_fat_g", label: "Saturated Fat", names: ["saturated fat", "saturated fats", "sat fat"], unit: "g", floor: 0.05 },
  { key: "trans_fat_g", label: "Trans Fat", names: ["trans fat", "trans fats"], unit: "g", floor: 0.05 },
  { key: "cholesterol_mg", label: "Cholesterol", names: ["cholesterol"], unit: "mg", floor: 1 },
  { key: "sodium_mg", label: "Sodium", names: ["sodium"], unit: "mg", floor: 1 },
  { key: "calcium_mg", label: "Calcium", names: ["calcium"], unit: "mg", floor: 1 },
];

/** Words that follow a nutrient name in a table row label, e.g. "Energy (Kcal)" or "Protein per 100g". */
export const UNIT_WORDS = new Set(["kcal", "kj", "g", "gm", "gms", "mg", "mcg", "per", "serve", "serving", "approx", "100g", "100"]);

export function describeNutrition(blocks: NutritionBlock[]): string {
  return blocks
    .map((b) => {
      const parts = NUTRIENTS.map((n) => {
        const v = b[n.key];
        return v === null || v === undefined ? null : `${n.label} ${v}${n.unit}`;
      }).filter(Boolean);
      return `per ${b.grammage}g: ${parts.join(", ")}`;
    })
    .join(" | ");
}
