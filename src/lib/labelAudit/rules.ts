/**
 * Deterministic SOP audit of a label's extracted text against the sheet's reference data.
 * No AI involved: every check is a rule on text positions/strings, so the result is the same each run.
 * When something can't be located on the label (or the sheet has no reference), the check is "skip",
 * never a guessed pass/fail.
 */
import { NutritionBlock } from "../types";
import { flattenItems } from "./flatten";
import { NUTRIENTS, UNIT_WORDS } from "./nutrients";
import { AuditReference } from "./reference";
import { Row, buildRows, buildViews, editDistance, joinItems, normalize, rowText, viewsContain, words } from "./textUtils";
import { AuditCheck, AuditReport, AuditStep, CheckStatus, ExtractedLabel, LabelItem, STEP_NAMES, combineStatus } from "./types";

type Ctx = { rows: Row[]; flat: string; views: string[]; ocr: boolean };

const MIN_TEXT_CHARS = 40;

export function labelHasText(label: ExtractedLabel): boolean {
  return label.charCount >= MIN_TEXT_CHARS;
}

function findAll(re: RegExp, text: string): RegExpExecArray[] {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const rx = new RegExp(re.source, flags);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    out.push(m);
    if (m[0] === "") rx.lastIndex++;
  }
  return out;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));

// ── Step 2: product name ─────────────────────────────────────────────────────

function checkName(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const expectedNorm = normalize(ref.productName);
  if (viewsContain(ctx.views, expectedNorm)) {
    return [{ label: "Product name", status: "pass", expected: ref.productName, found: ref.productName }];
  }
  const labelWords = new Set(ctx.views.flatMap((v) => v.split(" ")));
  // OCR reads accented letters badly ("jalapeño" -> "jalapefio"), so near-misses on longer words count as present
  const present = (w: string) =>
    labelWords.has(w) ||
    (ctx.ocr && w.length >= 5 && Array.from(labelWords).some((l) => editDistance(w, l, w.length >= 8 ? 2 : 1) <= (w.length >= 8 ? 2 : 1)));
  const missing = words(ref.productName).filter((w) => !present(w));
  if (missing.length === 0) {
    return [{
      label: "Product name",
      status: "warn",
      expected: ref.productName,
      found: "Same words, but not as one phrase",
      note: "Every word of the sheet name is on the label, but not in the same order. Check the label's product name wording.",
    }];
  }
  const hints = missing
    .map((w) => {
      const near = Array.from(labelWords).find((l) => l.length >= 5 && editDistance(w, l, 1) <= 1);
      return near ? `"${near}" on label vs "${w}" in sheet` : null;
    })
    .filter(Boolean);
  return [{
    label: "Product name",
    status: missing.length >= words(ref.productName).length / 2 ? "fail" : "warn",
    expected: ref.productName,
    found: `Missing words: ${missing.join(", ")}`,
    note: hints.length ? `Possible spelling difference: ${hints.join("; ")}.` : undefined,
  }];
}

// ── Step 3: USPs ─────────────────────────────────────────────────────────────

/** "No Maida", "Without palm oil", "Zero trans fat", "Preservative free" claim an absence, so they are checked against the sheet. */
function absenceTarget(claim: string): string | null {
  const m = claim.trim().match(/^(?:no|without|zero)\s+(.+)$/i) ?? claim.trim().match(/^(.+?)[\s-]free$/i);
  return m ? normalize(m[1]) : null;
}

const ABSENCE_ALIASES: Record<string, string[]> = {
  maida: ["maida", "refined wheat flour", "refined flour", "all purpose flour"],
  "refined sugar": ["refined sugar", "white sugar", "sugar syrup", "invert sugar"],
};

/** Does the sheet back up an absence claim, or contradict it? */
function checkAbsence(target: string, ref: AuditReference): { contradicted: boolean; evidence: string } {
  const nutrient = NUTRIENTS.find((n) => n.names.includes(target));
  if (nutrient && ref.nutrition.length) {
    const block = ref.nutrition.find((b) => b.grammage === 100) ?? ref.nutrition[0];
    const v = block[nutrient.key] as number | null;
    if (v !== null && v !== undefined) {
      return { contradicted: v > 0, evidence: `the sheet shows ${nutrient.label.toLowerCase()} of ${fmt(v)}${nutrient.unit} per ${fmt(block.grammage)}g` };
    }
  }
  const ingredients = ` ${normalize(ref.ingredients)} `;
  const singular = target.endsWith("s") ? target.slice(0, -1) : target;
  const forms = [target, singular, ...(ABSENCE_ALIASES[target] ?? [])];
  const hit = forms.find((f) => f && ingredients.includes(` ${f}`));
  if (hit) return { contradicted: true, evidence: `the sheet's ingredient list includes "${hit}"` };
  return { contradicted: false, evidence: ref.ingredients.trim() ? `the sheet's ingredient list has no ${target}` : "" };
}

/** "Made with Whole Wheat", "Made from jaggery": the named ingredient has to be in the ingredient list. */
function madeWithTarget(claim: string): string | null {
  const m = claim.trim().match(/^made\s+(?:with|from|using)\s+(.+)$/i);
  return m ? normalize(m[1]) : null;
}

/** Does an ingredient list (normalised) include the named ingredient, in singular or plural form? */
function listHas(listNorm: string, target: string): boolean {
  const singular = target.endsWith("s") ? target.slice(0, -1) : target;
  return [target, singular].some((f) => f && ` ${listNorm} `.includes(` ${f}`));
}

/** The ingredient list printed on the label, if the label has an "Ingredients" heading. */
function labelIngredientList(ctx: Ctx): string {
  const head = findHeading(ctx.rows, /^ingredients?\b/);
  if (!head) return "";
  return collectBlock(ctx.rows, head, ctx.ocr ? 60 : 20, blockLimit(ctx, ctx.rows[head.row].items[head.item].x));
}

