import { NextRequest, NextResponse } from "next/server";
import { updateProductNutrition } from "../../../../lib/productStatus";

export async function POST(req: NextRequest) {
  try {
    const { sheet, name, nutrition, rda } = await req.json();

    if (!sheet || !name) {
      return NextResponse.json({ error: "sheet and name are required" }, { status: 400 });
    }
    if (nutrition !== null && !Array.isArray(nutrition)) {
      return NextResponse.json({ error: "nutrition must be an array or null" }, { status: 400 });
    }

    const override = nutrition === null ? null : { nutrition, rda: rda ?? [] };
    const result = await updateProductNutrition(sheet, name, override);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
