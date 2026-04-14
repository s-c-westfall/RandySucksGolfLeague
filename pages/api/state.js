// pages/api/state.js
// Shared league state persisted in Neon Postgres.
// GET  /api/state          → returns current state
// POST /api/state          → body: { action, payload } → mutates + returns new state
// DELETE /api/state        → resets league (commissioner only)

import { sql, ensureTable } from '../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';

function computeRankings(state) {
  if (!state.draftComplete || !state.picks?.length) return {};
  const teamMap = {};
  (state.picks || []).forEach(pick => {
    const name = state.drafters[pick.drafterIndex];
    if (!teamMap[name]) teamMap[name] = [];
    const sc = state.scores?.[pick.playerId];
    teamMap[name].push(sc?.total ?? 0);
  });
  const teams = Object.entries(teamMap).map(([name, scores]) => {
    const sorted = [...scores].sort((a, b) => a - b);
    const total = sorted.slice(0, 2).reduce((s, v) => s + v, 0);
    return { name, total };
  });
  teams.sort((a, b) => a.total - b.total);
  const rankings = {};
  let pos = 1;
  for (let i = 0; i < teams.length; i++) {
    if (i > 0 && teams[i].total === teams[i - 1].total) {
      rankings[teams[i].name] = rankings[teams[i - 1].name];
    } else {
      rankings[teams[i].name] = pos;
    }
    pos++;
  }
  return rankings;
}

const DEFAULT_STATE = {
  configured: false,
  tournId: '',
  year: '',
  tournamentName: '',
  field: [],
  drafters: [],
  creator: null,
  picks: [],
  draftOrder: [],
  currentPickIndex: 0,
  draftComplete: false,
  scores: {},
  lastRefreshed: null,
};

async function getState() {
  await ensureTable();
  const rows = await sql`SELECT state FROM league_state WHERE id = 1`;
  const s = rows[0]?.state;
  return s ? { ...DEFAULT_STATE, ...s } : { ...DEFAULT_STATE };
}

async function setState(s) {
  await ensureTable();
  await sql`
    INSERT INTO league_state (id, state) VALUES (1, ${JSON.stringify(s)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET state = ${JSON.stringify(s)}::jsonb
  `;
  return s;
}

export default async function handler(req, res) {
  // Require authenticated session for all mutations
  if (req.method === 'POST' || req.method === 'DELETE') {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'DELETE') {
      if (!session.user.isCommissioner) {
        return res.status(403).json({ error: 'Only the commissioner can reset the league.' });
      }
      await ensureTable();
      await sql`DELETE FROM league_state WHERE id = 1`;
      return res.status(200).json({ ok: true });
    }

    // POST mutations
    const { action, payload } = req.body;
    const state = await getState();
    const actingName = session.user.name;
    const isCommissioner = session.user.isCommissioner;

    switch (action) {

      case 'configure': {
        const updated = {
          ...state,
          configured: true,
          tournId: payload.tournId,
          year: payload.year,
          tournamentName: payload.tournamentName,
          field: payload.field,
          creator: actingName,
          drafters: [actingName],
        };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'addDrafter': {
        if (!isCommissioner && actingName !== state.creator) {
          return res.status(403).json({ error: 'Only the league creator can add drafters.' });
        }
        const addName = (payload.name || '').trim();
        if (!addName) return res.status(400).json({ error: 'Name is required.' });
        if (state.drafters.includes(addName)) return res.status(409).json({ error: 'That name is already taken.' });
        const addUpdated = { ...state, drafters: [...state.drafters, addName] };
        await setState(addUpdated);
        return res.status(200).json(addUpdated);
      }

      case 'assignGolfer': {
        if (!isCommissioner && actingName !== state.creator) {
          return res.status(403).json({ error: 'Only the league creator can assign golfers.' });
        }
        const drafterIdx = state.drafters.indexOf(payload.drafterName);
        if (drafterIdx === -1) return res.status(400).json({ error: 'Drafter not found.' });
        const alreadyPicked = state.picks.some(p => p.playerId === payload.playerId);
        if (alreadyPicked) return res.status(409).json({ error: 'That golfer is already drafted.' });
        const pick = { pickIndex: state.picks.length, drafterIndex: drafterIdx, playerId: payload.playerId, name: payload.playerName };
        const updated = { ...state, picks: [...state.picks, pick] };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'joinDraft': {
        if (!state.configured) return res.status(400).json({ error: 'No tournament configured yet.' });
        if (state.draftOrder.length > 0) return res.status(400).json({ error: 'Draft already started.' });
        if (state.drafters.includes(actingName)) {
          return res.status(409).json({ error: 'You are already in the draft.' });
        }
        const updated = { ...state, drafters: [...state.drafters, actingName] };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'leaveDraft': {
        if (state.draftOrder.length > 0) return res.status(400).json({ error: 'Draft already started.' });
        if (actingName === state.creator) return res.status(400).json({ error: 'Creator cannot leave. Use Reset instead.' });
        const updated = { ...state, drafters: state.drafters.filter(d => d !== actingName) };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'startDraft': {
        if (!isCommissioner && actingName !== state.creator) {
          return res.status(403).json({ error: 'Only the league creator can start the draft.' });
        }
        if (state.drafters.length < 2) return res.status(400).json({ error: 'Need at least 2 drafters.' });
        // Shuffle drafters for random draft order
        const shuffled = [...state.drafters];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const updated = {
          ...state,
          drafters: shuffled,
          picks: [],
          currentPickIndex: 0,
          draftComplete: false,
          draftOrder: payload.draftOrder,
        };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'makePick': {
        if (state.draftComplete) return res.status(409).json({ error: 'Draft complete' });
        // Optimistic lock: client must send the expected pick index
        if (payload.pick.pickIndex !== state.currentPickIndex) {
          const current = await getState();
          return res.status(409).json({ error: 'Pick conflict — someone else picked. Refreshing.', state: current });
        }
        // Validate the pick is from the correct drafter
        const expectedDrafterIndex = state.draftOrder[state.currentPickIndex];
        const expectedName = state.drafters[expectedDrafterIndex];
        if (actingName !== expectedName && !isCommissioner) {
          return res.status(403).json({ error: `It is ${expectedName}'s turn, not yours.` });
        }
        const newPicks = [...state.picks];
        newPicks[state.currentPickIndex] = payload.pick;
        const nextIndex = state.currentPickIndex + 1;
        const complete = nextIndex >= state.draftOrder.length;
        const updated = {
          ...state,
          picks: newPicks,
          currentPickIndex: nextIndex,
          draftComplete: complete,
        };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'updateScores': {
        const previousRankings = computeRankings(state);
        const updated = {
          ...state,
          scores: payload.scores,
          previousRankings,
          lastRefreshed: new Date().toISOString(),
        };
        await setState(updated);
        return res.status(200).json(updated);
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  }

  if (req.method === 'GET') {
    const state = await getState();
    return res.status(200).json(state);
  }

  res.status(405).end();
}