/** Splits a USP on "/", but not inside brackets: "Source of protein (3.85g/70g and 5.50g/100g)" is one claim. */
function splitClaims(usp: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of usp) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "/" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * A claim's bracketed part ("(3.85g/70g and 5.50g/100g)") is supporting detail from the sheet, not wording to look for on the
 * label. Its figures are checked against the sheet's nutrition instead.
 */
function checkClaimFigures(core: string, detail: string, ref: AuditReference): AuditCheck | null {
  const nutrient = NUTRIENTS.find((n) => n.names.some((nm) => ` ${normalize(core)} `.includes(` ${nm} `)));
  const figures = findAll(/(\d+(?:\.\d+)?)\s*(?:g|mg)\s*\/\s*(\d+(?:\.\d+)?)\s*g/gi, detail);
  if (!nutrient || figures.length === 0 || ref.nutrition.length === 0) return null;
  const problems: string[] = [];
  let checked = 0;
  for (const m of figures) {
    const amount = parseFloat(m[1]);
    const per = parseFloat(m[2]);
    const block = ref.nutrition.find((b) => Math.abs(b.grammage - per) < 0.5);
    const sheetValue = block ? (block[nutrient.key] as number | null) : null;
    if (sheetValue === null || sheetValue === undefined) continue;
    checked++;
    if (Math.abs(sheetValue - amount) > Math.max(nutrient.floor, Math.abs(sheetValue) * 0.02)) problems.push(`${fmt(amount)}${nutrient.unit}/${fmt(per)}g (sheet nutrition: ${fmt(sheetValue)}${nutrient.unit})`);
  }
  if (checked === 0) return null;
  return {
    label: `Claim figures: ${core}`,
    status: problems.length ? "warn" : "pass",
    expected: detail.trim(),
    found: problems.length ? `Different from the sheet's nutrition: ${problems.join("; ")}` : undefined,
    note: problems.length ? undefined : `The figures in brackets match the sheet's ${nutrient.label.toLowerCase()} values.`,
  };
}

function checkUsps(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const details = new Map<string, string>();
  const claims = ref.usps
    .flatMap((u) => splitClaims(u.replace(/^\s*\d+[).]\s*/, "")))
    .map((c) => {
      const detail = Array.from(c.matchAll(/[(\[]([^)\]]*)[)\]]/g)).map((m) => m[1]).join(" ");
      const core = c.replace(/[(\[][^)\]]*[)\]]/g, " ").replace(/\s+/g, " ").replace(/[\s.]+$/, "").trim();
      if (detail) details.set(core, detail);
      return core;
    })
    .filter((c) => c.length > 1);
  const labelWords = new Set(ctx.views.flatMap((v) => v.split(" ")));

  if (claims.length === 0) {
    checks.push({ label: "USPs present", status: "skip", note: "The sheet has no USPs for this product." });
  }
  for (const claim of claims) {
    const norm = normalize(claim);
    if (!norm) continue;
    const madeWith = madeWithTarget(claim);
    if (madeWith) {
      const printed = viewsContain(ctx.views, norm);
      const inSheet = listHas(normalize(ref.ingredients), madeWith);
      const labelList = labelIngredientList(ctx);
      const inLabel = labelList ? listHas(normalize(labelList), madeWith) : null;
      if (ref.ingredients.trim() && !inSheet) {
        checks.push({ label: `Claim: ${claim}`, status: "fail", expected: claim, found: "Contradicted by the sheet", note: `The sheet lists this as a claim, but its ingredient list has no ${madeWith}.` });
      } else if (inLabel === false) {
        checks.push({ label: `Claim: ${claim}`, status: "fail", expected: claim, found: `No ${madeWith} in the label's ingredients`, note: "The claim says the product is made with this, but the ingredient list printed on the label doesn't include it." });
      } else if (!printed) {
        checks.push({
          label: `Claim: ${claim}`,
          status: "warn",
          expected: claim,
          found: "Not printed",
          note: `The label doesn't print this claim, though ${inLabel ? "its ingredient list" : "the sheet's ingredient list"} includes ${madeWith}. It may be on a panel that wasn't provided.`,
        });
      } else {
        checks.push({
          label: `Claim: ${claim}`,
          status: "pass",
          found: "Present",
          note: inLabel ? `Ingredients on the label include ${madeWith}.` : `The sheet's ingredients include ${madeWith}; the label's ingredient list wasn't found to compare.`,
        });
      }
      continue;
    }
    if (viewsContain(ctx.views, norm)) {
      checks.push({ label: `Claim: ${claim}`, status: "pass", found: "Present" });
      continue;
    }
    const absence = absenceTarget(claim);
    if (absence) {
      const { contradicted, evidence } = checkAbsence(absence, ref);
      checks.push(
        contradicted
          ? { label: `Claim: ${claim}`, status: "fail", expected: claim, found: "Contradicted by the sheet", note: `The sheet lists this as a claim, but ${evidence}.` }
          : {
              label: `Claim: ${claim}`,
              status: "warn",
              expected: claim,
              found: "Not printed",
              note: `The label doesn't print this claim${evidence ? `, though ${evidence}` : ""}. It may be on a panel that wasn't provided.`,
            }
      );
      continue;
    }
    const missing = words(claim).filter((w) => !labelWords.has(w));
    checks.push({
      label: `Claim: ${claim}`,
      status: "warn",
      expected: claim,
      found: "Missing",
      note: missing.length
        ? `Words not on the label: ${missing.join(", ")}. It may be on a panel that wasn't provided.`
        : "The label doesn't print this claim (its words only appear in other places). It may be on a panel that wasn't provided.",
    });
  }

  for (const [core, detail] of Array.from(details.entries())) {
    const figures = checkClaimFigures(core, detail, ref);
    if (figures) checks.push(figures);
  }

  const cooking = ref.usps.some((u) => /\b(roasted|baked|popped)\b/i.test(u));
  if (!cooking) {
    checks.push({ label: "Cooking method pairs with Not Fried", status: "skip", sop_rule: true, note: "No Roasted/Baked/Popped claim in the sheet's USPs." });
  } else if (viewsContain(ctx.views, "not fried")) {
    checks.push({ label: "Cooking method pairs with Not Fried", status: "pass", sop_rule: true, found: "'Not Fried' is on the label" });
  } else {
    checks.push({
      label: "Cooking method pairs with Not Fried",
      status: "fail",
      sop_rule: true,
      expected: "Not Fried next to the cooking method",
      found: "'Not Fried' not found",
    });
  }
  return checks;
}

