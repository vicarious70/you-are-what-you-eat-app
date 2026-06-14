// Supabase client + auth helpers for the Health DNA backend (ESM).
//
// Server endpoints use the SERVICE ROLE key, which bypasses RLS, so we MUST
// scope every query by the authenticated user id ourselves (the store does
// this). The user id is resolved from the caller's Supabase JWT.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Dev escape hatch: when ALLOW_DEV_USER=true, an `x-user-id` header (or
// ?userId=) is trusted without a JWT. Never enable this in production.
const ALLOW_DEV_USER = String(process.env.ALLOW_DEV_USER || "").toLowerCase() === "true";

let serviceClient = null;

export function isConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

export function getServiceClient() {
  if (!isConfigured()) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!serviceClient) {
    serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return serviceClient;
}

function bearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

// Resolve the acting user id from the request, or throw 401-style error.
export async function resolveUserId(req) {
  const token = bearerToken(req);
  if (token) {
    const { data, error } = await getServiceClient().auth.getUser(token);
    if (error || !data?.user) {
      const err = new Error("Invalid or expired session.");
      err.statusCode = 401;
      throw err;
    }
    return data.user.id;
  }

  if (ALLOW_DEV_USER) {
    const devId =
      req.headers?.["x-user-id"] ||
      new URL(req.url, "http://localhost").searchParams.get("userId");
    if (devId) return String(devId);
  }

  const err = new Error("Authentication required.");
  err.statusCode = 401;
  throw err;
}
