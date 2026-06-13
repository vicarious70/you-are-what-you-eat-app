const $ = (selector) => document.querySelector(selector);

const impactProfiles = {
  "Home plate": { calories: 620, protein: 38, carbs: 56, fat: 24, sodium: 720, sugar: 9 },
  "Restaurant meal": { calories: 980, protein: 42, carbs: 92, fat: 44, sodium: 1780, sugar: 18 },
  "Fast food": { calories: 1120, protein: 36, carbs: 104, fat: 56, sodium: 2240, sugar: 28 },
  "Holiday meal": { calories: 1280, protein: 48, carbs: 134, fat: 58, sodium: 1880, sugar: 42 },
};

const portionMultipliers = {
  Light: 0.72,
  Standard: 1,
  Large: 1.28,
  "Very large": 1.55,
};

const descriptionBoosts = [
  {
    label: "fried/crunchy side",
    terms: ["fried", "fries", "chips", "crispy"],
    changes: { calories: 180, fat: 12, sodium: 260 },
  },
  {
    label: "sweet drink or dessert",
    terms: ["soda", "dessert", "cake", "cookie", "sweet"],
    changes: { calories: 160, carbs: 34, sugar: 28 },
  },
  {
    label: "starch base",
    terms: ["rice", "pasta", "bread", "noodle", "tortilla", "burrito"],
    changes: { calories: 130, carbs: 30 },
  },
  {
    label: "beans or legumes",
    terms: ["beans", "lentils", "chickpeas"],
    changes: { calories: 110, protein: 7, carbs: 18, fiber: 6 },
  },
  {
    label: "cheese or creamy sauce",
    terms: ["cheese", "cream", "alfredo", "ranch", "sour cream"],
    changes: { calories: 150, fat: 12, sodium: 220 },
  },
  {
    label: "lean protein",
    terms: ["grilled", "chicken", "fish", "turkey", "tofu", "steak", "shrimp"],
    changes: { protein: 16, calories: 80 },
  },
  {
    label: "vegetable or salsa",
    terms: ["salad", "vegetable", "broccoli", "greens", "salsa", "peppers", "lettuce"],
    changes: { carbs: 8, calories: 35, fiber: 3 },
  },
];

const days = [
  ["Today", "Log the meal, then choose one recovery action.", "plan"],
  ["Tomorrow", "Protein plus plants at the first meal.", "steady"],
  ["Day 3", "Walk after the highest-carb meal.", "steady"],
  ["Day 4", "Hydrate early if sodium was high.", "recovery"],
  ["Day 5", "Restaurant strategy before ordering.", "plan"],
  ["Day 6", "Flexible meal without skipping protein.", "steady"],
  ["Day 7", "Review trend, not perfection.", "plan"],
];

let mealHistory = [];
let lastAnalysisId = 0;
let selectedMealImage = "";
let loadingTimers = [];

function setAnalyzeButton(disabled) {
  const button = $("#analyzeMeal");
  button.disabled = disabled;
  button.textContent = disabled ? "Analyzing..." : "Analyze again";
}

function clearLoadingTimers() {
  loadingTimers.forEach((timer) => clearTimeout(timer));
  loadingTimers = [];
}

function startLoadingMessages() {
  clearLoadingTimers();
  const messages = [
    [1800, "Identifying visible foods and likely portions from the photo..."],
    [4200, "Estimating calorie range, protein, carbs, fat, sodium, and sugar..."],
    [7200, "Preparing your meal impact, accuracy notes, and next step..."],
  ];

  loadingTimers = messages.map(([delay, message]) =>
    setTimeout(() => {
      $("#analysisNotice").textContent = message;
    }, delay)
  );
}

function scaleProfile(profile, multiplier) {
  return Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [key, Math.round(value * multiplier)])
  );
}

function getDescriptionSignals() {
  const description = $("#mealDescription").value.toLowerCase();
  if (!description.trim()) return [];

  return descriptionBoosts.filter(({ terms }) => terms.some((term) => description.includes(term)));
}

function applyDescriptionSignals(values, signals) {
  const adjusted = { ...values };

  signals.forEach(({ changes }) => {
    Object.entries(changes).forEach(([key, value]) => {
      adjusted[key] = Math.max(0, (adjusted[key] || 0) + value);
    });
  });

  return adjusted;
}

function getMealValues() {
  const type = $("#mealType").value;
  const portion = $("#portion").value;
  const signals = getDescriptionSignals();

  return {
    values: applyDescriptionSignals(scaleProfile(impactProfiles[type], portionMultipliers[portion]), signals),
    signals,
  };
}

