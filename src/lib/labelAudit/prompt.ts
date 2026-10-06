export type AiReference = {
  productName: string;
  packSizeG: number | null;
  expectedMrp: number | null;
  version: string;
  usps: string[];
  ingredients: string;
  nutritionText: string;
  allergens: string;
  manufacturer: string;
};

const cut = (s: string, n: number) => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "Not provided";
  return t.length > n ? t.slice(0, n) + "..." : t;
};

export function buildAuditPrompt(r: AiReference): string {
  const size = r.packSizeG ? String(r.packSizeG) : "unknown";
  const unitPrice = r.expectedMrp && r.packSizeG ? (r.expectedMrp / r.packSizeG).toFixed(3) : null;
  const check = (label: string, expected = "", sop = false) =>
    `{"label":"${label}","status":"pass|fail|warn|skip","expected":"${expected}","found":"","note":"","sop_rule":${sop}}`;

  return [
    "You are a label auditor for Snackible. The attached image(s) are the pages of one packaging label. Read them carefully. Return ONLY a valid JSON object. No markdown, no explanation, no text before or after the JSON.",
    "",
    `PRODUCT: ${r.productName} | PACK: ${size}g | EXPECTED MRP: ${r.expectedMrp ? "₹" + r.expectedMrp : "not provided"}`,
    `LABEL VERSION / NOTES: ${cut(r.version, 120)}`,
    `USPs: ${cut(r.usps.join(" | "), 300)}`,
    `INGREDIENTS: ${cut(r.ingredients, 500)}`,
    `NUTRITION (sheet): ${cut(r.nutritionText, 700)}`,
    `ALLERGENS: ${cut(r.allergens, 200)}`,
    `MANUFACTURER: ${cut(r.manufacturer, 300)}`,
    "LONG DESCRIPTION: Not provided",
    "",
    "Statuses: pass, fail, warn (needs human review), skip (cannot be checked).",
    "Rules:",
    '- If a reference value is "Not provided", never mark pass or fail on it. Use skip and write what you see on the label in "found".',
    "- The sheet may cover only part of the label (for example one component of a combo pack, such as the dip but not the sticks). Do not fail for extra label content the reference does not cover; mention it in \"note\".",
    "- Report any spelling mistake you see in the label text (product name, ingredients, nutrient names) in the relevant check.",
    "SOP rules (set sop_rule true):",
    "- Step 3: a cooking method claim (Roasted/Baked/Popped) in the USPs MUST pair with Not Fried on the label. FAIL if missing; skip if the USPs have no cooking claim.",
    "- Step 6: first ingredient capitalised, the rest lowercase, and each ingredient list ends with a full stop.",
    `- Step 7: the label may show several columns (components, per serve, %RDA). Compare the column that matches a sheet value; say which column you used in "note".`,
    `- Step 8: if the serving size is larger than ${size}g, warn and use ${size}g as the reference.`,
    `- Step 9: ${unitPrice ? `MRP must be ₹${r.expectedMrp}; price per gram must be about ₹${unitPrice} (rounding to 2 decimals either way is fine)` : "extract the MRP from the label and note it"}.`,
    "- Step 10: every address must end with a full stop after the pincode.",
    "",
    "Return JSON with this exact structure (fill every field, keep values concise):",
    '{"product":"","pack_size":"","overall":"pass|fail|warn","steps":[' +
      [
        `{"step":2,"name":"Product Name","checks":[${check("Product name spelling")}]}`,
        `{"step":3,"name":"USPs","checks":[${check("USPs present")},${check("Not Fried pairing", "", true)}]}`,
        `{"step":4,"name":"Grammage","checks":[${check("Net weight", size + "g")}]}`,
        `{"step":5,"name":"Long Description","checks":[${check("Description vs USPs")}]}`,
        `{"step":6,"name":"Ingredients","checks":[${check("Ingredients match")},${check("Casing rule", "First capital, rest lowercase", true)},${check("Ends with full stop", ".", true)},${check("Allergen declaration")}]}`,
        `{"step":7,"name":"Nutritional Values","checks":[${check("Energy")},${check("Protein")},${check("Total Fat")},${check("Sodium")}]}`,
        `{"step":8,"name":"Serving Size","checks":[${check("Serving vs grammage", "Serving <= " + size + "g", true)}]}`,
        `{"step":9,"name":"MRP","checks":[${check("MRP value")},${check("Price per gram")}]}`,
        `{"step":10,"name":"Addresses","checks":[${check("Manufacturer address")},${check("Full stop after pincode", "PINCODE.", true)}]}`,
      ].join(",") +
      "]}",
  ].join("\n");
}
