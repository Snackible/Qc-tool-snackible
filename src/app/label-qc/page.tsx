"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Product } from "../../lib/types";
import { extractPdfText, mergeLabels } from "../../lib/labelAudit/extract";
import { multiFileToJpegs, openRenderer } from "../../lib/labelAudit/toImages";
import { ocrCanvases } from "../../lib/labelAudit/ocr";
import { describeNutrition } from "../../lib/labelAudit/nutrients";
import { PackOption, buildReference, buildVocabulary, packOptionsFor } from "../../lib/labelAudit/reference";
import { labelHasText, runRulesAudit } from "../../lib/labelAudit/rules";
import { AuditReport, CheckStatus, ExtractedLabel, stepStatus } from "../../lib/labelAudit/types";
import Icon, { IconName } from "../../components/ui/Icon";

const LabelPreview = dynamic(() => import("./LabelPreview"), { ssr: false });

const STATUS_STYLE: Record<CheckStatus, { color: string; bg: string; label: string; icon: IconName }> = {
  pass: { color: "var(--teal-text)", bg: "rgba(6,170,144,0.16)", label: "Pass", icon: "check-circle" },
  fail: { color: "var(--red-text)", bg: "rgba(232,64,64,0.16)", label: "Fail", icon: "x-circle" },
  warn: { color: "var(--amber-text)", bg: "rgba(255,192,0,0.14)", label: "Review", icon: "alert-circle" },
  skip: { color: "var(--text-secondary)", bg: "rgba(155,191,190,0.12)", label: "Not checked", icon: "minus-circle" },
};

const OCR_SIDE = 3200;

type ExtractState =
  | { state: "reading"; detail: string }
  | { state: "ready"; label: ExtractedLabel }
  | { state: "no-text" }
  | { state: "error"; message: string };

type FileEntry = { id: number; file: File; extract: ExtractState; showPreview: boolean };

const cardStyle: React.CSSProperties = { padding: 18, marginBottom: 16 };
const cardTitle: React.CSSProperties = {
  margin: "0 0 12px", fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 13px", borderRadius: 10, border: "1px solid var(--border)",
  background: "var(--field-bg)", color: "var(--text-primary)", fontSize: 14.5, outline: "none",
};

function Badge({ status, small }: { status: CheckStatus; small?: boolean }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: small ? "2px 8px" : "4px 11px", borderRadius: 8, fontSize: small ? 11.5 : 12.5, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      <Icon name={s.icon} size={small ? 13 : 15} />
      {s.label}
    </span>
  );
}

function formatSize(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}

