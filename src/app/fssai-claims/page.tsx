"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Product, NutritionBlock, RDABlock } from "../../lib/types";
import { validateClaims, calcEnergy, ClaimResult, SODIUM_THRESHOLD, CLAIM_RULES, detectPrimaryOil, calcSatFatPct } from "../../lib/fssai";

// ─── Types ───────────────────────────────────────────────────────────────────

type LabelOCR = {
  nutrition_table: Partial<Record<string, number | null>>;
  serving_size_g: number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const NUTRIENT_ROWS: { label: string; key: keyof NutritionBlock; rdaKey?: keyof RDABlock; unit: string }[] = [
  { label: "Energy",        key: "energy_kcal",     rdaKey: "energy_pct",        unit: "kcal" },
  { label: "Protein",       key: "protein_g",       rdaKey: "protein_pct",       unit: "g"    },
  { label: "Carbohydrates", key: "carbohydrate_g",  rdaKey: undefined,           unit: "g"    },
  { label: "Total Sugar",   key: "total_sugar_g",   rdaKey: undefined,           unit: "g"    },
  { label: "Added Sugar",   key: "added_sugar_g",   rdaKey: "added_sugar_pct",   unit: "g"    },
  { label: "Dietary Fibre", key: "dietary_fibre_g", rdaKey: "dietary_fibre_pct", unit: "g"    },
  { label: "Total Fat",     key: "total_fat_g",     rdaKey: "total_fat_pct",     unit: "g"    },
  { label: "Saturated Fat", key: "saturated_fat_g", rdaKey: "saturated_fat_pct", unit: "g"    },
  { label: "Trans Fat",     key: "trans_fat_g",     rdaKey: "trans_fat_pct",     unit: "g"    },
  { label: "Sodium",        key: "sodium_mg",       rdaKey: "sodium_pct",        unit: "mg"   },
  { label: "Calcium",       key: "calcium_mg",      rdaKey: "calcium_pct",       unit: "mg"   },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ocrToN100(ocr: Partial<Record<string, number | null>>, servingG: number): NutritionBlock {
  // Scale OCR values to per-100g if the label declares a different serving size
  const scale = servingG > 0 && Math.abs(servingG - 100) > 1 ? 100 / servingG : 1;
  const g = (k: string) => {
    const v = (ocr[k] as number | null) ?? 0;
    return parseFloat((v * scale).toFixed(2));
  };
  const n = (k: string) => {
    const v = ocr[k] as number | null;
    if (v === null || v === undefined) return null;
    return parseFloat((v * scale).toFixed(2));
  };
  return {
    grammage:          100,
    energy_kcal:       g("energy_kcal"),
    protein_g:         g("protein_g"),
    carbohydrate_g:    g("carbohydrate_g"),
    total_sugar_g:     g("total_sugar_g"),
    added_sugar_g:     n("added_sugar_g"),
    dietary_fibre_g:   n("dietary_fibre_g"),
    total_fat_g:       g("total_fat_g"),
    saturated_fat_g:   n("saturated_fat_g"),
    unsaturated_fat_g: null,
    trans_fat_g:       n("trans_fat_g"),
    cholesterol_mg:    null,
    sodium_mg:         n("sodium_mg"),
    calcium_mg:        n("calcium_mg"),
  };
}

function StatusChip({ status, label }: { status: "pass" | "fail" | "warning" | "neutral" | "factual" | "custom"; label?: string }) {
  const map = {
    pass:    { bg: "rgba(6,170,144,0.15)",   color: "#06AA90", text: label || "PASS" },
    fail:    { bg: "rgba(232,64,64,0.15)",   color: "#E84040", text: label || "FAIL" },
    warning: { bg: "rgba(255,192,0,0.15)",   color: "#FFC000", text: label || "WARNING" },
    neutral: { bg: "rgba(155,191,190,0.15)", color: "#9BBFBE", text: label || "INFO" },
    factual: { bg: "rgba(183,200,21,0.15)",  color: "#B7C815", text: label || "FACTUAL" },
    custom:  { bg: "rgba(255,192,0,0.15)",   color: "#FFC000", text: label || "CUSTOM" },
  };
  const s = map[status] || map.neutral;
  return (
    <span style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
      {s.text}
    </span>
  );
}

function fmtVal(val: number | null | undefined, unit: string): string {
  if (val === null || val === undefined) return "—";
  return `${Number(val.toFixed(2))}${unit}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FSSAIClaimsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);

  // Label upload state
  const [labelFile, setLabelFile] = useState<File | null>(null);
  const [labelPreview, setLabelPreview] = useState<string | null>(null);
  const [labelPdfUrl, setLabelPdfUrl] = useState<string | null>(null);
  const [labelOCR, setLabelOCR] = useState<LabelOCR | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setProducts(data); })
      .finally(() => setLoading(false));
  }, []);

  // Revoke PDF object URL when it changes to avoid memory leaks
  useEffect(() => {
    return () => { if (labelPdfUrl) URL.revokeObjectURL(labelPdfUrl); };
  }, [labelPdfUrl]);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 20);

  const handleLabelFile = useCallback((f: File) => {
    setLabelFile(f);
    setLabelOCR(null);
    setOcrError(null);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setLabelPreview(e.target?.result as string);
      reader.readAsDataURL(f);
      setLabelPdfUrl(null);
    } else if (f.type === "application/pdf") {
      setLabelPreview(null);
      setLabelPdfUrl(URL.createObjectURL(f));
    } else {
      setLabelPreview(null);
      setLabelPdfUrl(null);
    }
  }, []);

  const handleExtract = async () => {
    if (!labelFile) return;
    setOcrLoading(true);
    setOcrError(null);
    try {
      const fd = new FormData();
      fd.append("file", labelFile);
      const res = await fetch("/api/analyze-label", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLabelOCR(data as LabelOCR);
    } catch (e) {
      setOcrError(String(e));
    } finally {
      setOcrLoading(false);
    }
  };

  const clearLabel = () => {
    setLabelFile(null);
    setLabelPreview(null);
    setLabelPdfUrl(null);
    setLabelOCR(null);
    setOcrError(null);
  };

  // ── Nutrition data ──
  const n100 = selected?.nutrition.find((nb) => Math.abs(nb.grammage - 100) < 1);
  const ocrBlock: NutritionBlock | null = labelOCR
    ? ocrToN100(labelOCR.nutrition_table, labelOCR.serving_size_g ?? 100)
    : null;

  // ── Claim validation: active source vs master reference ──
  const masterClaimResults: ClaimResult[] = selected && n100 ? validateClaims(selected.brand_usp, n100) : [];
  const ocrClaimResults: ClaimResult[] | null = selected && ocrBlock ? validateClaims(selected.brand_usp, ocrBlock) : null;
  const activeClaimResults = ocrClaimResults ?? masterClaimResults;
  const usingOCR = ocrClaimResults !== null;

  // ── Compliance checks (always master) ──
  const reportedEnergy   = n100?.energy_kcal ?? 0;
  const calculatedEnergy = n100 ? calcEnergy(n100) : 0;
  const energyDevPct     = reportedEnergy !== 0 ? Math.abs((reportedEnergy - calculatedEnergy) / reportedEnergy) * 100 : 0;
  const energyStatus     = energyDevPct <= 5 ? "pass" : "warning";
  const sodiumVal        = n100?.sodium_mg ?? null;
  const sodiumStatus     = sodiumVal !== null && sodiumVal > SODIUM_THRESHOLD ? "warning" : "pass";

  // ── Oil-based saturated-fat check (primary oil only) ──
  const primaryOil   = selected ? detectPrimaryOil(selected.ingredients) : null;
  const masterSatPct = n100 ? calcSatFatPct(n100) : null;
  const labelSatPct  = ocrBlock ? calcSatFatPct(ocrBlock) : null;
  // Only treat as compliance fail when a label is actually uploaded and exceeds the limit
  const anyOilFail   = !!(primaryOil && labelSatPct !== null && labelSatPct > primaryOil.maxPct);

  // ── Per-serving values ──
  // Prefer the uploaded label's serving size when available; fall back to master sheet
  const serving       = labelOCR?.serving_size_g ?? selected?.serving_size_g ?? 100;
  const servingSource = labelOCR?.serving_size_g ? "label" : "master";
  const factor        = serving / 100;
  const rdaBlock      = selected?.rda.reduce<RDABlock | undefined>((best, rb) => {
    if (!best) return rb;
    return Math.abs(rb.grammage - serving) < Math.abs(best.grammage - serving) ? rb : best;
  }, undefined);
  // Linearly scale %RDA from the nearest available grammage to the actual serving size
  const rdaScale = rdaBlock && rdaBlock.grammage > 0 ? serving / rdaBlock.grammage : 1;

  // ── Overall status ──
  const anyClaimFail  = activeClaimResults.some((r) => r.status === "fail");
  const needsReview   = energyStatus === "warning" || sodiumStatus === "warning";
  const overallStatus = (anyClaimFail || anyOilFail) ? "NON_COMPLIANT" : needsReview ? "REVIEW_REQUIRED" : "COMPLIANT";

  const hasLabel = labelFile !== null;

  const thCell: React.CSSProperties = {
    padding: "7px 8px", textAlign: "left", color: "var(--text-muted)",
    fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: 11,
  };

  return (
    <div style={{ padding: "16px" }}>
      <h1 style={{ fontSize: "clamp(18px, 5vw, 22px)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>FSSAI Claims</h1>
      <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: "13px" }}>
        Validate brand USP claims against FSSAI nutrient thresholds and run compliance checks.
      </p>

      {/* Product selector */}
      <div style={{ maxWidth: "100%", position: "relative", marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search product…"
          value={selected ? selected.name : search}
          onChange={(e) => { setSearch(e.target.value); setSelected(null); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          disabled={loading}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 14, outline: "none" }}
        />
        {showDropdown && filtered.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, zIndex: 100, maxHeight: 240, overflowY: "auto", marginTop: 4 }}>
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => { setSelected(p); setSearch(p.name); setShowDropdown(false); clearLabel(); }}
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

      {/* Label upload zone (optional) */}
      {selected && (
        <div style={{ maxWidth: 640, marginBottom: 28 }}>
          {!labelFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                border: "1px dashed var(--border)", borderRadius: 8, cursor: "pointer",
                color: "var(--text-muted)", fontSize: 13,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent-teal)"; (e.currentTarget as HTMLDivElement).style.color = "var(--accent-teal)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLDivElement).style.color = "var(--text-muted)"; }}
            >
              <span style={{ fontSize: 18 }}>📎</span>
              <span>Upload label (optional) — JPG, PNG, or PDF</span>
              <input ref={fileInputRef} type="file" accept="image/*,.pdf" style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.[0]) handleLabelFile(e.target.files[0]); }} />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <span style={{ fontSize: 18 }}>{labelPreview ? "🖼️" : "📄"}</span>
              <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{labelFile.name}</span>
              {ocrLoading && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Extracting…</span>}
              {!labelOCR && !ocrLoading && (
                <button
                  onClick={handleExtract}
                  style={{ padding: "6px 14px", background: "var(--accent-teal)", color: "#003433", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
                >
                  Extract from Label
                </button>
              )}
              {labelOCR && (
                <span style={{ fontSize: 11, color: "var(--accent-teal)", fontWeight: 600 }}>✓ OCR extracted</span>
              )}
              <button
                onClick={clearLabel}
                style={{ padding: "4px 10px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
              >
                ✕
              </button>
            </div>
          )}
          {ocrError && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(232,64,64,0.1)", border: "1px solid rgba(232,64,64,0.3)", borderRadius: 6, color: "var(--accent-red)", fontSize: 12 }}>
              OCR Error: {ocrError}
            </div>
          )}
        </div>
      )}

      {selected && !n100 && (
        <div style={{ background: "rgba(255,192,0,0.1)", border: "1px solid rgba(255,192,0,0.3)", borderRadius: 8, padding: 16, color: "var(--accent-amber)", marginBottom: 24 }}>
          No 100g nutrition block found for this product. Claims cannot be validated without per-100g values.
        </div>
      )}

      {selected && n100 && (
        <>
          {/* Data source indicator */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 20,
            padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: usingOCR ? "rgba(6,170,144,0.1)" : "rgba(155,191,190,0.1)",
            border: `1px solid ${usingOCR ? "rgba(6,170,144,0.3)" : "rgba(155,191,190,0.2)"}`,
            color: usingOCR ? "var(--accent-teal)" : "var(--text-muted)",
          }}>
            <span>{usingOCR ? "🔍" : "📊"}</span>
            <span>Validating against: {usingOCR ? "Uploaded Label (OCR)" : "Master Sheet"}</span>
          </div>

          {/* Overall status banner */}
          {!usingOCR ? (
            <div style={{
              borderRadius: 10, padding: "14px 20px", marginBottom: 28,
              background: "rgba(155,191,190,0.08)",
              border: "1px solid rgba(155,191,190,0.25)",
              color: "var(--text-secondary)",
              fontWeight: 500, fontSize: 14,
            }}>
              <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>Master sheet reference.</span>{" "}
              The checks below show what the sheet&apos;s data supports. Upload a printed label to validate it against FSSAI thresholds.
            </div>
          ) : (
            <div style={{
              borderRadius: 10, padding: "14px 20px", marginBottom: 28,
              background: overallStatus === "NON_COMPLIANT" ? "rgba(232,64,64,0.1)" : overallStatus === "REVIEW_REQUIRED" ? "rgba(255,192,0,0.1)" : "rgba(6,170,144,0.1)",
              border: `1px solid ${overallStatus === "NON_COMPLIANT" ? "rgba(232,64,64,0.3)" : overallStatus === "REVIEW_REQUIRED" ? "rgba(255,192,0,0.3)" : "rgba(6,170,144,0.3)"}`,
              color: overallStatus === "NON_COMPLIANT" ? "var(--accent-red)" : overallStatus === "REVIEW_REQUIRED" ? "var(--accent-amber)" : "var(--accent-teal)",
              fontWeight: 700, fontSize: 15,
            }}>
              {overallStatus === "NON_COMPLIANT"   && "✗ NON-COMPLIANT — One or more claims fail FSSAI thresholds on the uploaded label"}
              {overallStatus === "REVIEW_REQUIRED" && "⚠ REVIEW REQUIRED — Energy deviation or sodium flag detected"}
              {overallStatus === "COMPLIANT"       && "✓ COMPLIANT — All claims validated against the uploaded label, no flags raised"}
            </div>
          )}

          {/* Main content grid — label preview panel when file is loaded */}
          <div style={{ display: "grid", gridTemplateColumns: hasLabel ? "1fr 300px" : "1fr", gap: 28, alignItems: "start" }}>

            {/* ── LEFT: claim matrix + compliance checks ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {/* Claim Validation Matrix */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Claim Validation Matrix
                </div>
                {activeClaimResults.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No USP claims found for this product.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Claim", "Type", "Threshold", "Actual (Master)", `Serving${labelOCR?.serving_size_g ? ` (${labelOCR.serving_size_g}g)` : ""}`, "Calculated per 100g", "Status"].map((h) => (
                          <th key={h} style={thCell}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeClaimResults.map((r, i) => {
                        const ruleKey = Object.keys(CLAIM_RULES).find(k =>
                          k.toLowerCase() === r.claim.toLowerCase() ||
                          r.claim.toLowerCase().includes(k.toLowerCase()) ||
                          k.toLowerCase().includes(r.claim.toLowerCase())
                        );
                        const rule = ruleKey ? CLAIM_RULES[ruleKey] : undefined;
                        const unit = rule ? (rule.nutrient.endsWith("_mg") ? " mg" : rule.nutrient === "energy_kcal" ? " kcal" : "g") : "";

                        const masterActual = masterClaimResults[i]?.actual || "—";

                        const servingRaw = rule && labelOCR
                          ? (labelOCR.nutrition_table[rule.nutrient as string] as number | null) ?? null
                          : null;
                        const servingStr = servingRaw !== null ? `${servingRaw}${unit}` : "—";

                        const calc100Str = rule && ocrClaimResults ? (ocrClaimResults[i]?.actual || "—") : "—";

                        return (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "8px 8px", color: "var(--text-primary)", fontWeight: 500 }}>{r.claim}</td>
                            <td style={{ padding: "8px 8px", color: "var(--text-secondary)" }}>{r.type}</td>
                            <td style={{ padding: "8px 8px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                              {r.threshold || (r.type === "factual" ? "Factual claim — verified by ingredients" : "Custom — manual review required")}
                            </td>
                            <td style={{ padding: "8px 8px", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                              {masterActual}
                            </td>
                            <td style={{ padding: "8px 8px", color: labelOCR ? "var(--text-primary)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                              {servingStr}
                            </td>
                            <td style={{ padding: "8px 8px", color: labelOCR ? "var(--text-primary)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                              {calc100Str}
                            </td>
                            <td style={{ padding: "8px 8px" }}>
                              <StatusChip status={r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : r.status === "factual" ? "factual" : "custom"} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Compliance checks */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* Energy Cross-Check */}
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Energy Cross-Check
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: "5px 0", color: "var(--text-secondary)" }}>Reported (100g)</td>
                        <td style={{ padding: "5px 0", textAlign: "right", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{reportedEnergy} kcal</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "5px 0", color: "var(--text-secondary)" }}>Calculated (4C+4P+9F)</td>
                        <td style={{ padding: "5px 0", textAlign: "right", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{calculatedEnergy.toFixed(1)} kcal</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "5px 0", color: "var(--text-secondary)" }}>Deviation</td>
                        <td style={{ padding: "5px 0", textAlign: "right", color: energyStatus === "warning" ? "var(--accent-amber)" : "var(--accent-teal)", fontVariantNumeric: "tabular-nums" }}>
                          {energyDevPct.toFixed(1)}%
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "5px 0", color: "var(--text-secondary)" }}>Status</td>
                        <td style={{ padding: "5px 0", textAlign: "right" }}>
                          <StatusChip status={energyStatus} label={energyStatus === "pass" ? "PASS (≤5%)" : "WARNING (>5%)"} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Sodium Check */}
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Sodium Check
                  </div>
                  <div style={{ fontSize: 11, color: "var(--accent-amber)", marginBottom: 10 }}>
                    ⚠ Snackible Internal Standard (not FSSAI regulation): flag if sodium &gt; {SODIUM_THRESHOLD}mg/100g
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: "5px 0", color: "var(--text-secondary)" }}>Value (per 100g)</td>
                        <td style={{ padding: "5px 0", textAlign: "right", color: sodiumStatus === "warning" ? "var(--accent-amber)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                          {sodiumVal !== null ? `${sodiumVal} mg` : "—"}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "5px 0", color: "var(--text-secondary)" }}>Threshold</td>
                        <td style={{ padding: "5px 0", textAlign: "right", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{SODIUM_THRESHOLD} mg</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "5px 0", color: "var(--text-secondary)" }}>Status</td>
                        <td style={{ padding: "5px 0", textAlign: "right" }}>
                          <StatusChip status={sodiumStatus} label={sodiumStatus === "pass" ? "PASS" : "WARNING"} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Oil-based saturated fat check (primary oil only) ── */}
              {primaryOil && (
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Oil-Based Saturated Fat Check
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
                    Checked against the <strong style={{ color: "var(--text-secondary)" }}>primary oil</strong> (first listed — FSSAI requires ingredients in descending weight order).
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "6px 0", textAlign: "left",  color: "var(--text-muted)", fontWeight: 600, fontSize: 11 }}>Primary Oil</th>
                        <th style={{ padding: "6px 0", textAlign: "right", color: "var(--text-muted)", fontWeight: 600, fontSize: 11 }}>Limit</th>
                        <th style={{ padding: "6px 0", textAlign: "right", color: "var(--text-muted)", fontWeight: 600, fontSize: 11 }}>Master Sheet</th>
                        <th style={{ padding: "6px 0", textAlign: "right", color: "var(--text-muted)", fontWeight: 600, fontSize: 11 }}>Actual Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: "8px 0", color: "var(--text-primary)", fontWeight: 600 }}>{primaryOil.name}</td>
                        <td style={{ padding: "8px 0", textAlign: "right", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                          ≤ {primaryOil.maxPct}%
                        </td>
                        <td style={{
                          padding: "8px 0", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums",
                          color: masterSatPct === null ? "var(--text-muted)" : masterSatPct > primaryOil.maxPct ? "var(--accent-red)" : "var(--accent-teal)",
                        }}>
                          {masterSatPct !== null ? `${masterSatPct}%` : "—"}
                        </td>
                        <td style={{
                          padding: "8px 0", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums",
                          color: labelSatPct === null ? "var(--text-muted)" : labelSatPct > primaryOil.maxPct ? "var(--accent-red)" : "var(--accent-teal)",
                        }}>
                          {labelSatPct !== null ? `${labelSatPct}%` : "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {primaryOil.otherOils.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
                      Also detected (not validated — assumed trace): {primaryOil.otherOils.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── RIGHT: sticky label preview (only when file loaded) ── */}
            {hasLabel && (
              <div style={{ position: "sticky", top: 24 }}>
                <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "8px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)" }}>
                    Label Preview
                  </div>
                  <div style={{ background: "var(--bg-base)", display: "flex", justifyContent: "center", minHeight: 180 }}>
                    {labelPreview ? (
                      <img
                        src={labelPreview}
                        alt="Label"
                        style={{ maxWidth: "100%", maxHeight: 480, objectFit: "contain" }}
                      />
                    ) : labelPdfUrl ? (
                      <embed
                        src={labelPdfUrl}
                        type="application/pdf"
                        style={{ width: "100%", height: 480, border: "none" }}
                      />
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "24px 0" }}>
                        <span style={{ fontSize: 36 }}>📄</span>
                        <span style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>{labelFile?.name}</span>
                      </div>
                    )}
                  </div>
                  {labelOCR?.serving_size_g && (
                    <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
                      {Math.abs(labelOCR.serving_size_g - 100) > 1 ? (
                        <span style={{ color: "var(--accent-teal)" }}>
                          Label is per {labelOCR.serving_size_g}g — scaled ×{(100 / labelOCR.serving_size_g).toFixed(3)} to per 100g for FSSAI thresholds
                        </span>
                      ) : (
                        <span>OCR serving size: {labelOCR.serving_size_g}g ✓ per 100g</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Full Nutrition Table (master data, always full-width) ── */}
          <div style={{ marginTop: 32 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Full Nutrition Table
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg-elevated)" }}>
                  {[`Nutrient`, `Per 100g`, `Per Serving (${serving}g)`, `%RDA`].map((h) => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: h === "Nutrient" ? "left" : "right", color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: 11 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NUTRIENT_ROWS.map(({ label, key, rdaKey, unit }, idx) => {
                  const val100     = n100[key] as number | null;
                  const valServing = val100 !== null ? val100 * factor : null;
                  const rdaSrc     = rdaKey && rdaBlock ? (rdaBlock[rdaKey] as number | null) : null;
                  const rdaPct     = rdaSrc !== null && rdaSrc !== undefined ? parseFloat((rdaSrc * rdaScale).toFixed(1)) : null;
                  const isSodiumHigh = key === "sodium_mg" && val100 !== null && val100 > SODIUM_THRESHOLD;
                  return (
                    <tr
                      key={key}
                      style={{
                        background: isSodiumHigh ? "rgba(255,192,0,0.06)" : idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <td style={{ padding: "8px 12px", color: isSodiumHigh ? "var(--accent-amber)" : "var(--text-secondary)" }}>
                        {label}{isSodiumHigh && <span style={{ marginLeft: 6, fontSize: 10 }}>⚠</span>}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                        {fmtVal(val100, unit)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                        {fmtVal(valServing, unit)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                        {rdaPct !== null && rdaPct !== undefined ? `${rdaPct}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              %RDA scaled to {serving}g serving from {rdaBlock?.grammage ?? "—"}g RDA block (source: {servingSource}).
            </div>
          </div>
        </>
      )}
    </div>
  );
}
