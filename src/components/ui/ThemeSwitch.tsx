"use client";

import { useEffect, useState } from "react";
import Icon, { IconName } from "./Icon";

export type Theme = "light" | "dark" | "neutral";

const THEMES: { id: Theme; label: string; icon: IconName }[] = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
  { id: "neutral", label: "Neutral", icon: "contrast" },
];

// browser UI colour (mobile address bar) per theme
const CHROME: Record<Theme, string> = { light: "#eef3f1", dark: "#0d1413", neutral: "#00302f" };
const KEY = "snackible-theme";
const EVENT = "snackible-theme-change";

function readTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "neutral";
}

export default function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const sync = () => {
      const t = readTheme();
      setTheme(t);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CHROME[t]);
    };
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const choose = (t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // storage can be blocked; the theme still applies for this visit
    }
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <div role="group" aria-label="Colour theme" className="theme-switch">
      {THEMES.map((t) => (
        <button key={t.id} className="theme-btn" aria-pressed={theme === t.id} onClick={() => choose(t.id)} title={`${t.label} theme`}>
          <Icon name={t.icon} size={15} />
          {t.label}
        </button>
      ))}
    </div>
  );
}
