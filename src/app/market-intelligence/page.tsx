"use client";

import { useState, useEffect } from "react";
import MarketSearch, { MarketIntelResult } from "../../components/intelligence/MarketSearch";
import CompetitorResults from "../../components/intelligence/CompetitorResults";
import ClaimHistory from "../../components/intelligence/ClaimHistory";
import Icon from "../../components/ui/Icon";

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
    <div style={{ padding: "var(--page-pad)", paddingBottom: 56 }}>
      <h1 className="page-title">Market intelligence</h1>
      <p className="page-sub" style={{ marginBottom: 22 }}>
        Scan quick-commerce platforms for competitor products and claims.
      </p>

      {/* Coming Soon banner */}
      <div
        role="note"
        style={{
          background: "rgba(255,192,0,0.1)",
          boxShadow: "inset 0 0 0 1px rgba(255,192,0,0.3)",
          borderRadius: 12,
          padding: "12px 16px",
          color: "#FFD04D",
          fontSize: 14,
          marginBottom: 24,
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <Icon name="alert" size={17} style={{ marginTop: 2 }} />
        <span><strong style={{ fontWeight: 600 }}>Coming soon.</strong> Live scraping is still in development, so results are AI-generated simulations.</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <MarketSearch onResults={handleResults} isLoading={isLoading} setLoading={setIsLoading} />

        {isLoading && (
          <div
            className="surface"
            role="status"
            style={{ padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
          >
            <span className="spin" style={{ width: 22, height: 22, borderRadius: 999, border: "2.5px solid rgba(255,255,255,0.16)", borderTopColor: "var(--accent-teal-bright)", marginBottom: 6 }} />
            <div style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600 }}>
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
