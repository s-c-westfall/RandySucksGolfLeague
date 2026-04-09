# Golf Draft League

Shared golf draft & scoring tracker for friend leagues. Built with Next.js + Vercel KV.

## Features
- One commissioner enters the API key + tournament ID once — no one else needs credentials
- Snake draft (3 picks per drafter) with live field search
- Scoreboard shows each team's best 2 golfers counting toward their total
- Shared state via Vercel KV — all 12 league members see the same data
- Auto-refreshes scores every 2 minutes once draft is complete

## Setup

### 1. Get a Slash Golf API key
Sign up at [RapidAPI / Slash Golf](https://rapidapi.com/slashgolf/api/live-golf-data) — free tier (250 calls/month) is sufficient for a weekend tournament.

### 2. Find your Tournament ID
Call the `/schedules` endpoint with your API key to find the `tournId` for the current tournament (e.g. Masters = `014`).

### 3. Deploy to Vercel
```bash
cd golf-draft-league
npm install
vercel deploy
```

### 4. Add Vercel KV
In your Vercel dashboard:
1. Go to **Storage** → **Create Database** → **KV**
2. Connect it to your `golf-draft-league` project
3. Vercel auto-injects `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` env vars

### 5. Configure the league
Open the deployed URL, enter your API key + tournament ID, load the field, add drafters, and start the draft. Share the URL with your league — everyone sees live updates.

## Resetting between tournaments
Click the **Reset** button in the top-right to clear all state and start fresh.
