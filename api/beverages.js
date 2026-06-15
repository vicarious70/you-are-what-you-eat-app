// Vercel serverless function: /api/beverages
module.exports = async (req, res) => {
  const { handleBeverages } = await import("../lib/api-handlers.mjs");
  return handleBeverages(req, res);
};
