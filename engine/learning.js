// Health DNA Engine — the learning engine.
//
// This is what makes the product "Health DNA" rather than a calorie counter.
// It reads a user's meal history and learns, per individual, which factors
// (food tags, timing, post-meal behaviors) tend to improve or worsen their
// body response — and how confident we are.
//
// Mechanism (intentionally simple and explainable, not a black box):
//   - Each meal contributes FACTORS (e.g. "high-protein", "sugary-drink",
//     "walk-after-meal", "late night") and OUTCOMES along a few dimensions
//     where higher always means "better body response".
//   - For each factor we compare the average outcome on meals WITH the factor
//     against meals WITHOUT it. A meaningful, well-sampled gap becomes an
//     insight ("helps" or "hurts"), with confidence scaling by sample size
//     and effect size.
//
// The Anthony example from the spec falls straight out of this: higher protein
// helps fullness, walking after dinner helps glucose, sugary drinks hurt
// glucose, potatoes land neutral.

const DIMENSIONS = ["glucose", "fullness", "energy"];

const MIN_SAMPLES_WITH = 3; // need at least this many meals carrying the factor
const MIN_SAMPLES_WITHOUT = 3;
const EFFECT_THRESHOLD = 0.12; // minimum mean gap (on a 0..1 scale) to report
const CONFIDENCE_K = 4; // sample-size half-saturation constant

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// ---------------------------------------------------------------------------
// Per-meal outcomes — always normalized so 1 = best, 0 = worst.
// Measured signals win; otherwise we derive a reasonable proxy from nutrition.
// A dimension is `null` when we truly have no basis to judge it.
// ---------------------------------------------------------------------------

function mealOutcomes(meal) {
  const consumedCarbs = (meal.served.carbsG || 0) * (meal.eatenFraction ?? 1);
  const consumedSugar = (meal.served.sugarG || 0) * (meal.eatenFraction ?? 1);
  const consumedProtein = (meal.served.proteinG || 0) * (meal.eatenFraction ?? 1);
  const consumedFiber = (meal.served.fiberG || 0) * (meal.eatenFraction ?? 1);
  const s = meal.signals || {};

  // Glucose steadiness — measured peak (mg/dL) preferred, ~100 steady / ~220 sharp.
  const glucose =
    s.glucosePeak != null
      ? clamp01(1 - (s.glucosePeak - 100) / 120)
      : clamp01(1 - Math.max(0, consumedCarbs - 50) / 160 - Math.max(0, consumedSugar - 15) / 70);

  // Fullness — measured satiety hours preferred (~5h = full marks).
  const fullness =
    s.satietyHours != null
      ? clamp01(s.satietyHours / 5)
      : clamp01((consumedProtein / 45 + consumedFiber / 12) / 2);

  // Energy — only known if reported.
  const energy = s.energy == null ? null : s.energy === "high" ? 1 : s.energy === "ok" ? 0.6 : 0.2;

  return { glucose, fullness, energy };
}

// ---------------------------------------------------------------------------
// Per-meal factors — the learnable labels.
// ---------------------------------------------------------------------------

function mealFactors(meal) {
  const factors = new Set(meal.tags || []);
  factors.add(meal.timing.toLowerCase()); // breakfast / lunch / dinner / late night
  if (meal.signals && meal.signals.postMealWalk) factors.add("walk-after-meal");
  return [...factors];
}

// Readable phrasing for known factors; falls back to the raw label.
const FACTOR_LABELS = {
  "high-protein": "higher protein",
  "sugary-drink": "sugary drinks",
  fried: "fried foods",
  "starch-heavy": "starchy plates",
  vegetables: "vegetable-forward plates",
  dessert: "desserts",
  "cheesy-creamy": "cheesy or creamy dishes",
  "walk-after-meal": "walking after the meal",
  "late night": "late-night eating",
};

const DIMENSION_LABELS = {
  glucose: "glucose stability",
  fullness: "fullness and satiety",
  energy: "energy afterward",
};

function factorLabel(factor) {
  return FACTOR_LABELS[factor] || factor.replace(/-/g, " ");
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function confidenceFrom(samplesWith, samplesWithout, effect) {
  const sampleFactor = samplesWith / (samplesWith + CONFIDENCE_K);
  const effectFactor = clamp01(effect / 0.5); // a 0.5 gap is a very strong effect
  return Math.round(clamp01(sampleFactor * (0.5 + 0.5 * effectFactor)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main entry: build the Health DNA from a user's meals.
// ---------------------------------------------------------------------------

export function learnHealthDNA(userId, meals = []) {
  const enriched = meals.map((m) => ({ factors: mealFactors(m), outcomes: mealOutcomes(m) }));

  // collect the universe of factors actually seen
  const allFactors = new Set();
  for (const e of enriched) for (const f of e.factors) allFactors.add(f);

  const insights = [];

  for (const factor of allFactors) {
    let best = null;

    for (const dim of DIMENSIONS) {
      const withVals = [];
      const withoutVals = [];
      for (const e of enriched) {
        const o = e.outcomes[dim];
        if (o == null) continue;
        if (e.factors.includes(factor)) withVals.push(o);
        else withoutVals.push(o);
      }
      if (withVals.length < MIN_SAMPLES_WITH || withoutVals.length < MIN_SAMPLES_WITHOUT) continue;

      const mWith = mean(withVals);
      const mWithout = mean(withoutVals);
      const delta = mWith - mWithout; // >0 means the factor improves this dimension
      if (Math.abs(delta) < EFFECT_THRESHOLD) {
        // Track as "neutral" only if nothing stronger shows up.
        if (!best) best = { dim, delta, samples: withVals.length, neutral: true };
        continue;
      }
      if (!best || best.neutral || Math.abs(delta) > Math.abs(best.delta)) {
        best = { dim, delta, samples: withVals.length, neutral: false };
      }
    }

    if (!best) continue;

    const direction = best.neutral ? "neutral" : best.delta > 0 ? "helps" : "hurts";
    const confidence = best.neutral
      ? confidenceFrom(best.samples, MIN_SAMPLES_WITHOUT, 0)
      : confidenceFrom(best.samples, MIN_SAMPLES_WITHOUT, Math.abs(best.delta));

    const fLabel = factorLabel(factor);
    const dLabel = DIMENSION_LABELS[best.dim];
    // Phrased so the factor is never the grammatical subject — that keeps
    // singular ("higher protein") and plural ("sugary drinks") labels correct.
    const summary =
      direction === "helps"
        ? `Better ${dLabel} when you include ${fLabel}.`
        : direction === "hurts"
          ? `Worse ${dLabel} when you include ${fLabel}.`
          : `No clear effect on your ${dLabel} from ${fLabel} — looks well tolerated.`;

    insights.push({
      factor,
      direction,
      dimension: best.dim,
      delta: Math.round(best.delta * 100) / 100,
      samples: best.samples,
      confidence,
      summary,
    });
  }

  // Strongest, best-supported insights first. Neutral findings sink to the bottom.
  insights.sort((a, b) => {
    if ((a.direction === "neutral") !== (b.direction === "neutral")) return a.direction === "neutral" ? 1 : -1;
    return b.confidence - a.confidence;
  });

  return {
    userId,
    insights,
    mealsAnalyzed: meals.length,
    updatedAt: new Date().toISOString(),
  };
}

// Convenience splits the UI/coach can use directly.
export function whatWorks(dna) {
  return (dna.insights || []).filter((i) => i.direction === "helps");
}

export function whatDoesNotWork(dna) {
  return (dna.insights || []).filter((i) => i.direction === "hurts");
}
