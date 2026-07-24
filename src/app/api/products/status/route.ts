import { NextRequest, NextResponse } from "next/server";
import { updateProductStatus, VALID_STATUSES } from "../../../../lib/productStatus";

export async function POST(req: NextRequest) {
  try {
    const { sheet, name, status } = await req.json();

    if (!sheet || !name || !status) {
      return NextResponse.json({ error: "sheet, name and status are required" }, { status: 400 });
    }
    if (!(VALID_STATUSES as string[]).includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const result = await updateProductStatus(sheet, name, status);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
