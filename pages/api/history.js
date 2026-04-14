// pages/api/history.js
// GET /api/history        → list of past tournaments sorted by completed_at DESC
// GET /api/history?id=N   → full tournament detail (standings + picks)
// No auth required — history is read-only and public to league members.

import { sql, ensureTable } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  await ensureTable();

  const { id } = req.query;

  if (id) {
    // Return full detail for a single tournament
    const tournId = parseInt(id, 10);
    if (isNaN(tournId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const tournRows = await sql`
      SELECT id, tourn_id, name, year, winner_name, completed_at
      FROM tournaments
      WHERE id = ${tournId}
    `;
    if (!tournRows.length) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const standingsRows = await sql`
      SELECT drafter_name, position, display_position, team_total, golfer_scores
      FROM tournament_standings
      WHERE tournament_id = ${tournId}
      ORDER BY position ASC NULLS LAST
    `;

    const picksRows = await sql`
      SELECT drafter_name, player_name, player_id, pick_index, round
      FROM tournament_picks
      WHERE tournament_id = ${tournId}
      ORDER BY pick_index ASC
    `;

    return res.status(200).json({
      tournament: tournRows[0],
      standings: standingsRows,
      picks: picksRows,
    });
  }

  // Return list of all past tournaments
  const rows = await sql`
    SELECT id, name, year, winner_name, completed_at
    FROM tournaments
    ORDER BY completed_at DESC
  `;

  return res.status(200).json(rows);
}