// ── Step 4: grammage ─────────────────────────────────────────────────────────

function checkGrammage(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const hits = findAll(/net\s*(?:wt|weight|quantity|qty)\b\.?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|gms?|grams?|g|ml|l)\b/i, ctx.flat);
  if (hits.length === 0) {
    return [{ label: "Net weight", status: "warn", expected: ref.packSizeG ? `${fmt(ref.packSizeG)}g` : undefined, found: "No 'Net Wt' found on label" }];
  }
  const values = hits.map((h) => ({ text: `${h[1]}${h[2]}`, grams: parseFloat(h[1]) * (h[2].toLowerCase() === "kg" ? 1000 : 1), unit: h[2].toLowerCase() }));
  const foundText = uniq(values.map((v) => v.text)).join(", ");
  const checks: AuditCheck[] = [];

  if (ref.packSizeG === null) {
    checks.push({ label: "Net weight", status: "skip", found: foundText, note: "No pack size selected." });
  } else {
    const wrong = values.filter((v) => Math.abs(v.grams - ref.packSizeG!) > 0.01);
    checks.push({
      label: "Net weight",
      status: wrong.length ? "fail" : "pass",
      expected: `${fmt(ref.packSizeG)}g`,
      found: foundText,
      note: wrong.length ? "At least one net weight on the label differs from the selected pack size." : undefined,
    });
  }
  const unitStyles = uniq(values.map((v) => v.unit));
  checks.push({
    label: "Net weight unit written consistently",
    status: unitStyles.length > 1 ? "warn" : "pass",
    found: foundText,
    note: unitStyles.length > 1 ? "The unit is written differently in different places (for example gm and g)." : undefined,
  });
  return checks;
}

// ── Block extraction (ingredients, allergens) ────────────────────────────────

const STOP = /^(oil separation|do not consume|store in|store at|storage|avoid storing|allergen|packed|manufactured|marketed|best before|use by|net wt|net weight|mrp|batch|date of|customer care|fssai|lic no|nutritional|nutrition|serving|directions|shelf life|ingredients)\b/;

function findHeading(rows: Row[], re: RegExp): { row: number; item: number } | null {
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < rows[r].items.length; i++) {
      if (re.test(normalize(rows[r].items[i].s))) return { row: r, item: i };
    }
  }
  return null;
}

/** Collects the paragraph that starts at a heading: following rows aligned to the heading's left edge. */
function collectBlock(rows: Row[], at: { row: number; item: number }, columnGap = 20, xMax = Infinity, maxRows = 30): string {
  const row0 = rows[at.row];
  const head = row0.items[at.item];
  const x0 = head.x;
  const lead = head.s.includes(":") ? head.s.slice(head.s.indexOf(":") + 1).trim() : "";
  // text right after the heading on the same line, up to the first big gap (a gap means another column starts)
  const sameRowItems: LabelItem[] = [];
  let edge = head.x + head.w;
  for (const it of row0.items.slice(at.item + 1)) {
    if (it.x < x0 || it.x >= xMax || it.x - edge > columnGap) break;
    sameRowItems.push(it);
    edge = it.x + it.w;
  }
  const sameRow = joinItems(sameRowItems);
  const parts = [lead, sameRow].filter(Boolean);
  const maxGap = Math.max(head.h, 4) * 2.4;
  let prevY = row0.y;
  let inContains = false;

  for (let r = at.row + 1, used = 1; r < rows.length && used < maxRows; r++, used++) {
    const row = rows[r];
    if (row.page !== row0.page || prevY - row.y > maxGap) break;
    const cand = row.items.filter((i) => i.x >= x0 - 3 && i.x < xMax);
    if (!cand.length) continue; // this line only has text from another panel; the gap check ends the paragraph
    if (Math.abs(cand[0].x - x0) > 4) continue; // nothing in our column on this line (another column interleaved); the gap check ends the paragraph
    const group = [cand[0]];
    for (let k = 1; k < cand.length; k++) {
      const prev = group[group.length - 1];
      if (cand[k].x - (prev.x + prev.w) > columnGap) break;
      group.push(cand[k]);
    }
    const text = joinItems(group);
    if (STOP.test(normalize(text))) break;
    parts.push(text);
    prevY = row.y;
    if (/^CONTAINS\b/.test(text)) inContains = true;
    if (inContains && /\.\s*$/.test(text)) break;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ── Step 6: ingredients ──────────────────────────────────────────────────────

// A component heading ("Pizza Sticks:", "Seasoning :") sits at the start of the list or right after a full stop.
const COMPONENT_HEADING = /(?:^|\.\s+)([A-ZÀ-Ý][A-Za-zÀ-ÿ&'’ ]{1,40}?)\s*:\s/;
// OCR often drops the full stop that ends the previous component's list, leaving only its closing bracket or nothing
const COMPONENT_HEADING_OCR = /(?:^|[.)]\s+)([A-ZÀ-Ý][A-Za-zÀ-ÿ&'’ ]{1,40}?)\s*:\s/;
const ALLOWED_CAPS = new Set(["INS", "GMO", "FSSAI"]);

function segmentsOf(listText: string, ocr = false): { heading: string | null; body: string }[] {
  const text = listText.trim();
  const heads = findAll(ocr ? COMPONENT_HEADING_OCR : COMPONENT_HEADING, text).map((m) => ({
    start: m.index + (/^[.)]/.test(m[0]) ? m[0].indexOf(m[1]) : 0),
    end: m.index + m[0].length,
    heading: m[1].trim(),
  }));
  if (heads.length === 0) return text ? [{ heading: null, body: text }] : [];
  const segs: { heading: string | null; body: string }[] = [];
  if (heads[0].start > 0) segs.push({ heading: null, body: text.slice(0, heads[0].start).trim() });
  heads.forEach((h, i) => {
    segs.push({ heading: h.heading, body: text.slice(h.end, i + 1 < heads.length ? heads[i + 1].start : text.length).trim() });
  });
  return segs.filter((s) => s.body);
}

function splitList(text: string): { list: string; statement: string } {
  const i = text.search(/\bCONTAINS\b/);
  return i >= 0 ? { list: text.slice(0, i).trim(), statement: text.slice(i).trim() } : { list: text.trim(), statement: "" };
}

function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) items.push(cur);
  return items.map((i) => normalize(i.replace(/\([^)]*\)|\[[^\]]*\]/g, " "))).filter(Boolean);
}