export default function LabelQCPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [packGrams, setPackGrams] = useState<number | null>(null);
  const [customPack, setCustomPack] = useState("");
  const [expectedMrp, setExpectedMrp] = useState("");
  const [version, setVersion] = useState("");

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextEntryId = useRef(0);

  const [running, setRunning] = useState<"rules" | "ai" | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<CheckStatus | null>(null); // show only the checks with this status

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setProducts(data);
        else setLoadError(data.error || "Could not load products");
      })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const vocabulary = useMemo(() => buildVocabulary(products), [products]);
  const packOptions: PackOption[] = useMemo(() => (selected ? packOptionsFor(selected) : []), [selected]);
  const matches = useMemo(
    () => products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 20),
    [products, search]
  );

  const clearReport = () => {
    setReport(null);
    setRunError(null);
  };

  const selectProduct = (p: Product) => {
    setSelected(p);
    setSearch(p.name);
    setShowDropdown(false);
    const opts = packOptionsFor(p);
    const first = opts.find((o) => o.price) ?? opts[0];
    setPackGrams(first?.grams ?? null);
    setExpectedMrp(first?.price ? String(first.price) : "");
    setCustomPack("");
    clearReport();
  };

  const clearProduct = () => {
    setSelected(null);
    setSearch("");
    setPackGrams(null);
    setCustomPack("");
    setExpectedMrp("");
    clearReport();
  };

  const pickPack = (o: PackOption) => {
    setPackGrams(o.grams);
    setCustomPack("");
    setExpectedMrp(o.price ? String(o.price) : "");
    clearReport();
  };

  const onCustomPack = (v: string) => {
    setCustomPack(v);
    const n = parseFloat(v);
    setPackGrams(n > 0 ? n : null);
    clearReport();
  };

  // Each entry extracts independently; `updateEntry` is a no-op once an entry has been removed, so there is nothing
  // to cancel when the user removes a file mid-read.
  const updateEntry = (id: number, extract: ExtractState) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, extract } : e)));

  const extractInto = async (id: number, f: File) => {
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    try {
      if (isPdf) {
        updateEntry(id, { state: "reading", detail: "Reading the label text…" });
        const pdfLabel = await extractPdfText(f);
        if (labelHasText(pdfLabel)) {
          updateEntry(id, { state: "ready", label: pdfLabel });
          return;
        }
      }
      // no text layer (a photo, or a PDF with outlined text): read the pixels with OCR
      updateEntry(id, { state: "reading", detail: "Starting OCR…" });
      const renderer = await openRenderer(f);
      let canvases: HTMLCanvasElement[];
      try {
        canvases = await renderer.render(OCR_SIDE, { upscale: true, crop: true });
      } finally {
        await renderer.close();
      }
      const ocrLabel = await ocrCanvases(canvases, (p) => {
        updateEntry(id, { state: "reading", detail: `${p.stage === "loading" ? "Loading the OCR engine" : "Reading text from the image"}… ${Math.round(p.pct)}%` });
      });
      updateEntry(id, labelHasText(ocrLabel) ? { state: "ready", label: ocrLabel } : { state: "no-text" });
    } catch (e) {
      updateEntry(id, { state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const addFiles = (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    clearReport();
    const newEntries: FileEntry[] = files.map((file) => ({
      id: ++nextEntryId.current,
      file,
      extract: { state: "reading", detail: "Reading the label text…" },
      showPreview: false,
    }));
    setEntries((prev) => [...prev, ...newEntries]);
    newEntries.forEach((entry) => extractInto(entry.id, entry.file));
  };

  const removeEntry = (id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    clearReport();
  };

  const clearFiles = () => {
    setEntries([]);
    clearReport();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const togglePreview = (id: number) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, showPreview: !e.showPreview } : e)));

  const mrpNumber = (() => {
    const n = parseFloat(expectedMrp);
    return n > 0 ? n : null;
  })();

  const allReady = entries.length > 0 && entries.every((e) => e.extract.state === "ready");
  const mergedLabel = useMemo(
    () => (allReady ? mergeLabels(entries.map((e) => (e.extract as { state: "ready"; label: ExtractedLabel }).label)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, allReady]
  );

  const startReport = (r: AuditReport) => {
    setReport(r);
    setStatusFilter(null);
    setCollapsed(new Set(r.steps.filter((s) => ["pass", "skip"].includes(stepStatus(s))).map((s) => s.step)));
  };

  const runRules = () => {
    if (!selected || !mergedLabel) return;
    setRunning("rules");
    setRunError(null);
    try {
      startReport(runRulesAudit(mergedLabel, buildReference(selected, packGrams, mrpNumber, vocabulary)));
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const runAi = async () => {
    if (!selected || entries.length === 0) return;
    setRunning("ai");
    setRunError(null);
    try {
      const images = await multiFileToJpegs(entries.map((e) => e.file));
      const form = new FormData();
      images.forEach((blob, i) => form.append("images", blob, `label-${i + 1}.jpg`));
      form.append(
        "reference",
        JSON.stringify({
          productName: selected.name,
          packSizeG: packGrams,
          expectedMrp: mrpNumber,
          version,
          usps: selected.brand_usp,
          ingredients: selected.ingredients,
          nutritionText: describeNutrition(selected.nutrition),
          allergens: selected.allergens,
          manufacturer: selected.manufacturer,
        })
      );
      const res = await fetch("/api/label-audit", { method: "POST", body: form });
      const body = await res.text();
      let data: { report?: AuditReport; error?: string };
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(`Server error (${res.status}). ${body.slice(0, 120)}`);
      }
      if (!res.ok || data.error || !data.report) throw new Error(data.error || `Server error (${res.status})`);
      startReport(data.report);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const toggleStep = (n: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const counts = report
    ? report.steps.flatMap((s) => s.checks).reduce<Record<CheckStatus, number>>((acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1 }), { pass: 0, fail: 0, warn: 0, skip: 0 })
    : null;

  const canRules = !!selected && !!mergedLabel && running === null;
  const canAi = !!selected && entries.length > 0 && entries.every((e) => e.extract.state !== "reading") && running === null;

  return (
    <div style={{ padding: "var(--page-pad)", paddingBottom: 56, maxWidth: 820, margin: "0 auto" }}>
      <h1 className="page-title">Label QC</h1>
      <p className="page-sub" style={{ marginBottom: 26 }}>
        Pick the product and pack size, upload the label (front and back, if the claims are split across them), and check it against the sheet, step by step.
      </p>

      {loadError && (
        <div role="alert" style={{ display: "flex", gap: 10, background: "rgba(232,64,64,0.1)", boxShadow: "inset 0 0 0 1px rgba(232,64,64,0.32)", borderRadius: 12, padding: "12px 14px", color: "var(--red-text)", marginBottom: 16, fontSize: 14 }}>
          <Icon name="alert-circle" size={18} style={{ marginTop: 1 }} />
          <span>Couldn&apos;t load products. {loadError}</span>
        </div>
      )}

      {/* Product */}
      <div className="surface" style={cardStyle}>
        <h2 style={cardTitle}>Product</h2>
        {selected ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "var(--field-bg)", boxShadow: "inset 0 0 0 1px var(--border)", borderRadius: 10, padding: "11px 13px" }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{selected.name}</span>
            <button onClick={clearProduct} aria-label="Clear product" style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "var(--text-muted)", fontSize: 13 }}>
              <Icon name="x" size={14} /> Clear
            </button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder={loading ? "Loading products…" : "Search product name…"}
              value={search}
              disabled={loading}
              onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              style={inputStyle}
            />
            {showDropdown && search && matches.length > 0 && (
              <div className="fade-in" style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, background: "var(--menu-bg)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "var(--shadow-menu)", maxHeight: 260, overflowY: "auto", zIndex: 20, padding: 4 }}>
                {matches.map((p) => (
                  <div
                    key={p.id}
                    className="menu-item"
                    onClick={() => selectProduct(p)}
                    style={{ padding: "10px 12px", cursor: "pointer", fontSize: 14, borderRadius: 8 }}
                  >
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 8 }}>{p.sheet}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pack size */}
      {selected && (
        <div className="surface" style={cardStyle}>
          <h2 style={cardTitle}>Pack size</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {packOptions.map((o) => {
              const on = packGrams === o.grams && customPack === "";
              return (
                <button
                  key={o.grams}
                  onClick={() => pickPack(o)}
                  aria-pressed={on}
                  title={o.source === "mrp" ? "From the sheet's MRP" : o.source === "pack" ? "From the sheet's pack sizes" : "From the sheet's nutrition columns"}
                  style={{
                    padding: "8px 14px", borderRadius: 10, fontSize: 14, fontWeight: 500,
                    border: `1px solid ${on ? "var(--accent-teal)" : "var(--border)"}`,
                    background: on ? "rgba(6,170,144,0.2)" : "var(--tint-1)",
                    color: on ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  <span className="mono">{o.grams}g</span>{o.price ? <span style={{ color: on ? "var(--accent-teal-bright)" : "var(--text-muted)" }}> · ₹{o.price}</span> : null}
                </button>
              );
            })}
            <input
              type="number"
              aria-label="Other pack size in grams"
              placeholder="Other (g)"
              value={customPack}
              onChange={(e) => onCustomPack(e.target.value)}
              style={{ ...inputStyle, width: 112, padding: "8px 11px", fontSize: 14 }}
            />
          </div>
          {packOptions.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--text-muted)" }}>The sheet has no pack sizes for this product. Enter the net weight.</div>
          )}
        </div>
      )}

      {/* Label files */}
      <div className="surface" style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: entries.length ? 12 : 12 }}>
          <h2 style={{ ...cardTitle, margin: 0 }}>Label files</h2>
          {entries.length > 0 && (
            <button onClick={clearFiles} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 13 }}>
              Clear all
            </button>
          )}
        </div>

        {entries.length === 0 && (
          <div
            className="dropzone"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
            style={{ border: "1.5px dashed var(--border-strong)", borderRadius: 12, padding: "32px 16px", textAlign: "center", cursor: "pointer", background: "var(--panel-sunken)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
          >
            <div style={{ width: 46, height: 46, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(6,170,144,0.14)", color: "var(--accent-teal-bright)" }}>
              <Icon name="upload" size={22} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Click or drop the label here</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>PDF or image, front and back — add as many as you need. Text is read automatically (with OCR for images), so the SOP audit runs without AI. Flat, square-on exports read best; photos of curved or angled packs read poorly, so use AI review for those.</div>
          </div>
        )}

        {entries.map((entry) => {
          const { extract } = entry;
          return (
            <div key={entry.id} style={{ boxShadow: "inset 0 0 0 1px var(--border)", borderRadius: 10, padding: "11px 13px", marginBottom: 10, background: "var(--panel-sunken)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Icon name={entry.file.type.startsWith("image/") ? "image" : "file"} size={18} style={{ color: "var(--accent-teal-bright)" }} />
                <span style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere", flex: "1 1 170px", minWidth: 0 }}>{entry.file.name}</span>
                <span className="mono" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{formatSize(entry.file.size)}</span>
                <button onClick={() => togglePreview(entry.id)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 13 }}>
                  {entry.showPreview ? "Hide" : "Show"}
                </button>
                <button onClick={() => removeEntry(entry.id)} aria-label={`Remove ${entry.file.name}`} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 13 }}>
                  Remove
                </button>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 7, alignItems: "flex-start", fontSize: 13, color: extract.state === "ready" ? "var(--accent-teal-bright)" : "var(--text-muted)" }}>
                {extract.state === "reading" && <span className="spin" style={{ width: 14, height: 14, marginTop: 2, borderRadius: 999, border: "2px solid var(--tint-4)", borderTopColor: "var(--accent-teal-bright)", flexShrink: 0 }} />}
                {extract.state === "ready" && <Icon name="check-circle" size={16} style={{ marginTop: 1 }} />}
                <span>
                  {extract.state === "reading" && extract.detail}
                  {extract.state === "ready" && (extract.label.source === "ocr"
                    ? `Read ${extract.label.charCount.toLocaleString()} characters with OCR. It can misread small or tilted text, so spelling findings are marked Review.${
                        extract.label.photoTextPx !== undefined && extract.label.photoTextPx < 10
                          ? ` The text in this photo is very small (about ${Math.round(extract.label.photoTextPx)} px tall), so expect misreads: use a closer or higher-resolution photo, or the print PDF.`
                          : ""
                      }`
                    : `Text found in the PDF (${extract.label.charCount.toLocaleString()} characters). The SOP audit can run without AI.`)}
                  {extract.state === "no-text" && "Couldn't read any text from this file, even with OCR. Use AI review."}
                  {extract.state === "error" && `Couldn't read the label text: ${extract.message}. Try AI review.`}
                </span>
              </div>
              {entry.showPreview && (
                <div style={{ marginTop: 12 }}>
                  <LabelPreview file={entry.file} height={360} />
                </div>
              )}
            </div>
          );
        })}

        {entries.length > 0 && (
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
            style={{ border: "1.5px dashed var(--border-strong)", borderRadius: 10, padding: "12px 16px", textAlign: "center", cursor: "pointer", color: "var(--text-secondary)", fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          >
            <Icon name="upload" size={15} /> Add another file (front, back, a second pack…)
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* Optional inputs */}
      <div className="surface" style={cardStyle}>
        <h2 style={cardTitle}>Optional details</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <div>
            <label htmlFor="mrp" style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>Expected MRP (₹), used in step 9</label>
            <input id="mrp" type="number" value={expectedMrp} onChange={(e) => { setExpectedMrp(e.target.value); clearReport(); }} placeholder="Filled from the sheet when available" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="ver" style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>Label version or notes (AI review)</label>
            <input id="ver" type="text" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. v2 Jan 2025" style={inputStyle} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={runRules}
          disabled={!canRules}
          style={{
            flex: "2 1 220px", padding: "14px 16px", borderRadius: 12, border: "none", fontWeight: 700, fontSize: 15,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: canRules ? "var(--btn-primary)" : "var(--tint-2)",
            color: canRules ? "var(--on-accent)" : "var(--text-muted)",
            boxShadow: canRules ? "var(--shadow-btn)" : "none",
          }}
        >
          {running === "rules" ? "Auditing…" : (<><Icon name="check-circle" size={18} /> Run SOP audit</>)}
        </button>
        <button
          onClick={runAi}
          disabled={!canAi}
          style={{ flex: "1 1 170px", padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border-strong)", background: "transparent", color: canAi ? "var(--text-primary)" : "var(--text-muted)", fontWeight: 600, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          {running === "ai" ? (<><span className="spin" style={{ width: 14, height: 14, borderRadius: 999, border: "2px solid var(--tint-4)", borderTopColor: "var(--accent-teal-bright)" }} /> Asking AI, up to a minute</>) : (<><Icon name="sparkle" size={18} /> Run AI review</>)}
        </button>
      </div>
      {selected && entries.length > 0 && !allReady && running === null && entries.some((e) => e.extract.state === "no-text" || e.extract.state === "error") && (
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--text-muted)" }}>The SOP audit needs readable text from every file; one of these couldn&apos;t be read. Remove it, or use AI review instead.</div>
      )}
      {runError && (
        <div role="alert" style={{ marginTop: 14, display: "flex", gap: 10, background: "rgba(232,64,64,0.1)", boxShadow: "inset 0 0 0 1px rgba(232,64,64,0.32)", borderRadius: 12, padding: "12px 14px", color: "var(--red-text)", fontSize: 14 }}>
          <Icon name="alert-circle" size={18} style={{ marginTop: 1 }} />
          <span>{runError}</span>
        </div>
      )}

      {/* Report */}
      {report && counts && (
        <div className="surface fade-up" style={{ ...cardStyle, marginTop: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", paddingBottom: 14, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{report.product}</h2>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
                <span className="mono">{report.pack_size}</span> &middot; {report.mode === "rules" ? "Rules engine, no AI" : "AI review"}
              </div>
            </div>
            <Badge status={report.overall} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: statusFilter ? 8 : 16 }}>
            {(["pass", "fail", "warn", "skip"] as CheckStatus[]).map((s) => {
              const on = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  className="card-lift"
                  disabled={counts[s] === 0}
                  aria-pressed={on}
                  aria-label={`${on ? "Show all checks" : `Show only ${STATUS_STYLE[s].label.toLowerCase()} checks`} (${counts[s]})`}
                  onClick={() => setStatusFilter(on ? null : s)}
                  style={{
                    textAlign: "left", cursor: counts[s] === 0 ? "default" : "pointer", color: "inherit",
                    background: on ? STATUS_STYLE[s].bg : "var(--panel-sunken)",
                    border: "none", boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? STATUS_STYLE[s].color : "var(--border)"}`,
                    borderRadius: 10, padding: "10px 12px", opacity: counts[s] === 0 ? 0.55 : 1,
                  }}
                >
                  <div className="mono" style={{ fontSize: 24, fontWeight: 500, color: STATUS_STYLE[s].color, lineHeight: 1.1 }}>{counts[s]}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{STATUS_STYLE[s].label}</div>
                </button>
              );
            })}
          </div>
          {statusFilter && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
              <span>Showing only {STATUS_STYLE[statusFilter].label.toLowerCase()} checks ({counts[statusFilter]}).</span>
              <button type="button" onClick={() => setStatusFilter(null)} style={{ background: "none", border: "none", color: "var(--accent-teal-bright)", fontSize: 13, textDecoration: "underline", padding: 0 }}>
                Show all
              </button>
            </div>
          )}

          {report.mode === "rules" && mergedLabel?.source === "ocr" && counts.warn / Math.max(1, counts.pass + counts.warn + counts.fail) >= 0.7 && (
            <div role="note" style={{ display: "flex", gap: 10, background: "rgba(255,192,0,0.1)", boxShadow: "inset 0 0 0 1px rgba(255,192,0,0.3)", borderRadius: 12, padding: "12px 14px", color: "var(--amber-text)", marginBottom: 12, fontSize: 13.5 }}>
              <Icon name="alert-circle" size={18} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>
                Most checks couldn&apos;t be confirmed from the OCR text. OCR reads curved, angled, blurry or glary photos poorly. If the label is flat and you&apos;ve uploaded every panel, you&apos;re done; otherwise try AI review, which handles these photos much better.
              </span>
            </div>
          )}

          {report.notes.map((n, i) => (
            <div key={i} style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>{n}</div>
          ))}

          <div style={{ marginTop: 12 }}>
            {report.steps.map((step) => {
              const ss = stepStatus(step);
              const shown = statusFilter ? step.checks.filter((c) => c.status === statusFilter) : step.checks;
              if (statusFilter && shown.length === 0) return null;
              const open = statusFilter ? true : !collapsed.has(step.step);
              return (
                <div key={step.step} style={{ boxShadow: "inset 0 0 0 1px var(--border)", borderRadius: 12, marginBottom: 10, overflow: "hidden", background: "var(--panel-sunken)" }}>
                  <button
                    onClick={() => toggleStep(step.step)}
                    aria-expanded={open}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--tint-1)", border: "none", color: "inherit", textAlign: "left" }}
                  >
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 44 }}>Step {step.step}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{step.name}</span>
                    <Badge status={ss} small />
                    <Icon name="chevron-down" size={16} style={{ color: "var(--text-muted)", transition: "transform 0.2s ease", transform: open ? "none" : "rotate(-90deg)" }} />
                  </button>
                  {open &&
                    shown.map((c, i) => (
                      <div key={i} style={{ display: "flex", gap: 11, padding: "12px 14px", borderTop: "1px solid var(--border)", alignItems: "flex-start" }}>
                        <Icon name={STATUS_STYLE[c.status].icon} size={18} style={{ color: STATUS_STYLE[c.status].color, marginTop: 1 }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>
                            {c.sop_rule && (
                              <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(183,200,21,0.14)", color: "var(--lime-text)", padding: "1px 6px", borderRadius: 5, marginRight: 7, verticalAlign: "middle" }}>SOP</span>
                            )}
                            {c.label}
                          </div>
                          {c.status !== "pass" && c.expected && (
                            <div style={{ fontSize: 13, marginTop: 4, wordBreak: "break-word" }}>
                              <span style={{ color: "var(--text-muted)" }}>Expected </span>
                              <span style={{ color: "var(--accent-teal-bright)" }}>{c.expected}</span>
                            </div>
                          )}
                          {c.found && (
                            <div style={{ fontSize: 13, marginTop: 2, wordBreak: "break-word" }}>
                              <span style={{ color: "var(--text-muted)" }}>On label </span>
                              <span style={{ color: c.status === "fail" ? "var(--red-text)" : c.status === "pass" ? "var(--accent-teal-bright)" : "var(--text-secondary)" }}>{c.found}</span>
                            </div>
                          )}
                          {c.note && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{c.note}</div>}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
