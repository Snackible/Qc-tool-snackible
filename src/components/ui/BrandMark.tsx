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
      <path
        d="M21 10.5c0-3-9-3.2-9 1.8 0 4.2 9 2.4 9 7.2 0 4.8-9.5 4.6-9.5.5"
        fill="none"
        stroke="#F0FAF9"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="23.5" cy="8" r="2" fill="#B7C815" />
    </svg>
  );
}