function findTypos(textWords: string[], vocab: Set<string>): { word: string; suggestion: string }[] {
  const seen = new Set<string>();
  const out: { word: string; suggestion: string }[] = [];
  for (const w of textWords) {
    if (w.length < 6 || !/^[a-z]+$/.test(w) || seen.has(w)) continue;
    seen.add(w);
    if (vocab.has(w) || (w.endsWith("s") && vocab.has(w.slice(0, -1))) || vocab.has(w + "s")) continue;
    const max = w.length >= 9 ? 2 : 1;
    let best: string | null = null;
    let bestD = max + 1;
    vocab.forEach((v) => {
      if (v[0] !== w[0] || Math.abs(v.length - w.length) > max) return;
      const d = editDistance(w, v, max);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    });
    if (best) out.push({ word: w, suggestion: best });
  }
  return out;
}

const ALLERGEN_GROUPS: [string, RegExp][] = [
  ["gluten", /\b(gluten|wheat|barley|rye)\b/],
  ["milk", /\b(milk|dairy|whey|casein|lactose)\b/],
  ["soya", /\b(soya|soy|soybeans?)\b/],
  ["peanut", /\b(peanuts?|groundnuts?)\b/],
  ["tree nuts", /\b(tree nuts?|almonds?|cashews?|walnuts?|pistachios?|hazelnuts?)\b/],
  ["nuts", /\bnuts\b/],
  ["mustard", /\bmustard\b/],
  ["sesame", /\bsesame\b/],
  ["egg", /\beggs?\b/],
  ["fish", /\bfish\b/],
  ["crustacean", /\b(crustaceans?|shellfish|prawns?)\b/],
];

function allergenGroups(text: string): Set<string> {
  const t = text.toLowerCase();
  return new Set(ALLERGEN_GROUPS.filter(([, re]) => re.test(t)).map(([g]) => g));
}

function satisfied(sheetGroup: string, label: Set<string>): boolean {
  if (label.has(sheetGroup)) return true;
  if (sheetGroup === "nuts") return label.has("peanut") || label.has("tree nuts");
  if (sheetGroup === "peanut" || sheetGroup === "tree nuts") return label.has("nuts");
  return false;
}

/** Right edge for a text block at x0: the start of a nutrition table's label column further right on the label, if there is one. */
function blockLimit(ctx: Ctx, x0: number): number {
  const right = parseNutritionRows(ctx).labelXs.filter((x) => x > x0 + 30);
  return right.length ? Math.min(...right) - 2 : Infinity;
}

