"use client";

import { useState } from "react";
import { Star, TrendingUp, Lightbulb, AlertTriangle, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { MarketIntelResult, MarketCompetitor, SIAnalysisItem } from "./MarketSearch";
import { cn } from "../../lib/utils";

const PLATFORMS = ["All", "Blinkit", "Zepto", "BigBasket", "SwiggyInstamart", "Amazon"] as const;

const PLATFORM_COLORS: Record<string, string> = {
  Blinkit: "bg-[rgba(255,192,0,0.12)] text-[#FFD04D] border-[rgba(255,192,0,0.3)]",
  Zepto: "bg-[rgba(183,200,21,0.12)] text-[#D2E04A] border-[rgba(183,200,21,0.3)]",
  BigBasket: "bg-[rgba(6,170,144,0.15)] text-[#5FE0C8] border-[rgba(6,170,144,0.35)]",
  SwiggyInstamart: "bg-[rgba(232,64,64,0.13)] text-[#FF9C9C] border-[rgba(232,64,64,0.32)]",
  Amazon: "bg-[rgba(169,203,202,0.12)] text-[#A9CBCA] border-[rgba(169,203,202,0.28)]",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-[#5FE0C8] bg-[rgba(6,170,144,0.15)] border-[rgba(6,170,144,0.35)]",
  negative: "text-[#FF9C9C] bg-[rgba(232,64,64,0.13)] border-[rgba(232,64,64,0.32)]",
  neutral: "text-[var(--text-muted)] bg-[rgba(255,255,255,0.05)] border-[var(--border)]",
};

const ALIGNMENT_COLORS: Record<string, string> = {
  High: "text-[#5FE0C8] bg-[rgba(6,170,144,0.15)] border-[rgba(6,170,144,0.4)]",
  Medium: "text-[#FFD04D] bg-[rgba(255,192,0,0.12)] border-[rgba(255,192,0,0.38)]",
  Low: "text-[#FF9C9C] bg-[rgba(232,64,64,0.13)] border-[rgba(232,64,64,0.38)]",
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      <Star className="w-3 h-3 fill-[var(--accent-amber)] text-[var(--accent-amber)]" />
      <span className="text-xs font-mono font-bold text-[var(--text-primary)]">{rating.toFixed(1)}</span>
    </div>
  );
}

function SIScorePill({ score }: { score: number }) {
  const color = score >= 4 ? "text-[#5FE0C8] bg-[rgba(6,170,144,0.15)]" : score >= 3 ? "text-[#FFD04D] bg-[rgba(255,192,0,0.13)]" : "text-[#FF9C9C] bg-[rgba(232,64,64,0.13)]";
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-bold font-mono", color)}>
      SI {score.toFixed(1)}
    </span>
  );
}

