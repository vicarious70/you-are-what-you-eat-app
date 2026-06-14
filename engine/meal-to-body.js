// Health DNA Engine — meal-to-body analysis.
//
// Turns one meal record into the four answers the platform promises:
//   1. What happened?      2. Why did it happen?
//   3. Where is this leading?   4. What should I do next?
//
// Plus Consumption DNA: served vs eaten vs saved, and calories saved.
//
// This file is deterministic and pure. It never shames; it explains
// consequences and offers the next adjustment.

const round = (n) => Math.round(n);

// ---------------------------------------------------------------------------
// Consumption DNA — what was served, eaten, and saved.
// ---------------------------------------------------------------------------

const NUTRIENT_KEYS = ["calories", "proteinG", "carbsG", "fatG", "fiberG", "sodiumMg", "sugarG"];

function scale(nutrition, fraction) {
  const out = {};
  for (const key of NUTRIENT_KEYS) out[key] = round((nutrition[key] || 0) * fraction);
  return out;
}

export function consumptionDNA(meal) {
  const served = meal.served;
  const eatenFraction = meal.eatenFraction ?? 1;
  const consumed = scale(served, eatenFraction);
  const saved = scale(served, 1 - eatenFraction);

  return {
    eatenFraction,
    served: { ...served },
    consumed,
    saved,
    caloriesSaved: saved.calories,
    // A take-home / leftover framing the Restaurant + Consumption DNA modes use.
    savedNarrative:
      eatenFraction >= 1
        ? "The full plate was eaten, so there is no saved portion this time."
        : `About ${Math.round((1 - eatenFraction) * 100)}% was left or saved — roughly ${saved.calories} kcal not eaten.`,
  };
}

// ---------------------------------------------------------------------------
// Body-response signals from the consumed portion.
// ---------------------------------------------------------------------------

export function mealSignals(consumed, profile = {}) {
  const goal = (profile.goal || "").toLowerCase();

  const glucose =
    consumed.carbsG >= 120 || consumed.sugarG >= 30
      ? { level: "Elevated", className: "high", note: "A higher carb or sugar load can create a sharper rise and dip." }
      : consumed.carbsG >= 75
        ? { level: "Moderate", className: "moderate", note: "Likely manageable, especially with a short walk after eating." }
        : { level: "Steady", className: "light", note: "Lower glucose pressure for most people." };

  const water =
    consumed.sodiumMg >= 2000
      ? { level: "High", className: "high", note: "Tomorrow's scale may jump from water, not instant fat gain." }
      : consumed.sodiumMg >= 1200
        ? { level: "Moderate", className: "moderate", note: "Hydration will help smooth temporary water retention." }
        : { level: "Low", className: "light", note: "Lower chance of sodium-driven scale noise." };

  const protein =
    consumed.proteinG >= 40
      ? { level: "Strong", className: "light", note: "Good support for fullness, recovery, and muscle retention." }
      : consumed.proteinG >= 25
        ? { level: "Okay", className: "moderate", note: "Helpful, but the next meal can anchor protein more strongly." }
        : { level: "Low", className: "high", note: "You may get hungry sooner; prioritize protein next." };

  const trend =
    consumed.calories >= 1100
      ? { level: "Heavy", className: "high", note: "Workable once, but repeating this pattern nudges the weekly trend up." }
      : consumed.calories >= 750
        ? { level: "Manageable", className: "moderate", note: "Fits fine if the surrounding meals stay simpler." }
        : { level: "Light", className: "light", note: "Lower pressure on the weekly energy trend." };

  // Goal slightly reweights which signal leads (e.g. glucose stability cares
  // most about the glucose signal). Used to order next steps, not to scold.
  const lead =
    goal.includes("glucose") ? "glucose" : goal.includes("heart") ? "water" : goal.includes("strength") ? "protein" : "trend";

  return { glucose, water, protein, trend, lead };
}

export function impactScore(consumed) {
  const score = Math.min(
    100,
    round(consumed.calories / 18 + consumed.sodiumMg / 70 + consumed.sugarG * 0.55 + consumed.carbsG * 0.2)
  );
  const label = score >= 78 ? "High impact" : score >= 54 ? "Moderate impact" : "Light impact";
  const className = score >= 78 ? "high" : score >= 54 ? "moderate" : "light";
  return { score, label, className };
}

