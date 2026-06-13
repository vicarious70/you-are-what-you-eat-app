const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb",
    },
  },
};

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
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
      throw new Error("The vision model did not return readable JSON.");
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

  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }

  return chunks.join("\n");
}

async function readRequestBody(request) {
  if (Buffer.isBuffer(request.body)) {
    return JSON.parse(request.body.toString("utf8"));
  }

  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body);

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function analyzeWithOpenAI(image, context) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing in the hosted backend environment.");
  }

  if (!String(image || "").startsWith("data:image/")) {
    throw new Error("No valid meal image was received.");
  }

  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildMealPrompt(context) },
            { type: "input_image", image_url: image },
          ],
        },
      ],
    }),
  });

  if (!openaiResponse.ok) {
    const details = await openaiResponse.text();
    console.error("OpenAI vision request failed:", details.slice(0, 800));
    throw new Error("OpenAI vision analysis failed. Check the API key, billing, and model access.");
  }

  const payload = await openaiResponse.json();
  return normalizeMealResult(parseModelJson(getResponseText(payload)));
}

export default async function handler(request, response) {
  try {
    if (request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        endpoint: "analyze-meal",
        method: "POST",
        provider: process.env.OPENAI_API_KEY ? "openai" : "missing-key",
        model: OPENAI_MODEL,
      });
      return;
    }

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("Allow", "GET, POST, OPTIONS");
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST, OPTIONS");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const body = await readRequestBody(request);
    const result = await analyzeWithOpenAI(body.image, body.context);
    sendJson(response, 200, result);
  } catch (error) {
    console.error("Meal analysis failed:", error);
    sendJson(response, 500, {
      error: error.message || "Hosted meal analysis failed.",
    });
  }
}
