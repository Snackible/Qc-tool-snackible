import { NextRequest, NextResponse } from "next/server";
import { addProductToSheet, NewProduct } from "../../../../lib/googleSheets";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<NewProduct>;

    if (!body.sheet || !body.name) {
      return NextResponse.json({ error: "sheet and name are required" }, { status: 400 });
    }
    if (!Array.isArray(body.nutrition) || body.nutrition.length === 0) {
      return NextResponse.json({ error: "at least one nutrition block is required" }, { status: 400 });
    }

    const product: NewProduct = {
      sheet: body.sheet,
      name: body.name,
      brand_usp: body.brand_usp ?? [],
      ingredients: body.ingredients ?? "",
      nutrition: body.nutrition,
      rda: body.rda ?? [],
      serving_size_g: body.serving_size_g ?? body.nutrition[0].grammage,
      allergens: body.allergens ?? "",
      shelf_life: body.shelf_life ?? "",
      small_pack_g: body.small_pack_g ?? null,
      large_pack_g: body.large_pack_g ?? null,
      manufacturer: body.manufacturer ?? "",
      mrp: body.mrp ?? "",
    };

    await addProductToSheet(product);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
