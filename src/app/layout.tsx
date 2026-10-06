import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavSidebar from "../components/NavSidebar";

export const metadata: Metadata = {
  title: "Snackible Nutrition Platform",
  description: "Internal nutrition compliance, packaging QC & market intelligence",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#003433",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="app-shell">
        <a href="#main" className="skip-link">Skip to content</a>
        <NavSidebar />
        <main id="main" className="app-main">
          <div className="page-container">{children}</div>
        </main>
      </body>
    </html>
  );
}
