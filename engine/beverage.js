// Health DNA Engine — Beverage DNA.
//
// Beverages are evaluated separately from meals: many people take in real
// calories, sugar, caffeine, and alcohol through drinks. This module defines
// the beverage record, sensible per-type defaults (so a logged type + size can
// be estimated without a lab), and the "What This Drink May Do" analysis,
// including Alcohol DNA. Like everything else here, it explains — it never
// shames.

import { nowISO, uid } from "./schema.js";

const num = (v, f = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
};
const nonNeg = (v, f = 0) => Math.max(0, Math.round(num(v, f)));
const str = (v, f = "") => (v == null ? f : String(v));

export const BEVERAGE_TYPES = [
  "Water",
  "Coffee",
  "Sweet Coffee",
  "Tea",
  "Sweet Tea",
  "Energy Drink",
  "Sports Drink",
  "Soda",
  "Diet Soda",
  "Juice",
  "Milk",
  "Protein Shake",
  "Smoothie",
  "Beer",
  "Wine",
  "Liquor",
  "Mixed Drink",
  "Frozen Drink",
  "Milkshake",
];

// Per standard serving. caffeineMg in mg, alcoholServings in US standard drinks.
// proteinG matters for satiety on shakes/milk. hydration is a -1..1 hint.
const DEFAULTS = {
  Water: { oz: 16, calories: 0, sugarG: 0, carbsG: 0, caffeineMg: 0, alcohol: 0, proteinG: 0, hydration: 1 },
  Coffee: { oz: 12, calories: 5, sugarG: 0, carbsG: 0, caffeineMg: 95, alcohol: 0, proteinG: 0, hydration: 0.1 },
  "Sweet Coffee": { oz: 16, calories: 250, sugarG: 33, carbsG: 40, caffeineMg: 150, alcohol: 0, proteinG: 3, hydration: 0 },
  Tea: { oz: 12, calories: 2, sugarG: 0, carbsG: 0, caffeineMg: 40, alcohol: 0, proteinG: 0, hydration: 0.4 },
  "Sweet Tea": { oz: 16, calories: 180, sugarG: 40, carbsG: 44, caffeineMg: 35, alcohol: 0, proteinG: 0, hydration: 0.1 },
  "Energy Drink": { oz: 16, calories: 210, sugarG: 54, carbsG: 56, caffeineMg: 160, alcohol: 0, proteinG: 0, hydration: -0.2 },
  "Sports Drink": { oz: 20, calories: 140, sugarG: 34, carbsG: 36, caffeineMg: 0, alcohol: 0, proteinG: 0, hydration: 0.6 },
  Soda: { oz: 12, calories: 140, sugarG: 39, carbsG: 39, caffeineMg: 34, alcohol: 0, proteinG: 0, hydration: -0.1 },
  "Diet Soda": { oz: 12, calories: 0, sugarG: 0, carbsG: 0, caffeineMg: 46, alcohol: 0, proteinG: 0, hydration: 0 },
  Juice: { oz: 12, calories: 165, sugarG: 36, carbsG: 39, caffeineMg: 0, alcohol: 0, proteinG: 1, hydration: 0.3 },
  Milk: { oz: 8, calories: 120, sugarG: 12, carbsG: 12, caffeineMg: 0, alcohol: 0, proteinG: 8, hydration: 0.4 },
  "Protein Shake": { oz: 12, calories: 200, sugarG: 6, carbsG: 12, caffeineMg: 0, alcohol: 0, proteinG: 25, hydration: 0.3 },
  Smoothie: { oz: 16, calories: 300, sugarG: 48, carbsG: 60, caffeineMg: 0, alcohol: 0, proteinG: 6, hydration: 0.3 },
  Beer: { oz: 12, calories: 150, sugarG: 0, carbsG: 13, caffeineMg: 0, alcohol: 1, proteinG: 1, hydration: -0.5 },
  Wine: { oz: 5, calories: 125, sugarG: 1, carbsG: 4, caffeineMg: 0, alcohol: 1, proteinG: 0, hydration: -0.5 },
  Liquor: { oz: 1.5, calories: 100, sugarG: 0, carbsG: 0, caffeineMg: 0, alcohol: 1, proteinG: 0, hydration: -0.6 },
  "Mixed Drink": { oz: 8, calories: 250, sugarG: 24, carbsG: 28, caffeineMg: 0, alcohol: 1.5, proteinG: 0, hydration: -0.6 },
  "Frozen Drink": { oz: 16, calories: 500, sugarG: 60, carbsG: 70, caffeineMg: 0, alcohol: 1.5, proteinG: 0, hydration: -0.5 },
  Milkshake: { oz: 16, calories: 550, sugarG: 65, carbsG: 85, caffeineMg: 0, alcohol: 0, proteinG: 9, hydration: -0.1 },
};

