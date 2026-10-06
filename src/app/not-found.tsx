import Link from "next/link";
import Icon from "../components/ui/Icon";

export default function NotFound() {
  return (
    <div style={{ padding: "var(--page-pad)", minHeight: "70dvh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: 14 }}>
      <div className="eyebrow">Error 404</div>
      <h1 className="page-title">That page doesn&apos;t exist</h1>
      <p className="page-sub">The link may be out of date, or the page was moved. Head back to the product library to keep working.</p>
      <Link
        href="/products"
        style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 6, padding: "11px 18px", borderRadius: 10, background: "var(--accent-teal)", color: "#003433", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
      >
        Product library <Icon name="arrow-right" size={16} />
      </Link>
    </div>
  );
}