function impactLevel(values) {
  const score = Math.min(
    100,
    Math.round(values.calories / 18 + values.sodium / 70 + values.sugar * 0.55 + values.carbs * 0.2)
  );

  if (score >= 78) return { score, label: "High impact", className: "high" };
  if (score >= 54) return { score, label: "Moderate impact", className: "moderate" };
  return { score, label: "Light impact", className: "light" };
}

function renderImpact(values) {
  const calorieRange =
    values.calorie_min && values.calorie_max
      ? `likely range ${values.calorie_min}-${values.calorie_max} kcal`
      : "estimated energy";
  const metrics = [
    ["Calories", `${values.calories} kcal`, calorieRange],
    ["Protein", `${values.protein}g`, "satiety and muscle support"],
    ["Carbs", `${values.carbs}g`, "glucose load"],
    ["Fat", `${values.fat}g`, "richness and fullness"],
    ["Sodium", `${values.sodium}mg`, "water retention signal"],
    ["Sugar", `${values.sugar}g`, "fast energy signal"],
  ];

  $("#impactCards").innerHTML = metrics
    .map(
      ([label, value, note]) => `
        <div class="metric-card">
          <span>${label}</span>
          <b>${value}</b>
          <span>${note}</span>
        </div>
      `
    )
    .join("");
}

function signal(label, value, detail, className) {
  return `
    <div class="signal-card ${className}">
      <span>${label}</span>
      <strong>${value}</strong>
      <p>${detail}</p>
    </div>
  `;
}

function renderVitalSignals(values) {
  const glucose =
    values.carbs >= 120 || values.sugar >= 30
      ? ["Elevated", "Higher carb or sugar load may create a sharper rise and dip.", "high"]
      : values.carbs >= 75
        ? ["Moderate", "Likely manageable, especially with a short walk after eating.", "moderate"]
        : ["Steady", "Lower glucose pressure for most people.", "light"];

  const sodium =
    values.sodium >= 2000
      ? ["High", "Tomorrow's scale may jump from water, not instant fat gain.", "high"]
      : values.sodium >= 1200
        ? ["Moderate", "Hydration will help smooth temporary water retention.", "moderate"]
        : ["Low", "Lower chance of sodium-driven scale noise.", "light"];

  const protein =
    values.protein >= 40
      ? ["Strong", "Good support for fullness, recovery, and muscle retention.", "light"]
      : values.protein >= 25
        ? ["Okay", "Helpful, but the next meal can anchor protein more strongly.", "moderate"]
        : ["Low", "You may get hungry sooner; prioritize protein next.", "high"];

  const trend =
    values.calories >= 1100
      ? ["Heavy", "One meal is workable, but repeating this pattern can move the weekly trend up.", "high"]
      : values.calories >= 750
        ? ["Manageable", "This can fit if the surrounding meals are simpler.", "moderate"]
        : ["Light", "Lower pressure on the weekly energy trend.", "light"];

  $("#vitalSignals").innerHTML =
    signal("Glucose Impact", glucose[0], glucose[1], glucose[2]) +
    signal("Water Retention", sodium[0], sodium[1], sodium[2]) +
    signal("Protein Adequacy", protein[0], protein[1], protein[2]) +
    signal("Weight Trend", trend[0], trend[1], trend[2]);
}

function renderScore(values) {
  const level = impactLevel(values);
  $("#impactScore").className = `impact-score ${level.className}`;
  $("#impactScore").textContent = `${level.score} ${level.label}`;
}

function renderDetectedFoods(signals) {
  if (!signals.length) {
    $("#detectedFoods").innerHTML =
      '<span class="muted-chip">No plate details entered yet</span>';
    return;
  }

  $("#detectedFoods").innerHTML = signals
    .map(({ label }) => `<span>${label}</span>`)
    .join("");
}

function plateSummary(values, signals) {
  const proteinSignal = values.protein >= 40 ? "solid protein support" : "lighter protein support";
  const carbSignal = values.carbs >= 110 ? "a high starch load" : "a manageable starch load";
  const sodiumSignal = values.sodium >= 1800 ? "likely water retention tomorrow" : "less scale noise from sodium";
  const portion = $("#portion").value.toLowerCase();
  const mealType = $("#mealType").value.toLowerCase();
  const detectedText = signals.length
    ? ` I detected ${signals.map(({ label }) => label).join(", ")} from your description.`
    : " Add a plate description or photo so this estimate can move beyond the default meal type.";

  return `This ${portion} ${mealType} reads as ${proteinSignal}, ${carbSignal}, and ${sodiumSignal}.${detectedText} The goal is not to undo the meal; it is to use the next choice to steer the trend.`;
}