// ---------------------------------------------------------------------------
// The four questions.
// ---------------------------------------------------------------------------

function relevantInsights(meal, dna) {
  if (!dna || !Array.isArray(dna.insights)) return [];
  const tags = new Set(meal.tags || []);
  return dna.insights.filter((i) => i.factor && (tags.has(i.factor) || i.factor === meal.timing.toLowerCase()));
}

export function analyzeMeal(meal, profile = {}, dna = null) {
  const consumption = consumptionDNA(meal);
  const consumed = consumption.consumed;
  const signals = mealSignals(consumed, profile);
  const impact = impactScore(consumed);
  const insights = relevantInsights(meal, dna);

  // 1. What happened — the plain facts of the consumed portion.
  const whatHappened =
    `This ${meal.portion.toLowerCase()} ${meal.timing.toLowerCase()} delivered about ${consumed.calories} kcal ` +
    `(${consumed.proteinG}g protein, ${consumed.carbsG}g carbs, ${consumed.fatG}g fat, ${consumed.sodiumMg}mg sodium). ` +
    consumption.savedNarrative;

  // 2. Why it happened — the drivers, not willpower.
  const drivers = [];
  if (consumed.carbsG >= 100) drivers.push("a large starch or sugar load");
  if (consumed.sodiumMg >= 1500) drivers.push("high sodium");
  if (consumed.fatG >= 35) drivers.push("rich fats or sauces");
  if (consumed.proteinG < 25) drivers.push("lighter protein");
  if (meal.hunger === "Very hungry") drivers.push("starting the meal very hungry");
  const whyItHappened =
    drivers.length > 0
      ? `The signals above come mostly from ${listJoin(drivers)} — portion, sauce, and sodium move tomorrow's scale and energy more than willpower does.`
      : "Nothing in this meal stands out as a strong driver — it reads as a balanced, repeatable plate.";

  // 3. Where it is leading — short-term body response + learned pattern.
  let whereLeading =
    `Expect ${lower(signals.glucose.level)} glucose movement and ${lower(signals.water.level)} water-retention pressure. ` +
    `On its own this ${impact.label.toLowerCase()} meal does not define the trend; the pattern across the week does.`;
  const negative = insights.find((i) => i.direction === "hurts" && i.confidence >= 0.4);
  const positive = insights.find((i) => i.direction === "helps" && i.confidence >= 0.4);
  if (negative) whereLeading += ` Your Health DNA shows a pattern here: ${lowerFirst(negative.summary)}`;

  // 4. What next — concrete, optional, never punishing.
  const whatNext = nextSteps(meal, consumed, signals, profile, positive);

  return {
    mealId: meal.id,
    questions: { whatHappened, whyItHappened, whereLeading, whatNext },
    consumption,
    signals,
    impact,
    appliedInsights: insights.map((i) => ({ summary: i.summary, direction: i.direction, confidence: i.confidence })),
  };
}

function nextSteps(meal, consumed, signals, profile, positiveInsight) {
  const steps = [];
  if (signals.lead === "glucose" && consumed.carbsG >= 75)
    steps.push("Take a 10–20 minute walk after this meal to smooth the glucose curve.");
  if (consumed.proteinG < 35) steps.push("Make the next plate protein-first to improve fullness.");
  if (consumed.carbsG > 105 && signals.lead !== "glucose")
    steps.push("A short walk after the highest-carb meal helps tomorrow's energy.");
  if (consumed.sodiumMg > 1800) steps.push("Drink water early and expect temporary scale noise tomorrow, not fat gain.");
  if (consumed.sugarG > 25) steps.push("Pair the next snack with protein or fiber instead of another sweet item.");
  // Reinforce a habit the user's own DNA already shows works for them.
  if (positiveInsight) steps.push(`Lean on what works for you: ${positiveInsight.summary}`);
  if (steps.length < 2) steps.push("Keep the next meal simple: protein, plants, and a portion you can repeat.");
  return steps.slice(0, 4);
}

// ---------------------------------------------------------------------------
// small text helpers
// ---------------------------------------------------------------------------

function lower(s) {
  return String(s || "").toLowerCase();
}

function lowerFirst(s) {
  const str = String(s || "");
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function listJoin(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
