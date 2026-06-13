function handler(request, response) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({
    ok: true,
    provider: process.env.GEMINI_API_KEY
      ? "gemini"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : "missing-key",
    model: process.env.GEMINI_API_KEY
      ? process.env.GEMINI_MODEL || "gemini-3.5-flash"
      : process.env.OPENAI_MODEL || "gpt-4.1-mini",
  }));
}

module.exports = handler;
