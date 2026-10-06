"use client";

import { useEffect, useState, useCallback } from "react";
import { Product, NutritionBlock, RDABlock, ProductStatus } from "../../lib/types";
import StatusDropdown from "../../components/shared/StatusDropdown";
import AddProductModal from "../../components/products/AddProductModal";
import Icon from "../../components/ui/Icon";

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

// claim tag: squarer than a pill so it reads as a label rather than a button
function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        background: "rgba(6,170,144,0.11)",
        boxShadow: "inset 0 0 0 1px rgba(6,170,144,0.2)",
        color: "var(--accent-teal-bright)",
        lineHeight: 1.35,
      }}
    >
      {label}
    </span>
  );
}

function SheetBadge({ sheet }: { sheet: string }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "var(--tint-2)", color: "var(--text-secondary)" }}>
      {sheet}
    </span>
  );
}

const sectionLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 };

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
        <div style={{ ...sectionLabel, marginBottom: 0, fontFamily: "var(--font-display)", fontSize: 15, color: "var(--text-primary)", fontWeight: 600 }}>
          Nutritional information
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
                style={{ ...btnStyle, background: "var(--accent-teal)", color: "var(--on-accent)", borderColor: "var(--accent-teal)" }}
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
                          aria-label={`Remove ${nb.grammage}g column`}
                          style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", padding: 0, lineHeight: 1, display: "inline-flex" }}
                        >
                          <Icon name="x" size={13} />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                {editMode && (
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                    <button onClick={addColumn} title="Add a pack size" style={{ ...btnStyle, padding: "3px 9px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Icon name="plus" size={12} /> Add
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {NUTRIENT_ROWS.map(({ label, key, unit }, rowIdx) => (
                <tr key={key} style={{ background: rowIdx % 2 === 0 ? "transparent" : "var(--tint-1)" }}>
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
        className="fade-in"
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "var(--overlay)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", zIndex: 140 }}
      />
      {/* Drawer */}
      <aside
        className="slide-in-right"
        aria-label={product.name}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(100vw, 520px)",
          background: "var(--drawer-bg)",
          borderLeft: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-drawer)",
          zIndex: 150, overflowY: "auto", padding: "22px 22px 32px",
          display: "flex", flexDirection: "column", gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ marginBottom: 8 }}><SheetBadge sheet={product.sheet} /></div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.15, color: "var(--text-primary)" }}>
              {product.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ flexShrink: 0, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "var(--tint-2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* USP chips */}
        {product.brand_usp.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {product.brand_usp.map((usp, i) => (
              <Chip key={i} label={usp} />
            ))}
          </div>
        )}

        {/* MRP + pack sizes */}
        {(product.mrp || packSizes.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, color: "var(--text-secondary)", fontSize: 13.5 }}>
            {product.mrp && (
              <div>
                <div style={sectionLabel}>MRP</div>
                <div style={{ color: "var(--text-primary)", fontWeight: 500, whiteSpace: "pre-line" }}>{product.mrp}</div>
              </div>
            )}
            {packSizes.length > 0 && (
              <div>
                <div style={sectionLabel}>Pack sizes</div>
                <div className="mono" style={{ color: "var(--text-primary)" }}>{packSizes.join(" · ")}</div>
              </div>
            )}
          </div>
        )}

        {/* Allergens */}
        {product.allergens && (
          <div style={{
            background: "rgba(232,64,64,0.09)", borderRadius: 10,
            padding: "12px 14px", boxShadow: "inset 0 0 0 1px rgba(232,64,64,0.26)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--red-text)", marginBottom: 4 }}>
              <Icon name="alert" size={14} /> Allergens
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 13.5 }}>{product.allergens}</div>
          </div>
        )}

        {/* Ingredients */}
        {product.ingredients && (
          <div>
            <div style={sectionLabel}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          {product.manufacturer && (
            <div>
              <div style={sectionLabel}>Manufacturer</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 13, whiteSpace: "pre-line" }}>{product.manufacturer.trim()}</div>
            </div>
          )}
          {product.shelf_life && (
            <div>
              <div style={sectionLabel}>Shelf life</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>{product.shelf_life}</div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function ProductCard({
  product,
  index,
  onClick,
  onStatusChange,
}: {
  product: Product;
  index: number;
  onClick: () => void;
  onStatusChange: (product: Product, status: ProductStatus) => Promise<void>;
}) {
  const packSizes: string[] = [];
  if (product.small_pack_g) packSizes.push(`${product.small_pack_g}g`);
  if (product.large_pack_g) packSizes.push(`${product.large_pack_g}g`);
  const extra = product.brand_usp.length - 3;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className="surface card-lift fade-up"
      style={{ ["--i" as string]: Math.min(index, 14), padding: 18, cursor: "pointer", display: "flex", flexDirection: "column", gap: 14, minHeight: 168 }}
    >
      <div>
        <div className="eyebrow">{product.sheet}</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, lineHeight: 1.2, letterSpacing: "-0.02em", marginTop: 5 }}>
          {product.name}
        </div>
      </div>

      {product.brand_usp.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {product.brand_usp.slice(0, 3).map((usp, i) => (
            <Chip key={i} label={usp} />
          ))}
          {extra > 0 && <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>+{extra} more</span>}
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="mono" style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{packSizes.length ? packSizes.join(" · ") : "No pack size"}</span>
        <StatusDropdown value={product.status} onChange={(status) => onStatusChange(product, status)} />
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
  const [showAddModal, setShowAddModal] = useState(false);

  const loadProducts = useCallback(() => {
    setLoading(true);
    return fetch("/api/products")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(data);
          setError(null);
        } else {
          setError(data.error || "Unknown error");
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

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
    <div style={{ padding: "var(--page-pad)", paddingBottom: 56 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Product library</h1>
          <p className="page-sub">
            {loading ? "Loading products…" : `${filtered.length} of ${products.length} products`}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "11px 18px", borderRadius: 10, border: "none",
            background: "var(--btn-primary)", color: "var(--on-accent)",
            boxShadow: "var(--shadow-btn)",
            fontWeight: 700, fontSize: 14, whiteSpace: "nowrap",
          }}
        >
          <Icon name="plus" size={16} strokeWidth={2} /> Add product
        </button>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 14 }}>
        <Icon name="search" size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
        <input
          type="search"
          aria-label="Search products or claims"
          placeholder="Search products or claims"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "13px 16px 13px 42px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--field-bg)",
            color: "var(--text-primary)",
            fontSize: 15,
            outline: "none",
          }}
        />
      </div>

      {/* Category filters */}
      <div role="group" aria-label="Filter by category" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
        {sheets.map((sheet) => {
          const isActive = activeSheets.has(sheet);
          const count = products.filter((p) => p.sheet === sheet).length;
          return (
            <button
              key={sheet}
              onClick={() => toggleSheet(sheet)}
              aria-pressed={isActive}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "7px 8px 7px 14px",
                borderRadius: 10,
                border: `1px solid ${isActive ? "var(--accent-teal)" : "var(--border)"}`,
                background: isActive ? "rgba(6,170,144,0.2)" : "var(--tint-1)",
                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                fontSize: 13.5,
                fontWeight: 500,
              }}
            >
              {sheet}
              <span className="mono" style={{ minWidth: 22, padding: "1px 6px", borderRadius: 6, fontSize: 11.5, textAlign: "center", background: isActive ? "rgba(6,170,144,0.35)" : "var(--tint-2)", color: isActive ? "var(--teal-text)" : "var(--text-muted)" }}>
                {count}
              </span>
            </button>
          );
        })}
        {activeSheets.size > 0 && (
          <button
            onClick={() => setActiveSheets(new Set())}
            style={{ padding: "7px 12px", borderRadius: 10, border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 13.5, textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div role="alert" style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(232,64,64,0.1)", boxShadow: "inset 0 0 0 1px rgba(232,64,64,0.32)", borderRadius: 12, padding: "14px 16px", color: "var(--red-text)", marginBottom: 24, fontSize: 14 }}>
            <Icon name="alert-circle" size={18} style={{ marginTop: 1 }} />
            <span>Couldn&apos;t load products. {error}</span>
          </div>
        )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="surface" style={{ padding: 18, minHeight: 168, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="skeleton" style={{ borderRadius: 6, height: 11, width: "34%" }} />
              <div className="skeleton" style={{ borderRadius: 6, height: 20, width: "78%" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <div className="skeleton" style={{ borderRadius: 6, height: 22, width: 84 }} />
                <div className="skeleton" style={{ borderRadius: 6, height: 22, width: 64 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
          {filtered.map((product, i) => (
            <ProductCard
              key={product.id}
              product={product}
              index={i}
              onClick={() => setSelectedProduct(product)}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="surface" style={{ padding: "48px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(6,170,144,0.12)", color: "var(--accent-teal-bright)" }}>
            <Icon name="search" size={22} />
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600 }}>
            {products.length === 0 ? "No products yet" : "Nothing matches that"}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 360 }}>
            {products.length === 0
              ? "Add your first product to start building the library."
              : "Try a different search term, or clear the category filters."}
          </div>
          {products.length > 0 && (search || activeSheets.size > 0) && (
            <button
              onClick={() => { setSearch(""); setActiveSheets(new Set()); }}
              style={{ marginTop: 6, padding: "9px 16px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}
            >
              Reset search and filters
            </button>
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

      {/* Add Product */}
      {showAddModal && (
        <AddProductModal
          sheets={sheets}
          onClose={() => setShowAddModal(false)}
          onAdded={loadProducts}
        />
      )}
    </div>
  );
}
