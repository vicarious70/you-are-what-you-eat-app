// Front-end controller for the Health DNA app.
//
// Photo-first: take/upload a meal photo, the vision backend reads the plate,
// and the result flows into the REAL Health DNA engine (imported from /engine)
// which saves the meal, learns from it, and answers the four questions.
// If the vision backend isn't reachable, we fall back to a context-based
// estimate so logging still works — but the photo is always the primary path.

import { HealthDNAEngine, consumptionDNA, BEVERAGE_TYPES } from "/engine/index.js";
import { createLocalStore, clearLocalData } from "/store-local.js";

// Master switch for cloud mode (login + Supabase sync). OFF keeps the app
// exactly as it is today: local-only, no login. When ON, the app shows a login
// gate and syncs to Supabase — but gracefully falls back to local mode if the
// cloud backend isn't configured (e.g. running locally without Supabase env).
const CLOUD_ENABLED = true;

const $ = (sel) => document.querySelector(sel);

// Brief "saved" confirmation toast.
let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// store/engine/UID are assigned during boot (local immediately, or cloud after
// login). Handlers only touch them after the user can interact, so `let` is safe.
let store = createLocalStore();
let engine = new HealthDNAEngine(store);
let UID = "";
let cloudActive = false; // true once a Supabase-backed session is in use

function getLocalUserId() {
  let id = localStorage.getItem("ywye.userid");
  if (!id) {
    id = "local_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("ywye.userid", id);
  }
  return id;
}

let selectedMealImage = "";
let loadingTimers = [];
// True after a photo is added but required fields are still missing. While it's
// set, filling the last required field auto-starts the analysis (the original
// hands-free flow: upload -> fill -> it runs itself).
let waitingForRequiredContext = false;

