import type { CSSProperties } from "react";

// One consistent set: 24px grid, 1.6 stroke, round caps and joins.
const PATHS = {
  box: ["M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z", "m3.5 7.5 8.5 4.5 8.5-4.5", "M12 12v9"],
  scan: ["M4 8V6a2 2 0 0 1 2-2h2", "M16 4h2a2 2 0 0 1 2 2v2", "M20 16v2a2 2 0 0 1-2 2h-2", "M8 20H6a2 2 0 0 1-2-2v-2", "M8 12h8"],
  badge: ["M12 3 5 6v5.5c0 4.2 2.9 7.7 7 9.5 4.1-1.8 7-5.3 7-9.5V6l-7-3Z", "m9 12 2 2 4-4"],
  trend: ["m3 17 6-6 4 4 8-8", "M15 7h6v6"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M5 20h14"],
  file: ["M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M14 3v5h5"],
  image: ["M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Z", "M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z", "m4 17 5-5 4 4 3-3 4 4"],
  x: ["M6 6l12 12", "M18 6 6 18"],
  check: ["m5 12.5 4.5 4.5L19 7.5"],
  alert: ["M12 4 3 19.5h18L12 4Z", "M12 10v4", "M12 17h.01"],
  "check-circle": ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m8.5 12.5 2.5 2.5 4.5-5"],
  "x-circle": ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m9 9 6 6", "m15 9-6 6"],
  "alert-circle": ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 8v4.5", "M12 15.5h.01"],
  "minus-circle": ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12h7"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-right": ["m9 6 6 6-6 6"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h10"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m20 20-3.5-3.5"],
  plus: ["M12 5v14", "M5 12h14"],
  "arrow-right": ["M5 12h14", "m13 6 6 6-6 6"],
  paperclip: ["m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"],
  sun: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M12 3v1.5", "M12 19.5V21", "M3 12h1.5", "M19.5 12H21", "m5.6 5.6 1.1 1.1", "m17.3 17.3 1.1 1.1", "m18.4 5.6-1.1 1.1", "m6.7 17.3-1.1 1.1"],
  moon: ["M20 14.2A8 8 0 0 1 9.8 4 8 8 0 1 0 20 14.2Z"],
  contrast: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 3v18", "M12 3a9 9 0 0 1 0 18"],
  sparkle: ["M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4", "m6.3 6.3 2.4 2.4", "m15.3 15.3 2.4 2.4", "m17.7 6.3-2.4 2.4", "m8.7 15.3-2.4 2.4"],
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 18,
  strokeWidth = 1.6,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flexShrink: 0, ...style }}
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
