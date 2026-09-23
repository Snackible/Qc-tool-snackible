"use client";

import { useState, useEffect } from "react";
import MarketSearch, { MarketIntelResult } from "../../components/intelligence/MarketSearch";
import CompetitorResults from "../../components/intelligence/CompetitorResults";
import ClaimHistory from "../../components/intelligence/ClaimHistory";

const HISTORY_KEY = "snackible_market_history";

export default function MarketIntelligencePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [marketResult, setMarketResult] = useState<MarketIntelResult | null>(null);
  const [history, setHistory] = useState<MarketIntelResult[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch {}
  }, []);

  function handleResults(data: MarketIntelResult) {
    setMarketResult(data);
    setHistory((prev) => {
      const updated = [data, ...prev].slice(0, 10);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  }

  return (
    <div
      style={{
        padding: "16px",
        minHeight: "100vh",
        background: "var(--bg-base)",
      }}
    >
      <h1 style={{ fontSize: "clamp(18px, 5vw, 22px)", fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
        Market Intelligence
      </h1>
      <p style={{ color: "var(--text-muted)", marginBottom: 20, fontSize: "13px" }}>
        Scan quick-commerce platforms for competitor products and claims.
      </p>

      {/* Coming Soon banner */}
      <div
        style={{
          background: "rgba(255,192,0,0.1)",
          border: "1px solid rgba(255,192,0,0.3)",
          borderRadius: 10,
          padding: "12px 18px",
          color: "var(--accent-amber)",
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>⚠</span>
        <span>Coming Soon — Live scraping integration is under development. Results are AI-generated simulations.</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <MarketSearch onResults={handleResults} isLoading={isLoading} setLoading={setIsLoading} />

        {isLoading && (
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 40,
              textAlign: "center",
            }}
          >
            <div style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: 8 }}>
              Scanning quick-commerce platforms…
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              Analysing competitors across Blinkit, Zepto, BigBasket, Swiggy Instamart &amp; Amazon
            </div>
          </div>
        )}

        {!isLoading && marketResult && (
          <CompetitorResults result={marketResult} />
        )}

        {!isLoading && !marketResult && (
          <ClaimHistory history={history} onSelect={setMarketResult} onClear={clearHistory} />
        )}

        {!isLoading && marketResult && history.length > 1 && (
          <ClaimHistory
            history={history.slice(1)}
            onSelect={(item) => setMarketResult(item)}
            onClear={clearHistory}
          />
        )}
      </div>
    </div>
  );
}