function smoothScrollTo(selector) {
  const el = document.querySelector(selector);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

const requiredFields = [
  ["mealType", "meal type"],
  ["portion", "portion"],
  ["hunger", "hunger"],
  ["mealTiming", "timing"],
  ["plateReference", "size reference"],
  ["eatenAmount", "amount eaten"],
];

// ---------------------------------------------------------------------------
// Manual fallback estimate (used only when the vision backend is unreachable).
// ---------------------------------------------------------------------------

const baseProfiles = {
  "Home plate": { calories: 620, proteinG: 38, carbsG: 56, fatG: 24, fiberG: 6, sodiumMg: 720, sugarG: 9 },
  "Restaurant meal": { calories: 980, proteinG: 42, carbsG: 92, fatG: 44, fiberG: 5, sodiumMg: 1780, sugarG: 18 },
  "Fast food": { calories: 1120, proteinG: 36, carbsG: 104, fatG: 56, fiberG: 4, sodiumMg: 2240, sugarG: 28 },
  "Holiday meal": { calories: 1280, proteinG: 48, carbsG: 134, fatG: 58, fiberG: 7, sodiumMg: 1880, sugarG: 42 },
};
const portionMultipliers = { Light: 0.72, Standard: 1, Large: 1.28, "Very large": 1.55 };
const noteBoosts = [
  { terms: ["fried", "fries", "chips", "crispy"], add: { calories: 180, fatG: 12, sodiumMg: 260 } },
  { terms: ["soda", "pop", "sweet tea", "juice", "lemonade", "dessert", "cake", "cookie", "ice cream"], add: { calories: 160, carbsG: 34, sugarG: 28 } },
  { terms: ["rice", "pasta", "bread", "potato", "noodle", "tortilla", "bun"], add: { calories: 130, carbsG: 30 } },
  { terms: ["beans", "lentils", "chickpeas"], add: { calories: 110, proteinG: 7, carbsG: 18, fiberG: 6 } },
  { terms: ["cheese", "cream", "alfredo", "ranch"], add: { calories: 150, fatG: 12, sodiumMg: 220 } },
  { terms: ["grilled", "chicken", "fish", "turkey", "tofu", "steak", "shrimp", "eggs"], add: { proteinG: 16, calories: 80 } },
  { terms: ["salad", "vegetable", "broccoli", "greens", "spinach", "peppers"], add: { carbsG: 8, calories: 35, fiberG: 3 } },
];

function estimateNutrition() {
  const base = baseProfiles[$("#mealType").value] || baseProfiles["Home plate"];
  const mult = portionMultipliers[$("#portion").value] || 1;
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = Math.round(v * mult);
  const text = $("#mealDescription").value.toLowerCase();
  for (const { terms, add } of noteBoosts) {
    if (terms.some((t) => text.includes(t))) {
      for (const [k, v] of Object.entries(add)) out[k] = Math.max(0, (out[k] || 0) + v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vision backend
// ---------------------------------------------------------------------------

function context() {
  return {
    mealType: $("#mealType").value,
    portion: $("#portion").value,
    goal: "",
    hunger: $("#hunger").value,
    timing: $("#mealTiming").value,
    plateReference: $("#plateReference").value,
    eatenAmount: $("#eatenAmount").value,
    notes: $("#mealDescription").value.trim(),
  };
}

async function requestVisionAnalysis() {
  if (location.protocol === "file:") {
    throw new Error("Open the app from a server link, not the raw file, to analyze photos.");
  }
  const response = await fetch("/api/analyze-meal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: selectedMealImage, context: context() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Vision analysis failed.");
  return payload;
}

const num = (v, f = 0) => Math.max(0, Math.round(Number(v) || f));

// Map a vision result to the engine's served-nutrition keys.
function visionToServed(result) {
  const calories = num(result.calories, 650);
  return {
    calories,
    calorieMin: Math.min(num(result.calorie_min, Math.round(calories * 0.8)), calories),
    calorieMax: Math.max(num(result.calorie_max, Math.round(calories * 1.25)), calories),
    proteinG: num(result.protein_g, 30),
    carbsG: num(result.carbs_g, 65),
    fatG: num(result.fat_g, 24),
    sodiumMg: num(result.sodium_mg, 900),
    sugarG: num(result.sugar_g, 10),
  };
}

// ---------------------------------------------------------------------------
// Required-context gate
// ---------------------------------------------------------------------------

function missingRequired() {
  return requiredFields.filter(([id]) => !document.getElementById(id).value);
}

function showContextAlert(missing) {
  const names = missing.map(([, label]) => label).join(", ");
  $("#contextAlert").hidden = false;
  $("#contextAlert").textContent = `Choose ${names} before analysis starts.`;
  $("#scanStatus").textContent = "Details needed";
  requiredFields.forEach(([id]) => {
    const misses = missing.some(([mid]) => mid === id);
    document.getElementById(id).closest("label").classList.toggle("needs-choice", misses);
  });
}

function clearContextAlert() {
  $("#contextAlert").hidden = true;
  requiredFields.forEach(([id]) => document.getElementById(id).closest("label").classList.remove("needs-choice"));
}

// ---------------------------------------------------------------------------
// Loading / states
// ---------------------------------------------------------------------------

function setAnalyzing(on) {
  const btn = $("#analyzeMeal");
  btn.disabled = on;
  btn.textContent = on ? "Analyzing..." : "Analyze again";
}

function startLoadingMessages() {
  clearLoadingTimers();
  const messages = [
    [1600, "Identifying visible foods and likely portions from the photo..."],
    [4200, "Estimating calories, protein, carbs, fat, sodium, and sugar..."],
    [7200, "Reading meal-to-body impact and your Health DNA..."],
  ];
  loadingTimers = messages.map(([d, m]) => setTimeout(() => ($("#analysisNotice").textContent = m), d));
}
function clearLoadingTimers() {
  loadingTimers.forEach(clearTimeout);
  loadingTimers = [];
}

function renderAnalyzingState() {
  setAnalyzing(true);
  startLoadingMessages();
  $("#failureHelp").hidden = true;
  $("#plateRead").hidden = false;
  $("#analysisNotice").classList.remove("error");
  $("#analysisNotice").textContent = "Analyzing your meal photo now...";
  $("#impactScore").className = "impact-score empty";
  $("#impactScore").textContent = "...";
  $("#scanStatus").textContent = "Analyzing";
  $("#confidenceBadge").textContent = "Analyzing photo";
}

function renderFailure(message) {
  clearLoadingTimers();
  setAnalyzing(false);
  $("#analysisNotice").classList.add("error");
  $("#analysisNotice").textContent = message;
  $("#failureHelp").hidden = false;
  $("#plateRead").hidden = true;
  $("#impactScore").className = "impact-score empty";
  $("#impactScore").textContent = "--";
  $("#confidenceBadge").textContent = "Analysis failed";
  $("#scanStatus").textContent = "Try again";
}

// ---------------------------------------------------------------------------
// Analyze + save (photo -> engine)
// ---------------------------------------------------------------------------

async function analyzeMeal() {
  if (!selectedMealImage) {
    $("#analysisNotice").classList.remove("error");
    $("#analysisNotice").textContent = "Take or upload a meal photo to start.";
    $("#scanStatus").textContent = "Photo needed";
    return;
  }
  const missing = missingRequired();
  if (missing.length) {
    showContextAlert(missing);
    $(".meal-context").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  clearContextAlert();
  waitingForRequiredContext = false;
  renderAnalyzingState();
  smoothScrollTo("#analysisNotice"); // land on the green progress box

  let served;
  let visionResult = null;
  let usedFallback = false;
  try {
    visionResult = await requestVisionAnalysis();
    served = visionToServed(visionResult);
  } catch (error) {
    usedFallback = true;
    served = estimateNutrition();
  }

  try {
    const { analysis } = await engine.logMeal({
      userId: UID,
      mealType: $("#mealType").value,
      portion: $("#portion").value,
      timing: $("#mealTiming").value,
      hunger: $("#hunger").value,
      eatenAmount: $("#eatenAmount").value,
      notes: $("#mealDescription").value.trim(),
      foods: visionResult ? visionResult.foods : [],
      source: usedFallback ? "estimate" : "vision",
      signals: { postMealWalk: $("#postMealWalk").checked },
      ...served,
    });
    renderResult(analysis, visionResult, usedFallback);
    await renderHistory();
    clearLoadingTimers();
    setAnalyzing(false);
    $("#scanStatus").textContent = "Analyzed";
    toast("Meal saved");
    smoothScrollTo("#plateRead"); // land on the results
  } catch (error) {
    // Never leave the user stuck on the spinner — surface what went wrong.
    renderFailure(`Could not save this meal: ${error.message}`);
    smoothScrollTo("#analysisNotice");
  }
}

function signalCard(title, sig) {
  return `<div class="signal-card ${sig.className}">
    <span>${title}</span><strong>${sig.level}</strong><p>${sig.note}</p></div>`;
}

function renderResult(analysis, visionResult, usedFallback) {
  const consumed = analysis.consumption.consumed;
  const served = analysis.consumption.served;
  const ef = analysis.consumption.eatenFraction;
  const calMin = Math.round((served.calorieMin || consumed.calories) * ef);
  const calMax = Math.round((served.calorieMax || consumed.calories) * ef);
  const { impact, questions, signals } = analysis;

  $("#failureHelp").hidden = true;
  $("#plateRead").hidden = false;
  $("#analysisNotice").classList.remove("error");
  $("#analysisNotice").textContent = usedFallback
    ? "Vision backend unavailable — showing a context-based estimate. Connect the backend for true photo analysis."
    : "Photo analysis complete. The foods and portions below were read from your image.";

  $("#impactScore").className = `impact-score ${impact.className}`;
  $("#impactScore").textContent = `${impact.score} ${impact.label}`;

  // consumed macros
  const metrics = [
    ["Calories", `${consumed.calories} kcal`, `range ${calMin}–${calMax} kcal`],
    ["Protein", `${consumed.proteinG}g`, "satiety & muscle"],
    ["Carbs", `${consumed.carbsG}g`, "glucose load"],
    ["Fat", `${consumed.fatG}g`, "richness"],
    ["Sodium", `${consumed.sodiumMg}mg`, "water retention"],
    ["Sugar", `${consumed.sugarG}g`, "fast energy"],
  ];
  $("#impactCards").innerHTML = metrics
    .map(([l, v, n]) => `<div class="metric-card"><span>${l}</span><b>${v}</b><span>${n}</span></div>`)
    .join("");

  // vital signals from the engine
  $("#vitalSignals").innerHTML =
    signalCard("Glucose", signals.glucose) +
    signalCard("Water Retention", signals.water) +
    signalCard("Protein", signals.protein) +
    signalCard("Weight Trend", signals.trend);

  // plate read + detected foods
  $("#plateSummary").textContent = (visionResult && visionResult.plate_read) || questions.whatHappened;
  const foods = visionResult && Array.isArray(visionResult.foods) ? visionResult.foods : [];
  $("#detectedFoods").innerHTML = foods.length
    ? foods.map((f) => `<span>${f.name || "food"}${f.estimated_portion ? " · " + f.estimated_portion : ""}</span>`).join("")
    : `<span class="muted-chip">${usedFallback ? "Estimate from context (no vision backend)" : "No foods confidently detected"}</span>`;
  const notes = visionResult && Array.isArray(visionResult.accuracy_notes) ? visionResult.accuracy_notes : [];
  $("#accuracyNotes").innerHTML = notes.map((n) => `<li>${n}</li>`).join("");

  // four questions
  $("#qWhat").textContent = questions.whatHappened;
  $("#qWhy").textContent = questions.whyItHappened;
  $("#qWhere").textContent = questions.whereLeading;
  $("#qNext").innerHTML = questions.whatNext.map((s) => `<li>${s}</li>`).join("");

  const provider = visionResult ? (visionResult.provider === "gemini" ? "Gemini" : "Vision") : "Estimate";
  const confidence = visionResult ? visionResult.confidence || "photo estimate" : "manual";
  $("#confidenceBadge").textContent = usedFallback ? "Manual estimate" : `${provider}: ${confidence}`;
}

function clearMeal() {
  $("#mealPhoto").value = "";
  $("#cameraPhoto").value = "";
  $("#mealDescription").value = "";
  selectedMealImage = "";
  $("#preview").removeAttribute("src");
  $(".upload-zone").classList.remove("has-image");
  $("#uploadText").textContent = "Take or upload a meal photo";
  clearContextAlert();
  $("#analysisNotice").classList.remove("error");
  $("#analysisNotice").textContent = "Take or upload a meal photo to start.";
  $("#impactScore").className = "impact-score";
  $("#impactScore").textContent = "--";
  ["#impactCards", "#vitalSignals", "#detectedFoods", "#accuracyNotes", "#qNext"].forEach((s) => ($(s).innerHTML = ""));
  ["#qWhat", "#qWhy", "#qWhere"].forEach((s) => ($(s).textContent = ""));
  $("#confidenceBadge").textContent = "No analysis yet";
  $("#scanStatus").textContent = "Ready";
}

// ---------------------------------------------------------------------------
// Photo input
// ---------------------------------------------------------------------------

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected photo."));
    reader.readAsDataURL(file);
  });
}
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not prepare the photo."));
    img.src = dataUrl;
  });
}
async function resizeMealImageFile(file) {
  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size < 1_000_000) return original;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function handlePhoto(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  $("#scanStatus").textContent = "Preparing photo";
  setAnalyzing(true);
  try {
    selectedMealImage = await resizeMealImageFile(file);
    $("#preview").src = selectedMealImage;
    $(".upload-zone").classList.add("has-image");
    $("#uploadText").textContent = "Retake or replace photo";
    $("#scanStatus").textContent = "Photo added";
    setAnalyzing(false);
    if (!missingRequired().length) {
      // Everything's set — run hands-free.
      analyzeMeal();
    } else {
      // Need details first: surface them and scroll the user down to fill them.
      // Filling the last one auto-starts the analysis (see the change listener).
      waitingForRequiredContext = true;
      showContextAlert(missingRequired());
      smoothScrollTo(".meal-context");
    }
  } catch (error) {
    setAnalyzing(false);
    renderFailure(error.message || "The selected photo could not be prepared.");
  }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

// Bottom-nav groups: Log = meal/drink, Insights = health DNA/weekly.
const NAV = [
  { nav: "home", screens: ["home"] },
  { nav: "log", screens: ["log", "drink"], sub: [["log", "Meal"], ["drink", "Drink"]] },
  { nav: "track", screens: ["track"] },
  { nav: "insights", screens: ["dna", "review"], sub: [["dna", "Health DNA"], ["review", "Weekly"]] },
  { nav: "you", screens: ["profile"] },
];
const navForScreen = (screen) => NAV.find((n) => n.screens.includes(screen));

// Keep the bottom bar + sub-tabs in sync with the active screen.
function syncNav(screen) {
  const item = navForScreen(screen);
  document
    .querySelectorAll(".bottom-nav-item")
    .forEach((b) => b.classList.toggle("is-active", Boolean(item) && b.dataset.nav === item.nav));
  const sub = $("#subnav");
  if (item && item.sub) {
    sub.hidden = false;
    sub.innerHTML = item.sub
      .map(([scr, label]) => `<button class="subnav-item ${scr === screen ? "is-active" : ""}" data-screen="${scr}" type="button">${label}</button>`)
      .join("");
  } else {
    sub.hidden = true;
    sub.innerHTML = "";
  }
}

function hideChrome() {
  $("#bottomNav").hidden = true;
  $("#subnav").hidden = true;
}

function showTab(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.dataset.screen === name));
  syncNav(name);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "home") renderDashboard();
  if (name === "drink") renderDrinkHistory();
  if (name === "track") renderTrack();
  if (name === "dna") renderDNA();
  if (name === "review") renderReview();
  if (name === "profile") loadProfile();
}

