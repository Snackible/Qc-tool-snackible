import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavSidebar from "../components/NavSidebar";

export const metadata: Metadata = {
  title: "Snackible QC",
  description: "Internal nutrition compliance, packaging QC & market intelligence",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#00302f",
};

// Runs before first paint so the saved theme never flashes the default one.
const themeInit = `(function(){try{var t=localStorage.getItem('snackible-theme');if(t!=='light'&&t!=='dark'&&t!=='neutral')t='neutral';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="neutral" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
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
