# The Wrong Joke — Vercel setup

## Frontend
Use `wrong_joke_final.html` as a static page (e.g., in the repo root). It calls `/api/generate`.

## Backend on Vercel
Create `api/generate.js` with the contents in this folder. Set Environment Variables in Vercel:
- `OPENAI_API_KEY` (from Quino's OpenAI account)
- `OPENAI_MODEL` (optional, defaults to `gpt-4o-mini`)

Deploy by connecting the repo to Vercel. The function will be available at `/api/generate`.

## Local test
You can use `vercel dev` or any local server; ensure the API route is reachable at `/api/generate`.

Trigger redeploy 2025-10-08T20:03:01