function checkIngredients(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const head = findHeading(ctx.rows, /^ingredients?\b/);

  if (!head) {
    checks.push({ label: "Ingredients list", status: "warn", found: "No 'Ingredients' heading found in the label text" });
  } else {
    const text = collectBlock(ctx.rows, head, ctx.ocr ? 60 : 20, blockLimit(ctx, ctx.rows[head.row].items[head.item].x));
    const { list, statement } = splitList(text);
    const segments = segmentsOf(list, ctx.ocr);
    const sheet = splitList(ref.ingredients.replace(/\s+/g, " "));

    // match against the sheet: the sheet may cover only part of a combo, so only sheet words missing from the label count
    const labelTokens = new Set(words(text));
    const sheetTokens = uniq(words(sheet.list + " " + sheet.statement)).filter((w) => w.length > 1);
    const missing = sheetTokens.filter((w) => !labelTokens.has(w));
    if (!ref.ingredients.trim()) {
      checks.push({ label: "Ingredients match the sheet", status: "skip", note: "The sheet has no ingredients for this product." });
    } else if (missing.length === 0) {
      checks.push({ label: "Ingredients match the sheet", status: "pass", found: "All sheet ingredients are on the label" });
    } else {
      const ratio = missing.length / sheetTokens.length;
      checks.push({
        label: "Ingredients match the sheet",
        status: ratio > 0.1 ? "fail" : "warn",
        expected: "Every word of the sheet's ingredient list",
        found: `Missing on label: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`,
      });
    }

    const sheetSegments = segmentsOf(sheet.list);
    const labelComponentCount = segments.filter((s) => s.heading).length;
    if (ref.ingredients.trim() && labelComponentCount <= 1 && sheetSegments.filter((s) => s.heading).length <= 1) {
      const sheetSet = new Set(sheetTokens);
      const extra = uniq(words(list)).filter((w) => w.length > 1 && !sheetSet.has(w));
      if (extra.length) {
        checks.push({
          label: "No extra ingredients on the label",
          status: "warn",
          found: `Not in sheet: ${extra.slice(0, 10).join(", ")}${extra.length > 10 ? "…" : ""}`,
        });
      }
    }

    // order of ingredients (descending by weight): compare the items both lists share
    const sheetItems = sheetSegments.flatMap((s) => topLevelItems(s.body));
    const labelItems = segments.flatMap((s) => topLevelItems(s.body));
    const idx = sheetItems.map((i) => labelItems.indexOf(i)).filter((i, k) => i >= 0 && sheetItems.indexOf(sheetItems[k]) === k);
    const shared = sheetItems.filter((i) => labelItems.includes(i));
    if (shared.length >= 3) {
      const bad = idx.findIndex((v, k) => k > 0 && v < idx[k - 1]);
      checks.push({
        label: "Ingredient order matches the sheet",
        status: bad >= 0 ? "warn" : "pass",
        found: bad >= 0 ? `"${shared[bad]}" comes before "${shared[bad - 1]}" on the label` : undefined,
        note: bad >= 0 ? "Ingredients must be listed in descending order by weight." : undefined,
      });
    }

    // SOP: first letter capital, rest lowercase
    const allCaps: string[] = [];
    const capitalised: string[] = [];
    let firstOk = segments.length > 0;
    for (const seg of segments) {
      if (!/^[^A-Za-z]*[A-ZÀ-Ý]/.test(seg.body)) firstOk = false;
      const toks = findAll(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/, seg.body);
      toks.forEach((m, k) => {
        if (k === 0) return;
        const t = m[0];
        if (t.length < 2 || ALLOWED_CAPS.has(t)) return;
        if (t === t.toUpperCase()) allCaps.push(t);
        else if (/^[A-ZÀ-Ý]/.test(t)) capitalised.push(t);
      });
    }
    const caseStatus: CheckStatus = !firstOk || allCaps.length ? "fail" : capitalised.length ? "warn" : "pass";
    checks.push({
      label: "Casing: first letter capital, rest lowercase",
      status: caseStatus,
      sop_rule: true,
      expected: "First ingredient capitalised, the rest lowercase",
      found:
        caseStatus === "pass"
          ? undefined
          : [!firstOk ? "List does not start with a capital" : "", allCaps.length ? `ALL CAPS: ${uniq(allCaps).join(", ")}` : "", capitalised.length ? `Capitalised mid-list: ${uniq(capitalised).join(", ")}` : ""].filter(Boolean).join("; "),
    });

    // SOP: ends with full stop (each component list, and the CONTAINS statement)
    const noStop = segments.filter((s) => !/\.\s*$/.test(s.body)).map((s) => s.heading ?? "Ingredient list");
    const stmtNoStop = statement && !/\.\s*$/.test(statement);
    checks.push({
      label: "Ends with full stop",
      status: noStop.length || stmtNoStop ? "fail" : "pass",
      sop_rule: true,
      expected: "A full stop at the end of the list",
      found: noStop.length || stmtNoStop ? `Missing after: ${[...noStop, stmtNoStop ? "the CONTAINS statement" : ""].filter(Boolean).join(", ")}` : undefined,
    });

    // spelling against the words used across the sheet
    const typos = findTypos(words(text), ref.vocabulary);
    checks.push({
      label: "Ingredient spelling",
      status: typos.length ? (ctx.ocr ? "warn" : "fail") : "pass",
      expected: typos.length ? typos.map((t) => t.suggestion).join(", ") : undefined,
      found: typos.length ? typos.map((t) => t.word).join(", ") : undefined,
      note: typos.length
        ? "These words are not in the sheet's vocabulary but are one or two letters away from a word that is." + (ctx.ocr ? " The text was read by OCR, so this may be a misread: check the label." : "")
        : undefined,
    });
  }

  // allergen declaration
  const sheetGroups = allergenGroups(ref.allergens);
  const aHead = findHeading(ctx.rows, /^allergen/);
  const aText = aHead ? collectBlock(ctx.rows, aHead, ctx.ocr ? 60 : 20, blockLimit(ctx, ctx.rows[aHead.row].items[aHead.item].x)) : "";
  if (sheetGroups.size === 0) {
    checks.push({ label: "Allergen declaration", status: "skip", note: "The sheet lists no allergens." });
  } else if (!aText) {
    checks.push({ label: "Allergen declaration", status: "warn", expected: ref.allergens.trim(), found: "No 'Allergen' statement found" });
  } else {
    const labelGroups = allergenGroups(aText);
    const missing = Array.from(sheetGroups).filter((g) => !satisfied(g, labelGroups));
    const extra = Array.from(labelGroups).filter((g) => !sheetGroups.has(g) && !(g === "nuts" && (sheetGroups.has("peanut") || sheetGroups.has("tree nuts"))) && !((g === "peanut" || g === "tree nuts") && sheetGroups.has("nuts")));
    checks.push({
      label: "Allergen declaration",
      status: missing.length ? "fail" : extra.length ? "warn" : "pass",
      expected: ref.allergens.trim(),
      found: missing.length ? `Label does not declare: ${missing.join(", ")}` : extra.length ? `Label also declares: ${extra.join(", ")}` : aText,
    });
  }
  return checks;
}

// ── Step 7: nutrition ────────────────────────────────────────────────────────

function calcStatus(master: number, found: number, floor: number): CheckStatus {
  const diff = Math.abs(master - found);
  if (diff <= floor) return "pass";
  const deviation = master !== 0 ? (diff / Math.abs(master)) * 100 : 100;
  if (deviation > 15) return "fail";
  if (deviation >= 2) return "warn";
  return "pass";
}

/** Tesseract slips in nutrition tables: "10:2" for 10.2, "Og"/"Omg" for 0g/0mg, and a unit "g" read as a trailing 9 ("6g" -> "69"). */
function ocrFix(token: string): string {
  return token.replace(/^(\d+):(\d+)/, "$1.$2").replace(/^[Oo](m?g)?$/, "0$1");
}
function ocrAlternatives(token: string): string[] {
  const alts: string[] = [];
  if (/^\d+(\.\d+)?9$/.test(token)) alts.push(token.slice(0, -1));
  // small print often loses its decimal point ("106" for 10.6, "066" for 0.66)
  const m = token.match(/^(\d{2,5})(kcal|kj|mg|mcg|gm|g)?$/i);
  if (m) for (let i = 1; i < m[1].length; i++) alts.push(m[1].slice(0, i) + "." + m[1].slice(i) + (m[2] ?? ""));
  return alts;
}

