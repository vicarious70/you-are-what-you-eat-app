// HTTP handlers for the Health DNA backend.
//
// These are plain Node (req, res) handlers, so the SAME functions serve both
// Vercel serverless functions (api/*.mjs) and the local dev server
// (server.mjs). Each builds a fresh engine over the Supabase store, scoped to
// the authenticated user.

import { HealthDNAEngine } from "../engine/index.js";
import { getServiceClient, resolveUserId } from "./supabase.mjs";
import { createSupabaseStore } from "./dna-store.mjs";

function buildEngine() {
  return new HealthDNAEngine(createSupabaseStore(getServiceClient()));
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

// Wrap a handler with auth + uniform error handling.
function withUser(fn) {
  return async (req, res) => {
    try {
      const userId = await resolveUserId(req);
      await fn(req, res, { userId, engine: buildEngine() });
    } catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) console.error("Health DNA API error:", error);
      sendJson(res, status, { error: error.message || "Request failed." });
    }
  };
}

// GET /api/public-config -> values the browser needs to talk to Supabase.
// PUBLIC by design: the project URL and anon key are safe to expose to the
// client (RLS protects the data). The service-role key is never sent here.
export const handlePublicConfig = async (req, res) => {
  sendJson(res, 200, {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
  });
};

// GET  /api/profile      -> current profile (creates a default if none)
// POST /api/profile      -> upsert profile (id forced to the auth user)
export const handleProfile = withUser(async (req, res, { userId, engine }) => {
  if (req.method === "GET") {
    const profile = (await engine.store.getProfile(userId)) || (await engine.upsertProfile({ id: userId }));
    return sendJson(res, 200, { profile });
  }
  if (req.method === "POST" || req.method === "PUT") {
    const body = await readJsonBody(req);
    const profile = await engine.upsertProfile({ ...body, id: userId });
    return sendJson(res, 200, { profile });
  }
  return sendJson(res, 405, { error: "Method not allowed." });
});

// GET  /api/meals        -> list this user's meals
// POST /api/meals        -> log a meal, return { meal, analysis, dna }
export const handleMeals = withUser(async (req, res, { userId, engine }) => {
  if (req.method === "GET") {
    return sendJson(res, 200, { meals: await engine.store.listMeals(userId) });
  }
  if (req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await engine.logMeal({ ...body, userId });
    return sendJson(res, 200, result);
  }
  return sendJson(res, 405, { error: "Method not allowed." });
});

// GET  /api/activities   -> list   |   POST -> log a workout
export const handleActivities = withUser(async (req, res, { userId, engine }) => {
  if (req.method === "GET") {
    return sendJson(res, 200, { activities: await engine.store.listActivities(userId) });
  }
  if (req.method === "POST") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, { activity: await engine.logActivity({ ...body, userId }) });
  }
  return sendJson(res, 405, { error: "Method not allowed." });
});

// GET  /api/body         -> list   |   POST -> log a weigh-in / reading
export const handleBody = withUser(async (req, res, { userId, engine }) => {
  if (req.method === "GET") {
    return sendJson(res, 200, { bodyEntries: await engine.store.listBodyEntries(userId) });
  }
  if (req.method === "POST") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, { entry: await engine.logBody({ ...body, userId }) });
  }
  return sendJson(res, 405, { error: "Method not allowed." });
});

// GET /api/health-dna    -> learned insights (what works / what doesn't)
export const handleHealthDNA = withUser(async (req, res, { userId, engine }) => {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  return sendJson(res, 200, await engine.getHealthDNA(userId));
});

// GET /api/weekly-review[?date=ISO] -> generate (and cache) the weekly review
export const handleWeeklyReview = withUser(async (req, res, { userId, engine }) => {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  const dateParam = new URL(req.url, "http://localhost").searchParams.get("date");
  const review = await engine.weeklyReview(userId, dateParam ? new Date(dateParam) : new Date());
  // Best-effort cache; never fail the request if caching errors.
  if (typeof engine.store.saveWeeklyReview === "function") {
    try {
      await engine.store.saveWeeklyReview(review);
    } catch (e) {
      console.error("weekly review cache failed:", e.message);
    }
  }
  return sendJson(res, 200, { review });
});

// Map of path -> handler, reused by both Vercel wrappers and server.mjs.
export const routes = {
  "/api/public-config": handlePublicConfig,
  "/api/profile": handleProfile,
  "/api/meals": handleMeals,
  "/api/activities": handleActivities,
  "/api/body": handleBody,
  "/api/health-dna": handleHealthDNA,
  "/api/weekly-review": handleWeeklyReview,
};
