// In-memory store implementing the HealthDNAEngine store contract.
// Used by the demo and tests, and as the reference for the Supabase store.

export function createMemoryStore() {
  const profiles = new Map();
  const meals = [];
  const activities = [];
  const bodyEntries = [];
  const dnaCache = new Map();

  const byUser = (list, userId) =>
    list.filter((r) => r.userId === userId).sort((a, b) => new Date(a.at) - new Date(b.at));

  return {
    async getProfile(userId) {
      return profiles.get(userId) || null;
    },
    async saveProfile(profile) {
      profiles.set(profile.id, profile);
      return profile;
    },
    async addMeal(meal) {
      meals.push(meal);
      return meal;
    },
    async listMeals(userId) {
      return byUser(meals, userId);
    },
    async addActivity(activity) {
      activities.push(activity);
      return activity;
    },
    async listActivities(userId) {
      return byUser(activities, userId);
    },
    async addBodyEntry(entry) {
      bodyEntries.push(entry);
      return entry;
    },
    async listBodyEntries(userId) {
      return byUser(bodyEntries, userId);
    },
    async saveDNA(dna) {
      dnaCache.set(dna.userId, dna);
      return dna;
    },
  };
}