function parseCell(token: string): number | null | undefined {
  const t = token.trim();
  if (/^[-–—]$/.test(t)) return null;
  if (/^(nil|blq|nd|trace)$/i.test(t)) return 0;
  const m = t.match(/^[<≤]?\s*(\d+(?:\.\d+)?)\s*(?:kcal|kj|g|gm|mg|mcg|%)?$/i);
  return m ? parseFloat(m[1]) : undefined;
}

type LabelNutrient = { values: (number | null)[]; rowLabel: string };

function parseNutritionRows(ctx: Ctx) {
  const found = new Map<string, LabelNutrient>();
  const typos: { found: string; expected: string }[] = [];
  const labelXs: number[] = [];
  const cell = (tok: string) => parseCell(ctx.ocr ? ocrFix(tok) : tok);
  const labelGap = ctx.ocr ? 4.5 : 30; // OCR packs a text column and a table closer together than a PDF does
  for (const row of ctx.rows) {
    for (let firstNum = 1; firstNum < row.items.length; firstNum++) {
    if (!row.items[firstNum].s.split(/\s+/).every((tok) => cell(tok) !== undefined)) continue;
    // the label is the run of items just left of this number; text from a neighbouring panel on the same line is further away
    let labelStart = firstNum - 1;
    while (labelStart > 0 && row.items[labelStart].x - (row.items[labelStart - 1].x + row.items[labelStart - 1].w) <= labelGap) labelStart--;
    const rowLabel = joinItems(row.items.slice(labelStart, firstNum));
    const labelNorm = words(rowLabel).filter((w) => !UNIT_WORDS.has(w)).join(" ");
    if (!labelNorm) continue;
    let nutrient = NUTRIENTS.find((n) => n.names.includes(labelNorm));
    if (!nutrient) {
      for (const n of NUTRIENTS) {
        const hit = n.names.find((name) => name.length >= 6 && editDistance(labelNorm, name, name.length >= 9 ? 2 : 1) <= (name.length >= 9 ? 2 : 1));
        if (hit) {
          nutrient = n;
          typos.push({ found: rowLabel.replace(/\s*\([^)]*\)\s*/g, "").trim(), expected: n.label });
          break;
        }
      }
    }
    if (!nutrient) continue;
    const values: (number | null)[] = [];
    for (const it of row.items.slice(firstNum)) {
      for (const tok of it.s.split(/\s+/)) {
        const v = cell(tok);
        if (v !== undefined) values.push(v);
        if (ctx.ocr) {
          for (const alt of ocrAlternatives(ocrFix(tok))) {
            const a = parseCell(alt);
            if (typeof a === "number") values.push(a);
          }
        }
      }
    }
    const prev = found.get(nutrient.key as string);
    found.set(nutrient.key as string, { values: prev ? [...prev.values, ...values] : values, rowLabel });
    labelXs.push(row.items[labelStart].x);
    break; // this line's nutrient is recorded
    }
  }
  return { found, typos, labelXs };
}

function checkNutrition(ctx: Ctx, ref: AuditReference, notes: string[]): AuditCheck[] {
  const { found, typos } = parseNutritionRows(ctx);
  if (found.size < 3) {
    return [{ label: "Nutrition table", status: "warn", found: "Could not find a nutrition table in the label text" }];
  }
  if (ref.nutrition.length === 0) {
    return [{ label: "Nutrition table", status: "skip", note: "The sheet has no nutrition values for this product." }];
  }

  const closest = (key: keyof NutritionBlock, expected: number): number | null => {
    const vals = (found.get(key as string)?.values ?? []).filter((v): v is number => v !== null);
    if (!vals.length) return null;
    return vals.reduce((best, v) => (Math.abs(v - expected) < Math.abs(best - expected) ? v : best), vals[0]);
  };

  // which sheet column is this label table? the one most nutrient rows agree with
  let block = ref.nutrition[0];
  let bestScore = -1;
  for (const b of ref.nutrition) {
    const score = NUTRIENTS.filter((n) => {
      const exp = b[n.key];
      if (exp === null || exp === undefined) return false;
      const got = closest(n.key, exp as number);
      return got !== null && calcStatus(exp as number, got, n.floor) === "pass";
    }).length;
    const nearer = ref.packSizeG !== null && Math.abs(b.grammage - ref.packSizeG) < Math.abs(block.grammage - ref.packSizeG);
    if (score > bestScore || (score === bestScore && nearer)) {
      block = b;
      bestScore = score;
    }
  }
  notes.push(
    bestScore >= 3
      ? `Nutrition values were compared with the sheet's ${fmt(block.grammage)}g column. Other columns on the label (other components, %RDA) are not verified.`
      : `The label's nutrition table did not clearly match any sheet column; values were compared with the sheet's ${fmt(block.grammage)}g column.`
  );

  const checks: AuditCheck[] = [];
  for (const n of NUTRIENTS) {
    const exp = block[n.key];
    if (exp === null || exp === undefined) continue;
    const expected = exp as number;
    const entry = found.get(n.key as string);
    if (!entry) {
      checks.push({ label: n.label, status: "warn", expected: `${fmt(expected)}${n.unit}`, found: "Not found in the nutrition table" });
      continue;
    }
    const got = closest(n.key, expected);
    if (got === null) {
      checks.push({
        label: n.label,
        status: expected === 0 ? "pass" : "warn",
        expected: `${fmt(expected)}${n.unit}`,
        found: "-",
        note: expected === 0 ? undefined : "The label shows a dash for this nutrient.",
      });
      continue;
    }
    const status = calcStatus(expected, got, n.floor);
    const dev = expected !== 0 ? ((got - expected) / Math.abs(expected)) * 100 : null;
    checks.push({
      label: n.label,
      status,
      expected: `${fmt(expected)}${n.unit}`,
      found: `${fmt(got)}${n.unit}`,
      note: status === "pass" || dev === null ? undefined : `${dev >= 0 ? "+" : ""}${dev.toFixed(1)}% vs sheet (closest value in that row of the label)`,
    });
  }
  checks.push({
    label: "Nutrient names spelled correctly",
    status: typos.length ? (ctx.ocr ? "warn" : "fail") : "pass",
    note: typos.length && ctx.ocr ? "The text was read by OCR, so this may be a misread: check the label." : undefined,
    expected: typos.length ? typos.map((t) => t.expected).join(", ") : undefined,
    found: typos.length ? typos.map((t) => t.found).join(", ") : undefined,
  });
  return checks;
}

