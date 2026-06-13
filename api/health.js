export default function handler(request, response) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({
    ok: true,
    provider: process.env.OPENAI_API_KEY ? "openai" : "missing-key",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  }));
}
