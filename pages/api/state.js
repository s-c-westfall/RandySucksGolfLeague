// pages/api/state.js
// Shared league state persisted in Neon Postgres.
// GET  /api/state          → returns current state
// POST /api/state          → body: { action, payload } → mutates + returns new state
// DELETE /api/state        → resets league (admin use)

import { sql, ensureTable } from '../../lib/db';

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

function checkAuth(req) {
  const expected = process.env.LEAGUE_SECRET;
  if (!expected) return true; // auth disabled
  const token = req.headers['x-league-secret'] || '';
  return token === expected;
}

function isCommissioner(name, state) {
  const envName = process.env.COMMISSIONER_NAME;
  if (envName && name === envName) return true;
  return name === state.creator;
}

export default async function handler(req, res) {
  // Mutations require auth when LEAGUE_SECRET is set
  if ((req.method === 'POST' || req.method === 'DELETE') && !checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const state = await getState();
    const commissionerName = process.env.COMMISSIONER_NAME || null;
    return res.status(200).json({ ...state, commissionerName });
  }

  if (req.method === 'DELETE') {
    await ensureTable();
    await sql`DELETE FROM league_state WHERE id = 1`;
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    const { action, payload } = req.body;
    const state = await getState();

    switch (action) {

      case 'configure': {
        const creator = (payload.creator || '').trim();
        if (!creator) return res.status(400).json({ error: 'Creator name is required.' });
        const updated = {
          ...state,
          configured: true,
          tournId: payload.tournId,
          year: payload.year,
          tournamentName: payload.tournamentName,
          field: payload.field,
          creator,
          drafters: [creator],
        };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'addDrafter': {
        if (!isCommissioner(payload.creatorName, state)) return res.status(403).json({ error: 'Only the league creator can add drafters.' });
        const addName = (payload.name || '').trim();
        if (!addName) return res.status(400).json({ error: 'Name is required.' });
        if (state.drafters.includes(addName)) return res.status(409).json({ error: 'That name is already taken.' });
        const addUpdated = { ...state, drafters: [...state.drafters, addName] };
        await setState(addUpdated);
        return res.status(200).json(addUpdated);
      }

      case 'assignGolfer': {
        if (!isCommissioner(payload.creatorName, state)) return res.status(403).json({ error: 'Only the league creator can assign golfers.' });
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
        const name = (payload.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Name is required.' });
        if (state.drafters.includes(name)) return res.status(409).json({ error: 'That name is already taken.' });
        const updated = { ...state, drafters: [...state.drafters, name] };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'leaveDraft': {
        if (state.draftOrder.length > 0) return res.status(400).json({ error: 'Draft already started.' });
        const name = (payload.name || '').trim();
        if (name === state.creator) return res.status(400).json({ error: 'Creator cannot leave. Use Reset instead.' });
        const updated = { ...state, drafters: state.drafters.filter(d => d !== name) };
        await setState(updated);
        return res.status(200).json(updated);
      }

      case 'startDraft': {
        if (!isCommissioner(payload.creatorName, state)) {
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
        if (payload.drafterName !== expectedName && !isCommissioner(payload.drafterName, state)) {
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
        const updated = {
          ...state,
          scores: payload.scores,
          lastRefreshed: new Date().toISOString(),
        };
        await setState(updated);
        return res.status(200).json(updated);
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  }

  res.status(405).end();
}
