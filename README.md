# YOU ARE WHAT YOU EAT(TM) DNA

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

## Running The Prototype

Open `index.html` in a browser. No build step is required.

## Running With Free Local Vision

The app can use a local, no-per-use-cost vision backend through Ollama.

1. Install Ollama from `https://ollama.com`.
2. Pull a local vision model:

```sh
ollama pull llava:latest
```

3. Start this app from the project folder:

```sh
node server.mjs
```

4. Open `http://localhost:5173/`.

When a meal photo is uploaded from the localhost app, the browser sends it to the local backend at `/api/analyze-meal`. The backend sends the image to Ollama running on your computer and returns estimated foods, portions, macros, sodium, sugar, glucose impact, water retention impact, and coaching.

If Ollama is not installed or the model has not been pulled, the app will fall back to the prototype estimate and show a clear message.
