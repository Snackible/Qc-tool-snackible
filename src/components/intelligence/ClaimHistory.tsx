"use client";

import { Clock, Trash2, ChevronRight } from "lucide-react";
import { MarketIntelResult } from "./MarketSearch";

interface Props {
  history: MarketIntelResult[];
  onSelect: (item: MarketIntelResult) => void;
  onClear: () => void;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ClaimHistory({ history, onSelect, onClear }: Props) {
  if (history.length === 0) return null;

  return (
    <div className="surface p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--text-muted)]" />
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Search history</h3>
        </div>
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--red-text)] transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Clear
        </button>
      </div>
      <div className="space-y-1.5">
        {history.map((item, i) => (
          <button
            key={i}
            onClick={() => onSelect(item)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[var(--tint-1)] transition-colors text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-[rgba(6,170,144,0.14)] flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-[var(--accent-teal-bright)]">{item.competitors.length}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">"{item.keyword}"</p>
              <p className="text-xs text-[var(--text-muted)]">
                {item.category} · {item.region} · {timeAgo(item.timestamp)}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--accent-teal-bright)] transition-colors flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