// ── Step 8: serving size ─────────────────────────────────────────────────────

function checkServing(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const bases = uniq([
    ...findAll(/serving\s*size\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:gms?|grams?|g)\b/i, ctx.flat),
    ...findAll(/nutritional\s*(?:information|info)\s*(?:per|for)\s*(\d+(?:\.\d+)?)\s*(?:gms?|grams?|g)\b/i, ctx.flat),
  ].map((m) => parseFloat(m[1]))).filter((b) => b !== 100);
  if (bases.length === 0) {
    return [{ label: "Serving size vs pack size", status: "skip", sop_rule: true, note: "No serving size (other than per 100g) found on the label." }];
  }
  if (ref.packSizeG === null) {
    return [{ label: "Serving size vs pack size", status: "skip", sop_rule: true, found: bases.map((b) => `${fmt(b)}g`).join(", "), note: "No pack size selected." }];
  }
  const over = bases.filter((b) => b > ref.packSizeG! + 0.01);
  return [{
    label: "Serving size vs pack size",
    status: over.length ? "warn" : "pass",
    sop_rule: true,
    expected: `Serving ≤ ${fmt(ref.packSizeG)}g`,
    found: bases.map((b) => `${fmt(b)}g`).join(", "),
    note: over.length ? `Serving size ${over.map((b) => `${fmt(b)}g`).join(", ")} is larger than the pack. Use ${fmt(ref.packSizeG)}g as the reference.` : undefined,
  }];
}

// ── Step 9: MRP ──────────────────────────────────────────────────────────────

function checkMrp(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const prices: number[] = [];
  const perGram = /^\s*\/?\s*-?\s*\)?\s*per\s*(?:gm|g|gram)/i;
  for (const m of findAll(/(?:mrp|m\.r\.p\.?)[\s.:\-]*(?:rs\.?|₹|inr)?[\s.:\-]*(\d+(?:\.\d+)?)/i, ctx.flat)) {
    if (!perGram.test(ctx.flat.slice(m.index + m[0].length, m.index + m[0].length + 14))) prices.push(parseFloat(m[1]));
  }
  for (const m of findAll(/(?:₹|rs\.?)\s*(\d+(?:\.\d+)?)\s*\/\s*-?/i, ctx.flat)) {
    if (!perGram.test(ctx.flat.slice(m.index + m[0].length, m.index + m[0].length + 14))) prices.push(parseFloat(m[1]));
  }
  const found = uniq(prices);

  const unitPrices = uniq([
    ...findAll(/(\d+(?:\.\d+)?)\s*\/?\s*-?\s*\)?\s*per\s*(?:gm|gms|g|gram|grams)\b/i, ctx.flat),
    ...findAll(/per\s*(?:gm|g|gram)s?\s*[:\-]?\s*(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?)/i, ctx.flat),
  ].map((m) => parseFloat(m[1])));

  const checks: AuditCheck[] = [];
  if (found.length === 0) {
    checks.push({ label: "MRP value", status: "warn", expected: ref.expectedMrp ? `₹${fmt(ref.expectedMrp)}` : undefined, found: "No MRP found on label" });
  } else if (ref.expectedMrp === null) {
    checks.push({ label: "MRP value", status: "skip", found: found.map((p) => `₹${fmt(p)}`).join(", "), note: "No expected MRP: select a pack size with a price in the sheet, or enter one." });
  } else {
    const wrong = found.filter((p) => Math.abs(p - ref.expectedMrp!) > 0.001);
    checks.push({
      label: "MRP value",
      status: wrong.length ? "fail" : "pass",
      expected: `₹${fmt(ref.expectedMrp)}`,
      found: found.map((p) => `₹${fmt(p)}`).join(", "),
      note: wrong.length ? `The label shows ${found.length > 1 ? "more than one price" : "a different price"}: ${found.map((p) => `₹${fmt(p)}`).join(" and ")}.` : undefined,
    });
  }

  if (ref.expectedMrp !== null && ref.packSizeG) {
    const exp = ref.expectedMrp / ref.packSizeG;
    if (unitPrices.length === 0) {
      checks.push({ label: "Price per gram", status: "warn", expected: `₹${exp.toFixed(2)}/g`, found: "No per-gram price found on label" });
    } else {
      // 0.875 may be printed as 0.87 or 0.88, so allow a rounding difference
      const worst = unitPrices.reduce((w, u) => (Math.abs(u - exp) > Math.abs(w - exp) ? u : w), unitPrices[0]);
      const diff = Math.abs(worst - exp);
      checks.push({
        label: "Price per gram",
        status: diff <= 0.011 ? "pass" : diff <= 0.05 ? "warn" : "fail",
        expected: `₹${exp.toFixed(3)}/g (₹${fmt(ref.expectedMrp)} ÷ ${fmt(ref.packSizeG)}g)`,
        found: unitPrices.map((u) => `₹${fmt(u)}/g`).join(", "),
        note: diff > 0.011 ? "The per-gram price on the label doesn't match the MRP and pack size." : undefined,
      });
    }
  }
  return checks;
}

// ── Step 10: addresses & licences ────────────────────────────────────────────

/** The sheet's manufacturer cell is free text: optional "For X:" / "X:" heading, then the company name, then its address. */
function manufacturerNames(manufacturer: string): string[] {
  const names: string[] = [];
  let expectName = true;
  for (const raw of manufacturer.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      expectName = true;
      continue;
    }
    if (/:\s*$/.test(line) || /^(for|fssai|lic)\b/i.test(line)) continue;
    if (expectName) {
      names.push(line.replace(/[.,]+$/, ""));
      expectName = false;
    }
  }
  return names.slice(0, 3);
}

