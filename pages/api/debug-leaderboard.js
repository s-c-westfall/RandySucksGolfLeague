// Temporary debug endpoint — returns raw leaderboard row for inspection
export default async function handler(req, res) {
  const apiKey = process.env.GOLF_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No GOLF_API_KEY' });

  const { tournId, year } = req.query;
  if (!tournId || !year) return res.status(400).json({ error: 'Need tournId and year' });

  const url = `https://live-golf-data.p.rapidapi.com/leaderboard?tournId=${tournId}&year=${year}`;
  const upstream = await fetch(url, {
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': 'live-golf-data.p.rapidapi.com',
    },
  });
  const data = await upstream.json();

  // Return top-level keys and first 2 leaderboard rows raw
  const rows = data?.leaderboardRows || [];
  res.status(200).json({
    topLevelKeys: Object.keys(data),
    rowCount: rows.length,
    sampleRows: rows.slice(0, 3).map(r => ({
      ...r,
      _allKeys: Object.keys(r),
    })),
  });
}
