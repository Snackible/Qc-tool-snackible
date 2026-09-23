"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { Product, NutritionBlock, RDABlock } from "../../lib/types";

const LabelPreview = dynamic(() => import("./LabelPreview"), { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────

type OCRResult = {
  nutrition_table: Partial<Record<string, number | null>>;
  rda_table: Partial<Record<string, number | null>>;
  serving_size_g: number;
  barcode: string | null;
  allergens_declared: string[];
  claims_on_pack: string[];
  fssai_license: string | null;
  mrp: string | null;
  net_weight: string | null;
};

type NutrientRow = {
  label: string;
  masterKey: keyof NutritionBlock;
  ocrKey: string;
  rdaKey: keyof RDABlock | null;
  unit: string;
  absFloor: number;
};

const NUTRIENT_ROWS: NutrientRow[] = [
  { label: "Energy",        masterKey: "energy_kcal",     ocrKey: "energy_kcal",     rdaKey: "energy_pct",        unit: "kcal", absFloor: 1 },
  { label: "Protein",       masterKey: "protein_g",       ocrKey: "protein_g",       rdaKey: "protein_pct",       unit: "g",    absFloor: 0.05 },
  { label: "Carbohydrates", masterKey: "carbohydrate_g",  ocrKey: "carbohydrate_g",  rdaKey: null,                unit: "g",    absFloor: 0.05 },
  { label: "Total Sugar",   masterKey: "total_sugar_g",   ocrKey: "total_sugar_g",   rdaKey: null,                unit: "g",    absFloor: 0.05 },
  { label: "Added Sugar",   masterKey: "added_sugar_g",   ocrKey: "added_sugar_g",   rdaKey: "added_sugar_pct",   unit: "g",    absFloor: 0.05 },
  { label: "Dietary Fibre", masterKey: "dietary_fibre_g", ocrKey: "dietary_fibre_g", rdaKey: "dietary_fibre_pct", unit: "g",    absFloor: 0.05 },
  { label: "Total Fat",     masterKey: "total_fat_g",     ocrKey: "total_fat_g",     rdaKey: "total_fat_pct",     unit: "g",    absFloor: 0.05 },
  { label: "Saturated Fat", masterKey: "saturated_fat_g", ocrKey: "saturated_fat_g", rdaKey: "saturated_fat_pct", unit: "g",    absFloor: 0.05 },
  { label: "Trans Fat",     masterKey: "trans_fat_g",     ocrKey: "trans_fat_g",     rdaKey: "trans_fat_pct",     unit: "g",    absFloor: 0.05 },
  { label: "Sodium",        masterKey: "sodium_mg",       ocrKey: "sodium_mg",       rdaKey: "sodium_pct",        unit: "mg",   absFloor: 1 },
  { label: "Calcium",       masterKey: "calcium_mg",      ocrKey: "calcium_mg",      rdaKey: "calcium_pct",       unit: "mg",   absFloor: 1 },
];

const ALLERGEN_KEYWORDS: { name: string; patterns: RegExp[] }[] = [
  { name: "Wheat / Gluten", patterns: [/wheat/i, /gluten/i, /maida/i, /atta/i] },
  { name: "Milk / Dairy",   patterns: [/milk/i, /dairy/i, /whey/i, /lactose/i, /butter/i, /cream/i, /cheese/i, /casein/i] },
  { name: "Soya / Soy",     patterns: [/soy/i, /soya/i] },
  { name: "Peanut",         patterns: [/peanut/i, /groundnut/i] },
  { name: "Tree Nuts",      patterns: [/almond/i, /cashew/i, /walnut/i, /pistachio/i, /hazelnut/i, /pecan/i, /macadamia/i] },
  { name: "Mustard",        patterns: [/mustard/i] },
  { name: "Sesame",         patterns: [/sesame/i, /til/i] },
];

function detectAllergens(ingredients: string): string[] {
  return ALLERGEN_KEYWORDS
    .filter(({ patterns }) => patterns.some((p) => p.test(ingredients)))
    .map(({ name }) => name);
}

type CompStatus = "PASS" | "WARNING" | "CRITICAL";

function calcStatus(master: number, servingSizeData: number, absFloor: number): CompStatus {
  const absDiff = Math.abs(master - servingSizeData);
  if (absDiff <= absFloor) return "PASS";
  const deviation = master !== 0 ? (absDiff / Math.abs(master)) * 100 : 100;
  if (deviation > 15) return "CRITICAL";
  if (deviation >= 2) return "WARNING";
  return "PASS";
}

function StatusChip({ status }: { status: CompStatus }) {
  const map = {
    PASS:     { bg: "rgba(6,170,144,0.15)",  color: "#06AA90", label: "PASS" },
    WARNING:  { bg: "rgba(255,192,0,0.15)",  color: "#FFC000", label: "WARNING" },
    CRITICAL: { bg: "rgba(232,64,64,0.15)", color: "#E84040", label: "CRITICAL" },
  };
  const s = map[status];
  return (
    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// ─── Step 1: Product / Grammage Select ───────────────────────────────────────

function Step1({ products, onProceed }: { products: Product[]; onProceed: (p: Product, g: number) => void }) {
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [grammage, setGrammage] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 20);

  const masterBlock = selected?.nutrition.find((nb) => nb.grammage === grammage);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px" }}>
      <h1 style={{ fontSize: "clamp(18px, 5vw, 22px)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>Label QC</h1>
      <p style={{ color: "var(--text-muted)", marginBottom: 28, fontSize: "13px" }}>
        Select a product and grammage, then upload a label to compare against master data.
      </p>

      <label style={{ display: "block", color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Product
      </label>
      <div style={{ position: "relative" }} ref={dropdownRef}>
        <input
          type="text"
          placeholder="Search product name…"
          value={selected ? selected.name : search}
          onChange={(e) => { setSearch(e.target.value); setSelected(null); setGrammage(null); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 14, outline: "none" }}
        />
        {showDropdown && filtered.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, zIndex: 100, maxHeight: 240, overflowY: "auto", marginTop: 4 }}>
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => { setSelected(p); setSearch(p.name); setShowDropdown(false); setGrammage(null); }}
                style={{ padding: "10px 14px", cursor: "pointer", color: "var(--text-primary)", fontSize: 13, borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-surface)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 8 }}>{p.sheet}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && selected.nutrition.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <label style={{ display: "block", color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Pack Size
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {selected.nutrition.map((nb) => (
              <button
                key={nb.grammage}
                onClick={() => setGrammage(nb.grammage)}
                style={{
                  padding: "8px 18px", borderRadius: 8,
                  border: `1px solid ${grammage === nb.grammage ? "var(--accent-teal)" : "var(--border)"}`,
                  background: grammage === nb.grammage ? "rgba(6,170,144,0.15)" : "transparent",
                  color: grammage === nb.grammage ? "var(--accent-teal)" : "var(--text-secondary)",
                  fontWeight: grammage === nb.grammage ? 600 : 400,
                  cursor: "pointer", fontSize: 14,
                }}
              >
                {nb.grammage}g
              </button>
            ))}
          </div>
        </div>
      )}

      {masterBlock && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Master values for {grammage}g
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {NUTRIENT_ROWS.map(({ label, masterKey, unit }) => {
                const val = masterBlock[masterKey];
                if (val === null || val === undefined) return null;
                return (
                  <tr key={masterKey}>
                    <td style={{ padding: "5px 8px", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>{label}</td>
                    <td style={{ padding: "5px 8px", color: "var(--text-primary)", textAlign: "right", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid var(--border)" }}>
                      {val}{unit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && grammage !== null && (
        <button
          onClick={() => onProceed(selected, grammage)}
          style={{ marginTop: 24, padding: "12px 28px", background: "var(--accent-teal)", color: "#003433", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
        >
          Upload Label →
        </button>
      )}
    </div>
  );
}

// ─── Step 2: Upload + Results ─────────────────────────────────────────────────

function Step2({ product, grammage, onBack }: { product: Product; grammage: number; onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OCRResult | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const masterBlock = product.nutrition.find((nb) => nb.grammage === grammage);
  const rdaBlock    = product.rda.find((rb) => rb.grammage === grammage);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResult(null);
    setOcrError(null);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    setOcrError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/analyze-label", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data as OCRResult);
    } catch (e) {
      setOcrError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Serving size scaling
  const labelG = result?.serving_size_g ?? null;
  const hasServingSizeDiff = labelG != null && Math.abs(labelG - grammage) > 1;
  const scaleFactor = hasServingSizeDiff && labelG ? grammage / labelG : 1;

  // Allergen analysis
  const detectedAllergens = detectAllergens(product.ingredients);
  const declaredAllergens = (result?.allergens_declared || []).map((a) => a.toLowerCase());
  const allergenIssues = detectedAllergens.filter(
    (a) => !declaredAllergens.some((d) =>
      d.includes(a.toLowerCase().split(" ")[0]) ||
      a.toLowerCase().split(" ").some((w) => d.includes(w))
    )
  );

  const hasCritical =
    allergenIssues.length > 0 ||
    (result && masterBlock &&
      NUTRIENT_ROWS.some(({ masterKey, ocrKey, absFloor }) => {
        const masterVal = (masterBlock[masterKey] as number | null) ?? 0;
        const labelData = (result.nutrition_table?.[ocrKey] as number | null) ?? 0;
        const ssd = parseFloat((labelData * scaleFactor).toFixed(2));
        return calcStatus(masterVal, ssd, absFloor) === "CRITICAL";
      }));

  const thCell: React.CSSProperties = {
    padding: "9px 12px", fontWeight: 700, fontSize: 11,
    color: "var(--text-muted)", borderBottom: "2px solid var(--border)",
    textTransform: "uppercase" as const, letterSpacing: "0.04em",
    whiteSpace: "nowrap" as const, background: "var(--bg-elevated)",
  };

  return (
    <div style={{ padding: "16px", maxWidth: 1280, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
        >
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(16px, 4vw, 20px)", fontWeight: 700, color: "var(--text-primary)", wordBreak: "break-word" }}>
            {product.name}
          </h1>
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{grammage}g pack</span>
        </div>
      </div>

      {/* ── LABEL UPLOAD CARD ── */}
      <div style={{ marginBottom: 24, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)" }}>
          Label Upload
        </div>

        {!file ? (
          /* Drop zone */
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: "32px 16px", textAlign: "center", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(6,170,144,0.04)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            <div style={{ fontSize: 36 }}>📤</div>
            <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>Drop label image or PDF here</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>JPG, PNG, or PDF supported</div>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
          </div>
        ) : result ? (
          /* Compact bar once results are loaded — preview moves to sticky panel */
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px" }}>
            <span style={{ fontSize: 16 }}>{preview ? "🖼️" : "📄"}</span>
            <span style={{ flex: 1, color: "var(--text-primary)", fontSize: 13, fontWeight: 500 }}>{file.name}</span>
            <span style={{ fontSize: 11, color: "var(--accent-teal)", fontWeight: 600 }}>✓ Analyzed</span>
            <button
              onClick={() => { setFile(null); setPreview(null); setResult(null); setOcrError(null); }}
              style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
            >
              Re-upload
            </button>
          </div>
        ) : (
          <div>
            {/* Preview — centred */}
            <div style={{ padding: 24, display: "flex", justifyContent: "center", background: "var(--bg-base)" }}>
              {preview ? (
                <img
                  src={preview}
                  alt="Label preview"
                  style={{ maxWidth: 480, maxHeight: 360, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)" }}
                />
              ) : (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
                  <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{file.name}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>PDF file</div>
                </div>
              )}
            </div>

            {/* File name bar + action buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 16 }}>{preview ? "🖼️" : "📄"}</span>
              <span style={{ flex: 1, color: "var(--text-primary)", fontSize: 13, fontWeight: 500 }}>{file.name}</span>
              <button
                onClick={() => { setFile(null); setPreview(null); setResult(null); setOcrError(null); }}
                style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
              >
                Re-upload
              </button>
              {!result && !loading && (
                <button
                  onClick={handleAnalyze}
                  style={{ padding: "8px 20px", background: "var(--accent-teal)", color: "#003433", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 13 }}
                >
                  Analyze Label
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Loading skeleton ── */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} style={{ height: 34, borderRadius: 6, background: "var(--bg-elevated)", opacity: 1 - i * 0.07, animation: "pulse 1.5s ease-in-out infinite" }} />
          ))}
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>Analyzing label…</div>
        </div>
      )}

      {/* ── OCR error ── */}
      {ocrError && (
        <div style={{ background: "rgba(232,64,64,0.1)", border: "1px solid rgba(232,64,64,0.3)", borderRadius: 8, padding: 16, color: "var(--accent-red)", marginBottom: 24 }}>
          OCR Error: {ocrError}
        </div>
      )}

      {/* ── QC RESULTS ── */}
      {result && masterBlock && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Serving size banner */}
            {hasServingSizeDiff && (
              <div style={{ background: "rgba(255,192,0,0.08)", border: "1px solid rgba(255,192,0,0.35)", borderRadius: 8, padding: "10px 16px", color: "var(--accent-amber)", fontSize: 13 }}>
                <strong>Serving size note: </strong>
                Label nutrition is printed for {labelG}g. Scaled to {grammage}g for master comparison.
              </div>
            )}

            {/* Side-by-side: printed label preview + comparison table */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Nutrient Comparison
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, alignItems: "start" }}>
                {file && (
                  <div style={{ borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
                    <LabelPreview file={file} height={300} />
                  </div>
                )}
              <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--border)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thCell, textAlign: "left" }}>Nutrient</th>
                      <th style={{ ...thCell, textAlign: "right" }}>
                        Master<br /><span style={{ fontWeight: 400, opacity: 0.65 }}>({grammage}g)</span>
                      </th>
                      <th style={{ ...thCell, textAlign: "right" }}>
                        Label Data<br /><span style={{ fontWeight: 400, opacity: 0.65 }}>({labelG ?? grammage}g)</span>
                      </th>
                      <th style={{ ...thCell, textAlign: "right" }}>
                        Serving Size Data<br /><span style={{ fontWeight: 400, opacity: 0.65 }}>({grammage}g)</span>
                      </th>
                      <th style={{ ...thCell, textAlign: "right" }}>%RDA</th>
                      <th style={{ ...thCell, textAlign: "right" }}>Deviation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {NUTRIENT_ROWS.map(({ label, masterKey, ocrKey, rdaKey, unit, absFloor }) => {
                      const masterVal    = (masterBlock[masterKey] as number | null) ?? 0;
                      const labelData    = (result.nutrition_table?.[ocrKey] as number | null) ?? 0;
                      const ssd          = parseFloat((labelData * scaleFactor).toFixed(2));
                      const rdaVal       = rdaKey ? (rdaBlock?.[rdaKey] as number | null) ?? null : null;
                      const deviation    = masterVal !== 0 ? ((ssd - masterVal) / Math.abs(masterVal)) * 100 : null;
                      const devFormatted = deviation != null ? `${deviation >= 0 ? "+" : ""}${deviation.toFixed(1)}%` : "—";
                      const status       = calcStatus(masterVal, ssd, absFloor);
                      const devColor     = status === "CRITICAL" ? "#E84040" : status === "WARNING" ? "#FFC000" : "#06AA90";

                      return (
                        <tr key={masterKey} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 12px", color: "var(--text-secondary)", fontWeight: 500 }}>{label}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                            {masterVal}{unit}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                            {labelData}{unit}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                            {ssd}{unit}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                            {rdaVal != null ? `${rdaVal}%` : "—"}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: devColor, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                            {devFormatted}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            </div>

            {/* Allergen check */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Allergen Check
              </div>
              {detectedAllergens.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No allergens detected in ingredients.</div>
              ) : (
                <div style={{ borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Allergen", "In Ingredients", "Declared on Label", "Status"].map((h) => (
                          <th key={h} style={{ ...thCell, textAlign: "left" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detectedAllergens.map((allergen) => {
                        const isDeclared = declaredAllergens.some((d) =>
                          d.includes(allergen.toLowerCase().split(" ")[0]) ||
                          allergen.toLowerCase().split(" ").some((w) => d.includes(w))
                        );
                        return (
                          <tr key={allergen} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "8px 12px", color: "var(--text-primary)" }}>{allergen}</td>
                            <td style={{ padding: "8px 12px", color: "var(--accent-teal)" }}>✓ Yes</td>
                            <td style={{ padding: "8px 12px", color: isDeclared ? "var(--accent-teal)" : "var(--accent-red)" }}>
                              {isDeclared ? "✓ Yes" : "✗ No"}
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              <StatusChip status={isDeclared ? "PASS" : "CRITICAL"} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Approve / Reject */}
            <div style={{ display: "flex", gap: 12 }}>
              <button
                style={{ flex: 1, padding: "13px", borderRadius: 8, border: "1px solid var(--accent-red)", background: "transparent", color: "var(--accent-red)", fontWeight: 700, cursor: "pointer", fontSize: 14 }}
              >
                Reject
              </button>
              <button
                disabled={!!hasCritical}
                style={{
                  flex: 3, padding: "13px", borderRadius: 8, border: "none",
                  background: hasCritical ? "var(--bg-elevated)" : "var(--accent-teal)",
                  color: hasCritical ? "var(--text-muted)" : "#003433",
                  fontWeight: 700, cursor: hasCritical ? "not-allowed" : "pointer", fontSize: 14,
                }}
              >
                Approve for Print ✓
              </button>
            </div>
            {hasCritical && (
              <div style={{ fontSize: 12, color: "var(--accent-red)", textAlign: "center", marginTop: -12 }}>
                Resolve all CRITICAL issues before approving.
              </div>
            )}
        </div>
      )}

      {!file && (
        <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "8px 0" }}>
          Upload a label above to begin QC analysis.
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LabelQCPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedGrammage, setSelectedGrammage] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setProducts(data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 48, color: "var(--text-muted)", textAlign: "center" }}>Loading products…</div>;
  }

  if (step === 2 && selectedProduct && selectedGrammage !== null) {
    return (
      <Step2
        product={selectedProduct}
        grammage={selectedGrammage}
        onBack={() => setStep(1)}
      />
    );
  }

  return (
    <Step1
      products={products}
      onProceed={(product, grammage) => {
        setSelectedProduct(product);
        setSelectedGrammage(grammage);
        setStep(2);
      }}
    />
  );
}