// ---------------------------------------------------------------------------
// Beverage DNA — log a drink, show "What This Drink May Do"
// ---------------------------------------------------------------------------

function fillBeverageTypes() {
  $("#bevType").innerHTML = BEVERAGE_TYPES.map((t) => `<option>${t}</option>`).join("");
}

async function analyzeDrink() {
  const { analysis, beverage } = await engine.logBeverage({
    userId: UID,
    type: $("#bevType").value,
    servingOz: $("#bevOz").value ? Number($("#bevOz").value) : null,
    notes: $("#bevNotes").value.trim(),
  });

  $("#drinkResult").hidden = false;
  $("#drinkBadge").textContent = `${beverage.servingOz}oz · ${beverage.calories} kcal`;
  $("#drinkTags").innerHTML = analysis.whatItMayDo
    .map((t) => `<div class="signal-card ${t.className}"><span>${t.label}</span><p>${t.note}</p></div>`)
    .join("");

  const alc = $("#alcoholDNA");
  if (analysis.alcohol) {
    alc.hidden = false;
    alc.innerHTML = `<p class="eyebrow">Alcohol DNA</p><p>${analysis.alcohol.note}</p>`;
  } else {
    alc.hidden = true;
  }

  const q = analysis.questions;
  $("#bWhat").textContent = q.whatHappened;
  $("#bWhy").textContent = q.whyItHappened;
  $("#bWhere").textContent = q.whereLeading;
  $("#bNext").innerHTML = q.whatNext.map((s) => `<li>${s}</li>`).join("");

  $("#bevOz").value = "";
  $("#bevNotes").value = "";
  toast("Drink saved");
  $("#drinkStatus").textContent = "Logged";
  setTimeout(() => ($("#drinkStatus").textContent = "Ready"), 1500);
  await renderDrinkHistory();
  smoothScrollTo("#drinkResult");
}

