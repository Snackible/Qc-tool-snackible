"use client";

import { useId } from "react";

export default function BrandMark({ size = 34 }: { size?: number }) {
  // each instance needs its own gradient id: a gradient defined inside a display:none copy doesn't render for the others
  const id = `bm${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0a8f7b" />
          <stop offset="1" stopColor="#005a57" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="rgba(255,255,255,0.14)" />
      <g transform="translate(16 16.4) scale(1.12) translate(-16 -14.8)" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11.8 6.8l4.7 8.8" stroke="#F0FAF9" strokeWidth="3.6" />
        <path d="M16.6 11.2c5.2 1.2 6.6 7.2 3.2 11.1" stroke="#F0FAF9" strokeWidth="2.2" />
        <path d="M10.5 20h8" stroke="#B7C815" strokeWidth="2.2" />
        <path d="M9 24.4h14" stroke="#F0FAF9" strokeWidth="2.4" />
      </g>
    </svg>
  );
}
