"use client";

import { useEffect, useState, useCallback } from "react";
import { Product, NutritionBlock, RDABlock, ProductStatus } from "../../lib/types";
import StatusDropdown from "../../components/shared/StatusDropdown";

const NUTRIENT_ROWS: { label: string; key: keyof NutritionBlock; unit: string }[] = [
  { label: "Energy", key: "energy_kcal", unit: "kcal" },
  { label: "Protein", key: "protein_g", unit: "g" },
  { label: "Carbohydrates", key: "carbohydrate_g", unit: "g" },
  { label: "Total Sugar", key: "total_sugar_g", unit: "g" },
  { label: "Added Sugar", key: "added_sugar_g", unit: "g" },
  { label: "Dietary Fibre", key: "dietary_fibre_g", unit: "g" },
  { label: "Total Fat", key: "total_fat_g", unit: "g" },
  { label: "Saturated Fat", key: "saturated_fat_g", unit: "g" },
  { label: "Trans Fat", key: "trans_fat_g", unit: "g" },
  { label: "Sodium", key: "sodium_mg", unit: "mg" },
  { label: "Calcium", key: "calcium_mg", unit: "mg" },
];

// Map nutrient key to RDA block key
const RDA_KEY_MAP: Partial<Record<keyof NutritionBlock, keyof RDABlock>> = {
  energy_kcal: "energy_pct",
  protein_g: "protein_pct",
  added_sugar_g: "added_sugar_pct",
  dietary_fibre_g: "dietary_fibre_pct",
  total_fat_g: "total_fat_pct",
  saturated_fat_g: "saturated_fat_pct",
  trans_fat_g: "trans_fat_pct",
  sodium_mg: "sodium_pct",
  calcium_mg: "calcium_pct",
};

function fmtVal(val: number | null | undefined, unit: string): string {
  if (val === null || val === undefined) return "—";
  return `${val}${unit}`;
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: `${color}26`,
        color,
        marginRight: 4,
        marginBottom: 4,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SheetBadge({ sheet }: { sheet: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        background: "rgba(6,170,144,0.12)",
        color: "var(--accent-teal)",
        letterSpacing: "0.03em",
        textTransform: "uppercase",
      }}
    >
      {sheet}
    </span>
  );
}

function emptyNutritionBlock(grammage: number): NutritionBlock {
  return {
    grammage,
    energy_kcal: 0,
    protein_g: 0,
    carbohydrate_g: 0,
    total_sugar_g: 0,
    added_sugar_g: null,
    dietary_fibre_g: null,
    total_fat_g: 0,
    saturated_fat_g: null,
    unsaturated_fat_g: null,
    trans_fat_g: null,
    cholesterol_mg: null,
    sodium_mg: null,
    calcium_mg: null,
  };
}

function emptyRDABlock(grammage: number): RDABlock {
  return {
    grammage,
    energy_pct: null,
    protein_pct: null,
    added_sugar_pct: null,
    dietary_fibre_pct: null,
    total_fat_pct: null,
    saturated_fat_pct: null,
    trans_fat_pct: null,
    sodium_pct: null,
    calcium_pct: null,
  };
}

// In edit mode every nutrition column always has a matching RDA block (even if all null),
// so cells never have to fall back to the "calculated from nearest grammage" interpolation.
function alignedRda(nutrition: NutritionBlock[], rda: RDABlock[]): RDABlock[] {
  return nutrition.map((nb) => rda.find((r) => r.grammage === nb.grammage) ?? emptyRDABlock(nb.grammage));
}