export function beverageDefaults(type) {
  return DEFAULTS[type] || DEFAULTS.Water;
}

// Learnable factors for the DNA Memory engine.
export function deriveBeverageTags(bev) {
  const tags = new Set();
  if (bev.sugarG >= 20) tags.add("sugary-drink");
  if (bev.alcoholServings > 0) tags.add("alcohol");
  if (bev.caffeineMg >= 80) tags.add("caffeine");
  if (bev.type === "Water") tags.add("hydration");
  if (bev.calories >= 250) tags.add("high-calorie-drink");
  if (bev.calories <= 10 && bev.type !== "Water") tags.add("diet-drink");
  return [...tags];
}

export function createBeverage(input = {}) {
  const type = BEVERAGE_TYPES.includes(input.type) ? input.type : "Water";
  const def = beverageDefaults(type);
  // Scale the defaults by how the serving compares to the standard serving,
  // unless explicit nutrition was provided (e.g. from a vision estimate).
  const oz = input.servingOz ? num(input.servingOz, def.oz) : def.oz;
  const scale = def.oz ? oz / def.oz : 1;

  const bev = {
    id: str(input.id) || uid("bev"),
    userId: str(input.userId),
    at: str(input.at) || nowISO(),
    type,
    servingOz: Math.round(oz * 10) / 10,
    calories: input.calories != null ? nonNeg(input.calories) : Math.round(def.calories * scale),
    sugarG: input.sugarG != null ? nonNeg(input.sugarG) : Math.round(def.sugarG * scale),
    carbsG: input.carbsG != null ? nonNeg(input.carbsG) : Math.round(def.carbsG * scale),
    caffeineMg: input.caffeineMg != null ? nonNeg(input.caffeineMg) : Math.round(def.caffeineMg * scale),
    proteinG: input.proteinG != null ? nonNeg(input.proteinG) : Math.round(def.proteinG * scale),
    alcoholServings:
      input.alcoholServings != null ? Math.max(0, num(input.alcoholServings)) : Math.round(def.alcohol * scale * 10) / 10,
    hydration: def.hydration,
    notes: str(input.notes),
    source: ["vision", "manual", "estimate"].includes(input.source) ? input.source : "manual",
    createdAt: str(input.createdAt) || nowISO(),
  };
  bev.tags = Array.isArray(input.tags) && input.tags.length ? input.tags : deriveBeverageTags(bev);
  return bev;
}

// ---------------------------------------------------------------------------
// "What This Drink May Do" — qualitative impact tags.
// ---------------------------------------------------------------------------

function impactTags(bev) {
  const tags = [];
  const add = (label, className, note) => tags.push({ label, className, note });

  if (bev.sugarG >= 25) add("High Sugar", "high", `About ${bev.sugarG}g of sugar — a fast spike for most people.`);
  if (bev.calories >= 250) add("High Calorie", "high", `Roughly ${bev.calories} kcal in liquid form, easy to drink quickly.`);
  if (bev.calories <= 25 && bev.type !== "Water") add("Low Calorie", "light", "Very little energy from this drink.");
  if (bev.sugarG >= 20) add("May Increase Glucose", "moderate", "Liquid sugar tends to raise blood glucose faster than food.");
  if (bev.type === "Water" || bev.hydration >= 0.5) add("Hydrating", "good", "Supports hydration with no sugar or calorie cost.");
  if (bev.alcoholServings > 0 || bev.caffeineMg >= 200 || bev.hydration <= -0.4)
    add("Dehydrating", "moderate", "Alcohol and heavy caffeine pull water out — pair with water.");
  if (bev.alcoholServings >= 1) add("May Slow Recovery", "high", "Alcohol can blunt sleep quality and next-day recovery.");
  if (bev.caffeineMg >= 80) add("Caffeine Boost", "moderate", `About ${bev.caffeineMg}mg caffeine — watch the timing before sleep.`);
  if (bev.proteinG >= 15) add("Protein Support", "good", `${bev.proteinG}g protein helps fullness and muscle.`);

  if (!tags.length) add("Gentle", "light", "A low-impact drink for most people.");
  return tags;
}

