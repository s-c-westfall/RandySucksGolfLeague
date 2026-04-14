// pages/api/challenges.js
// GET  /api/challenges?tournId=X  → returns all challenges for the given tournId
// POST /api/challenges             → body: { action, ... } → mutates challenges

import { sql, ensureTable } from '../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';

export default async function handler(req, res) {
  await ensureTable();

  if (req.method === 'GET') {
    const { tournId } = req.query;
    if (!tournId) return res.status(400).json({ error: 'tournId is required' });

    // Get the tournament integer PK from the text tournId
    const tournRows = await sql`SELECT id FROM tournaments WHERE tourn_id = ${tournId} ORDER BY created_at DESC LIMIT 1`;
    const tournamentId = tournRows[0]?.id || null;

    let challenges;
    if (tournamentId) {
      challenges = await sql`
        SELECT * FROM challenges
        WHERE tournament_id = ${tournamentId}
        ORDER BY created_at DESC
      `;
    } else {
      // If no tournament found, return empty
      challenges = [];
    }

    return res.status(200).json(challenges);
  }

  if (req.method === 'POST') {
    const session = await getServerSession(req, res, authOptions);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    const { action } = req.body;

    switch (action) {

      case 'create': {
        const { opponentName, amount, tournId } = req.body;
        if (!opponentName || !amount) {
          return res.status(400).json({ error: 'opponentName and amount are required' });
        }
        if (opponentName === session.user.name) {
          return res.status(400).json({ error: 'You cannot challenge yourself' });
        }

        // Look up tournament_id by tournId text
        let tournamentId = null;
        if (tournId) {
          const tournRows = await sql`SELECT id FROM tournaments WHERE tourn_id = ${tournId} ORDER BY created_at DESC LIMIT 1`;
          tournamentId = tournRows[0]?.id || null;
        }

        // Look up user IDs by name
        const challengerRows = await sql`SELECT id FROM users WHERE name = ${session.user.name} LIMIT 1`;
        const challengerUserId = challengerRows[0]?.id || null;

        const opponentRows = await sql`SELECT id FROM users WHERE name = ${opponentName} LIMIT 1`;
        const opponentUserId = opponentRows[0]?.id || null;

        const inserted = await sql`
          INSERT INTO challenges (
            tournament_id, challenger_name, challenger_user_id,
            opponent_name, opponent_user_id, amount, status
          ) VALUES (
            ${tournamentId}, ${session.user.name}, ${challengerUserId},
            ${opponentName}, ${opponentUserId}, ${amount}, 'pending'
          )
          RETURNING *
        `;

        return res.status(201).json(inserted[0]);
      }

      case 'accept': {
        const { challengeId } = req.body;
        const rows = await sql`SELECT * FROM challenges WHERE id = ${challengeId} LIMIT 1`;
        const challenge = rows[0];
        if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
        if (challenge.status !== 'pending') return res.status(409).json({ error: 'Challenge is not pending' });
        if (challenge.opponent_name !== session.user.name) {
          return res.status(403).json({ error: 'Only the opponent can accept this challenge' });
        }

        const updated = await sql`
          UPDATE challenges
          SET status = 'active', accepted_at = now()
          WHERE id = ${challengeId}
          RETURNING *
        `;
        return res.status(200).json(updated[0]);
      }

      case 'decline': {
        const { challengeId } = req.body;
        const rows = await sql`SELECT * FROM challenges WHERE id = ${challengeId} LIMIT 1`;
        const challenge = rows[0];
        if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
        if (challenge.status !== 'pending') return res.status(409).json({ error: 'Challenge is not pending' });
        if (challenge.opponent_name !== session.user.name) {
          return res.status(403).json({ error: 'Only the opponent can decline this challenge' });
        }

        const updated = await sql`
          UPDATE challenges
          SET status = 'declined', declined_at = now()
          WHERE id = ${challengeId}
          RETURNING *
        `;
        return res.status(200).json(updated[0]);
      }

      case 'withdraw': {
        const { challengeId } = req.body;
        const rows = await sql`SELECT * FROM challenges WHERE id = ${challengeId} LIMIT 1`;
        const challenge = rows[0];
        if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
        if (challenge.status !== 'pending') return res.status(409).json({ error: 'Challenge is not pending' });
        if (challenge.challenger_name !== session.user.name) {
          return res.status(403).json({ error: 'Only the challenger can withdraw this challenge' });
        }

        await sql`DELETE FROM challenges WHERE id = ${challengeId}`;
        return res.status(200).json({ ok: true });
      }

      case 'settle': {
        // standings is [{ name, position }]
        const { standings, tournId } = req.body;
        if (!standings || !Array.isArray(standings)) {
          return res.status(400).json({ error: 'standings array is required' });
        }

        // Build a position map
        const posMap = {};
        for (const s of standings) {
          posMap[s.name] = s.position;
        }

        // Get active challenges for this tournament
        let active;
        if (tournId) {
          const tournRows = await sql`SELECT id FROM tournaments WHERE tourn_id = ${tournId} ORDER BY created_at DESC LIMIT 1`;
          const tournamentId = tournRows[0]?.id || null;
          if (tournamentId) {
            active = await sql`SELECT * FROM challenges WHERE status = 'active' AND tournament_id = ${tournamentId}`;
          } else {
            active = [];
          }
        } else {
          active = await sql`SELECT * FROM challenges WHERE status = 'active'`;
        }

        for (const c of active) {
          const cp = posMap[c.challenger_name];
          const op = posMap[c.opponent_name];
          let winner = null;
          if (cp != null && op != null && cp !== op) {
            winner = cp < op ? c.challenger_name : c.opponent_name;
          }
          await sql`
            UPDATE challenges
            SET status = 'settled', winner_name = ${winner}, settled_at = now()
            WHERE id = ${c.id}
          `;
        }

        return res.status(200).json({ ok: true, settled: active.length });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  }

  res.status(405).end();
}
