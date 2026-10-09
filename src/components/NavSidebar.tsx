"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon, { IconName } from "./ui/Icon";
import BrandMark from "./ui/BrandMark";
import ThemeSwitch from "./ui/ThemeSwitch";

const NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/products", label: "Product Library", icon: "box" },
  { href: "/label-qc", label: "Label QC", icon: "scan" },
  { href: "/fssai-claims", label: "FSSAI Claims", icon: "badge" },
  { href: "/market-intelligence", label: "Market Intelligence", icon: "trend" },
];

function Brand() {
  return (
    <div className="nav-brand">
      <BrandMark />
      <div>
        <div className="nav-brand-name">snackible</div>
        <div className="nav-brand-sub">Nutrition &amp; QC</div>
      </div>
    </div>
  );
}

function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      <div className="nav-section">Workspace</div>
      <nav aria-label="Main" className="nav-list">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} className={`nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export default function NavSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* desktop */}
      <aside className="sidebar">
        <Brand />
        <NavLinks />
        <div className="nav-foot">
          <ThemeSwitch />
          <span>{process.env.NEXT_PUBLIC_APP_VERSION}</span>
        </div>
      </aside>

      {/* mobile: top bar + slide-in drawer (hidden on desktop by CSS) */}
      <header className="mobile-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark size={30} />
          <span className="nav-brand-name" style={{ fontSize: 18 }}>snackible</span>
        </div>
        <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
          <Icon name="menu" size={20} />
        </button>
      </header>
      <div className={`drawer-overlay${open ? " open" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className={`drawer${open ? " open" : ""}`} aria-hidden={!open}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: 12 }}>
          <Brand />
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close menu" tabIndex={open ? 0 : -1}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <NavLinks />
        <div className="nav-foot">
          <ThemeSwitch />
          <span>{process.env.NEXT_PUBLIC_APP_VERSION}</span>
        </div>
      </aside>
    </>
  );
}
