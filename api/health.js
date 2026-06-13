export default function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    ok: true,
    provider: process.env.OPENAI_API_KEY ? "openai" : "missing-key",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  });
}
