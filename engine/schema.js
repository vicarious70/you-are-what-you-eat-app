// Health DNA Engine — data structures.
//
// This module is the single source of truth for the shapes the engine reads
// and writes. It is pure and dependency-free so it runs unchanged in Node and
// the browser. Everything else in engine/ consumes these factories, and the
// Supabase store maps database rows to and from them.
//
// Design rules:
// - Inputs are messy (vision estimates, dropdowns, partial data). Factories
//   normalize and clamp so the rest of the brain never re-validates.
// - Nothing here judges or coaches. These are facts, not opinions.

export const GOALS = [
  "Fat loss",
  "Glucose stability",
  "Heart health",
  "Strength and muscle",
  "General wellness",
];

export const ACTIVITY_LEVELS = [
  "Light walking",
  "Moderate activity",
  "Resistance training",
  "High activity",
];

export const MEAL_TYPES = ["Home plate", "Restaurant meal", "Fast food", "Holiday meal"];

export const TIMINGS = ["Breakfast", "Lunch", "Dinner", "Late night"];

// Portion size relative to a "standard" plate.
export const PORTION_MULTIPLIERS = {
  Light: 0.72,
  Standard: 1,
  Large: 1.28,
  "Very large": 1.55,
};

// Consumption DNA: how much of what was served actually got eaten.
export const EATEN_FRACTIONS = {
  "All or planned": 1,
  "About three quarters": 0.75,
  "About half": 0.5,
  "Less than half": 0.35,
};

export const HUNGER_LEVELS = ["Not hungry", "Hungry", "Very hungry"];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function nowISO() {
  return new Date().toISOString();
}

