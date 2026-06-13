import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { networkInterfaces } from "node:os";

const PORT = Number(process.env.PORT || 5173);
const ROOT = new URL(".", import.meta.url).pathname;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llava:latest";
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
};

function getLanUrls() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((details) => details && details.family === "IPv4" && !details.internal)
    .map((details) => `http://${details.address}:${PORT}/`);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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

async function analyzeWithOllama(image, context) {
  const imageBase64 = dataUrlToBase64(image);
  if (!imageBase64) {
    throw new Error("No valid meal image was received.");
  }

  const prompt = `
Analyze this meal photo for the YOU ARE WHAT YOU EAT DNA app.

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
    const result = await analyzeWithOllama(body.image, body.context);
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
  const filePath = join(ROOT, safePath === "/" ? "index.html" : safePath);
  const extension = extname(filePath);

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extension] || "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      model: OLLAMA_MODEL,
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
  console.log(`YOU ARE WHAT YOU EAT DNA running at http://localhost:${PORT}/`);
  getLanUrls().forEach((url) => console.log(`Mobile/LAN test URL: ${url}`));
  console.log(`Free local vision provider: Ollama ${OLLAMA_MODEL} at ${OLLAMA_URL}`);
});
