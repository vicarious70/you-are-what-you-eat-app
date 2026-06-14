// Vercel serverless function: /api/health-dna
// CommonJS wrapper (matches vercel.json's api/*.js build + /api/$1.js routing)
// that defers to the shared ESM handler in lib/api-handlers.mjs.
module.exports = async (req, res) => {
  const { handleHealthDNA } = await import("../lib/api-handlers.mjs");
  return handleHealthDNA(req, res);
};
