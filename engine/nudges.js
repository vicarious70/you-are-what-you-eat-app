// Health DNA Engine — predictive nudges.
//
// Turns the learned Health DNA + recent logs into a few timely, personalized
// prompts: "you usually grab a soda about now, and it spikes you — try a swap",
// "walk now to flatten this meal", "no water logged yet". Rule-based but driven
// entirely by the individual's data, so it stays explainable and never shames.

const DAY = 24 * 3600 * 1000;

const hourOf = (at) => new Date(at).getHours();
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function fmtHour(h) {
  const hr = ((h + 11) % 12) + 1;
  return `${hr}${h < 12 ? "am" : "pm"}`;
}

// Average hour-of-day for a set of events (needs a couple to be meaningful).
function typicalHour(events) {
  const hrs = events.map((e) => hourOf(e.at));
  if (hrs.length < 2) return null;
  return Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
}

const FACTOR_PHRASE = {
  "sugary-drink": "a sugary drink",
  alcohol: "a drink",
  caffeine: "a caffeinated drink",
  fried: "something fried",
  dessert: "a dessert",
  "high-calorie-drink": "a high-calorie drink",
  "starch-heavy": "a starchy plate",
};
const factorPhrase = (f) => FACTOR_PHRASE[f] || f.replace(/-/g, " ");

function effectPhrase(insight) {
  if (insight.dimension === "glucose") return insight.direction === "hurts" ? "tends to spike your glucose" : "steadies your glucose";
  if (insight.dimension === "fullness") return insight.direction === "hurts" ? "leaves you less full" : "keeps you fuller";
  if (insight.dimension === "energy") return insight.direction === "hurts" ? "drains your energy" : "lifts your energy";
  return insight.direction === "hurts" ? "works against you" : "works for you";
}

const hasWalkInsight = (insights) =>
  insights.some((i) => i.factor === "walk-after-meal" && i.direction === "helps" && i.confidence >= 0.4);

// ---------------------------------------------------------------------------

export function generateNudges({
  profile = {},
  meals = [],
  beverages = [],
  activities = [],
  bodyEntries = [],
  dna = { insights: [] },
  now = new Date(),
} = {}) {
  const nudges = [];
  const h = now.getHours();
  const insights = dna.insights || [];
  const drinksToday = beverages.filter((b) => sameDay(b.at, now));
  const mealsToday = meals.filter((m) => sameDay(m.at, now));

  // 1. PREDICTIVE: a factor that hurts you, near the time you usually have it,
  //    and you haven't had it yet today.
  for (const ins of insights) {
    if (ins.direction !== "hurts" || ins.confidence < 0.4) continue;
    const carriers = [...beverages, ...meals].filter((e) => (e.tags || []).includes(ins.factor));
    const th = typicalHour(carriers);
    if (th == null) continue;
    const alreadyToday = [...drinksToday, ...mealsToday].some((e) => (e.tags || []).includes(ins.factor));
    if (alreadyToday) continue;
    if (h >= th - 2 && h <= th + 1) {
      nudges.push({
        id: `pattern-${ins.factor}`,
        priority: 5,
        tone: "watch",
        title: `Heads up around ${fmtHour(th)}`,
        body: `You usually have ${factorPhrase(ins.factor)} about now, and your Health DNA shows it ${effectPhrase(ins)}. A lighter swap today keeps your trend on track.`,
        action: null,
      });
      break; // at most one pattern nudge
    }
  }

  // 2. TIMELY: a higher-carb meal in the last ~75 min with no movement since.
  const recentMeal = meals
    .filter((m) => now - new Date(m.at) < 75 * 60 * 1000)
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  if (recentMeal) {
    const carbs = (recentMeal.served?.carbsG || 0) * (recentMeal.eatenFraction ?? 1);
    const movedSince =
      (recentMeal.signals && recentMeal.signals.postMealWalk) ||
      activities.some((a) => new Date(a.at) >= new Date(recentMeal.at));
    if (carbs >= 70 && !movedSince) {
      nudges.push({
        id: "walk-now",
        priority: 4,
        tone: "do",
        title: "Walk now → flatter curve",
        body: `That meal was higher-carb. A 10-minute walk in the next half hour can noticeably soften the glucose rise${hasWalkInsight(insights) ? " — and your DNA shows walking works for you" : ""}.`,
        action: { label: "Log a walk", goto: "track" },
      });
    }
  }

  // 3. REINFORCE: your strongest "what works" habit.
  const topHelp = insights.find((i) => i.direction === "helps" && i.confidence >= 0.4);
  if (topHelp) {
    nudges.push({
      id: "best-habit",
      priority: 3,
      tone: "win",
      title: "Your biggest win",
      body: `${capitalize(topHelp.summary)} Lean into it today.`,
      action: null,
    });
  }

  // 4. HYDRATION: nothing logged and it's past late morning.
  if (h >= 11 && drinksToday.filter((b) => b.type === "Water").length === 0) {
    nudges.push({
      id: "hydrate",
      priority: 3,
      tone: "do",
      title: "No water logged yet",
      body: "An easy win — hydration supports energy, fullness, and recovery.",
      action: { label: "Log water", goto: "drink" },
    });
  }

  // 5. PROTEIN: running light across the week.
  const weekMeals = meals.filter((m) => now - new Date(m.at) < 7 * DAY);
  if (weekMeals.length >= 3) {
    const avgProtein =
      weekMeals.reduce((s, m) => s + (m.served?.proteinG || 0) * (m.eatenFraction ?? 1), 0) / weekMeals.length;
    if (avgProtein < 30) {
      nudges.push({
        id: "protein",
        priority: 2,
        tone: "do",
        title: "Anchor more protein",
        body: `Your meals are averaging ~${Math.round(avgProtein)}g protein. Leading with protein keeps you fuller and steadier.`,
        action: null,
      });
    }
  }

  // 6. WEIGH-IN: none in the last week.
  const lastBody = bodyEntries.map((b) => new Date(b.at).getTime()).sort((a, b) => b - a)[0];
  if (!lastBody || now - lastBody > 7 * DAY) {
    nudges.push({
      id: "weigh-in",
      priority: 1,
      tone: "do",
      title: "Time for a weigh-in",
      body: "A morning weigh-in or two this week lets the engine separate real trend from daily water noise.",
      action: { label: "Log it", goto: "track" },
    });
  }

  nudges.sort((a, b) => b.priority - a.priority);
  const top = nudges.slice(0, 3);

  if (!top.length) {
    top.push({
      id: "start",
      priority: 0,
      tone: "info",
      title: "Let's find your patterns",
      body: "Log a few meals and drinks and I'll start predicting what helps and what to watch for you.",
      action: { label: "Log a meal", goto: "log" },
    });
  }
  return top;
}
