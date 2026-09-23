"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const NAV_ITEMS = [
  { href: "/products", label: "Product Library", icon: "📦" },
  { href: "/label-qc", label: "Label QC", icon: "🔍" },
  { href: "/fssai-claims", label: "FSSAI Claims", icon: "✓" },
  { href: "/market-intelligence", label: "Market Intelligence", icon: "📊" },
];

export default function NavSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) setIsOpen(false);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isMobile) {
    return (
      <>
        {/* Mobile hamburger button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 100,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ☰
        </button>

        {/* Mobile drawer overlay */}
        {isOpen && (
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 99,
            }}
          />
        )}

        {/* Mobile drawer */}
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: 200,
            height: "100vh",
            background: "var(--bg-surface)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            zIndex: 101,
            transform: isOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.3s ease",
            overflowY: "auto",
          }}
        >
          {/* Logo */}
          <div
            style={{
              padding: "24px 20px 20px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>
              snackible
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
              QC Platform
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: "12px 0" }}>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 20px",
                    textDecoration: "none",
                    color: isActive ? "var(--accent-teal)" : "var(--text-muted)",
                    background: isActive ? "rgba(6,170,144,0.08)" : "transparent",
                    borderLeft: isActive ? "3px solid var(--accent-teal)" : "3px solid transparent",
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div
            style={{
              padding: "16px 20px",
              borderTop: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontSize: 10,
            }}
          >
            v1.0
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      style={{
        width: 240,
        minWidth: 240,
        height: "100vh",
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo / Brand */}
      <div
        style={{
          padding: "24px 20px 20px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)", letterSpacing: "-0.3px" }}>
          snackible
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          Nutrition & QC Platform
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "12px 0" }}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 20px",
                textDecoration: "none",
                color: isActive ? "var(--accent-teal)" : "var(--text-muted)",
                background: isActive ? "rgba(6,170,144,0.08)" : "transparent",
                borderLeft: isActive ? "3px solid var(--accent-teal)" : "3px solid transparent",
                fontWeight: isActive ? 600 : 400,
                fontSize: 13,
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLAnchorElement).style.background = "var(--bg-elevated)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                }
              }}
            >
              <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: "16px 20px",
          borderTop: "1px solid var(--border)",
          color: "var(--text-muted)",
          fontSize: 12,
        }}
      >
        v1.0 — Internal Use Only
      </div>
    </div>
  );
}
