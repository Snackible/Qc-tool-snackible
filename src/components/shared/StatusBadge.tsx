"use client";

interface StatusBadgeProps {
  status: string;
  size?: "xs" | "sm" | "md";
  customLabel?: string;
}

const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
  PASS:         { bg: "rgba(6,170,144,0.15)",   color: "var(--teal-text)", label: "PASS" },
  VALID:        { bg: "rgba(6,170,144,0.15)",   color: "var(--teal-text)", label: "VALID" },
  FOUND:        { bg: "rgba(6,170,144,0.15)",   color: "var(--teal-text)", label: "FOUND" },
  ON_TARGET:    { bg: "rgba(6,170,144,0.15)",   color: "var(--teal-text)", label: "ON TARGET" },
  ABOVE:        { bg: "rgba(183,200,21,0.15)",  color: "var(--lime-text)", label: "ABOVE" },
  High:         { bg: "rgba(6,170,144,0.15)",   color: "var(--teal-text)", label: "High" },
  FAIL:         { bg: "rgba(232,64,64,0.15)",   color: "var(--red-text)", label: "FAIL" },
  INVALID:      { bg: "rgba(232,64,64,0.15)",   color: "var(--red-text)", label: "INVALID" },
  MISSING:      { bg: "rgba(232,64,64,0.15)",   color: "var(--red-text)", label: "MISSING" },
  CRITICAL:     { bg: "rgba(232,64,64,0.15)",   color: "var(--red-text)", label: "CRITICAL" },
  WARNING:      { bg: "rgba(255,192,0,0.15)",   color: "var(--amber-text)", label: "WARNING" },
  REVIEW:       { bg: "rgba(255,192,0,0.15)",   color: "var(--amber-text)", label: "REVIEW" },
  Low:          { bg: "rgba(232,64,64,0.15)",   color: "var(--red-text)", label: "Low" },
  Medium:       { bg: "rgba(255,192,0,0.15)",   color: "var(--amber-text)", label: "Medium" },
  positive:     { bg: "rgba(6,170,144,0.15)",   color: "var(--teal-text)", label: "positive" },
  negative:     { bg: "rgba(232,64,64,0.15)",   color: "var(--red-text)", label: "negative" },
  neutral:      { bg: "rgba(155,191,190,0.15)", color: "var(--text-secondary)", label: "neutral" },
  BELOW:        { bg: "rgba(155,191,190,0.15)", color: "var(--text-secondary)", label: "BELOW" },
};

export default function StatusBadge({ status, size = "sm", customLabel }: StatusBadgeProps) {
  const s = STATUS_MAP[status] ?? { bg: "rgba(155,191,190,0.15)", color: "var(--text-secondary)", label: status };
  const fontSize = size === "xs" ? 10 : size === "sm" ? 11 : 13;
  const padding = size === "xs" ? "1px 6px" : size === "sm" ? "2px 8px" : "4px 12px";

  return (
    <span
      style={{
        display: "inline-block",
        padding,
        borderRadius: 4,
        fontSize,
        fontWeight: 700,
        background: s.bg,
        color: s.color,
      }}
    >
      {customLabel ?? s.label}
    </span>
  );
}
