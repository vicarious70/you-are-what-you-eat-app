// Supabase-backed store implementing the HealthDNAEngine store contract.
//
// The engine never imports Supabase; it only knows this interface. That keeps
// the brain testable against the in-memory store and swappable in production.
// All mapping between snake_case DB rows and the engine's camelCase objects
// lives here.

// ---- row <-> object mapping -----------------------------------------------

function rowToProfile(r) {
  if (!r) return null;
  return {
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
}

function profileToRow(p) {
  return {
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
  };
}

function rowToMeal(r) {
  return {
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
  };
}

function mealToRow(m) {
  return {
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
  };
}

function rowToBeverage(r) {
  return {
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
  };
}

function beverageToRow(b) {
  return {
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
  };
}

function rowToActivity(r) {
  return {
    id: r.id,
    userId: r.user_id,
    at: r.at,
    type: r.type,
    durationMin: r.duration_min,
    caloriesBurned: r.calories_burned,
    distanceMi: r.distance_mi,
    source: r.source,
    createdAt: r.created_at,
  };
}

function activityToRow(a) {
  return {
    id: a.id,
    user_id: a.userId,
    at: a.at,
    type: a.type,
    duration_min: a.durationMin,
    calories_burned: a.caloriesBurned,
    distance_mi: a.distanceMi,
    source: a.source,
  };
}

function rowToBody(r) {
  return {
    id: r.id,
    userId: r.user_id,
    at: r.at,
    weightLb: r.weight_lb,
    bodyFatPct: r.body_fat_pct,
    fastingGlucose: r.fasting_glucose,
    restingHr: r.resting_hr,
    note: r.note,
    createdAt: r.created_at,
  };
}

function bodyToRow(b) {
  return {
    id: b.id,
    user_id: b.userId,
    at: b.at,
    weight_lb: b.weightLb,
    body_fat_pct: b.bodyFatPct,
    fasting_glucose: b.fastingGlucose,
    resting_hr: b.restingHr,
    note: b.note,
  };
}

// ---- store ----------------------------------------------------------------

function check(error, what) {
  if (error) {
    const err = new Error(`${what} failed: ${error.message}`);
    err.statusCode = 500;
    throw err;
  }
}

export function createSupabaseStore(client) {
  return {
    async getProfile(userId) {
      const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
      check(error, "getProfile");
      return rowToProfile(data);
    },

    async saveProfile(profile) {
      const { data, error } = await client
        .from("profiles")
        .upsert(profileToRow(profile), { onConflict: "id" })
        .select("*")
        .single();
      check(error, "saveProfile");
      return rowToProfile(data);
    },

    async addMeal(meal) {
      const { data, error } = await client.from("meals").insert(mealToRow(meal)).select("*").single();
      check(error, "addMeal");
      return rowToMeal(data);
    },

    async listMeals(userId) {
      const { data, error } = await client.from("meals").select("*").eq("user_id", userId).order("at", { ascending: true });
      check(error, "listMeals");
      return (data || []).map(rowToMeal);
    },

    async addBeverage(beverage) {
      const { data, error } = await client.from("beverages").insert(beverageToRow(beverage)).select("*").single();
      check(error, "addBeverage");
      return rowToBeverage(data);
    },

    async listBeverages(userId) {
      const { data, error } = await client.from("beverages").select("*").eq("user_id", userId).order("at", { ascending: true });
      check(error, "listBeverages");
      return (data || []).map(rowToBeverage);
    },

    async addActivity(activity) {
      const { data, error } = await client.from("activities").insert(activityToRow(activity)).select("*").single();
      check(error, "addActivity");
      return rowToActivity(data);
    },

    async listActivities(userId) {
      const { data, error } = await client.from("activities").select("*").eq("user_id", userId).order("at", { ascending: true });
      check(error, "listActivities");
      return (data || []).map(rowToActivity);
    },

    async addBodyEntry(entry) {
      const { data, error } = await client.from("body_entries").insert(bodyToRow(entry)).select("*").single();
      check(error, "addBodyEntry");
      return rowToBody(data);
    },

    async listBodyEntries(userId) {
      const { data, error } = await client.from("body_entries").select("*").eq("user_id", userId).order("at", { ascending: true });
      check(error, "listBodyEntries");
      return (data || []).map(rowToBody);
    },

    // Persist a generated weekly review (keyed by Mon-anchored week start).
    async saveWeeklyReview(review) {
      const weekStartDate = review.weekStart.slice(0, 10);
      const { error } = await client
        .from("weekly_reviews")
        .upsert(
          { user_id: review.userId, week_start: weekStartDate, payload: review, generated_at: review.generatedAt },
          { onConflict: "user_id,week_start" }
        );
      check(error, "saveWeeklyReview");
      return review;
    },
  };
}
