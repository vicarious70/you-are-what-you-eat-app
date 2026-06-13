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
  { terms: ["fried", "fries", "chips", "crispy"], changes: { calories: 180, fat: 12, sodium: 260 } },
  { terms: ["soda", "dessert", "cake", "cookie", "sweet"], changes: { calories: 160, carbs: 34, sugar: 28 } },
  { terms: ["rice", "pasta", "bread", "noodle", "tortilla"], changes: { calories: 130, carbs: 30 } },
  { terms: ["cheese", "cream", "alfredo", "ranch"], changes: { calories: 150, fat: 12, sodium: 220 } },
  { terms: ["grilled", "chicken", "fish", "turkey", "tofu"], changes: { protein: 16, calories: 80 } },
  { terms: ["salad", "vegetable", "broccoli", "greens", "salsa"], changes: { carbs: 8, calories: 35 } },
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

function scaleProfile(profile, multiplier) {
  return Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [key, Math.round(value * multiplier)])
  );
}

function applyDescriptionSignals(values) {
  const description = $("#mealDescription").value.toLowerCase();
  const adjusted = { ...values };

  descriptionBoosts.forEach(({ terms, changes }) => {
    if (terms.some((term) => description.includes(term))) {
      Object.entries(changes).forEach(([key, value]) => {
        adjusted[key] = Math.max(0, (adjusted[key] || 0) + value);
      });
    }
  });

  return adjusted;
}

function getMealValues() {
  const type = $("#mealType").value;
  const portion = $("#portion").value;
  return applyDescriptionSignals(scaleProfile(impactProfiles[type], portionMultipliers[portion]));
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
  const metrics = [
    ["Calories", values.calories, "estimated energy"],
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

function plateSummary(values) {
  const proteinSignal = values.protein >= 40 ? "solid protein support" : "lighter protein support";
  const carbSignal = values.carbs >= 110 ? "a high starch load" : "a manageable starch load";
  const sodiumSignal = values.sodium >= 1800 ? "likely water retention tomorrow" : "less scale noise from sodium";

  return `This plate reads as ${proteinSignal}, ${carbSignal}, and ${sodiumSignal}. The goal is not to undo the meal; it is to use the next choice to steer the trend.`;
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

function analyzeMeal({ save = true } = {}) {
  const values = getMealValues();
  $("#scanStatus").textContent = "Analyzed";
  renderImpact(values);
  renderScore(values);
  renderVitalSignals(values);
  renderNextSteps(values);
  $("#plateSummary").textContent = plateSummary(values);
  $("#coachMessage").textContent = coach(values);
  $("#confidenceBadge").textContent = $("#mealPhoto").files.length ? "Photo + context" : "Context estimate";
  if (save) saveToHistory(values);
}

function clearMeal() {
  $("#mealPhoto").value = "";
  $("#mealDescription").value = "";
  $("#preview").removeAttribute("src");
  $(".upload-zone").classList.remove("has-image");
  $("#uploadText").textContent = "Take or upload a meal photo";
  $("#scanStatus").textContent = "Ready";
  analyzeMeal({ save: false });
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

  $("#mealPhoto").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const preview = $("#preview");
    preview.src = URL.createObjectURL(file);
    zone.classList.add("has-image");
    $("#uploadText").textContent = "Retake or replace photo";
    $("#scanStatus").textContent = "Photo added";
  });
}

function bindEvents() {
  $("#analyzeMeal").addEventListener("click", () => analyzeMeal());
  $("#clearMeal").addEventListener("click", clearMeal);
  ["mealType", "portion", "goal", "activity", "preference", "hunger", "mealTiming"].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => analyzeMeal({ save: false }));
  });
  $("#mealDescription").addEventListener("input", () => analyzeMeal({ save: false }));
}

renderPlanner();
renderHistory();
analyzeMeal({ save: false });
bindPhotoPreview();
bindEvents();
