"use client";

import { useState } from "react";
import { ProductStatus } from "../../lib/types";

const STATUS_OPTIONS: { value: ProductStatus; label: string; bg: string; color: string }[] = [
  { value: "not_launched",       label: "Not Launched",         bg: "#ef4444", color: "#ffffff" },
  { value: "under_review",       label: "Under Review",         bg: "#eab308", color: "#1a1a1a" },
  { value: "needs_verification", label: "Needs to be Verified", bg: "#a855f7", color: "#ffffff" },
  { value: "launched",           label: "Launched Product",     bg: "#4ade80", color: "#1a1a1a" },
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
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={handleChange}
      disabled={saving}
      style={{
        appearance: "none",
        WebkitAppearance: "none",
        border: "none",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        cursor: saving ? "wait" : "pointer",
        background: current.bg,
        color: current.color,
        opacity: saving ? 0.7 : 1,
      }}
    >
      {STATUS_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value} style={{ background: "#fff", color: "#1a1a1a" }}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