function NutritionSection({
  product,
  onSave,
}: {
  product: Product;
  onSave: (nutrition: NutritionBlock[], rda: RDABlock[] | null) => Promise<void>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [draftNutrition, setDraftNutrition] = useState<NutritionBlock[]>([]);
  const [draftRda, setDraftRda] = useState<RDABlock[]>([]);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraftNutrition(product.nutrition.map((nb) => ({ ...nb })));
    setDraftRda(alignedRda(product.nutrition, product.rda));
    setEditMode(true);
  };

  const cancelEdit = () => setEditMode(false);

  const removeColumn = (grammage: number) => {
    if (grammage === 100) return; // 100g is the standardized reference — always kept
    setDraftNutrition((prev) => prev.filter((nb) => nb.grammage !== grammage));
    setDraftRda((prev) => prev.filter((rb) => rb.grammage !== grammage));
  };

  const addColumn = () => {
    const raw = window.prompt("Pack size for the new column (grams)?");
    if (!raw) return;
    const grammage = parseFloat(raw);
    if (isNaN(grammage) || grammage <= 0) {
      alert("Enter a valid grammage in grams.");
      return;
    }
    if (draftNutrition.some((nb) => nb.grammage === grammage)) {
      alert(`A ${grammage}g column already exists.`);
      return;
    }
    setDraftNutrition((prev) => [...prev, emptyNutritionBlock(grammage)].sort((a, b) => a.grammage - b.grammage));
    setDraftRda((prev) => [...prev, emptyRDABlock(grammage)].sort((a, b) => a.grammage - b.grammage));
  };

  const updateNutrientValue = (grammage: number, key: keyof NutritionBlock, raw: string) => {
    const value = raw === "" ? null : parseFloat(raw);
    setDraftNutrition((prev) =>
      prev.map((nb) => (nb.grammage === grammage ? { ...nb, [key]: value === null || isNaN(value) ? null : value } : nb))
    );
  };

  const updateRdaValue = (grammage: number, key: keyof RDABlock, raw: string) => {
    const value = raw === "" ? null : parseFloat(raw);
    setDraftRda((prev) =>
      prev.map((rb) => (rb.grammage === grammage ? { ...rb, [key]: value === null || isNaN(value) ? null : value } : rb))
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draftNutrition, draftRda);
      setEditMode(false);
    } catch (e) {
      alert(`Could not save nutrition table: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const resetToSheetData = async () => {
    if (!confirm("Discard the customized nutrition table and go back to the sheet's original data?")) return;
    setSaving(true);
    try {
      await onSave([], null);
      setEditMode(false);
    } catch (e) {
      alert(`Could not reset nutrition table: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const columns = editMode ? draftNutrition : product.nutrition;
  const rdaColumns = editMode ? draftRda : product.rda;

  if (columns.length === 0 && !editMode) return null;

  const btnStyle: React.CSSProperties = {
    padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
    border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
  };
  const cellInputStyle: React.CSSProperties = {
    width: 64, padding: "3px 5px", borderRadius: 4, border: "1px solid var(--border)",
    background: "var(--bg-base)", color: "var(--text-primary)", fontSize: 12, textAlign: "right",
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Nutritional Information
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!editMode && product.hasCustomNutrition && (
            <button onClick={resetToSheetData} disabled={saving} style={{ ...btnStyle, color: "var(--accent-red)", borderColor: "rgba(232,64,64,0.4)" }}>
              Reset to sheet data
            </button>
          )}
          {!editMode ? (
            <button onClick={startEdit} style={{ ...btnStyle, color: "var(--accent-teal)", borderColor: "var(--accent-teal)" }}>
              Customize
            </button>
          ) : (
            <>
              <button onClick={cancelEdit} disabled={saving} style={btnStyle}>Cancel</button>
              <button
                onClick={save}
                disabled={saving}
                style={{ ...btnStyle, background: "var(--accent-teal)", color: "#003433", borderColor: "var(--accent-teal)" }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      {columns.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{
                  textAlign: "left", padding: "8px 10px", color: "var(--text-muted)",
                  fontWeight: 500, borderBottom: "1px solid var(--border)", minWidth: 110,
                }}>
                  Nutrient
                </th>
                {columns.map((nb) => (
                  <th
                    key={nb.grammage}
                    style={{
                      textAlign: "right", padding: "8px 10px",
                      background: nb.grammage === 100 ? "rgba(6,170,144,0.15)" : "transparent",
                      color: nb.grammage === 100 ? "var(--accent-teal)" : "var(--text-secondary)",
                      fontWeight: 600,
                      borderBottom: "1px solid var(--border)",
                      minWidth: 70,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      {nb.grammage}g
                      {editMode && nb.grammage !== 100 && (
                        <button
                          onClick={() => removeColumn(nb.grammage)}
                          title="Remove this pack size"
                          style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                {editMode && (
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                    <button onClick={addColumn} title="Add a pack size" style={{ ...btnStyle, padding: "2px 8px" }}>
                      + Add
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {NUTRIENT_ROWS.map(({ label, key, unit }, rowIdx) => (
                <tr key={key} style={{ background: rowIdx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "7px 10px", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                    {label}
                  </td>
                  {columns.map((nb) => {
                    const raw = nb[key];
                    return (
                      <td
                        key={nb.grammage}
                        style={{
                          padding: "7px 10px", textAlign: "right",
                          color: "var(--text-primary)",
                          fontVariantNumeric: "tabular-nums",
                          borderBottom: "1px solid var(--border)",
                          background: nb.grammage === 100 ? "rgba(6,170,144,0.04)" : "transparent",
                        }}
                      >
                        {editMode ? (
                          <input
                            type="number"
                            value={raw === null || raw === undefined ? "" : raw}
                            onChange={(e) => updateNutrientValue(nb.grammage, key, e.target.value)}
                            style={cellInputStyle}
                          />
                        ) : (
                          fmtVal(raw as number | null, unit)
                        )}
                      </td>
                    );
                  })}
                  {editMode && <td style={{ borderBottom: "1px solid var(--border)" }} />}
                </tr>
              ))}
              {/* RDA % section header + grammage sub-header */}
              <tr>
                <td colSpan={columns.length + 1 + (editMode ? 1 : 0)} style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", background: "var(--bg-elevated)" }}>
                  % RDA
                </td>
              </tr>
              <tr style={{ background: "var(--bg-elevated)" }}>
                <td style={{ padding: "4px 10px", color: "var(--text-muted)", fontSize: 10 }} />
                {columns.map((nb) => (
                  <td key={nb.grammage} style={{ padding: "4px 10px", textAlign: "right", color: "var(--text-muted)", fontSize: 10, fontWeight: 600, borderBottom: "1px solid var(--border)" }}>
                    {nb.grammage}g
                  </td>
                ))}
                {editMode && <td style={{ borderBottom: "1px solid var(--border)" }} />}
              </tr>
              {NUTRIENT_ROWS.map(({ label, key }) => {
                const rdaKey = RDA_KEY_MAP[key];
                if (!rdaKey) return null;
                return (
                  <tr key={`rda-${key}`} style={{ background: "rgba(6,170,144,0.03)" }}>
                    <td style={{ padding: "6px 10px", color: "var(--text-muted)", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                      {label} %RDA
                    </td>
                    {columns.map((nb) => {
                      if (editMode) {
                        const rb = rdaColumns.find((r) => r.grammage === nb.grammage);
                        const val = rb ? (rb[rdaKey] as number | null) : null;
                        return (
                          <td key={nb.grammage} style={{ padding: "6px 10px", textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                            <input
                              type="number"
                              value={val === null || val === undefined ? "" : val}
                              onChange={(e) => updateRdaValue(nb.grammage, rdaKey, e.target.value)}
                              style={cellInputStyle}
                            />
                          </td>
                        );
                      }

                      // Exact match first
                      const exactBlock = rdaColumns.find((r) => Math.abs(r.grammage - nb.grammage) < 0.5);
                      let pct: number | null = exactBlock ? (exactBlock[rdaKey] as number | null) : null;
                      let isCalculated = false;

                      // No exact match — scale from nearest grammage that has a value
                      if (pct === null) {
                        const source = rdaColumns
                          .filter((r) => (r[rdaKey] as number | null) !== null)
                          .reduce<RDABlock | undefined>((best, rb) => {
                            if (!best) return rb;
                            return Math.abs(rb.grammage - nb.grammage) < Math.abs(best.grammage - nb.grammage) ? rb : best;
                          }, undefined);
                        if (source) {
                          const srcPct = source[rdaKey] as number | null;
                          if (srcPct !== null && source.grammage > 0) {
                            pct = parseFloat((srcPct * (nb.grammage / source.grammage)).toFixed(1));
                            isCalculated = true;
                          }
                        }
                      }

                      return (
                        <td
                          key={nb.grammage}
                          style={{
                            padding: "6px 10px", textAlign: "right",
                            color: isCalculated ? "var(--text-muted)" : "var(--text-secondary)",
                            fontSize: 11,
                            fontVariantNumeric: "tabular-nums",
                            borderBottom: "1px solid var(--border)",
                          }}
                          title={isCalculated ? `Calculated from ${rdaColumns.find(r => (r[rdaKey] as number | null) !== null)?.grammage}g RDA data` : undefined}
                        >
                          {pct !== null ? `${pct}%${isCalculated ? "*" : ""}` : "—"}
                        </td>
                      );
                    })}
                    {editMode && <td style={{ borderBottom: "1px solid var(--border)" }} />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProductDrawer({
  product,
  onClose,
  onNutritionSave,
}: {
  product: Product;
  onClose: () => void;
  onNutritionSave: (product: Product, nutrition: NutritionBlock[], rda: RDABlock[] | null) => Promise<void>;
}) {
  const [showFullIngredients, setShowFullIngredients] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const packSizes: string[] = [];
  if (product.small_pack_g) packSizes.push(`${product.small_pack_g}g`);
  if (product.large_pack_g) packSizes.push(`${product.large_pack_g}g`);

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40,
        }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: 480, background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border)",
          zIndex: 50, overflowY: "auto", padding: 24,
          display: "flex", flexDirection: "column", gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-primary)", flex: 1, marginRight: 12 }}>
            {product.name}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", fontSize: 20, padding: 4, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* USP chips */}
        {product.brand_usp.length > 0 && (
          <div>
            {product.brand_usp.map((usp, i) => (
              <Chip key={i} label={usp} color="var(--accent-teal)" />
            ))}
          </div>
        )}

        {/* Sheet + MRP row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SheetBadge sheet={product.sheet} />
          {product.mrp && (
            <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              MRP: <strong style={{ color: "var(--text-primary)" }}>{product.mrp}</strong>
            </span>
          )}
          {packSizes.length > 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {packSizes.join(" · ")}
            </span>
          )}
        </div>

        {/* Allergens */}
        {product.allergens && (
          <div style={{
            background: "rgba(232,64,64,0.08)", borderRadius: 8,
            padding: "10px 14px", border: "1px solid rgba(232,64,64,0.2)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-red)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Allergens
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>{product.allergens}</div>
          </div>
        )}

        {/* Ingredients */}
        {product.ingredients && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Ingredients
            </div>
            <div
              style={{
                color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: showFullIngredients ? "unset" : 2,
              } as React.CSSProperties}
            >
              {product.ingredients}
            </div>
            {product.ingredients.length > 120 && (
              <button
                onClick={() => setShowFullIngredients(!showFullIngredients)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--accent-teal)", fontSize: 12, padding: "4px 0", marginTop: 4,
                }}
              >
                {showFullIngredients ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        {/* Nutrition Table */}
        <NutritionSection
          product={product}
          onSave={(nutrition, rda) => onNutritionSave(product, nutrition, rda)}
        />

        {/* Manufacturer + Shelf Life */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {product.manufacturer && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Manufacturer
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{product.manufacturer}</div>
            </div>
          )}
          {product.shelf_life && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Shelf Life
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{product.shelf_life}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ProductCard({
  product,
  onClick,
  onStatusChange,
}: {
  product: Product;
  onClick: () => void;
  onStatusChange: (product: Product, status: ProductStatus) => Promise<void>;
}) {
  const packSizes: string[] = [];
  if (product.small_pack_g) packSizes.push(`${product.small_pack_g}g`);
  if (product.large_pack_g) packSizes.push(`${product.large_pack_g}g`);

  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 24,
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(6,170,144,0.4)";
        (e.currentTarget as HTMLDivElement).style.background = "var(--bg-elevated)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
        (e.currentTarget as HTMLDivElement).style.background = "var(--bg-surface)";
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)", marginBottom: 10, lineHeight: 1.3 }}>
        {product.name}
      </div>

      {/* USP chips (max 3) */}
      <div style={{ marginBottom: 10 }}>
        {product.brand_usp.slice(0, 3).map((usp, i) => (
          <Chip key={i} label={usp} color="var(--accent-teal)" />
        ))}
      </div>

      {/* Pack sizes */}
      {packSizes.length > 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 10 }}>
          {packSizes.join(" · ")}
        </div>
      )}

      {/* Status dropdown bottom right */}
      <div style={{ position: "absolute", bottom: 14, right: 14 }}>
        <StatusDropdown
          value={product.status}
          onChange={(status) => onStatusChange(product, status)}
        />
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeSheets, setActiveSheets] = useState<Set<string>>(new Set());
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(data);
        } else {
          setError(data.error || "Unknown error");
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const sheets = Array.from(new Set(products.map((p) => p.sheet)));

  const toggleSheet = useCallback((sheet: string) => {
    setActiveSheets((prev) => {
      const next = new Set(prev);
      if (next.has(sheet)) next.delete(sheet);
      else next.add(sheet);
      return next;
    });
  }, []);

  const handleStatusChange = useCallback(async (product: Product, status: ProductStatus) => {
    const previous = product.status;
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, status } : p)));

    try {
      const res = await fetch("/api/products/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet: product.sheet, name: product.name, status }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to update status");
    } catch (e) {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, status: previous } : p)));
      alert(`Could not update status: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const handleNutritionSave = useCallback(
    async (product: Product, nutrition: NutritionBlock[], rda: RDABlock[] | null) => {
      const res = await fetch("/api/products/nutrition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet: product.sheet,
          name: product.name,
          nutrition: rda === null ? null : nutrition,
          rda: rda === null ? null : rda,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to save nutrition table");

      if (rda === null) {
        // Reset — the sheet-derived values live server-side only, so re-fetch to get them back.
        const refreshed = await fetch("/api/products").then((r) => r.json());
        if (Array.isArray(refreshed)) {
          setProducts(refreshed);
          const match = refreshed.find((p: Product) => p.id === product.id);
          if (match) setSelectedProduct(match);
        }
        return;
      }

      const updated: Product = { ...product, nutrition, rda, hasCustomNutrition: true };
      setProducts((prev) => prev.map((p) => (p.id === product.id ? updated : p)));
      setSelectedProduct((prev) => (prev && prev.id === product.id ? updated : prev));
    },
    []
  );

  const filtered = products.filter((p) => {
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.brand_usp.some((u) => u.toLowerCase().includes(search.toLowerCase()));
    const matchSheet = activeSheets.size === 0 || activeSheets.has(p.sheet);
    return matchSearch && matchSheet;
  });

  return (
    <div style={{ padding: 32, minHeight: "100vh" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
          Product Library
        </h1>
        <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
          {loading ? "Loading…" : `${filtered.length} products`}
        </p>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search products or claims…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          fontSize: 14,
          marginBottom: 16,
          outline: "none",
        }}
      />

      {/* Sheet filter chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
        {sheets.map((sheet) => {
          const isActive = activeSheets.has(sheet);
          return (
            <button
              key={sheet}
              onClick={() => toggleSheet(sheet)}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-surface)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-elevated)";
              }}
              style={{
                padding: "8px 18px",
                borderRadius: 999,
                border: `1px solid ${isActive ? "var(--accent-teal)" : "var(--border)"}`,
                background: isActive ? "rgba(6,170,144,0.18)" : "var(--bg-elevated)",
                color: isActive ? "var(--accent-teal)" : "var(--text-primary)",
                fontSize: 13,
                fontWeight: isActive ? 700 : 600,
                letterSpacing: "0.01em",
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s, border-color 0.15s",
              }}
            >
              {sheet}
            </button>
          );
        })}
        {activeSheets.size > 0 && (
          <button
            onClick={() => setActiveSheets(new Set())}
            style={{
              padding: "8px 18px", borderRadius: 999,
              border: "1px dashed var(--border)", background: "transparent",
              color: "var(--text-muted)", fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "rgba(232,64,64,0.1)", border: "1px solid rgba(232,64,64,0.3)", borderRadius: 8, padding: 16, color: "var(--accent-red)", marginBottom: 24 }}>
          Error: {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, height: 140 }}>
              <div style={{ background: "var(--bg-elevated)", borderRadius: 6, height: 16, width: "70%", marginBottom: 12, animation: "pulse 1.5s infinite" }} />
              <div style={{ background: "var(--bg-elevated)", borderRadius: 6, height: 12, width: "50%", marginBottom: 8 }} />
              <div style={{ background: "var(--bg-elevated)", borderRadius: 6, height: 12, width: "40%" }} />
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onClick={() => setSelectedProduct(product)}
              onStatusChange={handleStatusChange}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
              No products found.
            </div>
          )}
        </div>
      )}

      {/* Drawer */}
      {selectedProduct && (
        <ProductDrawer
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onNutritionSave={handleNutritionSave}
        />
      )}
    </div>
  );
}
