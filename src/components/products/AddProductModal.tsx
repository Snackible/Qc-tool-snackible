"use client";

import { Fragment, useState } from "react";
import { NutritionBlock, RDABlock } from "../../lib/types";

const NUTRIENT_FIELDS: { label: string; key: keyof NutritionBlock; unit: string; rdaKey?: keyof RDABlock }[] = [
  { label: "Energy", key: "energy_kcal", unit: "kcal", rdaKey: "energy_pct" },
  { label: "Protein", key: "protein_g", unit: "g", rdaKey: "protein_pct" },
  { label: "Carbohydrates", key: "carbohydrate_g", unit: "g" },
  { label: "Total Sugar", key: "total_sugar_g", unit: "g" },
  { label: "Added Sugar", key: "added_sugar_g", unit: "g", rdaKey: "added_sugar_pct" },
  { label: "Dietary Fibre", key: "dietary_fibre_g", unit: "g", rdaKey: "dietary_fibre_pct" },
  { label: "Total Fat", key: "total_fat_g", unit: "g", rdaKey: "total_fat_pct" },
  { label: "Saturated Fat", key: "saturated_fat_g", unit: "g", rdaKey: "saturated_fat_pct" },
  { label: "Trans Fat", key: "trans_fat_g", unit: "g", rdaKey: "trans_fat_pct" },
  { label: "Sodium", key: "sodium_mg", unit: "mg", rdaKey: "sodium_pct" },
  { label: "Calcium", key: "calcium_mg", unit: "mg", rdaKey: "calcium_pct" },
];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 8,
  border: "1px solid var(--border)", background: "var(--bg-base)",
  color: "var(--text-primary)", fontSize: 13, outline: "none",
};
const labelStyle: React.CSSProperties = {
  display: "block", color: "var(--text-secondary)", fontSize: 11, fontWeight: 600,
  marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em",
};
const fieldWrap: React.CSSProperties = { marginBottom: 14 };

