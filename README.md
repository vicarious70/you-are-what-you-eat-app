# You Are What You Eat App

Foundation Brain v1.0 prototype.

This workspace contains a static MVP for a Health DNA Engine. It is not a calorie counter or a diet app. It is designed to help users understand what their food choices are doing to their body, where those choices are leading over time, and what to do next.

## Product Principles

- Create realization before restriction.
- Never punish, shame, or guilt.
- Always explain, educate, and guide.
- Judge trends, not isolated meals.
- Use the portion plate as the primary measuring system.
- Make the experience photo-first and low friction.

## MVP Surface

- User profile and Health DNA signals
- Goal selection
- Meal photo upload
- Estimated meal impact
- Weight trend tracking
- 7-day planner
- AI-style coaching and next-step guidance

## Health DNA Engine (the brain)

The engine in `engine/` is the core intelligence layer. It is pure,
dependency-free JavaScript that runs unchanged in Node and the browser, and it
answers the four product questions for every meal: what happened, why, where it
is leading, and what to do next.

| File | Responsibility |
| --- | --- |
| `engine/schema.js` | Data structures: Health DNA profile, meal, activity, body records. Normalizes messy input. |
| `engine/meal-to-body.js` | Consumption DNA (served vs eaten vs saved) + the four-question analysis for one meal. |
| `engine/learning.js` | DNA learning engine. Correlates each meal's factors (food tags, timing, post-meal walks) against body-response outcomes to learn what works / what doesn't, with confidence that grows as evidence accumulates. |
| `engine/weekly-review.js` | Monday–Sunday review: Nutrition, Activity, Body Response, Progress, Mindset, Next Week Focus. Educational, never shaming. |
| `engine/index.js` | `HealthDNAEngine` facade over a pluggable store. |
| `engine/memory-store.js` | In-memory store for tests and the demo. |

Run the brain with no database, against the spec's Anthony scenario:

```sh
npm run demo   # node engine/demo.mjs
```

It logs a week of meals, prints the learned Health DNA (higher protein and
post-meal walks help glucose; sugary drinks hurt it), the four-question read on
the latest meal, and a full weekly review.

The store is an interface, so the same engine runs against in-memory data,
`localStorage`, or Supabase without any change to the brain.

## Supabase Backend

Persistence and the HTTP API live behind Supabase (Postgres + Row Level
Security).

1. Create a Supabase project, then run `supabase/schema.sql` in the SQL editor.
   It creates `profiles`, `meals`, `activities`, `body_entries`, and
   `weekly_reviews`, enables RLS so each user only sees their own rows, and
   auto-creates a profile on signup.
2. Copy `.env.example` to `.env` (local) or set the same variables in Vercel:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`. The service
   role key is server-only — never ship it to the browser.
3. Endpoints authenticate with the caller's Supabase JWT (`Authorization:
   Bearer <token>`). For local testing without auth, set `ALLOW_DEV_USER=true`
   and pass `x-user-id: <uuid>`.

### API

All endpoints are served by both Vercel (`api/*.mjs`) and the local dev server.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/profile` | Read or upsert the Health DNA profile. |
| GET | `/api/meals` | List meals. |
| POST | `/api/meals` | Log a meal; returns `{ meal, analysis, dna }`. |
| GET / POST | `/api/activities` | List or log workouts. |
| GET / POST | `/api/body` | List or log weigh-ins / readings. |
| GET | `/api/health-dna` | Learned insights: what works / what doesn't. |
| GET | `/api/weekly-review` | Generate (and cache) the weekly review. |

`lib/dna-store.mjs` maps Postgres rows to and from the engine's objects;
`lib/api-handlers.mjs` holds the shared request handlers.

## Running The App

Open `index.html` in a browser. No build step is required.

For meal photo analysis, run the backend server:

```sh
node server.mjs
```

Then open `http://localhost:5173/`.

## Hosted Mobile Backend

For the real mobile version, deploy this folder to Vercel. The hosted app uses
`api/analyze-meal.js` as a serverless backend, so phones can analyze meal photos
without depending on the Mac or Ollama.

In Vercel, add these environment variables before redeploying:

```sh
GEMINI_API_KEY=your_new_gemini_key_here
GEMINI_MODEL=gemini-3.5-flash
```

Do not paste the API key into `index.html`, `app.js`, or any public file. The key
must live only in Vercel's Environment Variables.

Test links after deploy:

- App: `https://your-vercel-project.vercel.app/`
- Backend health: `https://your-vercel-project.vercel.app/api/health`

The `/api/health` endpoint should return JSON with `"ok": true` and
`"provider": "gemini"`. If it says `"missing-key"`, the Vercel environment
variable is not set for the deployed environment yet.

## Running With Gemini Vision

Use this for the real mobile path. Keep the API key on the server only.

```sh
export GEMINI_API_KEY="your_new_gemini_key_here"
node server.mjs
```

The phone opens the Mac/server URL, uploads the photo, and the backend calls Gemini. Do not put the API key in `index.html`, `app.js`, or any mobile frontend file.

If `GEMINI_API_KEY` is not set, local development falls back to Ollama.

## Running With Free Local Vision

The app can use a local, no-per-use-cost vision backend through Ollama.

1. Install Ollama from `https://ollama.com`.
2. Pull a local vision model:

```sh
ollama pull llava:latest
```

3. Start this app from the project folder without `GEMINI_API_KEY`:

```sh
node server.mjs
```

4. Open `http://localhost:5173/`.

When a meal photo is uploaded from the localhost app, the browser sends it to the local backend at `/api/analyze-meal`. The backend sends the image to Ollama running on your computer and returns estimated foods, portions, macros, sodium, sugar, glucose impact, water retention impact, and coaching.

If Ollama is not installed or the model has not been pulled, the app shows a clear analysis failure message and does not display fake nutrition results.
