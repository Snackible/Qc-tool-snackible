import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { AiReference, buildAuditPrompt } from "../../../lib/labelAudit/prompt";
import { AuditCheck, AuditReport, AuditStep, CheckStatus, combineStatus } from "../../../lib/labelAudit/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUSES: CheckStatus[] = ["pass", "fail", "warn", "skip"];
const asStatus = (v: unknown): CheckStatus => (STATUSES.includes(v as CheckStatus) ? (v as CheckStatus) : "warn");
const asText = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

function normalizeReport(raw: unknown, ref: AiReference): AuditReport {
  const r = (raw ?? {}) as { product?: unknown; pack_size?: unknown; steps?: unknown };
  const steps: AuditStep[] = (Array.isArray(r.steps) ? r.steps : [])
    .map((s: { step?: unknown; name?: unknown; checks?: unknown }) => ({
      step: typeof s?.step === "number" ? s.step : 0,
      name: asText(s?.name) ?? "Step",
      checks: (Array.isArray(s?.checks) ? s.checks : []).map(
        (c: Partial<Record<keyof AuditCheck, unknown>>): AuditCheck => ({
          label: asText(c?.label) ?? "Check",
          status: asStatus(c?.status),
          expected: asText(c?.expected),
          found: asText(c?.found),
          note: asText(c?.note),
          sop_rule: c?.sop_rule === true,
        })
      ),
    }))
    .filter((s: AuditStep) => s.checks.length > 0);

  return {
    product: asText(r.product) ?? ref.productName,
    pack_size: asText(r.pack_size) ?? (ref.packSizeG ? `${ref.packSizeG}g` : "pack size not set"),
    overall: combineStatus(steps.flatMap((s) => s.checks.map((c) => c.status))),
    steps,
    mode: "ai",
    notes: ["AI review (Claude) of the label image. Wording judgments can vary between runs; treat Review items as prompts for a human check."],
  };
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_QC_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_QC_KEY is not configured on the server." }, { status: 500 });
    }

    const form = await req.formData();
    const images = form.getAll("images").filter((f): f is File => f instanceof File);
    const refJson = form.get("reference");
    if (images.length === 0 || images.length > 4) {
      return NextResponse.json({ error: "Send 1 to 4 label images." }, { status: 400 });
    }
    if (typeof refJson !== "string") {
      return NextResponse.json({ error: "Missing reference data." }, { status: 400 });
    }
    const ref = JSON.parse(refJson) as AiReference;
    if (!ref.productName) {
      return NextResponse.json({ error: "Missing product name." }, { status: 400 });
    }

    const content: Anthropic.MessageParam["content"] = [];
    for (const img of images) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(await img.arrayBuffer()).toString("base64") },
      });
    }
    content.push({ type: "text", text: buildAuditPrompt(ref) });

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content }],
    });

    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1) {
      return NextResponse.json({ error: "The AI reply did not contain a report. Try again." }, { status: 502 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(first, last + 1));
    } catch {
      return NextResponse.json({ error: "The AI reply was not valid JSON. Try again." }, { status: 502 });
    }

    const report = normalizeReport(parsed, ref);
    if (report.steps.length === 0) {
      return NextResponse.json({ error: "The AI reply had no checks. Try again." }, { status: 502 });
    }
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
