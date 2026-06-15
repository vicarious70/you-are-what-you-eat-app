// Health DNA Engine — weekly review generator.
//
// The week (Mon–Sun) is the platform's primary analysis period. This produces
// the six required sections plus next-week focus, in a tone that educates and
// guides. It never shames: missed days are framed as data, not failure.

import { consumptionDNA } from "./meal-to-body.js";
import { whatWorks, whatDoesNotWork } from "./learning.js";

const round = (n) => Math.round(n);
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// Monday 00:00 of the week containing `date`, as a Date.
export function weekStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

export function weekRange(date = new Date()) {
  const start = weekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function inWeek(at, start, end) {
  const t = new Date(at).getTime();
  return t >= start.getTime() && t < end.getTime();
}

// Sum the actually-consumed nutrition across a set of meals.
function consumedTotals(meals) {
  const totals = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 0, sugarG: 0, caloriesSaved: 0 };
  for (const meal of meals) {
    const c = consumptionDNA(meal);
    for (const k of Object.keys(totals)) {
      if (k === "caloriesSaved") totals.caloriesSaved += c.caloriesSaved;
      else totals[k] += c.consumed[k] || 0;
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// section builders — each returns { headline, body, stats? }
// ---------------------------------------------------------------------------

function nutritionReview(meals) {
  if (!meals.length) {
    return {
      headline: "Nutrition",
      body: "No meals were logged this week, so there is nothing to read yet. Even two or three photos next week will let the engine start learning your plate.",
      stats: {},
    };
  }
  const days = new Set(meals.map((m) => new Date(m.at).toDateString())).size;
  const totals = consumedTotals(meals);
  const perMeal = meals.length;
  const avgProtein = round(totals.proteinG / perMeal);
  const avgCalories = round(totals.calories / days);
  const avgSodium = round(totals.sodiumMg / perMeal);

  const proteinLine =
    avgProtein >= 35
      ? "Protein held up well across meals, which supports fullness and muscle."
      : "Protein ran a little light on average — anchoring it earlier in the day is the easiest win.";
  const sodiumLine =
    avgSodium >= 1500
      ? "Sodium trended high, so some scale movement this week was likely water, not fat."
      : "Sodium stayed reasonable, so the scale should reflect real trend more than water.";
  const savedLine =
    totals.caloriesSaved > 300
      ? ` Consumption DNA noticed roughly ${totals.caloriesSaved} kcal served but not eaten — leaving food on the plate is already working in your favor.`
      : "";

  const mealWord = perMeal === 1 ? "meal" : "meals";
  const dayWord = days === 1 ? "day" : "days";
  return {
    headline: "Nutrition",
    body: `You logged ${perMeal} ${mealWord} across ${days} ${dayWord}, averaging about ${avgCalories} kcal/day and ${avgProtein}g protein per meal. ${proteinLine} ${sodiumLine}${savedLine}`,
    stats: { meals: perMeal, daysLogged: days, avgCaloriesPerDay: avgCalories, avgProteinPerMeal: avgProtein, avgSodiumPerMeal: avgSodium, caloriesSaved: totals.caloriesSaved },
  };
}

function activityReview(activities, meals) {
  const walksAfterMeals = meals.filter((m) => m.signals && m.signals.postMealWalk).length;
  if (!activities.length && !walksAfterMeals) {
    return {
      headline: "Activity",
      body: "No workouts or post-meal walks were recorded. A 10-minute walk after your biggest meal is the single highest-leverage habit to try next week — no gym required.",
      stats: { workouts: 0, postMealWalks: 0 },
    };
  }
  const totalMin = activities.reduce((a, b) => a + (b.durationMin || 0), 0);
  const totalBurn = activities.reduce((a, b) => a + (b.caloriesBurned || 0), 0);
  return {
    headline: "Activity",
    body: `You recorded ${activities.length} workout(s) totaling ${totalMin} minutes${totalBurn ? ` (~${totalBurn} kcal)` : ""}, plus ${walksAfterMeals} post-meal walk(s). Movement after eating does more for glucose than its calorie burn suggests, so those walks count for a lot.`,
    stats: { workouts: activities.length, totalMinutes: totalMin, caloriesBurned: totalBurn, postMealWalks: walksAfterMeals },
  };
}

// Beverage Review — drinks are judged on their own, per spec.
function beverageReview(beverages) {
  if (!beverages.length) {
    return {
      headline: "Beverage",
      body: "No drinks logged this week. Beverages are easy to overlook but can carry a lot of sugar, calories, and caffeine — logging a few next week gives the engine the full picture.",
      stats: { drinks: 0 },
    };
  }
  const calories = beverages.reduce((a, b) => a + (b.calories || 0), 0);
  const sugar = beverages.reduce((a, b) => a + (b.sugarG || 0), 0);
  const sugary = beverages.filter((b) => (b.sugarG || 0) >= 20).length;
  const alcohol = round(beverages.reduce((a, b) => a + (b.alcoholServings || 0), 0) * 10) / 10;
  const water = beverages.filter((b) => b.type === "Water").length;

  const sugarLine =
    sugary > 0
      ? ` ${sugary} of them were higher-sugar (~${sugar}g sugar total) — liquid sugar spikes glucose faster than food.`
      : " Sugar from drinks stayed low, which keeps glucose steadier.";
  const alcoholLine = alcohol > 0 ? ` About ${alcohol} alcohol serving(s) — worth pairing with water and noting on recovery.` : "";
  const waterLine = water > 0 ? ` You logged water ${water} time(s) — keep that easy to reach.` : "";

  return {
    headline: "Beverage",
    body: `You logged ${beverages.length} drink(s) for roughly ${calories} kcal.${sugarLine}${alcoholLine}${waterLine}`,
    stats: { drinks: beverages.length, calories, sugaryDrinks: sugary, alcoholServings: alcohol, waterCount: water },
  };
}

// Recovery Review — weight/glucose trend plus hydration and alcohol recovery.
// (Sleep is a future input.)
function recoveryReview(bodyEntries, beverages) {
  const withWeight = bodyEntries.filter((b) => b.weightLb != null).sort((a, b) => new Date(a.at) - new Date(b.at));
  const glucoseReadings = bodyEntries.filter((b) => b.fastingGlucose != null).map((b) => b.fastingGlucose);
  const alcohol = round(beverages.reduce((a, b) => a + (b.alcoholServings || 0), 0) * 10) / 10;
  const water = beverages.filter((b) => b.type === "Water").length;

  let direction = "unknown";
  let weightLine = "No weigh-ins this week — one or two at a consistent morning time lets the engine separate real trend from water noise.";
  if (withWeight.length >= 1) {
    const delta = round((withWeight[withWeight.length - 1].weightLb - withWeight[0].weightLb) * 10) / 10;
    direction = delta < -0.3 ? "down" : delta > 0.3 ? "up" : "about flat";
    weightLine =
      direction === "about flat"
        ? "Weight held about flat — over a single week that is normal, not a stall."
        : `Weight moved ${direction} about ${Math.abs(delta)} lb, within normal water-driven range for seven days.`;
  }
  const glucoseLine = glucoseReadings.length
    ? ` Fasting glucose averaged about ${round(avg(glucoseReadings))} mg/dL across ${glucoseReadings.length} reading(s).`
    : "";
  const recoveryLine =
    alcohol > 0
      ? ` ${alcohol} alcohol serving(s) this week can lighten deep sleep — hydration and a lighter night or two help recovery.`
      : water > 0
        ? " Hydration looked solid, which supports sleep and recovery."
        : "";

  return {
    headline: "Recovery",
    body: `${weightLine}${glucoseLine}${recoveryLine} The scale is noisy day to day; the multi-week direction is the real signal.`,
    stats: { direction, glucoseReadings: glucoseReadings.length, alcoholServings: alcohol, waterCount: water },
  };
}

// "What we learned this week" — surface the strongest learned patterns.
function learnedThisWeek(dna) {
  const insights = (dna.insights || []).filter((i) => i.direction !== "neutral" && i.confidence >= 0.4);
  return insights.slice(0, 4).map((i) => i.summary);
}

function progressReview(profile, nutrition, recovery) {
  const goal = (profile.goal || "general wellness").toLowerCase();
  let line;
  if (goal.includes("fat")) {
    line =
      recovery.stats.direction === "down"
        ? "For fat loss, the week pointed the right direction. Keep the protein and the walks; don't chase a faster drop."
        : "For fat loss, hold steady — one flat or slightly-up week is water, not lost progress. Consistency beats intensity here.";
  } else if (goal.includes("glucose")) {
    line = "For glucose stability, the pattern of walks and protein placement matters more than any single number. Keep stacking the habits that flattened your curve.";
  } else if (goal.includes("strength")) {
    line = "For strength and muscle, protein consistency is the lever. Pair it with your training days and the trend takes care of itself.";
  } else {
    line = "For general wellness, the win is showing up and learning your patterns. That foundation is already forming.";
  }
  return { headline: "Progress", body: line, stats: { goal: profile.goal } };
}

function mindsetReview(nutrition) {
  const days = nutrition.stats.daysLogged || 0;
  let line;
  if (days >= 6) line = "You showed up almost every day — that consistency, not perfection, is what changes a body. Keep the streak light and repeatable.";
  else if (days >= 3) line = "You logged a solid chunk of the week. The goal isn't a perfect log; it's enough data to see your patterns. You're there.";
  else if (days >= 1) line = "You got started, and starting is the hardest part. No guilt about the gaps — next week, aim for one more day than this one.";
  else line = "This was a quiet week for logging, and that's okay. The engine meets you where you are. One photo is enough to begin again.";
  return { headline: "Mindset", body: line, stats: { daysLogged: days } };
}

function nextWeekFocus(dna, nutrition, activity) {
  const focuses = [];
  const helps = whatWorks(dna).slice(0, 2);
  const hurts = whatDoesNotWork(dna).filter((i) => i.confidence >= 0.4).slice(0, 1);

  for (const h of helps) focuses.push(`Do more of what works: ${h.summary.replace(/\.$/, "")}.`);
  for (const h of hurts) focuses.push(`Soften what works against you: ${h.summary.replace(/\.$/, "")}.`);
  if ((activity.stats.postMealWalks || 0) === 0) focuses.push("Add one 10-minute walk after your largest meal, 4 days this week.");
  if ((nutrition.stats.avgProteinPerMeal || 0) < 35) focuses.push("Put protein first at your first meal each day.");
  if (!focuses.length) focuses.push("Keep doing what you're doing — log a couple meals so the engine can keep learning your DNA.");

  return { headline: "Next Week Focus", body: "Two or three small, repeatable moves:", items: focuses.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------

export function generateWeeklyReview({
  profile,
  meals = [],
  beverages = [],
  activities = [],
  bodyEntries = [],
  dna = { insights: [] },
  date = new Date(),
}) {
  const { start, end } = weekRange(date);
  const weekMeals = meals.filter((m) => inWeek(m.at, start, end));
  const weekBeverages = beverages.filter((b) => inWeek(b.at, start, end));
  const weekActivities = activities.filter((a) => inWeek(a.at, start, end));
  const weekBody = bodyEntries.filter((b) => inWeek(b.at, start, end));

  const nutrition = nutritionReview(weekMeals);
  const beverage = beverageReview(weekBeverages);
  const activity = activityReview(weekActivities, weekMeals);
  const recovery = recoveryReview(weekBody, weekBeverages);
  const progress = progressReview(profile, nutrition, recovery);
  const mindset = mindsetReview(nutrition);
  const focus = nextWeekFocus(dna, nutrition, activity);

  return {
    userId: profile.id,
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    generatedAt: new Date().toISOString(),
    // Spec order: Nutrition, Beverage, Activity, Progress, Recovery, Mindset.
    sections: { nutrition, beverage, activity, progress, recovery, mindset },
    learnedThisWeek: learnedThisWeek(dna),
    nextWeekFocus: focus,
  };
}
