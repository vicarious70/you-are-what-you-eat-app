// Cloud auth client for the Health DNA app (browser).
//
// Talks to Supabase Auth from the browser using the PUBLIC anon key (fetched
// from /api/public-config), and provides an authed `apiFetch` that attaches the
// user's JWT so the serverless API can scope everything to that user.
//
// This file is inert until something calls it — the app only wires it in when
// the CLOUD_ENABLED flag is on, so the local-only app is unaffected.

let configPromise = null;
let clientPromise = null;

export async function loadConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/public-config")
      .then((r) => r.json())
      .catch(() => ({ configured: false }));
  }
  return configPromise;
}

// Lazily load supabase-js from a CDN and create a browser client. Only runs in
// cloud mode, so the local app never pulls this dependency.
export async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const cfg = await loadConfig();
      if (!cfg.configured) throw new Error("Cloud backend is not configured (missing Supabase env vars).");
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // Bypass the Web Locks API, which can deadlock token refresh on mobile
          // Safari and hang every query after a reload.
          lock: async (_name, _acquireTimeout, fn) => fn(),
        },
      });
    })();
  }
  return clientPromise;
}

export async function signUp(email, password) {
  const { data, error } = await (await getClient()).auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await (await getClient()).auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signOut() {
  await (await getClient()).auth.signOut();
}

export async function getSession() {
  const { data } = await (await getClient()).auth.getSession();
  return data.session || null;
}

export async function getAccessToken() {
  const session = await getSession();
  return session ? session.access_token : null;
}

export async function onAuthChange(callback) {
  const client = await getClient();
  client.auth.onAuthStateChange((_event, session) => callback(session));
  // Fire once with the current state so callers can render immediately.
  callback(await getSession());
}

// Authenticated fetch to our serverless API. Throws on non-2xx with the
// server's error message.
export async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}
