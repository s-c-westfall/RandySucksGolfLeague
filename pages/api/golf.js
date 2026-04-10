// pages/api/golf.js
// Proxies calls to Slash Golf (RapidAPI) using GOLF_API_KEY env var.
// Query params: path=/tournaments&tournId=014&year=2026

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.GOLF_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOLF_API_KEY not configured on server.' });

  const ALLOWED_PATHS = ['tournament', 'leaderboard', 'schedule', 'stats', 'organizations', 'players', 'scorecard', 'points', 'earnings'];
  const { path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path param' });
  if (!ALLOWED_PATHS.includes(path)) return res.status(400).json({ error: `Invalid path: ${path}` });

  const qs = new URLSearchParams(params).toString();
  const url = `https://live-golf-data.p.rapidapi.com/${path}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'live-golf-data.p.rapidapi.com',
      },
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
