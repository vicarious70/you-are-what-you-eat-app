function handler(request, response) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({
    ok: true,
    provider: process.env.GEMINI_API_KEY ? "gemini" : "missing-gemini-key",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  }));
}

module.exports = handler;
