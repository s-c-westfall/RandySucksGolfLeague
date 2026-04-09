// pages/api/auth.js
// Simple shared-secret auth. Set LEAGUE_SECRET env var in Vercel.

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { secret } = req.body;
  const expected = process.env.LEAGUE_SECRET;

  if (!expected) {
    // No secret configured — auth disabled
    return res.status(200).json({ ok: true });
  }

  if (secret === expected) {
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ error: 'Wrong password.' });
}