// Alcohol DNA — only when there's alcohol. Explains, never lectures.
function alcoholDNA(bev) {
  if (bev.alcoholServings <= 0) return null;
  const s = Math.round(bev.alcoholServings * 10) / 10;
  return {
    servings: s,
    calories: bev.calories,
    note:
      `This is about ${s} standard ${s === 1 ? "drink" : "drinks"}. Alcohol can lighten deep sleep, slow next-day ` +
      `recovery, and add calories the body burns first — which can pause fat use. It also dehydrates, so a glass of ` +
      `water between drinks and before bed helps. No guilt here; it's about knowing the trade-off against this week's goals.`,
  };
}

export function analyzeBeverage(bev, profile = {}, dna = null) {
  const tags = impactTags(bev);
  const alcohol = alcoholDNA(bev);

  const whatHappened =
    `This ${bev.servingOz}oz ${bev.type.toLowerCase()} added about ${bev.calories} kcal` +
    (bev.sugarG ? `, ${bev.sugarG}g sugar` : "") +
    (bev.caffeineMg ? `, ${bev.caffeineMg}mg caffeine` : "") +
    (bev.alcoholServings ? `, ~${Math.round(bev.alcoholServings * 10) / 10} drinks` : "") +
    ".";

  const drivers = [];
  if (bev.sugarG >= 20) drivers.push("liquid sugar");
  if (bev.alcoholServings > 0) drivers.push("alcohol");
  if (bev.caffeineMg >= 150) drivers.push("a high caffeine dose");
  const whyItHappened = drivers.length
    ? `The effects above come mainly from ${listJoin(drivers)} — calories you drink don't fill you up the way food does.`
    : "Nothing here stands out — this reads as a low-impact choice.";

  let whereLeading =
    bev.sugarG >= 20
      ? "Expect a quicker glucose rise and dip than a meal would cause."
      : bev.alcoholServings > 0
        ? "The bigger effect is on tonight's sleep and tomorrow's recovery, more than the scale."
        : "Low pressure on glucose, recovery, and the weekly trend.";
  // Pull in the user's own learned pattern if we have one.
  const negative = dna && Array.isArray(dna.insights)
    ? dna.insights.find((i) => i.direction === "hurts" && bev.tags.includes(i.factor) && i.confidence >= 0.4)
    : null;
  if (negative) whereLeading += ` Your Health DNA shows a pattern here: ${lowerFirst(negative.summary)}`;

  const whatNext = [];
  if (bev.alcoholServings > 0) whatNext.push("Have a glass of water between drinks and one before bed.");
  if (bev.sugarG >= 25) whatNext.push("Next time, try a smaller size or a lower-sugar version to soften the spike.");
  if (bev.caffeineMg >= 150) whatNext.push("Keep caffeine to earlier in the day so it doesn't cut into sleep.");
  if (bev.type === "Water" || bev.hydration >= 0.5) whatNext.push("Nice — keep water easy to reach through the day.");
  if (whatNext.length < 1) whatNext.push("A solid choice — no change needed.");

  return {
    beverageId: bev.id,
    whatItMayDo: tags,
    questions: { whatHappened, whyItHappened, whereLeading, whatNext: whatNext.slice(0, 3) },
    alcohol,
  };
}

function listJoin(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function lowerFirst(s) {
  const t = String(s || "");
  return t.charAt(0).toLowerCase() + t.slice(1);
}
