import { NextResponse } from "next/server";
import { parseProducts } from "../../../lib/parseProducts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await parseProducts();
    return NextResponse.json(products);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