function checkAddresses(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const checks: AuditCheck[] = [];

  const names = manufacturerNames(ref.manufacturer);
  if (names.length) {
    const missing = names.filter((n) => !viewsContain(ctx.views, normalize(n)));
    checks.push({
      label: "Manufacturer name",
      status: missing.length ? "fail" : "pass",
      expected: names.join("; "),
      found: missing.length ? `Not found on label: ${missing.join("; ")}` : undefined,
    });
  } else {
    checks.push({ label: "Manufacturer name", status: "skip", note: "The sheet has no manufacturer name to compare." });
  }

  // six digits that sit in a longer run of digits (a barcode printed as "8 906151 234498") are not pincodes
  const labelPins = findAll(/\b[1-9]\d{5}\b/, ctx.flat).filter(
    (m) => !/\d\s?$/.test(ctx.flat.slice(Math.max(0, m.index - 2), m.index)) && !/^\s?\d/.test(ctx.flat.slice(m.index + 6, m.index + 8))
  );
  const sheetPins = uniq(findAll(/\b[1-9]\d{5}\b/, ref.manufacturer).map((m) => m[0]));
  if (sheetPins.length) {
    const missing = sheetPins.filter((p) => !labelPins.some((l) => l[0] === p));
    checks.push({
      label: "Pincode matches the sheet",
      status: missing.length ? "fail" : "pass",
      expected: sheetPins.join(", "),
      found: missing.length ? `Not on label: ${missing.join(", ")}` : undefined,
    });
  }
  // when the sheet has pincodes, only those count: a misread number elsewhere (an OCR'd nutrient value, a batch number) is not an address
  const addressPins = sheetPins.length ? labelPins.filter((m) => sheetPins.includes(m[0])) : labelPins;
  if (addressPins.length === 0) {
    checks.push({ label: "Full stop after pincode", status: "warn", sop_rule: true, expected: "PINCODE.", found: "No pincode found on label" });
  } else {
    const bad = addressPins.filter((m) => !/^\s*\./.test(ctx.flat.slice(m.index + 6, m.index + 8)));
    checks.push({
      label: "Full stop after pincode",
      status: bad.length ? "fail" : "pass",
      sop_rule: true,
      expected: "PINCODE.",
      found: bad.length ? `No full stop after: ${uniq(bad.map((m) => m[0])).join(", ")}` : undefined,
      note: bad.length && ctx.ocr ? "The text was read by OCR, which often drops a small full stop, so check the label." : undefined,
    });
  }

  const digits = ctx.flat.replace(/\s+/g, "");
  const sheetLic = uniq(findAll(/\b\d{14}\b/, ref.manufacturer.replace(/\s+/g, " ")).map((m) => m[0]));
  if (sheetLic.length) {
    const missing = sheetLic.filter((l) => !digits.includes(l));
    checks.push({
      label: "FSSAI licence number matches the sheet",
      status: missing.length ? "fail" : "pass",
      expected: sheetLic.join(", "),
      found: missing.length ? `Not on label: ${missing.join(", ")}` : undefined,
    });
  }
  const licHits = findAll(/lic\.?\s*no\.?\s*[:\-]?\s*(\d[\d\s]*\d)/i, ctx.flat);
  if (licHits.length) {
    const badFormat = licHits.map((m) => m[1].replace(/\s+/g, "")).filter((d) => d.length !== 14);
    checks.push({
      label: "FSSAI licence number is 14 digits",
      status: badFormat.length ? "fail" : "pass",
      found: badFormat.length ? badFormat.join(", ") : undefined,
    });
  }
  return checks;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function runRulesAudit(label: ExtractedLabel, ref: AuditReference): AuditReport {
  const ocr = label.source === "ocr";
  // OCR of a tilted or handheld photo gives sloping baselines; flatten the word positions so rows line up
  const items = ocr ? flattenItems(label.items) : label.items;
  const rows = buildRows(items, ocr ? 4.8 : 2.5);
  const ctx: Ctx = { rows, flat: rows.map(rowText).join(" "), views: buildViews(items, rows), ocr };
  const notes: string[] = [
    ocr
      ? "Checked by the rules engine on text read from the image by OCR (no AI). OCR can misread small, tilted or low-contrast text, so confirm any surprising result on the label itself. Anything it couldn't locate is marked Not checked rather than guessed."
      : "Checked by the rules engine on the PDF's text layer (no AI). Anything it couldn't locate is marked Not checked rather than guessed.",
  ];

  const steps: AuditStep[] = [
    { step: 2, name: STEP_NAMES[2], checks: checkName(ctx, ref) },
    { step: 3, name: STEP_NAMES[3], checks: checkUsps(ctx, ref) },
    { step: 4, name: STEP_NAMES[4], checks: checkGrammage(ctx, ref) },
    { step: 5, name: STEP_NAMES[5], checks: [{ label: "Description vs USPs", status: "skip", note: "The sheet has no long description to compare. Use AI review for a wording check." }] },
    { step: 6, name: STEP_NAMES[6], checks: checkIngredients(ctx, ref) },
    { step: 7, name: STEP_NAMES[7], checks: checkNutrition(ctx, ref, notes) },
    { step: 8, name: STEP_NAMES[8], checks: checkServing(ctx, ref) },
    { step: 9, name: STEP_NAMES[9], checks: checkMrp(ctx, ref) },
    { step: 10, name: STEP_NAMES[10], checks: checkAddresses(ctx, ref) },
  ];

  if (ocr) {
    for (const step of steps) for (const c of step.checks) if (c.status === "fail") c.status = "warn";
    notes.push("Because the text came from OCR, mismatches are marked Review rather than Fail.");
  }

  return {
    product: ref.productName,
    pack_size: ref.packSizeG ? `${fmt(ref.packSizeG)}g` : "pack size not set",
    overall: combineStatus(steps.flatMap((s) => s.checks.map((c) => c.status))),
    steps,
    mode: "rules",
    notes,
  };
}