async function renderDrinkHistory() {
  const drinks = (await store.listBeverages(UID)).slice().reverse();
  const el = $("#drinkHistory");
  if (!drinks.length) {
    el.innerHTML = '<p class="empty-history">No drinks logged yet.</p>';
    return;
  }
  el.innerHTML = drinks
    .slice(0, 12)
    .map((b) => {
      const bits = [`${b.calories} kcal`];
      if (b.sugarG) bits.push(`${b.sugarG}g sugar`);
      if (b.alcoholServings) bits.push(`~${Math.round(b.alcoholServings * 10) / 10} drinks`);
      const note = b.notes ? ` — ${b.notes}` : "";
      return historyItem(b.type, `${whenLabel(b.at)}${note}`, bits.join(" · "), "beverages", b.id);
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Dashboard (Home) — DNA summary cards
// ---------------------------------------------------------------------------

function dashCard(title, value, sub, goto, tone = "") {
  return `<button class="dash-card ${tone}" data-goto="${goto}" type="button">
    <span class="dash-card-label">${title}</span>
    <span class="dash-card-value">${value}</span>
    <span class="dash-card-sub">${sub}</span>
  </button>`;
}

async function renderDashboard() {
  const profile = (await store.getProfile(UID)) || {};
  const name = profile.name && profile.name !== "Friend" ? profile.name : "there";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  $("#dashHello").textContent = `${greet}, ${name}`;
  $("#dashEyebrow").textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const [review, dna, body, nudges] = await Promise.all([
    engine.weeklyReview(UID),
    engine.getHealthDNA(UID),
    store.listBodyEntries(UID),
    engine.nudges(UID),
  ]);

  // Predictive nudges — timely, personalized prompts.
  $("#dashNudges").innerHTML = nudges
    .map(
      (n) => `<div class="nudge nudge-${n.tone}">
        <div class="nudge-text"><strong>${n.title}</strong><p>${n.body}</p></div>
        ${n.action ? `<button class="nudge-action" data-goto="${n.action.goto}" type="button">${n.action.label}</button>` : ""}
      </div>`
    )
    .join("");
  const s = review.sections;
  const latestWeight = [...body].reverse().find((b) => b.weightLb != null);
  const latestGlucose = [...body].reverse().find((b) => b.fastingGlucose != null);
  const learned = (dna.works && dna.works[0]) || (dna.doesNotWork && dna.doesNotWork[0]);

  const cards = [];

  // Featured: What We Learned About You
  cards.push(`<button class="dash-card featured" data-goto="dna" type="button">
    <span class="dash-card-label">What We Learned About You</span>
    <span class="dash-card-value">${learned ? learned.summary : "Your patterns will appear here"}</span>
    <span class="dash-card-sub">${learned ? "Tap to see your full Health DNA" : "Keep logging — the engine is learning you"}</span>
  </button>`);

  const meals = s.nutrition.stats.meals || 0;
  cards.push(
    dashCard("Meal DNA", `${meals} ${meals === 1 ? "meal" : "meals"}`,
      s.nutrition.stats.avgCaloriesPerDay ? `~${s.nutrition.stats.avgCaloriesPerDay} kcal/day this week` : "Tap to log a meal", "log")
  );

  const drinks = s.beverage.stats.drinks || 0;
  cards.push(
    dashCard("Beverage DNA", `${drinks} ${drinks === 1 ? "drink" : "drinks"}`,
      drinks ? `${s.beverage.stats.sugaryDrinks || 0} high-sugar · ${s.beverage.stats.alcoholServings || 0} alcohol` : "Tap to log a drink", "drink")
  );

  const workouts = s.activity.stats.workouts || 0;
  cards.push(
    dashCard("Workout DNA", `${workouts} ${workouts === 1 ? "workout" : "workouts"}`,
      `${s.activity.stats.totalMinutes || 0} min this week`, "track")
  );

  cards.push(
    dashCard("Glucose DNA", latestGlucose ? `${latestGlucose.fastingGlucose} mg/dL` : "—",
      latestGlucose ? "latest fasting glucose" : "Log a reading under Track", "track")
  );

  const dir = s.recovery.stats.direction;
  cards.push(
    dashCard("Progress", latestWeight ? `${latestWeight.weightLb} lb` : (profile.goal || "Set a goal"),
      dir && dir !== "unknown" ? `weight trend ${dir}` : "Log a weigh-in to track trend", "track")
  );

  cards.push(dashCard("Weekly DNA Report", "Your week in review", "Tap to open the full report", "review", "wide"));

  $("#dashCards").innerHTML = cards.join("");
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function renderHistory() {
  const meals = (await store.listMeals(UID)).slice().reverse();
  const el = $("#mealHistory");
  if (!meals.length) {
    el.innerHTML = '<p class="empty-history">No meals logged yet. Your first photo will appear here.</p>';
    return;
  }
  el.innerHTML = meals
    .slice(0, 12)
    .map((m) => {
      const kcal = consumptionDNA(m).consumed.calories;
      const when =
        new Date(m.at).toLocaleDateString([], { weekday: "short" }) +
        " · " +
        new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const note = m.notes ? ` — ${m.notes}` : "";
      return historyItem(m.timing, `${when}${note}`, `${kcal} kcal`, "meals", m.id);
    })
    .join("");
}

// Shared history row with a delete control.
function historyItem(title, sub, value, collection, id) {
  return `<div class="history-item">
    <div><strong>${title}</strong><span>${sub}</span></div>
    <b>${value}</b>
    <button class="delete-btn" data-collection="${collection}" data-id="${id}" aria-label="Delete entry" title="Delete">×</button>
  </div>`;
}

const RERENDER = {
  meals: renderHistory,
  beverages: renderDrinkHistory,
  activities: renderTrack,
  bodyEntries: renderTrack,
};

async function handleDeleteClick(event) {
  const btn = event.target.closest(".delete-btn");
  if (!btn) return;
  if (!confirm("Delete this entry? This can't be undone.")) return;
  await store.deleteRecord(btn.dataset.collection, btn.dataset.id);
  const rerender = RERENDER[btn.dataset.collection];
  if (rerender) await rerender();
}

// ---------------------------------------------------------------------------
// Health DNA
// ---------------------------------------------------------------------------

function confidenceTag(c) {
  const pct = Math.round(c * 100);
  const strength = c >= 0.6 ? "strong" : c >= 0.4 ? "growing" : "early";
  return `<span class="conf ${strength}">${strength} · ${pct}%</span>`;
}

async function renderDNA() {
  const dna = await engine.getHealthDNA(UID);
  const total = (dna.mealsAnalyzed || 0) + (dna.beveragesAnalyzed || 0);
  $("#dnaCount").textContent = `${total} ${total === 1 ? "entry" : "entries"}`;
  const works = dna.works || [];
  const hurts = dna.doesNotWork || [];
  const li = (i) => `<li><span>${i.summary}</span>${confidenceTag(i.confidence)}</li>`;
  $("#dnaWorks").innerHTML = works.length ? works.map(li).join("") : '<li class="muted">Nothing learned here yet.</li>';
  $("#dnaHurts").innerHTML = hurts.length ? hurts.map(li).join("") : '<li class="muted">Nothing learned here yet.</li>';
  $("#dnaEmpty").hidden = !(works.length === 0 && hurts.length === 0);
}

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

async function renderReview() {
  const review = await engine.weeklyReview(UID);
  const start = new Date(review.weekStart);
  const end = new Date(review.weekEnd);
  end.setDate(end.getDate() - 1);
  const fmt = (d) => d.toLocaleDateString([], { month: "short", day: "numeric" });
  $("#reviewWeek").textContent = `${fmt(start)} – ${fmt(end)}`;
  const s = review.sections;
  const card = (sec) => `<div class="review-section"><p class="eyebrow">${sec.headline}</p><p>${sec.body}</p></div>`;
  const focus = review.nextWeekFocus;
  const learned = review.learnedThisWeek || [];
  const learnedCard = learned.length
    ? `<div class="review-section learned"><p class="eyebrow">What We Learned This Week</p>
        <ul>${learned.map((l) => `<li>${l}</li>`).join("")}</ul></div>`
    : "";
  $("#reviewBody").innerHTML =
    card(s.nutrition) + card(s.beverage) + card(s.activity) + card(s.progress) + card(s.recovery) + card(s.mindset) +
    learnedCard +
    `<div class="review-section focus"><p class="eyebrow">${focus.headline}</p><p>${focus.body}</p>
      <ul>${focus.items.map((f) => `<li>${f}</li>`).join("")}</ul></div>`;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

async function loadProfile() {
  const p = (await store.getProfile(UID)) || {};
  $("#pName").value = p.name && p.name !== "Friend" ? p.name : "";
  if (p.goal) $("#pGoal").value = p.goal;
  if (p.activityLevel) $("#pActivity").value = p.activityLevel;
  if (p.sex) $("#pSex").value = p.sex;
  $("#pAge").value = p.age || "";
  if (p.heightIn != null) {
    $("#pHeightFt").value = Math.floor(p.heightIn / 12) || "";
    $("#pHeightIn").value = p.heightIn % 12;
  }
  $("#pWeight").value = p.startWeightLb || "";
  $("#pConditions").value = (p.medicalConditions || []).join(", ");
}

async function saveProfile() {
  const ft = Number($("#pHeightFt").value) || 0;
  const inch = Number($("#pHeightIn").value) || 0;
  const heightIn = ft || inch ? ft * 12 + inch : null;
  const conditions = $("#pConditions").value
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  await engine.upsertProfile({
    id: UID,
    name: $("#pName").value.trim() || "Friend",
    goal: $("#pGoal").value,
    activityLevel: $("#pActivity").value,
    sex: $("#pSex").value,
    age: $("#pAge").value ? Number($("#pAge").value) : null,
    heightIn,
    startWeightLb: $("#pWeight").value ? Number($("#pWeight").value) : null,
    medicalConditions: conditions,
  });

  toast("Profile saved");
  // Completing the profile for the first time finishes onboarding.
  if (!isOnboarded()) {
    finishOnboarding();
    return;
  }
  $("#profileStatus").textContent = "Saved";
  setTimeout(() => ($("#profileStatus").textContent = ""), 1500);
}

// ---------------------------------------------------------------------------
// Onboarding — profile first. Tabs stay hidden until the profile is saved.
// ---------------------------------------------------------------------------

function isOnboarded() {
  return localStorage.getItem("ywye.onboarded") === "1";
}

function startOnboarding() {
  hideChrome();
  $("#onboardWelcome").hidden = false;
  $("#profileHeading").hidden = true;
  $("#advancedPanel").hidden = true;
  $("#saveProfile").textContent = "Save & continue";
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.dataset.screen === "profile"));
  loadProfile();
}

function finishOnboarding() {
  localStorage.setItem("ywye.onboarded", "1");
  $("#onboardWelcome").hidden = true;
  $("#profileHeading").hidden = false;
  $("#advancedPanel").hidden = false;
  $("#saveProfile").textContent = "Save profile";
  $("#bottomNav").hidden = false;
  showTab("home");
}

// ---------------------------------------------------------------------------
// Track — workouts + body readings
// ---------------------------------------------------------------------------

const TYPE_LABELS = { walk: "Walk", run: "Run", cycling: "Cycling", strength: "Strength", swimming: "Swimming", other: "Workout" };

async function logWorkout() {
  const duration = Number($("#wDuration").value);
  if (!duration) {
    $("#workoutStatus").textContent = "Add minutes";
    return;
  }
  await engine.logActivity({
    userId: UID,
    type: $("#wType").value,
    durationMin: duration,
    caloriesBurned: $("#wCalories").value ? Number($("#wCalories").value) : 0,
    distanceMi: $("#wDistance").value ? Number($("#wDistance").value) : null,
  });
  $("#wDuration").value = "";
  $("#wCalories").value = "";
  $("#wDistance").value = "";
  toast("Workout saved");
  $("#workoutStatus").textContent = "Saved";
  setTimeout(() => ($("#workoutStatus").textContent = ""), 1500);
  renderTrack();
}

async function logBodyEntry() {
  const weight = $("#bWeight").value ? Number($("#bWeight").value) : null;
  const fat = $("#bFat").value ? Number($("#bFat").value) : null;
  const glucose = $("#bGlucose").value ? Number($("#bGlucose").value) : null;
  const hr = $("#bHr").value ? Number($("#bHr").value) : null;
  if (weight == null && fat == null && glucose == null && hr == null) {
    $("#bodyStatus").textContent = "Add a value";
    return;
  }
  await engine.logBody({ userId: UID, weightLb: weight, bodyFatPct: fat, fastingGlucose: glucose, restingHr: hr });
  ["#bWeight", "#bFat", "#bGlucose", "#bHr"].forEach((s) => ($(s).value = ""));
  toast("Weigh-in saved");
  $("#bodyStatus").textContent = "Saved";
  setTimeout(() => ($("#bodyStatus").textContent = ""), 1500);
  renderTrack();
}

function whenLabel(at) {
  return (
    new Date(at).toLocaleDateString([], { weekday: "short" }) +
    " · " +
    new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  );
}

async function renderTrack() {
  const acts = (await store.listActivities(UID)).slice().reverse();
  $("#workoutHistory").innerHTML = acts.length
    ? acts
        .slice(0, 10)
        .map((a) => {
          const bits = [`${a.durationMin} min`];
          if (a.caloriesBurned) bits.push(`${a.caloriesBurned} kcal`);
          if (a.distanceMi) bits.push(`${a.distanceMi} mi`);
          return historyItem(TYPE_LABELS[a.type] || a.type, whenLabel(a.at), bits.join(" · "), "activities", a.id);
        })
        .join("")
    : '<p class="empty-history">No workouts yet.</p>';

  const body = (await store.listBodyEntries(UID)).slice().reverse();
  $("#bodyHistory").innerHTML = body.length
    ? body
        .slice(0, 10)
        .map((b) => {
          const bits = [];
          if (b.weightLb != null) bits.push(`${b.weightLb} lb`);
          if (b.bodyFatPct != null) bits.push(`${b.bodyFatPct}% fat`);
          if (b.fastingGlucose != null) bits.push(`${b.fastingGlucose} mg/dL`);
          if (b.restingHr != null) bits.push(`${b.restingHr} bpm`);
          return historyItem("Weigh-in", whenLabel(b.at), bits.join(" · "), "bodyEntries", b.id);
        })
        .join("")
    : '<p class="empty-history">No body readings yet.</p>';
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function resetData() {
  if (cloudActive) {
    // In cloud mode your data lives in your account — delete entries individually,
    // or sign out. (A full account wipe is a future addition.)
    alert("Your data is saved to your account. Delete individual entries with the × buttons, or use Sign out.");
    return;
  }
  if (!confirm("Delete everything stored on this device — profile, meals, workouts, and body entries?")) return;
  clearLocalData();
  localStorage.removeItem("ywye.onboarded");
  clearMeal();
  await renderHistory();
  // Back to a clean slate: re-run onboarding.
  startOnboarding();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

$("#bottomNav").addEventListener("click", (e) => {
  const b = e.target.closest(".bottom-nav-item");
  if (!b) return;
  const item = NAV.find((n) => n.nav === b.dataset.nav);
  if (item) showTab(item.screens[0]);
});
$("#subnav").addEventListener("click", (e) => {
  const b = e.target.closest(".subnav-item");
  if (b) showTab(b.dataset.screen);
});
$("#mealPhoto").addEventListener("change", handlePhoto);
$("#cameraPhoto").addEventListener("change", handlePhoto);
$("#analyzeMeal").addEventListener("click", analyzeMeal);
$("#clearMeal").addEventListener("click", clearMeal);
$("#saveProfile").addEventListener("click", saveProfile);
$("#analyzeDrink").addEventListener("click", analyzeDrink);
$("#saveWorkout").addEventListener("click", logWorkout);
$("#saveBody").addEventListener("click", logBodyEntry);
$("#resetData").addEventListener("click", resetData);
document.addEventListener("click", handleDeleteClick);
$("#dashCards").addEventListener("click", (e) => {
  const card = e.target.closest("[data-goto]");
  if (card) showTab(card.dataset.goto);
});
$("#dashNudges").addEventListener("click", (e) => {
  const action = e.target.closest("[data-goto]");
  if (action) showTab(action.dataset.goto);
});
fillBeverageTypes();
requiredFields.forEach(([id]) =>
  document.getElementById(id).addEventListener("change", () => {
    const missing = missingRequired();
    if (missing.length) {
      // Keep the prompt in sync if we're still waiting on fields.
      if (waitingForRequiredContext) showContextAlert(missing);
      return;
    }
    clearContextAlert();
    // Last required field just got filled after a photo was added — auto-start.
    if (waitingForRequiredContext && selectedMealImage) {
      waitingForRequiredContext = false;
      smoothScrollTo("#analysisNotice");
      setTimeout(() => analyzeMeal(), 250);
    }
  })
);

// ---------------------------------------------------------------------------
// Boot — local mode, or cloud mode (login + Supabase) behind CLOUD_ENABLED.
// ---------------------------------------------------------------------------

// Render history then either open the app or run onboarding. Shared by both modes.
async function bootApp() {
  // Reveal the tabbed app (it's hidden by body.js-loading until now).
  document.body.classList.remove("js-loading");
  await renderHistory();
  let onboarded = isOnboarded();
  if (cloudActive) {
    // For a signed-in user, "onboarded" means they already have a cloud profile.
    const p = await store.getProfile(UID);
    onboarded = Boolean(p && p.name && p.name !== "Friend");
    if (onboarded) localStorage.setItem("ywye.onboarded", "1");
  }
  if (onboarded) {
    $("#bottomNav").hidden = false;
    showTab("home");
  } else {
    startOnboarding();
  }
}

function bootLocal() {
  cloudActive = false;
  $("#authGate").hidden = true;
  store = createLocalStore();
  engine = new HealthDNAEngine(store);
  UID = getLocalUserId();
  bootApp();
}

let authMode = "signin";
function showAuthMessage(msg) {
  $("#authError").hidden = false;
  $("#authError").textContent = msg;
}

async function startCloud() {
  const cloud = await import("/cloud.js");
  const { createCloudStore } = await import("/store-cloud.js");
  const cfg = await cloud.loadConfig();
  if (!cfg.configured) {
    // No Supabase env (e.g. local dev) — quietly use local mode so the app works.
    bootLocal();
    return;
  }

  // Wire the login form.
  $("#authToggle").addEventListener("click", () => {
    authMode = authMode === "signin" ? "signup" : "signin";
    const signup = authMode === "signup";
    $("#authTitle").textContent = signup ? "Create account" : "Sign in";
    $("#authSubmit").textContent = signup ? "Create account" : "Sign in";
    $("#authTogglePrompt").textContent = signup ? "Already have an account?" : "New here?";
    $("#authToggle").textContent = signup ? "Sign in" : "Create an account";
    $("#authPassword").autocomplete = signup ? "new-password" : "current-password";
    $("#authError").hidden = true;
  });
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    $("#authError").hidden = true;
    const submit = $("#authSubmit");
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Please wait…";
    try {
      if (authMode === "signup") {
        await cloud.signUp(email, password);
        if (!(await cloud.getSession())) {
          showAuthMessage("Account created. Check your email to confirm, then sign in.");
          authMode = "signin";
        }
      } else {
        await cloud.signIn(email, password);
      }
    } catch (err) {
      showAuthMessage(err.message || "Something went wrong. Try again.");
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });
  $("#signOut").addEventListener("click", async () => {
    await cloud.signOut();
  });

  // React to login/logout.
  cloud.onAuthChange(async (session) => {
    if (session) {
      UID = session.user.id;
      const client = await cloud.getClient();
      store = createCloudStore(client, UID);
      engine = new HealthDNAEngine(store);
      cloudActive = true;
      $("#authGate").hidden = true;
      $("#signOut").hidden = false;
      await bootApp();
    } else {
      cloudActive = false;
      document.body.classList.add("js-loading"); // hide the tabbed app behind the gate
      hideChrome();
      document.querySelectorAll(".screen").forEach((s) => s.classList.remove("is-active"));
      $("#authGate").hidden = false;
    }
  });
}

// A persisted Supabase session is stored under an "sb-...-auth-token" key.
function hasPersistedSession() {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) return true;
  }
  return false;
}

if (CLOUD_ENABLED) {
  // Don't let the app paint before we know who the user is. If there's no saved
  // session, show the sign-in gate immediately; otherwise stay on the loading
  // state and let onAuthChange reveal the app (no gate flash for returning users).
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("is-active"));
  hideChrome();
  // The gate lives outside .app-shell, so it shows even while js-loading keeps
  // the tabbed app hidden.
  if (!hasPersistedSession()) $("#authGate").hidden = false;
  startCloud();
} else {
  bootLocal();
}
