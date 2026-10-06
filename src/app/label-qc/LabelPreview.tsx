"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const btn: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 5, border: "1px solid var(--border)",
  background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
  fontSize: 13, lineHeight: 1,
};

export default function LabelPreview({ file, height = 700 }: { file: File; height?: number }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderRef    = useRef<number>(0);           // cancel stale renders

  const [url, setUrl]           = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage]         = useState(1);
  const [scale, setScale]       = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true);
  const [cWidth, setCWidth]     = useState(680);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const isPdf = file.type === "application/pdf";
  const isImg = file.type.startsWith("image/");

  /* ── blob URL lifecycle ── */
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setPage(1);
    setScale(1.0);
    setFitWidth(true);
    setNumPages(0);
    setPdfError(null);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  /* ── container width observer ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCWidth(Math.max(200, e.contentRect.width - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── PDF render ── */
  useEffect(() => {
    if (!isPdf || !url || !canvasRef.current) return;
    const id = ++renderRef.current;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

        const pdf = await pdfjs.getDocument({ url }).promise;
        if (id !== renderRef.current) return;
        setNumPages(pdf.numPages);

        const pg          = await pdf.getPage(page);
        if (id !== renderRef.current) return;
        const base        = pg.getViewport({ scale: 1 });
        const targetW     = fitWidth ? cWidth : Math.round(cWidth * scale);
        const renderScale = targetW / base.width;
        const viewport    = pg.getViewport({ scale: renderScale });

        const canvas = canvasRef.current!;
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        await pg.render({ canvasContext: ctx, viewport, canvas }).promise;
      } catch (e) {
        if (id === renderRef.current) setPdfError(String(e));
      }
    })();
  }, [url, page, scale, fitWidth, cWidth, isPdf]);

  /* ── controls ── */
  const zoomIn   = useCallback(() => { setFitWidth(false); setScale(s => +(Math.min(s + 0.25, 3)).toFixed(2)); }, []);
  const zoomOut  = useCallback(() => { setFitWidth(false); setScale(s => +(Math.max(s - 0.25, 0.25)).toFixed(2)); }, []);
  const doFit    = useCallback(() => setFitWidth(true), []);
  const prevPage = useCallback(() => setPage(p => Math.max(1, p - 1)), []);
  const nextPage = useCallback((n: number) => () => setPage(p => Math.min(n, p + 1)), []);

  if (!url) return null;

  const scaleLabel = fitWidth ? "Fit" : `${Math.round(scale * 100)}%`;

  return (
    <div style={{
      marginBottom: 28, background: "var(--bg-elevated)",
      border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden",
    }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Uploaded Label Preview
        </span>

        {/* Page nav — multi-page PDFs only */}
        {isPdf && numPages > 1 && (
          <>
            <button onClick={prevPage} disabled={page <= 1} style={btn}>‹</button>
            <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 54, textAlign: "center" }}>
              {page} / {numPages}
            </span>
            <button onClick={nextPage(numPages)} disabled={page >= numPages} style={btn}>›</button>
            <div style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
          </>
        )}

        {/* Zoom */}
        <button onClick={zoomOut} style={btn} title="Zoom out">−</button>
        <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 40, textAlign: "center", userSelect: "none" as const }}>
          {scaleLabel}
        </span>
        <button onClick={zoomIn} style={btn} title="Zoom in">+</button>
        <button
          onClick={doFit}
          title="Fit width"
          style={{ ...btn, marginLeft: 2, color: fitWidth ? "var(--accent-teal)" : "var(--text-secondary)", borderColor: fitWidth ? "var(--accent-teal)" : "var(--border)" }}
        >
          ⟷
        </button>
      </div>

      {/* ── Preview body ── */}
      <div
        ref={containerRef}
        style={{
          height, overflowY: "auto", overflowX: "hidden",
          background: "var(--bg-base)",
          display: "flex", justifyContent: "center", alignItems: "flex-start",
          padding: "16px",
        }}
      >
        {isPdf && !pdfError && (
          <canvas ref={canvasRef} style={{ display: "block", maxWidth: "100%" }} />
        )}
        {isPdf && pdfError && (
          <div style={{ color: "var(--red-text)", fontSize: 13, padding: 48, textAlign: "center" }}>
            Could not render PDF: {pdfError}
          </div>
        )}
        {isImg && url && (
          <img
            src={url}
            alt="Uploaded label"
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }}
          />
        )}
      </div>

      {/* ── Footer ── */}
      {isPdf && numPages > 0 && (
        <div style={{ padding: "6px 14px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
          <span>{file.name}</span>
          <span>{numPages} page{numPages !== 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}
