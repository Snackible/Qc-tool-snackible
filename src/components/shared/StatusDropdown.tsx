"use client";

import { useState } from "react";
import { ProductStatus } from "../../lib/types";
import Icon from "../ui/Icon";

// tinted versions of the brand palette (teal / lime / amber / red)
const STATUS_OPTIONS: { value: ProductStatus; label: string; dot: string; bg: string; text: string; ring: string }[] = [
  { value: "not_launched",       label: "Not launched",         dot: "#E84040", bg: "rgba(232,64,64,0.14)",  text: "var(--red-text)", ring: "rgba(232,64,64,0.38)" },
  { value: "under_review",       label: "Under review",         dot: "#FFC000", bg: "rgba(255,192,0,0.13)",  text: "var(--amber-text)", ring: "rgba(255,192,0,0.36)" },
  { value: "needs_verification", label: "Needs verification",   dot: "#B7C815", bg: "rgba(183,200,21,0.13)", text: "var(--lime-text)", ring: "rgba(183,200,21,0.36)" },
  { value: "launched",           label: "Launched",             dot: "#06AA90", bg: "rgba(6,170,144,0.18)",  text: "var(--teal-text)", ring: "rgba(6,170,144,0.45)" },
];

interface StatusDropdownProps {
  value: ProductStatus;
  onChange: (status: ProductStatus) => Promise<void> | void;
}

export default function StatusDropdown({ value, onChange }: StatusDropdownProps) {
  const [saving, setSaving] = useState(false);
  const current = STATUS_OPTIONS.find((o) => o.value === value) ?? STATUS_OPTIONS[0];

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as ProductStatus;
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
      <span
        aria-hidden="true"
        style={{ position: "absolute", left: 10, width: 7, height: 7, borderRadius: 999, background: current.dot, boxShadow: `0 0 0 3px ${current.ring}`, pointerEvents: "none" }}
      />
      <select
        aria-label="Launch status"
        value={value}
        onChange={handleChange}
        disabled={saving}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          border: `1px solid ${current.ring}`,
          borderRadius: 8,
          padding: "6px 28px 6px 26px",
          fontSize: 12,
          fontWeight: 600,
          cursor: saving ? "wait" : "pointer",
          background: current.bg,
          color: current.text,
          opacity: saving ? 0.65 : 1,
          minHeight: 30,
        }}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ background: "var(--menu-bg)", color: "var(--text-primary)" }}>
            {opt.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} style={{ position: "absolute", right: 8, color: current.text, pointerEvents: "none" }} />
    </span>
  );
}
