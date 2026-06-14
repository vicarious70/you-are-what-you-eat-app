import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { networkInterfaces } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 5173);
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llava:latest";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const HOST = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function getLanUrls() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((details) => details && details.family === "IPv4" && !details.internal)
    .map((details) => `http://${details.address}:${PORT}/`);
}

function getFriendlyLocalUrl() {
  let rawName = process.env.LOCAL_HOSTNAME || "";
  if (!rawName) {
    try {
      rawName = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim();
    } catch {
      rawName = "";
    }
  }
  if (!rawName) return "";
  return `http://${rawName}.local:${PORT}/`;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12_000_000) {
        reject(new Error("Image is too large. Try a smaller photo."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function dataUrlToBase64(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return "";
  return match[1];
}

function parseImageDataUrl(image) {
  const match = String(image || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("No valid meal image was received.");
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function normalizeMealResult(result) {
  const calories = Number(result.calories) || 650;
  const calorieMin = Number(result.calorie_min) || Math.round(calories * 0.8);
  const calorieMax = Number(result.calorie_max) || Math.round(calories * 1.25);

  return {
    foods: Array.isArray(result.foods) ? result.foods : [],
    calories,
    calorie_min: Math.min(calorieMin, calories),
    calorie_max: Math.max(calorieMax, calories),
    protein_g: Number(result.protein_g) || 30,
    carbs_g: Number(result.carbs_g) || 65,
    fat_g: Number(result.fat_g) || 24,
    sodium_mg: Number(result.sodium_mg) || 900,
    sugar_g: Number(result.sugar_g) || 10,
    confidence: result.confidence || "medium",
    plate_read: result.plate_read || "",
    coaching: result.coaching || "",
    accuracy_notes: Array.isArray(result.accuracy_notes) ? result.accuracy_notes : [],
  };
}

function parseModelJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("The local vision model did not return readable JSON.");
    }
    return JSON.parse(raw.slice(start, end + 1));
  }
}

function buildMealPrompt(context) {
  return `
Analyze this meal photo for the You Are What You Eat App.

Accuracy rules:
- Identify each visible food item first, then estimate the consumed portion for each item.
- Use visible size references if present, such as plate, bowl, fork, hand, cup, wrapper, or takeout container.
- If the portion is uncertain, widen the calorie range instead of pretending precision.
- Return a best calorie estimate plus low/high calorie range. The range should reflect realistic uncertainty from image-only estimation.
- Account for sauces, fried coatings, cheese, oils, drinks, and sides when visible or mentioned in context.
- If the image is unclear, say confidence is low and use a wider range.
- Do not diagnose, prescribe, or shame. Keep the guidance educational.

Return only JSON with this exact shape:
{
  "foods": [{"name": "string", "estimated_portion": "string", "confidence": "low|medium|high"}],
  "calories": number,
  "calorie_min": number,
  "calorie_max": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "sodium_mg": number,
  "sugar_g": number,
  "confidence": "low|medium|high",
  "accuracy_notes": ["short assumption or uncertainty note"],
  "plate_read": "one plain-language paragraph about what the plate appears to contain and what it may do",
  "coaching": "one supportive paragraph: what happened, why it happened, and what to do next"
}

Use this context to tighten portion assumptions:
${JSON.stringify(context || {})}
`;
}

function getResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  const geminiText = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("\n")
    .trim();
  if (geminiText) return geminiText;

  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }

  return chunks.join("\n");
}

async function analyzeWithGemini(image, context) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured on the server.");
  }

  const { mimeType, base64 } = parseImageDataUrl(image);
  const modelPath = GEMINI_MODEL.replace(/^models\//, "");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64,
                },
              },
              { text: buildMealPrompt(context) },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const details = await response.text();
    console.error("Gemini vision request failed:", details.slice(0, 800));
    throw new Error("Gemini vision analysis failed. Check the server API key, model access, and API restrictions.");
  }

  const payload = await response.json();
  return {
    ...normalizeMealResult(parseModelJson(getResponseText(payload))),
    provider: "gemini",
    model: GEMINI_MODEL,
  };
}

async function analyzeWithOllama(image, context) {
  const imageBase64 = dataUrlToBase64(image);
  if (!imageBase64) {
    throw new Error("No valid meal image was received.");
  }

  const prompt = buildMealPrompt(context);

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      images: [imageBase64],
      stream: false,
      format: "json",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Local vision backend is not ready. Install Ollama, run "ollama pull ${OLLAMA_MODEL}", then restart this server.`
    );
  }

  const payload = await response.json();
  const raw = payload.response || "{}";
  try {
    return normalizeMealResult(parseModelJson(raw));
  } catch (error) {
    console.error("Could not parse local vision response:", raw.slice(0, 800));
    throw error;
  }
}

async function handleAnalyzeMeal(request, response) {
  try {
    const body = JSON.parse(await readBody(request));
    const result = GEMINI_API_KEY
      ? await analyzeWithGemini(body.image, body.context)
      : await analyzeWithOllama(body.image, body.context);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 503, {
      error:
        error.message ||
        "Local vision analysis is unavailable. The app can still show a fallback estimate.",
    });
  }
}

async function handleStatic(request, response) {
  const requestUrl = new URL(request.url, `http://localhost:${PORT}`);
  const safePath = normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, "");

  // The front-end lives in public/; the browser-importable engine lives in
  // engine/. Everything else (the app) is served from public/. This mirrors
  // vercel.json so local dev and production resolve paths identically.
  const baseDir = safePath.startsWith("/engine/") ? ROOT : join(ROOT, "public");
  const filePath = join(baseDir, safePath === "/" ? "index.html" : safePath);
  const extension = extname(filePath);

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

// Health DNA engine routes are loaded lazily so the static app and meal-vision
// endpoints keep working even if Supabase deps aren't installed yet.
let dnaRoutesPromise = null;
function getDnaRoutes() {
  if (!dnaRoutesPromise) {
    dnaRoutesPromise = import("./lib/api-handlers.mjs").then((m) => m.routes);
  }
  return dnaRoutesPromise;
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url, `http://localhost:${PORT}`).pathname;

  // Engine API (profile, meals, activities, body, health-dna, weekly-review).
  if (
    pathname.startsWith("/api/") &&
    pathname !== "/api/health" &&
    pathname !== "/api/analyze-meal"
  ) {
    getDnaRoutes()
      .then((routes) => {
        const handler = routes[pathname];
        if (handler) return handler(request, response);
        sendJson(response, 404, { error: "Unknown API route." });
      })
      .catch((error) => sendJson(response, 500, { error: error.message }));
    return;
  }

  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      provider: GEMINI_API_KEY ? "gemini" : "ollama",
      model: GEMINI_API_KEY ? GEMINI_MODEL : OLLAMA_MODEL,
      ollama: OLLAMA_URL,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/analyze-meal") {
    handleAnalyzeMeal(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    handleStatic(request, response);
    return;
  }

  response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`You Are What You Eat App running at http://localhost:${PORT}/`);
  const friendlyUrl = getFriendlyLocalUrl();
  if (friendlyUrl) console.log(`Friendly mobile URL: ${friendlyUrl}`);
  getLanUrls().forEach((url) => console.log(`Mobile/LAN test URL: ${url}`));
  if (GEMINI_API_KEY) {
    console.log(`Vision provider: Gemini ${GEMINI_MODEL}`);
  } else {
    console.log(`Vision provider: Ollama ${OLLAMA_MODEL} at ${OLLAMA_URL}`);
  }
});