function coach(values) {
  const goal = $("#goal").value.toLowerCase();
  const timing = $("#mealTiming").value.toLowerCase();
  const hunger = $("#hunger").value.toLowerCase();
  const glucoseSignal = values.carbs > 110 ? "a stronger glucose rise" : "a manageable glucose rise";
  const waterSignal = values.sodium > 1800 ? "temporary water retention" : "a lower water-retention load";

  return `Here's what happened: this ${timing} meal likely created ${glucoseSignal} and ${waterSignal}. Here's why: portion size, starch, sauce, and sodium drive tomorrow's scale and energy more than willpower does. Because you started ${hunger} and your goal is ${goal}, the next move is adjustment, not punishment.`;
}

function nextSteps(values) {
  const steps = [];

  if (values.protein < 35) steps.push("Make the next plate protein-first to improve fullness.");
  if (values.carbs > 105) steps.push("Take a 10 to 20 minute walk to smooth the glucose curve.");
  if (values.sodium > 1800) steps.push("Drink water early and expect temporary scale noise tomorrow.");
  if (values.sugar > 25) steps.push("Pair the next snack with protein or fiber instead of another sweet item.");
  if (steps.length < 3) steps.push("Keep the next meal simple: protein, plants, and a portion you can repeat.");

  return steps.slice(0, 4);
}

function renderNextSteps(values) {
  $("#nextSteps").innerHTML = nextSteps(values).map((step) => `<li>${step}</li>`).join("");
}

function renderEmptyAnalysis(message = "Upload a meal photo to start. No sample analysis is shown.") {
  clearLoadingTimers();
  setAnalyzeButton(false);
  $("#analysisNotice").classList.remove("loading", "error");
  $("#failureHelp").hidden = true;
  $("#plateRead").hidden = false;
  $("#impactScore").className = "impact-score empty";
  $("#impactScore").textContent = "--";
  $("#analysisNotice").textContent = message;
  $("#plateSummary").textContent =
    "Your meal photo will be analyzed for likely foods, portions, macro signals, sodium, glucose impact, water retention, and next steps.";
  $("#detectedFoods").innerHTML = '<span class="muted-chip">Waiting for meal photo</span>';
  $("#accuracyNotes").innerHTML = "";
  $("#impactCards").innerHTML = "";
  $("#vitalSignals").innerHTML = "";
  $("#coachMessage").textContent =
    "Take or upload a meal photo, then press Analyze meal. The app will use the local vision backend instead of a canned sample.";
  $("#nextSteps").innerHTML = "";
  $("#confidenceBadge").textContent = "No analysis yet";
  $("#scanStatus").textContent = "Ready";
}

function renderAnalysisFailure(message) {
  clearLoadingTimers();
  setAnalyzeButton(false);
  $("#analysisNotice").classList.remove("loading");
  $("#analysisNotice").classList.add("error");
  $("#failureHelp").hidden = false;
  $("#plateRead").hidden = true;
  $("#impactScore").className = "impact-score empty";
  $("#impactScore").textContent = "--";
  $("#analysisNotice").textContent = message;
  $("#plateSummary").textContent =
    "The photo was received, but the local vision model did not return a usable meal analysis. Try Analyze again, or retake the photo with the full plate visible and better lighting.";
  $("#detectedFoods").innerHTML = '<span class="muted-chip">No verified food detection</span>';
  $("#accuracyNotes").innerHTML = "";
  $("#impactCards").innerHTML = "";
  $("#vitalSignals").innerHTML = "";
  $("#coachMessage").textContent =
    "No nutrition details are shown because the image analysis failed. This avoids presenting a default estimate as if it came from your photo.";
  $("#nextSteps").innerHTML =
    "<li>On mobile, open the Mac local server URL, not the GitHub Pages URL.</li><li>Retake the photo from above with the whole plate in frame.</li><li>Use Analyze again after the local model has warmed up.</li>";
  $("#confidenceBadge").textContent = "Analysis failed";
  $("#scanStatus").textContent = "Try again";
}

