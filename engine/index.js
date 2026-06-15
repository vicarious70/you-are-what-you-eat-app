// Health DNA Engine — public facade.
//
// One object that ties the brain together and reads/writes through a pluggable
// store. The store is any object implementing the async methods below, so the
// same engine runs against in-memory data (tests), localStorage (browser), or
// Supabase (production) without changing engine logic.
//
//   store.getProfile(userId)            -> profile | null
//   store.saveProfile(profile)          -> profile
//   store.addMeal(meal)                 -> meal
//   store.listMeals(userId, opts?)      -> meal[]
//   store.addActivity(activity)         -> activity
//   store.listActivities(userId, opts?) -> activity[]
//   store.addBodyEntry(entry)           -> entry
//   store.listBodyEntries(userId,opts?) -> entry[]
//   store.saveDNA(dna)                  -> dna        (optional cache)
//
// The brain itself (analysis, learning, review) is pure and also exported
// directly for callers that already hold the data.

import { createProfile, createMeal, createActivity, createBodyEntry } from "./schema.js";
import { analyzeMeal, consumptionDNA } from "./meal-to-body.js";
import { createBeverage, analyzeBeverage } from "./beverage.js";
import { learnHealthDNA, whatWorks, whatDoesNotWork } from "./learning.js";
import { generateWeeklyReview } from "./weekly-review.js";

export * from "./schema.js";
export { analyzeMeal, consumptionDNA } from "./meal-to-body.js";
export { createBeverage, analyzeBeverage, BEVERAGE_TYPES, beverageDefaults } from "./beverage.js";
export { learnHealthDNA, whatWorks, whatDoesNotWork } from "./learning.js";
export { generateWeeklyReview, weekRange, weekStart } from "./weekly-review.js";

// Stores that predate beverages won't have these methods; treat as empty.
async function listBeveragesSafe(store, userId) {
  return store.listBeverages ? store.listBeverages(userId) : [];
}

export class HealthDNAEngine {
  constructor(store) {
    if (!store) throw new Error("HealthDNAEngine requires a store.");
    this.store = store;
  }

  async upsertProfile(input) {
    return this.store.saveProfile(createProfile(input));
  }

  // Log a meal and immediately return its four-question analysis, computed
  // against the user's latest learned Health DNA.
  async logMeal(input) {
    const profile = (await this.store.getProfile(input.userId)) || createProfile({ id: input.userId });
    const meal = await this.store.addMeal(createMeal({ ...input, userId: profile.id }));
    const dna = await this.computeDNA(profile.id);
    const analysis = analyzeMeal(meal, profile, dna);
    return { meal, analysis, dna };
  }

  // Log a beverage and return its Beverage DNA ("what this drink may do").
  async logBeverage(input) {
    const profile = (await this.store.getProfile(input.userId)) || createProfile({ id: input.userId });
    const beverage = await this.store.addBeverage(createBeverage({ ...input, userId: profile.id }));
    const dna = await this.computeDNA(profile.id);
    const analysis = analyzeBeverage(beverage, profile, dna);
    return { beverage, analysis, dna };
  }

  async logActivity(input) {
    return this.store.addActivity(createActivity(input));
  }

  async logBody(input) {
    return this.store.addBodyEntry(createBodyEntry(input));
  }

  // Recompute the user's Health DNA from their full meal history. Cheap enough
  // to run on demand; cache via store.saveDNA if the store supports it.
  async computeDNA(userId) {
    const [meals, beverages] = await Promise.all([this.store.listMeals(userId), listBeveragesSafe(this.store, userId)]);
    const dna = learnHealthDNA(userId, meals, beverages);
    if (typeof this.store.saveDNA === "function") await this.store.saveDNA(dna);
    return dna;
  }

  async getHealthDNA(userId) {
    const dna = await this.computeDNA(userId);
    return { ...dna, works: whatWorks(dna), doesNotWork: whatDoesNotWork(dna) };
  }

  // The headline weekly artifact.
  async weeklyReview(userId, date = new Date()) {
    const [profile, meals, beverages, activities, bodyEntries] = await Promise.all([
      this.store.getProfile(userId),
      this.store.listMeals(userId),
      listBeveragesSafe(this.store, userId),
      this.store.listActivities ? this.store.listActivities(userId) : Promise.resolve([]),
      this.store.listBodyEntries ? this.store.listBodyEntries(userId) : Promise.resolve([]),
    ]);
    const dna = learnHealthDNA(userId, meals, beverages);
    return generateWeeklyReview({
      profile: profile || createProfile({ id: userId }),
      meals,
      beverages,
      activities,
      bodyEntries,
      dna,
      date,
    });
  }
}