export default function AddProductModal({
  sheets,
  onClose,
  onAdded,
}: {
  sheets: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [sheet, setSheet] = useState(sheets[0] ?? "");
  const [customSheet, setCustomSheet] = useState("");
  const [useCustomSheet, setUseCustomSheet] = useState(sheets.length === 0);
  const [servingSize, setServingSize] = useState("100");
  const [smallPack, setSmallPack] = useState("");
  const [largePack, setLargePack] = useState("");
  const [mrp, setMrp] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [shelfLife, setShelfLife] = useState("");
  const [allergens, setAllergens] = useState("");
  const [claims, setClaims] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [nutrients, setNutrients] = useState<Record<string, string>>({});
  const [rdaPcts, setRdaPcts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSheet = useCustomSheet ? customSheet.trim() : sheet;

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Product name is required.");
    if (!effectiveSheet) return setError("Choose or enter a category.");
    const grammage = parseFloat(servingSize) || 100;

    const nutrition: NutritionBlock[] = [{
      grammage,
      energy_kcal: parseFloat(nutrients.energy_kcal) || 0,
      protein_g: parseFloat(nutrients.protein_g) || 0,
      carbohydrate_g: parseFloat(nutrients.carbohydrate_g) || 0,
      total_sugar_g: parseFloat(nutrients.total_sugar_g) || 0,
      added_sugar_g: nutrients.added_sugar_g ? parseFloat(nutrients.added_sugar_g) : null,
      dietary_fibre_g: nutrients.dietary_fibre_g ? parseFloat(nutrients.dietary_fibre_g) : null,
      total_fat_g: parseFloat(nutrients.total_fat_g) || 0,
      saturated_fat_g: nutrients.saturated_fat_g ? parseFloat(nutrients.saturated_fat_g) : null,
      unsaturated_fat_g: null,
      trans_fat_g: nutrients.trans_fat_g ? parseFloat(nutrients.trans_fat_g) : null,
      cholesterol_mg: null,
      sodium_mg: nutrients.sodium_mg ? parseFloat(nutrients.sodium_mg) : null,
      calcium_mg: nutrients.calcium_mg ? parseFloat(nutrients.calcium_mg) : null,
    }];

    const hasAnyRda = NUTRIENT_FIELDS.some((f) => f.rdaKey && rdaPcts[f.rdaKey]);
    const rda: RDABlock[] = hasAnyRda ? [{
      grammage,
      energy_pct: rdaPcts.energy_pct ? parseFloat(rdaPcts.energy_pct) : null,
      protein_pct: rdaPcts.protein_pct ? parseFloat(rdaPcts.protein_pct) : null,
      added_sugar_pct: rdaPcts.added_sugar_pct ? parseFloat(rdaPcts.added_sugar_pct) : null,
      dietary_fibre_pct: rdaPcts.dietary_fibre_pct ? parseFloat(rdaPcts.dietary_fibre_pct) : null,
      total_fat_pct: rdaPcts.total_fat_pct ? parseFloat(rdaPcts.total_fat_pct) : null,
      saturated_fat_pct: rdaPcts.saturated_fat_pct ? parseFloat(rdaPcts.saturated_fat_pct) : null,
      trans_fat_pct: rdaPcts.trans_fat_pct ? parseFloat(rdaPcts.trans_fat_pct) : null,
      sodium_pct: rdaPcts.sodium_pct ? parseFloat(rdaPcts.sodium_pct) : null,
      calcium_pct: rdaPcts.calcium_pct ? parseFloat(rdaPcts.calcium_pct) : null,
    }] : [];

    setSaving(true);
    try {
      const res = await fetch("/api/products/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet: effectiveSheet,
          name: name.trim(),
          brand_usp: claims.split("\n").map((s) => s.trim()).filter(Boolean),
          ingredients,
          nutrition,
          rda,
          serving_size_g: grammage,
          allergens,
          shelf_life: shelfLife,
          small_pack_g: smallPack ? parseFloat(smallPack) : null,
          large_pack_g: largePack ? parseFloat(largePack) : null,
          manufacturer,
          mrp,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to add product");
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }} />
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(100vw, 560px)", background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border)", zIndex: 61,
          overflowY: "auto", padding: "20px 20px 32px",
          display: "flex", flexDirection: "column", gap: 4,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>Add Product</h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20, padding: 4, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ background: "rgba(232,64,64,0.1)", border: "1px solid rgba(232,64,64,0.3)", borderRadius: 8, padding: 12, color: "var(--accent-red)", fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div style={fieldWrap}>
          <label style={labelStyle}>Product Name *</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Peri Peri Ragi Chips" />
        </div>

        <div style={fieldWrap}>
          <label style={labelStyle}>Category / Sheet *</label>
          {!useCustomSheet ? (
            <div style={{ display: "flex", gap: 8 }}>
              <select style={{ ...inputStyle, flex: 1 }} value={sheet} onChange={(e) => setSheet(e.target.value)}>
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setUseCustomSheet(true)}
                style={{ padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer" }}
              >
                New…
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...inputStyle, flex: 1 }} value={customSheet} onChange={(e) => setCustomSheet(e.target.value)} placeholder="New category name" />
              {sheets.length > 0 && (
                <button
                  type="button"
                  onClick={() => setUseCustomSheet(false)}
                  style={{ padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer" }}
                >
                  Choose existing
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={fieldWrap}>
            <label style={labelStyle}>Serving Size (g)</label>
            <input style={inputStyle} type="number" value={servingSize} onChange={(e) => setServingSize(e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>MRP</label>
            <input style={inputStyle} value={mrp} onChange={(e) => setMrp(e.target.value)} placeholder="e.g. ₹99" />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Small Pack (g)</label>
            <input style={inputStyle} type="number" value={smallPack} onChange={(e) => setSmallPack(e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Large Pack (g)</label>
            <input style={inputStyle} type="number" value={largePack} onChange={(e) => setLargePack(e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Manufacturer</label>
            <input style={inputStyle} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Shelf Life</label>
            <input style={inputStyle} value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} placeholder="e.g. 6 months" />
          </div>
        </div>

        <div style={fieldWrap}>
          <label style={labelStyle}>Allergens</label>
          <input style={inputStyle} value={allergens} onChange={(e) => setAllergens(e.target.value)} placeholder="e.g. Contains milk, soy" />
        </div>

        <div style={fieldWrap}>
          <label style={labelStyle}>Claims / Brand USP (one per line)</label>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} value={claims} onChange={(e) => setClaims(e.target.value)} placeholder={"Source of protein\nNo palm oil"} />
        </div>

        <div style={fieldWrap}>
          <label style={labelStyle}>Ingredients</label>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
        </div>

        <div style={{ ...fieldWrap, marginTop: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Nutrition — per {servingSize || "100"}g
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }} />
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textAlign: "center" }}>VALUE</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textAlign: "center" }}>%RDA</div>
            {NUTRIENT_FIELDS.map((f) => (
              <Fragment key={f.key}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{f.label} ({f.unit})</div>
                <input
                  type="number"
                  style={{ ...inputStyle, padding: "6px 8px", textAlign: "right" }}
                  value={nutrients[f.key] ?? ""}
                  onChange={(e) => setNutrients((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
                {f.rdaKey ? (
                  <input
                    type="number"
                    style={{ ...inputStyle, padding: "6px 8px", textAlign: "right" }}
                    value={rdaPcts[f.rdaKey] ?? ""}
                    onChange={(e) => setRdaPcts((prev) => ({ ...prev, [f.rdaKey as string]: e.target.value }))}
                  />
                ) : <div />}
              </Fragment>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ flex: 1, padding: "11px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            style={{ flex: 2, padding: "11px", borderRadius: 8, border: "none", background: "var(--accent-teal)", color: "#003433", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontSize: 13 }}
          >
            {saving ? "Saving…" : "Add Product"}
          </button>
        </div>
      </div>
    </>
  );
}
