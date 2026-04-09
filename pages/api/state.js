// pages/api/state.js
// Shared league state persisted in Vercel KV.
// GET  /api/state          → returns current state
// POST /api/state          → body: { action, payload } → mutates + returns new state
// DELETE /api/state        → resets league (admin use)

import { kv } from '@vercel/kv';

const KEY = 'golf_league_state';

const DEFAULT_STATE = {
  configured: false,
  apiKey: '',
  tournId: '',
  year: '',
  tournamentName: '',
  field: [],
  drafters: [],
  picks: [],
  draftOrder: [],
  currentPickIndex: 0,
  draftComplete: false,
  scores: {},
  lastRefreshed: null,
};

async function getState() {
  const s = await kv.get(KEY);
  return s ? { ...DEFAULT_STATE, ...s } : { ...DEFAULT_STATE };
}

async function setState(s) {
  await kv.set(KEY, s);
  return s;
}

function checkAuth(req) {
  const expected = process.env.LEAGUE_SECRET;
  if (!expected) return true; // auth disabled
  const token = req.headers['x-league-secret'] || '';
  return token === expected;
}

export default async function handler(req, res) {
  // Mutations require auth when LEAGUE_SECRET is set
  if ((req.method === 'POST' || req.method === 'DELETE') && !checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const state = await getState();
    // Never expose the API key to the client
    return res.status(200).json({ ...state, apiKey: '••••••••' });
  }

  if (req.method === 'DELETE') {
    await kv.del(KEY);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    const { action, payload } = req.body;
    const state = await getState();

    switch (action) {

      case 'configure': {
        // Store config including real API key server-side only
        const updated = {
          ...state,
          configured: true,
          apiKey: payload.apiKey,
          tournId: payload.tournId,
          year: payload.year,
          tournamentName: payload.tournamentName,
          field: payload.field,
        };
        await setState(updated);
        return res.status(200).json({ ...updated, apiKey: '••••••••' });
      }

      case 'setDrafters': {
        const updated = { ...state, drafters: payload.drafters };
        await setState(updated);
        return res.status(200).json({ ...updated, apiKey: '••••••••' });
      }

      case 'startDraft': {
        const updated = {
          ...state,
          picks: [],
          currentPickIndex: 0,
          draftComplete: false,
          draftOrder: payload.draftOrder,
        };
        await setState(updated);
        return res.status(200).json({ ...updated, apiKey: '••••••••' });
      }

      case 'makePick': {
        if (state.draftComplete) return res.status(409).json({ error: 'Draft complete' });
        // Optimistic lock: client must send the expected pick index
        if (payload.pick.pickIndex !== state.currentPickIndex) {
          // Re-read and return current state so client can sync
          const current = await getState();
          return res.status(409).json({ error: 'Pick conflict — someone else picked. Refreshing.', state: { ...current, apiKey: '••••••••' } });
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
        return res.status(200).json({ ...updated, apiKey: '••••••••' });
      }

      case 'updateScores': {
        const updated = {
          ...state,
          scores: payload.scores,
          lastRefreshed: new Date().toISOString(),
        };
        await setState(updated);
        return res.status(200).json({ ...updated, apiKey: '••••••••' });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  }

  res.status(405).end();
}