function scrollToResults() {
  $("#plateRead").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAnalyzingState() {
  setAnalyzeButton(true);
  startLoadingMessages();
  $("#analysisNotice").classList.remove("error");
  $("#failureHelp").hidden = true;
  $("#plateRead").hidden = false;
  $("#impactScore").className = "impact-score empty";
  $("#impactScore").textContent = "...";
  $("#scanStatus").textContent = "Analyzing";
  $("#analysisNotice").textContent =
    "Analyzing your meal photo now. The local vision model is identifying foods, estimating portions, checking calorie range, and preparing next steps.";
  $("#analysisNotice").classList.add("loading");
  $("#plateSummary").textContent =
    "Reading the image for visible foods, portion clues, sauces, sides, and size references.";
  $("#detectedFoods").innerHTML = '<span class="muted-chip">Detecting foods...</span>';
  $("#accuracyNotes").innerHTML = "";
  $("#impactCards").innerHTML = "";
  $("#vitalSignals").innerHTML = "";
  $("#coachMessage").textContent =
    "This may take a little longer the first time while the local model warms up.";
  $("#nextSteps").innerHTML = "";
  $("#confidenceBadge").textContent = "Analyzing photo";
}

function renderHistory() {
  if (!mealHistory.length) {
    $("#mealHistory").innerHTML =
      '<p class="empty-history">No meals scanned yet. Your first upload will appear here.</p>';
    return;
  }

  $("#mealHistory").innerHTML = mealHistory
    .map(
      (meal) => `
        <div class="history-item">
          <div>
            <strong>${meal.type}</strong>
            <span>${meal.time} · ${meal.portion}</span>
          </div>
          <b>${meal.score}</b>
        </div>
      `
    )
    .join("");
}

function saveToHistory(values) {
  const level = impactLevel(values);
  mealHistory = [
    {
      type: $("#mealType").value,
      portion: $("#portion").value,
      score: level.label,
      time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    },
    ...mealHistory,
  ].slice(0, 5);

  renderHistory();
}

function applyVisionResult(result) {
  const safeNumber = (value, fallback = 0) => Math.max(0, Math.round(Number(value) || fallback));
  const calories = safeNumber(result.calories, 650);
  const calorieMin = safeNumber(result.calorie_min, Math.round(calories * 0.8));
  const calorieMax = safeNumber(result.calorie_max, Math.round(calories * 1.25));

  return {
    calories,
    calorie_min: Math.min(calorieMin, calories),
    calorie_max: Math.max(calorieMax, calories),
    protein: safeNumber(result.protein_g, 30),
    carbs: safeNumber(result.carbs_g, 65),
    fat: safeNumber(result.fat_g, 24),
    sodium: safeNumber(result.sodium_mg, 900),
    sugar: safeNumber(result.sugar_g, 10),
  };
}

function renderVisionFoods(result) {
  const foods = Array.isArray(result.foods) ? result.foods : [];

  if (!foods.length) {
    $("#detectedFoods").innerHTML = '<span class="muted-chip">No foods confidently detected</span>';
    return;
  }

  $("#detectedFoods").innerHTML = foods
    .map((food) => {
      const name = food.name || "food item";
      const portion = food.estimated_portion ? ` · ${food.estimated_portion}` : "";
      const confidence = food.confidence ? ` · ${food.confidence}` : "";
      return `<span>${name}${portion}${confidence}</span>`;
    })
    .join("");
}

function renderVisionAnalysis(result) {
  const values = applyVisionResult(result);
  const confidence = result.confidence || "photo estimate";
  const notes = Array.isArray(result.accuracy_notes) ? result.accuracy_notes : [];

  renderImpact(values);
  renderScore(values);
  renderVitalSignals(values);
  renderNextSteps(values);
  renderVisionFoods(result);
  $("#failureHelp").hidden = true;
  $("#plateRead").hidden = false;

  $("#plateSummary").textContent =
    result.plate_read ||
    `This photo was analyzed for likely foods, portions, macro signals, sodium, glucose impact, and short-term weight trend pressure.`;
  $("#coachMessage").textContent =
    result.coaching ||
    "Here's what happened: this meal has been estimated from the image. Use the next plate to steer the trend, not punish the previous choice.";
  $("#confidenceBadge").textContent = `Vision: ${confidence}`;
  $("#accuracyNotes").innerHTML = notes.map((note) => `<li>${note}</li>`).join("");
}

async function requestVisionAnalysis() {
  const host = window.location.hostname;
  const isLocalServer =
    host === "localhost" ||
    host === "127.0.0.1" ||
    /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

  if (!isLocalServer) {
    throw new Error(
      "Photo analysis needs the local Mac server, but this page is not running from it. On your phone, open the LAN test URL from the Mac server instead of the GitHub Pages link."
    );
  }

  const response = await fetch("/api/analyze-meal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: selectedMealImage,
      context: {
        mealType: $("#mealType").value,
        portion: $("#portion").value,
        goal: $("#goal").value,
        activity: $("#activity").value,
        hunger: $("#hunger").value,
        timing: $("#mealTiming").value,
        plateReference: $("#plateReference").value,
        eatenAmount: $("#eatenAmount").value,
        notes: $("#mealDescription").value.trim(),
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Vision analysis failed. Confirm the local server is running and open this app from its localhost or LAN URL.");
  }

  return payload;
}

async function analyzeMeal({ save = true } = {}) {
  const analyzedAt = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (!selectedMealImage) {
    renderEmptyAnalysis("Upload a meal photo first. The sample analysis has been removed.");
    $("#analysisNotice").classList.remove("pulse");
    void $("#analysisNotice").offsetWidth;
    $("#analysisNotice").classList.add("pulse");
    return;
  }

  const { values, signals } = getMealValues();
  lastAnalysisId += 1;
  renderAnalyzingState();

  try {
    if (selectedMealImage && window.location.protocol !== "file:") {
      const result = await requestVisionAnalysis();
      const visionValues = applyVisionResult(result);

      renderVisionAnalysis(result);
      $("#analysisNotice").classList.remove("error");
      $("#analysisNotice").textContent = `Photo analysis ${lastAnalysisId} complete at ${analyzedAt}. The foods and portions below were estimated from the image.`;
      if (save) saveToHistory(visionValues);
    } else {
      renderImpact(values);
      renderScore(values);
      renderVitalSignals(values);
      renderNextSteps(values);
      $("#plateSummary").textContent = plateSummary(values, signals);
      renderDetectedFoods(signals);
      $("#coachMessage").textContent = coach(values);
      $("#confidenceBadge").textContent = "Photo ready";
      $("#analysisNotice").classList.remove("error");
      $("#analysisNotice").textContent =
        selectedMealImage && window.location.protocol === "file:"
          ? `Photo added, but real food detection needs the local server link. Open the localhost test link to run vision analysis.`
          : `Photo fallback analysis ${lastAnalysisId} complete at ${analyzedAt}. Review your vital information and next step below.`;
      if (save) saveToHistory(values);
    }

    $("#scanStatus").textContent = "Photo analyzed";
  } catch (error) {
    renderAnalysisFailure(error.message || "Vision analysis failed.");
  } finally {
    clearLoadingTimers();
    setAnalyzeButton(false);
    $("#analysisNotice").classList.remove("loading");
  }

  $("#analysisNotice").classList.remove("pulse");
  void $("#analysisNotice").offsetWidth;
  $("#analysisNotice").classList.add("pulse");
}

function clearMeal() {
  $("#mealPhoto").value = "";
  $("#cameraPhoto").value = "";
  $("#mealDescription").value = "";
  selectedMealImage = "";
  $("#preview").removeAttribute("src");
  $(".upload-zone").classList.remove("has-image");
  $("#uploadText").textContent = "Take or upload a meal photo";
  renderEmptyAnalysis();
}

function renderPlanner() {
  $("#weekPlanner").innerHTML = days
    .map(
      ([day, focus, status]) => `
        <div class="day-card">
          <strong>${day}</strong>
          <p>${focus}</p>
          <span class="status-pill ${status}">${status}</span>
        </div>
      `
    )
    .join("");
}

function bindPhotoPreview() {
  const zone = $(".upload-zone");

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const preview = $("#preview");
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      selectedMealImage = reader.result;
      preview.src = selectedMealImage;
      zone.classList.add("has-image");
      $("#uploadText").textContent = "Retake or replace photo";
      $("#scanStatus").textContent = "Photo added";
      renderAnalyzingState();
      scrollToResults();
      analyzeMeal();
    });

    reader.readAsDataURL(file);
  };

  $("#mealPhoto").addEventListener("change", handlePhotoChange);
  $("#cameraPhoto").addEventListener("change", handlePhotoChange);
}

function bindEvents() {
  $("#analyzeMeal").addEventListener("click", () => analyzeMeal());
  $("#clearMeal").addEventListener("click", clearMeal);
}

renderPlanner();
renderHistory();
renderEmptyAnalysis();
bindPhotoPreview();
bindEvents();
