// Front-end controller for the Health DNA app.
//
// Photo-first: take/upload a meal photo, the vision backend reads the plate,
// and the result flows into the REAL Health DNA engine (imported from /engine)
// which saves the meal, learns from it, and answers the four questions.
// If the vision backend isn't reachable, we fall back to a context-based
// estimate so logging still works — but the photo is always the primary path.

import { HealthDNAEngine, consumptionDNA } from "/engine/index.js";
import { createLocalStore, clearLocalData } from "/store-local.js";

const $ = (sel) => document.querySelector(sel);
const store = createLocalStore();
const engine = new HealthDNAEngine(store);

function getUserId() {
  let id = localStorage.getItem("ywye.userid");
  if (!id) {
    id = "local_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("ywye.userid", id);
  }
  return id;
}
const UID = getUserId();

let selectedMealImage = "";
let loadingTimers = [];

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
  renderAnalyzingState();

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
  $("#analysisNotice").scrollIntoView({ behavior: "smooth", block: "start" });
}

function signalCard(title, sig) {
  return `<div class="signal-card ${sig.className}">
    <span>${title}</span><strong>${sig.level}</strong><p>${sig.note}</p></div>`;
}

function renderResult(analysis, visionResult, usedFallback) {
  const consumed = analysis.consumption.consumed;
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
    ["Calories", `${consumed.calories} kcal`, "energy eaten"],
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
    if (!missingRequired().length) analyzeMeal();
    else showContextAlert(missingRequired());
  } catch (error) {
    setAnalyzing(false);
    renderFailure(error.message || "The selected photo could not be prepared.");
  }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.dataset.screen === name));
  if (name === "dna") renderDNA();
  if (name === "review") renderReview();
  if (name === "profile") loadProfile();
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
      return `<div class="history-item"><div><strong>${m.timing}</strong><span>${when}${note}</span></div><b>${kcal} kcal</b></div>`;
    })
    .join("");
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
  $("#dnaCount").textContent = `${dna.mealsAnalyzed} meals`;
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
  $("#reviewBody").innerHTML =
    card(s.nutrition) + card(s.activity) + card(s.body) + card(s.progress) + card(s.mindset) +
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
}

async function saveProfile() {
  await engine.upsertProfile({
    id: UID,
    name: $("#pName").value.trim() || "Friend",
    goal: $("#pGoal").value,
    activityLevel: $("#pActivity").value,
    sex: $("#pSex").value,
    age: $("#pAge").value ? Number($("#pAge").value) : null,
  });
  $("#profileStatus").textContent = "Saved";
  setTimeout(() => ($("#profileStatus").textContent = ""), 1500);
}

// ---------------------------------------------------------------------------
// Sample week + reset
// ---------------------------------------------------------------------------

function daysAgo(n, hour = 18) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function loadSampleWeek() {
  await engine.upsertProfile({ id: UID, name: "Sample", goal: "Fat loss", activityLevel: "Moderate activity" });
  const meals = [
    { tags: ["high-protein", "vegetables"], proteinG: 48, carbsG: 40, sodiumMg: 700, sugarG: 4, signals: { glucosePeak: 105, satietyHours: 5, postMealWalk: true }, timing: "Dinner", notes: "grilled chicken and salad", at: daysAgo(6) },
    { tags: ["high-protein", "starch-heavy"], proteinG: 45, carbsG: 70, sodiumMg: 800, sugarG: 6, signals: { glucosePeak: 120, satietyHours: 4.5, postMealWalk: true }, timing: "Dinner", notes: "chicken and potatoes", at: daysAgo(5) },
    { tags: ["sugary-drink"], proteinG: 28, carbsG: 110, sodiumMg: 1600, sugarG: 55, signals: { glucosePeak: 190, satietyHours: 2, energy: "low" }, timing: "Dinner", notes: "burger and a large soda", at: daysAgo(4) },
    { tags: ["high-protein", "vegetables"], proteinG: 50, carbsG: 35, sodiumMg: 650, sugarG: 3, signals: { glucosePeak: 100, satietyHours: 5, postMealWalk: true }, timing: "Dinner", notes: "salmon and greens", at: daysAgo(3) },
    { tags: ["starch-heavy"], proteinG: 30, carbsG: 95, sodiumMg: 900, sugarG: 8, signals: { glucosePeak: 135, satietyHours: 3.5 }, timing: "Dinner", notes: "pasta night", at: daysAgo(2) },
    { tags: ["sugary-drink", "fried"], proteinG: 20, carbsG: 120, sodiumMg: 1900, sugarG: 48, signals: { glucosePeak: 200, satietyHours: 2, energy: "low" }, timing: "Dinner", notes: "fries and sweet tea", at: daysAgo(1) },
    { tags: ["high-protein", "vegetables"], proteinG: 47, carbsG: 38, sodiumMg: 700, sugarG: 5, signals: { glucosePeak: 102, satietyHours: 5, postMealWalk: true }, timing: "Dinner", notes: "turkey and veggies", at: daysAgo(0) },
    { tags: ["sugary-drink"], proteinG: 22, carbsG: 95, sodiumMg: 1200, sugarG: 50, signals: { glucosePeak: 185, satietyHours: 2.5, energy: "low" }, timing: "Lunch", notes: "sandwich and a soda", at: daysAgo(5, 12) },
    { tags: ["sugary-drink"], proteinG: 24, carbsG: 90, sodiumMg: 1100, sugarG: 46, signals: { glucosePeak: 180, satietyHours: 2.5, energy: "low" }, timing: "Lunch", notes: "wrap and lemonade", at: daysAgo(2, 12) },
  ];
  for (const m of meals) await engine.logMeal({ userId: UID, mealType: "Home plate", portion: "Standard", ...m });
  await engine.logActivity({ userId: UID, type: "walk", durationMin: 15, at: daysAgo(0) });
  await engine.logBody({ userId: UID, weightLb: 184, at: daysAgo(6) });
  await engine.logBody({ userId: UID, weightLb: 182.5, at: daysAgo(0) });
  await renderHistory();
  showTab("dna");
}

async function resetData() {
  if (!confirm("Delete all locally stored meals, profile, and data on this device?")) return;
  clearLocalData();
  clearMeal();
  await renderHistory();
  await renderDNA();
  $("#profileStatus").textContent = "Cleared";
  setTimeout(() => ($("#profileStatus").textContent = ""), 1500);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

$("#tabBar").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) showTab(tab.dataset.tab);
});
$("#mealPhoto").addEventListener("change", handlePhoto);
$("#cameraPhoto").addEventListener("change", handlePhoto);
$("#analyzeMeal").addEventListener("click", analyzeMeal);
$("#clearMeal").addEventListener("click", clearMeal);
$("#saveProfile").addEventListener("click", saveProfile);
$("#loadSample").addEventListener("click", loadSampleWeek);
$("#loadSample2").addEventListener("click", loadSampleWeek);
$("#resetData").addEventListener("click", resetData);
requiredFields.forEach(([id]) =>
  document.getElementById(id).addEventListener("change", () => {
    if (!missingRequired().length) clearContextAlert();
  })
);

renderHistory();
