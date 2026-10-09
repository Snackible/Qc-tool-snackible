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
function listHas(listNorm: string, target: string, ocr = false): boolean {
  const singular = target.endsWith("s") ? target.slice(0, -1) : target;
  if ([target, singular].some((f) => f && ` ${listNorm} `.includes(` ${f}`))) return true;
  if (!ocr) return false;
  // OCR garbles words: every word of the target must have a near match in the list
  const have = listNorm.split(" ");
  return target.split(" ").every((w) => have.some((l) => l === w || (w.length >= 5 && editDistance(w, l, w.length >= 7 ? 2 : 1) <= (w.length >= 7 ? 2 : 1))));
}

/** The ingredient list printed on the label, if the label has an "Ingredients" heading. */
function labelIngredientList(ctx: Ctx): string {
  const head = findHeading(ctx.rows, /^ingredients?\b/);
  if (!head) return "";
  return collectBlock(ctx.rows, head, ctx.ocr ? 60 : 20, blockLimit(ctx, ctx.rows[head.row].items[head.item].x, ctx.rows[head.row].y));
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
      const inLabel = labelList ? listHas(normalize(labelList), madeWith, ctx.ocr) : null;
      if (ref.ingredients.trim() && !inSheet) {
        checks.push({ label: `Claim: ${claim}`, status: "fail", expected: claim, found: "Contradicted by the sheet", note: `The sheet lists this as a claim, but its ingredient list has no ${madeWith}.` });
      } else if (inLabel === false) {
        checks.push({ label: `Claim: ${claim}`, status: ctx.ocr ? "warn" : "fail", expected: claim, found: `No ${madeWith} in the label's ingredients`, note: "The claim says the product is made with this, but the ingredient list printed on the label doesn't include it." });
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

  // A label that prints none (or hardly any) of the claims is almost certainly missing the panel they sit on (usually the
  // front), so "not printed" on every claim is noise. Say so once instead, and only call claims missing when the claims
  // panel is clearly there.
  const isClaim = (c: AuditCheck) => c.label.startsWith("Claim: ");
  const printedCount = checks.filter((c) => isClaim(c) && c.status === "pass").length;
  // a photo is usually one panel, so it has to print most of the claims before the rest count as missing; a PDF is normally the whole label
  const claimsPanelPresent = claims.length === 0 || printedCount >= Math.max(1, Math.ceil(claims.length * (ctx.ocr ? 0.75 : 0.4)));
  if (!claimsPanelPresent) {
    const unprinted = (c: AuditCheck) => isClaim(c) && c.status === "warn" && (c.found === "Not printed" || c.found === "Missing");
    if (checks.some(unprinted)) {
      for (let i = checks.length - 1; i >= 0; i--) if (unprinted(checks[i])) checks.splice(i, 1);
      checks.unshift({
        label: "USP claims",
        status: "skip",
        note: "Most of the sheet's claims aren't on the uploaded label, so the panel they sit on (usually the front) probably wasn't provided. Upload it to check them. Claims that are printed are still checked below.",
      });
    }
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
  } else if (!claimsPanelPresent) {
    checks.push({ label: "Cooking method pairs with Not Fried", status: "skip", sop_rule: true, note: "The panel with the claims wasn't provided, so this can't be checked." });
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
  const maxGap = Math.max(head.h, 4) * 3.6; // a blank line between two components is about two row pitches
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

/** OCR reads "a" as "o" ("Sugor", "Fot"), so with OCR words that differ only in a/o are the same word. */
const aoKey = (s: string) => s.replace(/o/g, "a");

function findTypos(textWords: string[], vocab: Set<string>, ignoreAO = false): { word: string; suggestion: string }[] {
  const vocabKeys = ignoreAO ? new Set(Array.from(vocab).map(aoKey)) : null;
  const seen = new Set<string>();
  const out: { word: string; suggestion: string }[] = [];
  for (const w of textWords) {
    if (w.length < 6 || !/^[a-z]+$/.test(w) || seen.has(w)) continue;
    seen.add(w);
    if (vocab.has(w) || (w.endsWith("s") && vocab.has(w.slice(0, -1))) || vocab.has(w + "s")) continue;
    if (vocabKeys && (vocabKeys.has(aoKey(w)) || (w.endsWith("s") && vocabKeys.has(aoKey(w.slice(0, -1)))) || vocabKeys.has(aoKey(w + "s")))) continue;
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
    if (best && !(ignoreAO && aoKey(best) === aoKey(w))) out.push({ word: w, suggestion: best });
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
function blockLimit(ctx: Ctx, x0: number, y?: number): number {
  const { labelXs, labelYs } = parseNutritionRows(ctx);
  // only a table beside the block can cut it off: its names sit within the block's height from the heading. A table stacked
  // above or below it (same x range) doesn't narrow it.
  const right = labelXs.filter((x, k) => x > x0 + 30 && (y === undefined || (labelYs[k] <= y + 3 && labelYs[k] >= y - 130)));
  return right.length ? Math.min(...right) - 2 : Infinity;
}

function checkIngredients(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const head = findHeading(ctx.rows, /^ingredients?\b/);

  if (!head) {
    checks.push({ label: "Ingredients list", status: "warn", found: "No 'Ingredients' heading found in the label text" });
  } else {
    const text = collectBlock(ctx.rows, head, ctx.ocr ? 60 : 20, blockLimit(ctx, ctx.rows[head.row].items[head.item].x, ctx.rows[head.row].y));
    const { list, statement } = splitList(text);
    const segments = segmentsOf(list, ctx.ocr);
    const sheet = splitList(ref.ingredients.replace(/\s+/g, " "));

    // match against the sheet: the sheet may cover only part of a combo, so only sheet words missing from the label count
    const labelTokens = new Set(words(text));
    const sheetTokens = uniq(words(sheet.list + " " + sheet.statement)).filter((w) => w.length > 1);
    // OCR garbles words ("oatmeal" -> "oaneal"), so with OCR a word within a couple of letters counts as present
    const labelList = Array.from(labelTokens);
    const nearPresent = (w: string) => ctx.ocr && w.length >= 5 && labelList.some((l) => editDistance(w, l, w.length >= 7 ? 2 : 1) <= (w.length >= 7 ? 2 : 1));
    const notPresent = sheetTokens.filter((w) => !labelTokens.has(w) && !nearPresent(w));
    // OCR also leaves damaged fragments of words ("min" for "mint", "suar" for "sugar", "foz" for "soy"): a missing word with
    // such a counterpart on the label (a word the sheet doesn't have) was read badly, which is not the same as being absent
    const sheetWordSet = new Set(sheetTokens);
    const unknownOnLabel = labelList.filter((l) => !sheetWordSet.has(l));
    const damagedBy = new Set<string>();
    const garbled = (w: string) => {
      if (!ctx.ocr) return false;
      const max = w.length <= 3 ? 1 : w.length <= 7 ? 2 : Math.ceil(w.length * 0.4);
      const hit = unknownOnLabel.find((l) => l.length >= 2 && ((l.length >= 3 && w.startsWith(l)) || editDistance(w, l, max) <= max));
      if (hit) damagedBy.add(hit);
      return !!hit;
    };
    const unclear = notPresent.filter(garbled);
    const missing = notPresent.filter((w) => !unclear.includes(w));
    if (!ref.ingredients.trim()) {
      checks.push({ label: "Ingredients match the sheet", status: "skip", note: "The sheet has no ingredients for this product." });
    } else if (missing.length === 0 && unclear.length === 0) {
      checks.push({ label: "Ingredients match the sheet", status: "pass", found: "All sheet ingredients are on the label" });
    } else if (missing.length === 0) {
      checks.push({
        label: "Ingredients match the sheet",
        status: "warn",
        expected: "Every word of the sheet's ingredient list",
        found: `Read badly (OCR): ${unclear.slice(0, 10).join(", ")}${unclear.length > 10 ? "…" : ""}`,
        note: "These words are on the label but the OCR garbled them, so they can't be confirmed. Check them on the label.",
      });
    } else {
      const ratio = missing.length / sheetTokens.length;
      // with OCR, a list of which only part was read (tiny print, a column the OCR skipped) can't show that words are absent
      const readShare = (sheetTokens.length - notPresent.length) / sheetTokens.length;
      const partlyRead = ctx.ocr && readShare < 0.8;
      checks.push({
        label: "Ingredients match the sheet",
        status: ratio > 0.1 && !partlyRead ? "fail" : "warn",
        expected: "Every word of the sheet's ingredient list",
        found: `Missing on label: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`,
        note: partlyRead
          ? "Only part of the list could be read by the OCR, so these may be unread rather than missing. Check the label or use AI review."
          : unclear.length
            ? `Also read badly by the OCR and not confirmed: ${unclear.slice(0, 10).join(", ")}${unclear.length > 10 ? "…" : ""}.`
            : undefined,
      });
    }

    const sheetSegments = segmentsOf(sheet.list);
    const labelComponentCount = segments.filter((s) => s.heading).length;
    if (ref.ingredients.trim() && labelComponentCount <= 1 && sheetSegments.filter((s) => s.heading).length <= 1) {
      const sheetSet = new Set(sheetTokens);
      const extra = uniq(words(list)).filter((w) => w.length > 1 && !sheetSet.has(w) && !damagedBy.has(w)); // (damaged fragments are reported above)
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
    const typos = findTypos(words(text), ref.vocabulary, ctx.ocr);
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
  const aText = aHead ? collectBlock(ctx.rows, aHead, ctx.ocr ? 60 : 20, blockLimit(ctx, ctx.rows[aHead.row].items[aHead.item].x, ctx.rows[aHead.row].y)) : "";
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
  // a value that was read and is wrong is red; amber is only for what couldn't be read or confirmed
  return deviation >= 2 ? "fail" : "pass";
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
  if (/^(?:nd|blq|bql)\s*[<＜≤]\s*\d+(?:\.\d+)?\s*(?:g|mg|mcg|kcal)?$/i.test(t)) return 0; // "ND<0.03g": not detected
  const m = t.match(/^[<≤]?\s*(\d+(?:\.\d+)?)\s*(?:kcal|kj|g|gm|mg|mcg|%)?$/i);
  return m ? parseFloat(m[1]) : undefined;
}

type LabelNutrient = { values: (number | null)[]; rowLabel: string };

function parseNutritionRows(ctx: Ctx, expected?: Map<string, number[]>) {
  const found = new Map<string, LabelNutrient>();
  const typos: { found: string; expected: string }[] = [];
  const labelXs: number[] = [];
  const labelYs: number[] = [];
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
    if (!nutrient && ctx.ocr) nutrient = NUTRIENTS.find((n) => n.names.some((name) => aoKey(name) === aoKey(labelNorm)));
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
    labelYs.push(row.y);
    break; // this line's nutrient is recorded
    }
  }
  if (ctx.ocr) addGeometricValues(ctx, found, typos, cell, expected);
  return { found, typos, labelXs, labelYs };
}

/**
 * On a photo the rows of a table slope or curve, so a nutrient's name and its value can land on different rows. Pair each
 * name with the numbers to its right at nearly the same height instead (allowing for the slope of the rows). When this
 * finds a table it replaces the row-based values.
 */
function addGeometricValues(
  ctx: Ctx,
  found: Map<string, LabelNutrient>,
  typos: { found: string; expected: string }[],
  cell: (tok: string) => number | null | undefined,
  expected?: Map<string, number[]>
) {
  const items = ctx.rows.flatMap((r) => r.items);
  if (items.length < 20) return;
  const H = items.map((i) => i.h).sort((a, b) => a - b)[Math.floor(items.length / 2)] || 7;
  const numeric = items.filter((i) => i.s.split(/\s+/).every((tok) => cell(tok) !== undefined));

  type Label = { nutrient: (typeof NUTRIENTS)[number]; item: LabelItem; text: string; fuzzy: boolean; weak: boolean };
  const labels: Label[] = [];
  for (const row of ctx.rows) {
    for (let i = 0; i < row.items.length; ) {
      let hit: Label | null = null;
      let len = 0;
      for (const n of [3, 2, 1]) {
        if (i + n > row.items.length) continue;
        const win = row.items.slice(i, i + n);
        if (win.some((w, k) => k > 0 && w.x - (win[k - 1].x + win[k - 1].w) > H * 1.5)) continue;
        const text = joinItems(win);
        const norm = words(text).filter((w) => !UNIT_WORDS.has(w)).join(" ");
        if (!norm) continue;
        // a bare "Fat" or "Sugar" right after another word is the end of a longer name we don't track ("Unsaturated Fat")
        const before = i > 0 ? row.items[i - 1] : null;
        if (n === 1 && /^(fats?|sugars?)$/.test(norm) && before && win[0].x - (before.x + before.w) <= H * 1.5) continue;
        let nutrient = NUTRIENTS.find((d) => d.names.includes(norm));
        if (!nutrient) nutrient = NUTRIENTS.find((d) => d.names.some((name) => aoKey(name) === aoKey(norm)));
        let fuzzy = false;
        if (!nutrient) {
          for (const d of NUTRIENTS) {
            if (d.names.some((name) => name.length >= 6 && editDistance(norm, name, name.length >= 9 ? 2 : 1) <= (name.length >= 9 ? 2 : 1))) {
              nutrient = d;
              fuzzy = true;
              break;
            }
          }
        }
        if (nutrient) {
          hit = { nutrient, item: win[win.length - 1], text, fuzzy, weak: n === 1 && /^(fats?|sugars?)$/.test(norm) };
          len = n;
          break;
        }
      }
      if (hit) {
        labels.push(hit);
        i += len;
      } else i++;
    }
  }
  // a bare "Fat" is probably the tail of "Saturated Fat" whose first word the OCR missed: it counts only if the table has no
  // proper name for that nutrient
  for (let k = labels.length - 1; k >= 0; k--) {
    const l = labels[k];
    if (l.weak && labels.some((o) => !o.weak && o.nutrient === l.nutrient && o.item.page === l.item.page)) labels.splice(k, 1);
  }
  if (labels.length < 3) return;

  const result = new Map<string, LabelNutrient>();
  const addValues = (l: Label, c0: LabelItem, slopeAtLabel: number, pool: LabelItem[]) => {
    const values: (number | null)[] = [];
    const push = (it: LabelItem) => {
      for (const tok of it.s.split(/\s+/)) {
        const v = cell(tok);
        if (v !== undefined) values.push(v);
        for (const alt of ocrAlternatives(ocrFix(tok))) {
          const a = parseCell(alt);
          if (typeof a === "number") values.push(a);
        }
      }
    };
    push(c0);
    // the columns after the first (per 100g, %RDA): the number nearest the row's height, left to right
    let lastX = c0.x;
    for (let extra = 0; extra < 2; extra++) {
      const next = pool
        .filter((c) => c.x > lastX + H * 3 && c.x - c0.x <= H * 14 && Math.abs(c.y - c0.y - slopeAtLabel * (c.x - c0.x)) <= H * 0.55)
        .sort((a, b) => a.x - b.x)[0];
      if (!next) break;
      push(next);
      lastX = next.x;
    }
    // a pack with two tables (a snack and its dip) names each nutrient twice: keep every table's values
    const prev = result.get(l.nutrient.key as string);
    result.set(l.nutrient.key as string, { values: prev ? [...prev.values, ...values] : values, rowLabel: prev ? prev.rowLabel : l.text });
    if (l.fuzzy && !typos.some((t) => t.expected === l.nutrient.label)) typos.push({ found: l.text.replace(/\s*\([^)]*\)\s*/g, "").trim(), expected: l.nutrient.label });
  };

  for (const page of Array.from(new Set(labels.map((l) => l.item.page)))) {
    const pl = labels.filter((l) => l.item.page === page);
    if (pl.length < 3) continue;
    const pool = numeric.filter((c) => c.page === page);
    const base0 = pl.map((l) => l.item.x + l.item.w).sort((a, b) => a - b)[Math.floor(pl.length / 2)];
    const mid = (c: LabelItem) => c.x + c.w / 2; // cells are centred, so columns line up by their centres
    const right = pool.filter((c) => c.x >= base0 - 2 && c.x - base0 <= H * 16).sort((a, b) => mid(a) - mid(b));

    // the first value column: the leftmost dense stack of numbers (by their centres) with about as many numbers as there are
    // names; found by counting neighbours, so two close columns don't merge
    const need = Math.max(3, Math.ceil(pl.length * 0.4));
    const countNear = (m: number) => right.filter((c) => Math.abs(mid(c) - m) <= H * 1.2).length;
    const start = right.find((c) => countNear(mid(c)) >= need);
    if (!start) continue;
    let center = mid(start);
    for (let k = 0; k < 3; k++) {
      const members = right.filter((c) => Math.abs(mid(c) - center) <= H * 1.2);
      center = members.reduce((n, c) => n + mid(c), 0) / members.length;
    }
    const col = right.filter((c) => Math.abs(mid(c) - center) <= H * 1.2);
    const xcol = col.reduce((n, c) => n + c.x, 0) / col.length;

    // what each number in the column could be (OCR drops decimal points), to compare with the sheet
    const valsOf = new Map<LabelItem, number[]>();
    for (const c of col) {
      const vs: number[] = [];
      for (const tok of c.s.split(/\s+/)) {
        const v = cell(tok);
        if (typeof v === "number") vs.push(v);
        for (const alt of ocrAlternatives(ocrFix(tok))) {
          const a = parseCell(alt);
          if (typeof a === "number") vs.push(a);
        }
      }
      valsOf.set(c, vs);
    }
    const agrees = (l: Label, c: LabelItem) => {
      const exp = expected?.get(l.nutrient.key as string);
      if (!exp) return false;
      return (valsOf.get(c) ?? []).some((v) => exp.some((e) => Math.abs(v - e) <= Math.max(l.nutrient.floor, Math.abs(e) * 0.02)));
    };

    const ys = pl.map((l) => l.item.y).sort((a, b) => b - a);
    const gaps = ys.slice(1).map((y, i) => ys[i] - y).filter((g) => g > H * 0.5);
    const pitch = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : H * 1.6;
    const yMid = (ys[0] + ys[ys.length - 1]) / 2;
    const yTop = ys[0] + pitch;
    const yBottom = ys[ys.length - 1] - pitch;

    // how the rows tilt (slope a, changing by b per unit of height, as on a curved or keystoned label) is found by which
    // pairing leaves the fewest names without a number and numbers without a name; one-to-one pairing breaks the tie
    // between "this row" and "the next row"
    let best: { pairs: [Label, LabelItem][]; a: number; b: number; score: number } | null = null;
    for (let a = -0.3; a <= 0.3001; a += 0.01) {
      for (let b = -0.003; b <= 0.0031; b += 0.0003) {
        const pairs = new Map<LabelItem, { l: Label; d: number }>();
        for (const l of pl) {
          const base = l.item.x + l.item.w;
          const expY = l.item.y + (a + b * (l.item.y - yMid)) * (xcol - base);
          let near: LabelItem | null = null;
          let nd = Infinity;
          for (const c of col) {
            const d = Math.abs(c.y - expY);
            if (d < nd) {
              nd = d;
              near = c;
            }
          }
          if (near && nd <= pitch * 0.5) {
            const prev = pairs.get(near);
            if (!prev || nd < prev.d) pairs.set(near, { l, d: nd });
          }
        }
        let unmatched = 0;
        for (const c of col) if (!pairs.has(c) && c.y <= yTop && c.y >= yBottom) unmatched++;
        let dist = 0;
        let agree = 0;
        pairs.forEach((p, c) => {
          dist += p.d / pitch;
          if (agrees(p.l, c)) agree++;
        });
        // pairing that makes the numbers agree with the sheet is the right row-to-row alignment: a wrongly shifted one
        // would make nearly every number disagree, while a real error on the label spoils only one
        const score = pairs.size - 0.8 * unmatched - 0.05 * dist - 0.02 * (Math.abs(a) + Math.abs(b) * 100) + 2 * agree;
        if (!best || score > best.score) best = { pairs: Array.from(pairs.entries()).map(([c, p]) => [p.l, c] as [Label, LabelItem]), a, b, score };
      }
    }
    if (!best) continue;
    const fit = best;
    for (const [l, c] of fit.pairs) addValues(l, c, fit.a + fit.b * (l.item.y - yMid), pool);

    // a name the OCR missed leaves its number unpaired: give it to the nutrient whose sheet value it matches, if that nutrient
    // is still unread and the number sits where that nutrient belongs in the table's usual order
    if (expected) {
      const order = NUTRIENTS.map((n) => n.key as string);
      const paired = new Set(fit.pairs.map(([, c]) => c));
      const anchors = fit.pairs.map(([l, c]) => ({ y: c.y, idx: order.indexOf(l.nutrient.key as string) })).sort((p, q) => q.y - p.y);
      for (const c of col) {
        if (paired.has(c)) continue;
        const above = anchors.filter((an) => an.y > c.y).pop();
        const below = anchors.find((an) => an.y < c.y);
        const lo = above ? above.idx : -1;
        const hi = below ? below.idx : order.length;
        const fits = NUTRIENTS.filter((n, idx) => {
          if (result.has(n.key as string) || idx <= lo || idx >= hi) return false;
          const exp = expected.get(n.key as string);
          return !!exp && (valsOf.get(c) ?? []).some((v) => exp.some((e) => Math.abs(v - e) <= Math.max(n.floor, Math.abs(e) * 0.02)));
        });
        if (fits.length === 1) {
          const n = fits[0];
          result.set(n.key as string, { values: valsOf.get(c) ?? [], rowLabel: n.label });
        }
      }
    }
  }
  if (result.size >= 3) result.forEach((v, k) => found.set(k, v));
}

function checkNutrition(ctx: Ctx, ref: AuditReference, notes: string[]): AuditCheck[] {
  const expectedValues = new Map<string, number[]>();
  for (const n of NUTRIENTS) {
    const vs = ref.nutrition.map((b) => b[n.key]).filter((v): v is number => typeof v === "number");
    if (vs.length) expectedValues.set(n.key as string, vs);
  }
  const { found, typos } = parseNutritionRows(ctx, expectedValues);
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
    const after = ctx.flat.slice(m.index + m[0].length, m.index + m[0].length + 14);
    // OCR reads the rupee sign as a digit ("MRP₹:60/-" -> "MRP3:60/-"): a lone digit followed by ":" and the real price is that
    if (ctx.ocr && /^\d$/.test(m[1]) && /^\s*[:\-]\s*\d/.test(after)) continue;
    if (!perGram.test(after)) prices.push(parseFloat(m[1]));
  }
  if (ctx.ocr) {
    for (const m of findAll(/mrp\s*\d\s*[:\-]\s*(\d+(?:\.\d+)?)/i, ctx.flat)) {
      if (!perGram.test(ctx.flat.slice(m.index + m[0].length, m.index + m[0].length + 14))) prices.push(parseFloat(m[1]));
    }
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

/** Finds a six-digit pincode in label text: digits may be split by one space or hyphen, and with OCR one wrong digit is tolerated. */
function findPincode(flat: string, pin: string, ocr: boolean): { index: number; end: number; digits: string; exact: boolean } | null {
  const re = /\d(?:[ -]?\d){5}/g;
  let near: { index: number; end: number; digits: string; exact: boolean } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const digits = m[0].replace(/\D/g, "");
    const before = flat[m.index - 1];
    const after = flat[m.index + m[0].length];
    if (digits.length !== 6 || (before && /\d/.test(before)) || (after && /\d/.test(after))) continue;
    const hit = { index: m.index, end: m.index + m[0].length, digits, exact: digits === pin };
    if (hit.exact) return hit;
    if (ocr && !near) {
      let diff = 0;
      for (let i = 0; i < 6; i++) if (digits[i] !== pin[i]) diff++;
      if (diff <= 1) near = hit;
    }
  }
  return near;
}

function checkAddresses(ctx: Ctx, ref: AuditReference): AuditCheck[] {
  const checks: AuditCheck[] = [];

  const names = manufacturerNames(ref.manufacturer);
  if (names.length) {
    // OCR garbles letters ("DIVINUTTY" -> "DMINUTTY"): with OCR every word of the name may be a near match
    const labelWords = new Set(ctx.views.flatMap((v) => v.split(" ")));
    const near = (n: string) =>
      ctx.ocr &&
      words(n).every((w) => labelWords.has(w) || (w.length >= 5 && Array.from(labelWords).some((l) => editDistance(w, l, w.length >= 8 ? 2 : 1) <= (w.length >= 8 ? 2 : 1))));
    const missing = names.filter((n) => !viewsContain(ctx.views, normalize(n)) && !near(n));
    checks.push({
      label: "Manufacturer name",
      status: missing.length ? "fail" : "pass",
      expected: names.join("; "),
      found: missing.length ? `Not found on label: ${missing.join("; ")}` : undefined,
    });
  } else {
    checks.push({ label: "Manufacturer name", status: "skip", note: "The sheet has no manufacturer name to compare." });
  }

  // sheet pincodes are searched for directly (allowing a space or hyphen between digits, and for OCR one misread digit)
  const sheetPins = uniq(findAll(/\b[1-9]\d{5}\b/, ref.manufacturer).map((m) => m[0]));
  const pinHits = sheetPins.map((pin) => ({ pin, hit: findPincode(ctx.flat, pin, ctx.ocr) }));
  // six-digit numbers printed on the label that aren't part of a longer run (a barcode)
  const printedPins = uniq(
    findAll(/\b[1-9]\d{5}\b/, ctx.flat)
      .filter((m) => !/\d\s?$/.test(ctx.flat.slice(Math.max(0, m.index - 2), m.index)) && !/^\s?\d/.test(ctx.flat.slice(m.index + 6, m.index + 8)))
      .map((m) => m[0])
  ).slice(0, 3);
  if (sheetPins.length) {
    const missing = pinHits.filter((p) => !p.hit);
    const misread = pinHits.filter((p) => p.hit && !p.hit.exact);
    checks.push({
      label: "Pincode matches the sheet",
      status: missing.length ? "fail" : misread.length ? "warn" : "pass",
      expected: sheetPins.join(", "),
      // say what the label does show, not just what is missing
      found: missing.length ? (printedPins.length ? printedPins.join(", ") : "No pincode found on the label") : misread.length ? `Read as ${misread.map((p) => p.hit!.digits).join(", ")}` : undefined,
      note: missing.length ? (printedPins.length ? "The pincode on the label differs from the sheet's." : "The address with the pincode may not be on the uploaded panel, or the OCR couldn't read it.") : misread.length ? "One digit differs, which is most likely an OCR misread. Check the label." : undefined,
    });
    const found = pinHits.filter((p) => p.hit);
    if (found.length === 0) {
      checks.push({ label: "Full stop after pincode", status: "warn", sop_rule: true, expected: "PINCODE.", found: "No pincode found on label" });
    } else {
      const bad = found.filter((p) => !/^\s*\./.test(ctx.flat.slice(p.hit!.end, p.hit!.end + 3)));
      checks.push({
        label: "Full stop after pincode",
        status: bad.length ? "fail" : "pass",
        sop_rule: true,
        expected: "PINCODE.",
        found: bad.length ? `No full stop after: ${uniq(bad.map((p) => p.hit!.digits)).join(", ")}` : undefined,
        note: bad.length && ctx.ocr ? "The text was read by OCR, which often drops a small full stop, so check the label." : undefined,
      });
    }
  } else {
    // no pincode in the sheet: any six-digit number that isn't part of a longer run (a barcode) counts
    const labelPins = findAll(/\b[1-9]\d{5}\b/, ctx.flat).filter(
      (m) => !/\d\s?$/.test(ctx.flat.slice(Math.max(0, m.index - 2), m.index)) && !/^\s?\d/.test(ctx.flat.slice(m.index + 6, m.index + 8))
    );
    if (labelPins.length === 0) {
      checks.push({ label: "Full stop after pincode", status: "warn", sop_rule: true, expected: "PINCODE.", found: "No pincode found on label" });
    } else {
      const bad = labelPins.filter((m) => !/^\s*\./.test(ctx.flat.slice(m.index + 6, m.index + 8)));
      checks.push({
        label: "Full stop after pincode",
        status: bad.length ? "fail" : "pass",
        sop_rule: true,
        expected: "PINCODE.",
        found: bad.length ? `No full stop after: ${uniq(bad.map((m) => m[0])).join(", ")}` : undefined,
        note: bad.length && ctx.ocr ? "The text was read by OCR, which often drops a small full stop, so check the label." : undefined,
      });
    }
  }

  const digits = ctx.flat.replace(/\s+/g, "");
  const printedLic = uniq(findAll(/\b\d{14}\b/, ctx.flat).map((m) => m[0])).slice(0, 3);
  const sheetLic = uniq(findAll(/\b\d{14}\b/, ref.manufacturer.replace(/\s+/g, " ")).map((m) => m[0]));
  if (sheetLic.length) {
    const missing = sheetLic.filter((l) => !digits.includes(l));
    checks.push({
      label: "FSSAI licence number matches the sheet",
      status: missing.length ? "fail" : "pass",
      expected: sheetLic.join(", "),
      found: missing.length ? (printedLic.length ? printedLic.join(", ") : "No licence number found on the label") : undefined,
      note: missing.length ? (printedLic.length ? "The licence number on the label differs from the sheet's." : "The panel with the licence number may not be on the upload, or the OCR couldn't read it.") : undefined,
    });
  }
  const licHits = findAll(/lic\.?\s*no\.?\s*[:\-]?\s*(\d[\d\s]*\d)/i, ctx.flat);
  // nothing from the address panel is on the label at all: it wasn't provided, which is not the same as being wrong
  const nameFound = names.some((n) => viewsContain(ctx.views, normalize(n)));
  const panelPresent = nameFound || pinHits.some((p) => p.hit) || licHits.length > 0 || /\b(manufactured|marketed|packed)\s+(?:&\s*marketed\s+)?by\b|\bfssai\b/i.test(ctx.flat);
  if (!panelPresent) {
    return [{ label: "Addresses", status: "skip", note: "The address panel (manufacturer, pincode, licence number) wasn't found on the uploaded label. Upload the panel that has it to check these." }];
  }
  if (licHits.length) {
    // the number may be split into groups by spaces, but digits that follow a complete 14-digit number (a barcode, a phone number
    // from the next column) are not part of it
    const takeLicence = (raw: string) => {
      let digits = "";
      for (const g of raw.trim().split(/\s+/)) {
        digits += g;
        if (digits.length >= 14) break;
      }
      return digits;
    };
    const badFormat = licHits.map((m) => takeLicence(m[1])).filter((d) => d.length !== 14);
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
    // OCR drops small full stops and swaps look-alike letters, so those findings stay Review; a wrong value, name, price or
    // number that was read stays red, with a note to confirm it on the label
    const fragile = /spelling|spelled|full stop|casing|capital|^product name/i;
    for (const step of steps) {
      for (const c of step.checks) {
        if (c.status !== "fail") continue;
        if (fragile.test(c.label)) c.status = "warn";
        else c.note ??= "Read by OCR: if this looks wrong, check it on the label.";
      }
    }
    notes.push("Spelling and full-stop findings are marked Review because OCR often misreads them. Values that were read and don't match the sheet are marked Fail.");
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
