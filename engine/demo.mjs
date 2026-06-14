// Runnable proof that the brain works: `node engine/demo.mjs`
//
// Recreates the spec's Anthony scenario (higher protein helps, walking after
// dinner helps glucose, potatoes tolerated, sugary drinks create problems) plus
// a contrasting Virginia, then prints learned Health DNA and a weekly review.

import { HealthDNAEngine } from "./index.js";
import { createMemoryStore } from "./memory-store.js";

const engine = new HealthDNAEngine(createMemoryStore());

// Build a meal N days ago so it lands inside the current Mon–Sun week.
function daysAgo(n, hour = 18) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

await engine.upsertProfile({ id: "anthony", name: "Anthony", sex: "male", goal: "Fat loss", activityLevel: "Moderate activity" });

// A week of Anthony's dinners. Note the recurring signals that drive learning:
// high-protein + post-meal walk => steady glucose & full; sugary drinks => spikes.
const anthonyMeals = [
  { tags: ["high-protein", "vegetables"], proteinG: 48, carbsG: 40, sodiumMg: 700, sugarG: 4, signals: { glucosePeak: 105, satietyHours: 5, postMealWalk: true }, timing: "Dinner", at: daysAgo(6) },
  { tags: ["high-protein", "starch-heavy"], notes: "chicken and potatoes", proteinG: 45, carbsG: 70, sodiumMg: 800, sugarG: 6, signals: { glucosePeak: 120, satietyHours: 4.5, postMealWalk: true }, timing: "Dinner", at: daysAgo(5) },
  { tags: ["sugary-drink"], notes: "burger and a large soda", proteinG: 28, carbsG: 110, sodiumMg: 1600, sugarG: 55, signals: { glucosePeak: 190, satietyHours: 2, energy: "low" }, timing: "Dinner", at: daysAgo(4) },
  { tags: ["high-protein", "vegetables"], proteinG: 50, carbsG: 35, sodiumMg: 650, sugarG: 3, signals: { glucosePeak: 100, satietyHours: 5, postMealWalk: true }, timing: "Dinner", at: daysAgo(3) },
  { tags: ["starch-heavy"], notes: "pasta night, potatoes side", proteinG: 30, carbsG: 95, sodiumMg: 900, sugarG: 8, signals: { glucosePeak: 135, satietyHours: 3.5 }, timing: "Dinner", at: daysAgo(2) },
  { tags: ["sugary-drink", "fried"], notes: "fries and sweet tea", proteinG: 20, carbsG: 120, sodiumMg: 1900, sugarG: 48, signals: { glucosePeak: 200, satietyHours: 2, energy: "low" }, timing: "Dinner", at: daysAgo(1) },
  { tags: ["high-protein", "vegetables"], proteinG: 47, carbsG: 38, sodiumMg: 700, sugarG: 5, signals: { glucosePeak: 102, satietyHours: 5, postMealWalk: true }, timing: "Dinner", at: daysAgo(0) },
  // A couple of sugary lunches push "sugary-drink" past the evidence threshold,
  // so the engine can confidently learn it works against him.
  { tags: ["sugary-drink"], notes: "sandwich and a soda", proteinG: 22, carbsG: 95, sodiumMg: 1200, sugarG: 50, signals: { glucosePeak: 185, satietyHours: 2.5, energy: "low" }, timing: "Lunch", at: daysAgo(5, 12) },
  { tags: ["sugary-drink"], notes: "wrap and lemonade", proteinG: 24, carbsG: 90, sodiumMg: 1100, sugarG: 46, signals: { glucosePeak: 180, satietyHours: 2.5, energy: "low" }, timing: "Lunch", at: daysAgo(2, 12) },
];

let lastAnalysis;
for (const m of anthonyMeals) {
  const { analysis } = await engine.logMeal({ userId: "anthony", mealType: "Home plate", portion: "Standard", ...m });
  lastAnalysis = analysis;
}
await engine.logActivity({ userId: "anthony", type: "walk", durationMin: 15, at: daysAgo(0) });
await engine.logBody({ userId: "anthony", weightLb: 184, at: daysAgo(6) });
await engine.logBody({ userId: "anthony", weightLb: 182.5, at: daysAgo(0) });

const line = "=".repeat(64);

console.log(`\n${line}\nLEARNED HEALTH DNA — Anthony\n${line}`);
const dna = await engine.getHealthDNA("anthony");
console.log(`Meals analyzed: ${dna.mealsAnalyzed}`);
console.log("\nWhat works:");
for (const i of dna.works) console.log(`  + ${i.summary}  (confidence ${i.confidence}, n=${i.samples})`);
console.log("What does not work:");
for (const i of dna.doesNotWork) console.log(`  - ${i.summary}  (confidence ${i.confidence}, n=${i.samples})`);

console.log(`\n${line}\nLAST MEAL — four questions\n${line}`);
console.log("What happened:  ", lastAnalysis.questions.whatHappened);
console.log("Why:            ", lastAnalysis.questions.whyItHappened);
console.log("Where leading:  ", lastAnalysis.questions.whereLeading);
console.log("What next:");
for (const s of lastAnalysis.questions.whatNext) console.log("   • " + s);

console.log(`\n${line}\nWEEKLY HEALTH DNA REVIEW — Anthony\n${line}`);
const review = await engine.weeklyReview("anthony");
for (const [, sec] of Object.entries(review.sections)) {
  console.log(`\n[${sec.headline}]\n${sec.body}`);
}
console.log(`\n[${review.nextWeekFocus.headline}]\n${review.nextWeekFocus.body}`);
for (const f of review.nextWeekFocus.items) console.log("   • " + f);
console.log();