function CompetitorCard({ competitor }: { competitor: MarketCompetitor }) {
  const [showReviews, setShowReviews] = useState(false);
  return (
    <div className="surface p-4 hover:border-[var(--border-strong)] transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-bold text-[var(--accent-teal-bright)]">{competitor.brand}</p>
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-tight mt-0.5">{competitor.product_name}</p>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap", PLATFORM_COLORS[competitor.platform])}>
          {competitor.platform === "SwiggyInstamart" ? "Swiggy" : competitor.platform}
        </span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-base font-bold text-[var(--text-primary)]">₹{competitor.price}</span>
        <span className="text-xs text-[var(--text-muted)]">{competitor.pack_size}</span>
        <StarRating rating={competitor.rating} />
        <span className="text-xs text-[var(--text-muted)] ml-auto">
          ₹{Math.round((competitor.price / parseFloat(competitor.pack_size)) * 100)}/100g
        </span>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {competitor.claims.map((claim) => (
          <span key={claim} className="text-xs px-2 py-0.5 bg-[rgba(6,170,144,0.14)] text-[var(--accent-teal-bright)] rounded-full border border-[rgba(6,170,144,0.28)]">
            {claim}
          </span>
        ))}
      </div>

      <button
        onClick={() => setShowReviews(!showReviews)}
        className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent-teal-bright)] transition-colors"
      >
        {showReviews ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {competitor.sample_reviews.length} customer reviews
      </button>

      {showReviews && (
        <div className="mt-2 space-y-1.5">
          {competitor.sample_reviews.map((r, i) => (
            <div key={i} className={cn("text-xs p-2 rounded-lg border", SENTIMENT_COLORS[r.sentiment])}>
              "{r.text}"
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SIAnalysisRow({ item }: { item: SIAnalysisItem }) {
  return (
    <div className="surface p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-xs text-[var(--text-muted)] font-medium">{item.brand}</p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">"{item.competitor_claim}"</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <SIScorePill score={item.si_score} />
          <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", ALIGNMENT_COLORS[item.alignment])}>
            {item.alignment}
          </span>
        </div>
      </div>
      {item.risk_flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {item.risk_flags.map((f) => (
            <span key={f} className="flex items-center gap-1 text-xs px-2 py-0.5 bg-[rgba(255,192,0,0.12)] text-[#FFD04D] rounded-full border border-[rgba(255,192,0,0.3)]">
              <AlertTriangle className="w-3 h-3" />
              {f}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-[var(--text-secondary)] bg-[rgba(6,170,144,0.14)] rounded-lg p-2">
        <span className="font-semibold text-[var(--accent-teal-bright)]">Snackible edge: </span>
        {item.snackible_advantage}
      </p>
    </div>
  );
}

export default function CompetitorResults({ result }: { result: MarketIntelResult }) {
  const [activeTab, setActiveTab] = useState<string>("All");

  const filtered = activeTab === "All"
    ? result.competitors
    : result.competitors.filter((c) => c.platform === activeTab);

  const { market_summary } = result;

  return (
    <div className="space-y-4">
      {/* Data source badge */}
      {result.dataSource && (
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-xs px-3 py-1 rounded-full border font-medium",
            result.dataSource === "scraper"
              ? "bg-[rgba(6,170,144,0.15)] text-[#5FE0C8] border-[rgba(6,170,144,0.35)]"
              : result.dataSource === "apify"
              ? "bg-[rgba(169,203,202,0.12)] text-[#A9CBCA] border-[rgba(169,203,202,0.28)]"
              : "bg-[rgba(255,192,0,0.12)] text-[#FFD04D] border-[rgba(255,192,0,0.3)]"
          )}>
            {result.dataSource === "scraper" && "Live scraped data"}
            {result.dataSource === "apify" && "Apify actor data"}
            {result.dataSource === "claude" && "AI-generated data (add SCRAPER_URL to use live scraping)"}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            Results for "{result.keyword}" · {result.category} · {result.region}
          </span>
        </div>
      )}

      {/* Market Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="surface p-3 text-center">
          <p className="text-xl font-bold font-mono text-[var(--accent-teal-bright)]">{result.competitors.length}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Competitors found</p>
        </div>
        <div className="surface p-3 text-center">
          <p className="text-xl font-bold font-mono text-[var(--accent-teal-bright)]">₹{market_summary.avg_price}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Average market price</p>
        </div>
        <div className="surface p-3 text-center">
          <p className="text-xl font-bold font-mono text-[var(--accent-amber)]">
            {market_summary.sentiment_breakdown.positive}%
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Positive sentiment</p>
        </div>
        <div className="surface p-3 text-center">
          <p className="text-xl font-bold font-mono text-[var(--accent-teal-bright)]">{market_summary.white_space.length}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">White space gaps</p>
        </div>
      </div>

      {/* Dominant Claims + White Space */}
      <div className="grid grid-cols-2 gap-4">
        <div className="surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-[var(--accent-teal-bright)]" />
            <p className="text-xs font-bold text-[var(--text-primary)]">Dominant market claims</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {market_summary.dominant_claims.map((c) => (
              <span key={c} className="text-xs px-2.5 py-1 bg-[rgba(255,255,255,0.04)] border border-[var(--border)] text-[var(--text-secondary)] rounded-full">
                {c}
              </span>
            ))}
          </div>
        </div>
        <div className="surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-[var(--accent-amber)]" />
            <p className="text-xs font-bold text-[var(--text-primary)]">White space opportunities</p>
          </div>
          <div className="space-y-1.5">
            {market_summary.white_space.map((w) => (
              <div key={w} className="flex items-start gap-2 text-xs p-2 bg-[rgba(255,192,0,0.1)] rounded-lg border border-[rgba(255,192,0,0.3)]">
                <ArrowRight className="w-3.5 h-3.5 text-[var(--accent-amber)] flex-shrink-0 mt-0.5" />
                <span className="text-[var(--text-secondary)]">{w}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Platform Tabs + Product Grid */}
      <div className="surface overflow-hidden">
        <div className="flex items-center gap-1 p-2 border-b border-[var(--border)] bg-[rgba(255,255,255,0.04)] overflow-x-auto">
          {PLATFORMS.map((p) => {
            const count = p === "All" ? result.competitors.length : result.competitors.filter((c) => c.platform === p).length;
            if (count === 0 && p !== "All") return null;
            return (
              <button
                key={p}
                onClick={() => setActiveTab(p)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap",
                  activeTab === p
                    ? "bg-[var(--accent-teal)] text-[#002d2b]"
                    : "text-[var(--text-muted)] hover:bg-[rgba(6,170,144,0.14)] hover:text-[var(--accent-teal-bright)]"
                )}
              >
                {p === "SwiggyInstamart" ? "Swiggy" : p}
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", activeTab === p ? "bg-[rgba(0,45,43,0.25)]" : "bg-[rgba(255,255,255,0.09)]")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <CompetitorCard key={c.id} competitor={c} />
          ))}
        </div>
      </div>

      {/* SI Analysis */}
      <div className="surface p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-lg bg-[rgba(6,170,144,0.14)] flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5 text-[var(--accent-teal-bright)]" />
          </div>
          <h3 className="font-bold text-[var(--text-primary)] text-sm">
            Competitor claim SI analysis
          </h3>
          <span className="text-xs text-[var(--text-muted)] ml-auto">How do competitor claims score against Snackible's brand?</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {result.si_analysis.map((item, i) => (
            <SIAnalysisRow key={i} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