export function uid(prefix = "id") {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNum(value, fallback, min, max) {
  const v = num(value, fallback);
  return Math.min(max, Math.max(min, v));
}

function nonNegInt(value, fallback = 0) {
  return Math.max(0, Math.round(num(value, fallback)));
}

function str(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

// ISO date (YYYY-MM-DD) in local terms, used for grouping into days/weeks.
export function dayKey(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Health DNA profile
// ---------------------------------------------------------------------------

// The durable description of a person plus the slow-changing context the brain
// needs. Fast-changing signals (weight over time, glucose) live in body/meal
// records, not here.
export function createProfile(input = {}) {
  return {
    id: str(input.id) || uid("user"),
    name: str(input.name, "Friend"),
    sex: oneOf(input.sex, ["female", "male", "unspecified"], "unspecified"),
    age: input.age == null ? null : nonNegInt(input.age),
    heightIn: input.heightIn == null ? null : clampNum(input.heightIn, 66, 36, 90),
    startWeightLb: input.startWeightLb == null ? null : clampNum(input.startWeightLb, null, 50, 800),
    goal: oneOf(input.goal, GOALS, "General wellness"),
    activityLevel: oneOf(input.activityLevel, ACTIVITY_LEVELS, "Moderate activity"),
    // Free-form, optional context that shapes coaching tone and safety.
    medicalConditions: arr(input.medicalConditions).map(String),
    mobilityLimitations: arr(input.mobilityLimitations).map(String),
    pregnancyStatus: oneOf(input.pregnancyStatus, ["none", "pregnant", "postpartum"], "none"),
    foodPreferences: arr(input.foodPreferences).map(String),
    budgetLimited: Boolean(input.budgetLimited),
    createdAt: str(input.createdAt) || nowISO(),
    updatedAt: nowISO(),
  };
}

// ---------------------------------------------------------------------------
// Meal record
// ---------------------------------------------------------------------------

// Normalized nutrition for what was SERVED (the full plate). Consumption DNA
// then derives what was actually eaten from `eatenAmount`.
function normalizeNutrition(input = {}) {
  const calories = nonNegInt(input.calories, 650);
  return {
    calories,
    calorieMin: Math.min(nonNegInt(input.calorieMin, Math.round(calories * 0.8)), calories),
    calorieMax: Math.max(nonNegInt(input.calorieMax, Math.round(calories * 1.25)), calories),
    proteinG: nonNegInt(input.proteinG, 30),
    carbsG: nonNegInt(input.carbsG, 65),
    fatG: nonNegInt(input.fatG, 24),
    fiberG: nonNegInt(input.fiberG, 5),
    sodiumMg: nonNegInt(input.sodiumMg, 900),
    sugarG: nonNegInt(input.sugarG, 10),
  };
}

// Tags are the learnable "factors" of a meal: lightweight labels that the
// learning engine correlates against outcomes. They come from detected foods,
// notes, or the meal type. Keep them stable and lowercase.
export function deriveMealTags(input = {}) {
  const tags = new Set(arr(input.tags).map((t) => String(t).toLowerCase()));
  const text = [
    str(input.notes),
    ...arr(input.foods).map((f) => str(f && f.name)),
  ]
    .join(" ")
    .toLowerCase();

  const rules = [
    ["sugary-drink", ["soda", "pop", "sweet tea", "juice", "energy drink", "lemonade"]],
    ["fried", ["fried", "fries", "crispy", "tempura", "nuggets"]],
    ["high-protein", ["chicken", "steak", "fish", "eggs", "turkey", "tofu", "shrimp", "greek yogurt"]],
    ["starch-heavy", ["rice", "pasta", "bread", "potato", "noodle", "tortilla", "bun"]],
    ["vegetables", ["salad", "broccoli", "greens", "vegetable", "peppers", "spinach"]],
    ["dessert", ["cake", "cookie", "ice cream", "donut", "candy", "pie"]],
    ["cheesy-creamy", ["cheese", "cream", "alfredo", "ranch", "queso"]],
  ];

  for (const [tag, terms] of rules) {
    if (terms.some((term) => text.includes(term))) tags.add(tag);
  }
  return [...tags];
}

export function createMeal(input = {}) {
  const served = normalizeNutrition(input);
  const eatenAmount = oneOf(input.eatenAmount, Object.keys(EATEN_FRACTIONS), "All or planned");
  const eatenFraction = EATEN_FRACTIONS[eatenAmount];

  return {
    id: str(input.id) || uid("meal"),
    userId: str(input.userId),
    at: str(input.at) || nowISO(),

    // context
    mealType: oneOf(input.mealType, MEAL_TYPES, "Home plate"),
    portion: oneOf(input.portion, Object.keys(PORTION_MULTIPLIERS), "Standard"),
    timing: oneOf(input.timing, TIMINGS, "Lunch"),
    hunger: oneOf(input.hunger, HUNGER_LEVELS, "Hungry"),
    eatenAmount,
    eatenFraction,
    notes: str(input.notes),
    foods: arr(input.foods),
    tags: deriveMealTags(input),

    // nutrition as served
    served,

    // post-meal signals the user or a sensor may report later. Optional, and
    // the learning engine uses whatever is present. nextDay* values describe
    // the morning after.
    signals: {
      glucosePeak: input.signals && input.signals.glucosePeak != null ? num(input.signals.glucosePeak) : null,
      satietyHours: input.signals && input.signals.satietyHours != null ? num(input.signals.satietyHours) : null,
      energy: oneOf(input.signals && input.signals.energy, ["low", "ok", "high"], null),
      postMealWalk: Boolean(input.signals && input.signals.postMealWalk),
    },

    source: oneOf(input.source, ["vision", "manual", "estimate"], "manual"),
    createdAt: str(input.createdAt) || nowISO(),
  };
}

// ---------------------------------------------------------------------------
// Activity record (Workout DNA target shape)
// ---------------------------------------------------------------------------

export function createActivity(input = {}) {
  return {
    id: str(input.id) || uid("act"),
    userId: str(input.userId),
    at: str(input.at) || nowISO(),
    type: str(input.type, "walk"),
    durationMin: nonNegInt(input.durationMin, 0),
    caloriesBurned: nonNegInt(input.caloriesBurned, 0),
    distanceMi: input.distanceMi == null ? null : clampNum(input.distanceMi, 0, 0, 200),
    source: oneOf(input.source, ["samsung-health", "apple-health", "machine", "manual"], "manual"),
    createdAt: str(input.createdAt) || nowISO(),
  };
}

// ---------------------------------------------------------------------------
// Body response record (weight, glucose, composition, blood work)
// ---------------------------------------------------------------------------

export function createBodyEntry(input = {}) {
  return {
    id: str(input.id) || uid("body"),
    userId: str(input.userId),
    at: str(input.at) || nowISO(),
    weightLb: input.weightLb == null ? null : clampNum(input.weightLb, null, 50, 800),
    bodyFatPct: input.bodyFatPct == null ? null : clampNum(input.bodyFatPct, null, 3, 70),
    fastingGlucose: input.fastingGlucose == null ? null : clampNum(input.fastingGlucose, null, 40, 600),
    restingHr: input.restingHr == null ? null : clampNum(input.restingHr, null, 30, 220),
    note: str(input.note),
    createdAt: str(input.createdAt) || nowISO(),
  };
}
