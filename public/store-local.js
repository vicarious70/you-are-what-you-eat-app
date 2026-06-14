// Browser store implementing the HealthDNAEngine store contract, backed by
// localStorage. This is what makes the app work with NO backend yet: meals,
// profile, activities, and body entries persist on the device.
//
// When Supabase auth + API are wired up later, this file is the only thing
// that gets swapped — the engine and screens stay exactly the same.

const KEY = "ywye.healthdna.v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function persist(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

function db() {
  const data = load();
  data.profiles = data.profiles || {};
  data.meals = data.meals || [];
  data.activities = data.activities || [];
  data.bodyEntries = data.bodyEntries || [];
  return data;
}

const byUser = (list, userId) =>
  list.filter((r) => r.userId === userId).sort((a, b) => new Date(a.at) - new Date(b.at));

export function createLocalStore() {
  return {
    async getProfile(userId) {
      return db().profiles[userId] || null;
    },
    async saveProfile(profile) {
      const data = db();
      data.profiles[profile.id] = profile;
      persist(data);
      return profile;
    },
    async addMeal(meal) {
      const data = db();
      data.meals.push(meal);
      persist(data);
      return meal;
    },
    async listMeals(userId) {
      return byUser(db().meals, userId);
    },
    async addActivity(activity) {
      const data = db();
      data.activities.push(activity);
      persist(data);
      return activity;
    },
    async listActivities(userId) {
      return byUser(db().activities, userId);
    },
    async addBodyEntry(entry) {
      const data = db();
      data.bodyEntries.push(entry);
      persist(data);
      return entry;
    },
    async listBodyEntries(userId) {
      return byUser(db().bodyEntries, userId);
    },
  };
}

// Wipe everything (used by the "reset" action in the UI).
export function clearLocalData() {
  localStorage.removeItem(KEY);
}

// Bulk-import records (used by "Load sample week"). Records must already carry
// the right userId.
export function importSeed({ profile, meals = [], activities = [], bodyEntries = [] }) {
  const data = db();
  if (profile) data.profiles[profile.id] = profile;
  data.meals.push(...meals);
  data.activities.push(...activities);
  data.bodyEntries.push(...bodyEntries);
  persist(data);
}
