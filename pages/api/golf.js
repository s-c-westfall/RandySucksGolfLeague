// pages/api/golf.js
// Proxies calls to Slash Golf (RapidAPI) using the stored API key.
// Query params: path=/tournaments&tournId=014&year=2026

import { kv } from '@vercel/kv';

const KEY = 'golf_league_state';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const state = await kv.get(KEY);
  if (!state?.apiKey) return res.status(401).json({ error: 'No API key configured.' });

  const { path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path param' });

  const qs = new URLSearchParams(params).toString();
  const url = `https://live-golf-data.p.rapidapi.com/${path}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'x-rapidapi-key': state.apiKey,
        'x-rapidapi-host': 'live-golf-data.p.rapidapi.com',
      },
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
