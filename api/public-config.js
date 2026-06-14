// Vercel serverless function: /api/public-config
module.exports = async (req, res) => {
  const { handlePublicConfig } = await import("../lib/api-handlers.mjs");
  return handlePublicConfig(req, res);
};
