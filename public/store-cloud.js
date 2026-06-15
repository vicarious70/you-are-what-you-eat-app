// Cloud store implementing the HealthDNAEngine store contract, backed by
// Supabase directly from the browser (anon key + the user's JWT). Row Level
// Security ensures each person only ever reads/writes their own rows, so no
// server-side engine is needed — the browser engine runs over these rows just
// like it does over localStorage.
//
// Used only in cloud mode; the local app never imports this.

// ---- row <-> engine-object mapping (mirrors lib/dna-store.mjs) ----

const rowToProfile = (r) =>
  r && {
    id: r.id,
    name: r.name,
    sex: r.sex,
    age: r.age,
    heightIn: r.height_in,
    startWeightLb: r.start_weight_lb,
    goal: r.goal,
    activityLevel: r.activity_level,
    medicalConditions: r.medical_conditions || [],
    mobilityLimitations: r.mobility_limitations || [],
    pregnancyStatus: r.pregnancy_status,
    foodPreferences: r.food_preferences || [],
    budgetLimited: r.budget_limited,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

const profileToRow = (p) => ({
  id: p.id,
  name: p.name,
  sex: p.sex,
  age: p.age,
  height_in: p.heightIn,
  start_weight_lb: p.startWeightLb,
  goal: p.goal,
  activity_level: p.activityLevel,
  medical_conditions: p.medicalConditions,
  mobility_limitations: p.mobilityLimitations,
  pregnancy_status: p.pregnancyStatus,
  food_preferences: p.foodPreferences,
  budget_limited: p.budgetLimited,
});

const rowToMeal = (r) => ({
  id: r.id,
  userId: r.user_id,
  at: r.at,
  mealType: r.meal_type,
  portion: r.portion,
  timing: r.timing,
  hunger: r.hunger,
  eatenAmount: r.eaten_amount,
  eatenFraction: Number(r.eaten_fraction),
  notes: r.notes,
  foods: r.foods || [],
  tags: r.tags || [],
  served: {
    calories: r.calories,
    calorieMin: r.calorie_min,
    calorieMax: r.calorie_max,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    fiberG: r.fiber_g,
    sodiumMg: r.sodium_mg,
    sugarG: r.sugar_g,
  },
  signals: r.signals || {},
  source: r.source,
  createdAt: r.created_at,
});

const mealToRow = (m) => ({
  id: m.id,
  user_id: m.userId,
  at: m.at,
  meal_type: m.mealType,
  portion: m.portion,
  timing: m.timing,
  hunger: m.hunger,
  eaten_amount: m.eatenAmount,
  eaten_fraction: m.eatenFraction,
  notes: m.notes,
  foods: m.foods,
  tags: m.tags,
  calories: m.served.calories,
  calorie_min: m.served.calorieMin,
  calorie_max: m.served.calorieMax,
  protein_g: m.served.proteinG,
  carbs_g: m.served.carbsG,
  fat_g: m.served.fatG,
  fiber_g: m.served.fiberG,
  sodium_mg: m.served.sodiumMg,
  sugar_g: m.served.sugarG,
  signals: m.signals,
  source: m.source,
});

const rowToBeverage = (r) => ({
  id: r.id,
  userId: r.user_id,
  at: r.at,
  type: r.type,
  servingOz: Number(r.serving_oz),
  calories: r.calories,
  sugarG: r.sugar_g,
  carbsG: r.carbs_g,
  caffeineMg: r.caffeine_mg,
  proteinG: r.protein_g,
  alcoholServings: Number(r.alcohol_servings),
  notes: r.notes,
  tags: r.tags || [],
  source: r.source,
  createdAt: r.created_at,
});

const beverageToRow = (b) => ({
  id: b.id,
  user_id: b.userId,
  at: b.at,
  type: b.type,
  serving_oz: b.servingOz,
  calories: b.calories,
  sugar_g: b.sugarG,
  carbs_g: b.carbsG,
  caffeine_mg: b.caffeineMg,
  protein_g: b.proteinG,
  alcohol_servings: b.alcoholServings,
  notes: b.notes,
  tags: b.tags,
  source: b.source,
});

const rowToActivity = (r) => ({
  id: r.id,
  userId: r.user_id,
  at: r.at,
  type: r.type,
  durationMin: r.duration_min,
  caloriesBurned: r.calories_burned,
  distanceMi: r.distance_mi,
  source: r.source,
  createdAt: r.created_at,
});

const activityToRow = (a) => ({
  id: a.id,
  user_id: a.userId,
  at: a.at,
  type: a.type,
  duration_min: a.durationMin,
  calories_burned: a.caloriesBurned,
  distance_mi: a.distanceMi,
  source: a.source,
});

const rowToBody = (r) => ({
  id: r.id,
  userId: r.user_id,
  at: r.at,
  weightLb: r.weight_lb,
  bodyFatPct: r.body_fat_pct,
  fastingGlucose: r.fasting_glucose,
  restingHr: r.resting_hr,
  note: r.note,
  createdAt: r.created_at,
});

const bodyToRow = (b) => ({
  id: b.id,
  user_id: b.userId,
  at: b.at,
  weight_lb: b.weightLb,
  body_fat_pct: b.bodyFatPct,
  fasting_glucose: b.fastingGlucose,
  resting_hr: b.restingHr,
  note: b.note,
});

const TABLE_FOR = { meals: "meals", beverages: "beverages", activities: "activities", bodyEntries: "body_entries" };

// ---- store ----

export function createCloudStore(client, userId) {
  const check = (error, what) => {
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };
  const list = async (table, mapper) => {
    const { data, error } = await client.from(table).select("*").eq("user_id", userId).order("at", { ascending: true });
    check(error, `list ${table}`);
    return (data || []).map(mapper);
  };
  const insert = async (table, row, mapper, what) => {
    const { data, error } = await client.from(table).insert(row).select("*").single();
    check(error, what);
    return mapper(data);
  };

  return {
    async getProfile() {
      const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
      check(error, "getProfile");
      return rowToProfile(data) || null;
    },
    async saveProfile(profile) {
      const { data, error } = await client
        .from("profiles")
        .upsert(profileToRow({ ...profile, id: userId }), { onConflict: "id" })
        .select("*")
        .single();
      check(error, "saveProfile");
      return rowToProfile(data);
    },
    addMeal: (m) => insert("meals", mealToRow(m), rowToMeal, "addMeal"),
    listMeals: () => list("meals", rowToMeal),
    addBeverage: (b) => insert("beverages", beverageToRow(b), rowToBeverage, "addBeverage"),
    listBeverages: () => list("beverages", rowToBeverage),
    addActivity: (a) => insert("activities", activityToRow(a), rowToActivity, "addActivity"),
    listActivities: () => list("activities", rowToActivity),
    addBodyEntry: (e) => insert("body_entries", bodyToRow(e), rowToBody, "addBodyEntry"),
    listBodyEntries: () => list("body_entries", rowToBody),

    async deleteRecord(collection, id) {
      const table = TABLE_FOR[collection];
      if (!table) return false;
      const { error } = await client.from(table).delete().eq("id", id).eq("user_id", userId);
      check(error, `delete ${collection}`);
      return true;
    },
  };
}
