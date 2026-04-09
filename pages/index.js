import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';

const PICKS_PER_DRAFTER = 3;

// ── helpers ──────────────────────────────────────────────────────────────────
function buildSnakeOrder(n, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r++) {
    const row = Array.from({ length: n }, (_, i) => i);
    if (r % 2 === 1) row.reverse();
    order.push(...row);
  }
  return order;
}

function fmtScore(n) {
  if (n === null || n === undefined) return '–';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

function scoreClass(n) {
  if (n === null || n === undefined) return '';
  if (n < 0) return 'under';
  if (n > 0) return 'over';
  return 'even';
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function apiGet(path, params = {}) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  const res = await fetch(`/api/golf?${qs}`);
  if (!res.ok) throw new Error(`Golf API ${res.status}`);
  return res.json();
}

async function statePost(action, payload = {}) {
  const res = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) throw new Error(`State API ${res.status}`);
  return res.json();
}

async function stateGet() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`State API ${res.status}`);
  return res.json();
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [s, setS] = useState(null);   // server state
  const [tab, setTab] = useState('draft');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [searchQ, setSearchQ] = useState('');

  // setup form
  const [apiKey, setApiKey] = useState('');
  const [tournId, setTournId] = useState('');
  const [year, setYear] = useState('2026');
  const [newDrafter, setNewDrafter] = useState('');

  const pollingRef = useRef(null);

  // initial load
  useEffect(() => {
    stateGet().then(setS).catch(console.error);
  }, []);

  // auto-refresh scores every 2 min when draft complete
  useEffect(() => {
    if (s?.draftComplete) {
      pollingRef.current = setInterval(refreshScores, 120_000);
    }
    return () => clearInterval(pollingRef.current);
  }, [s?.draftComplete]);

  const wrap = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // ── handlers ──
  const loadTournament = () => wrap(async () => {
    if (!apiKey || !tournId || !year) throw new Error('Fill in all fields.');
    const data = await apiGet('tournaments', { tournId, year });
    if (!data?.players) throw new Error('No player data — check tournament ID.');
    const field = data.players
      .filter(p => p.status !== 'wd')
      .map(p => ({ playerId: p.playerId, name: p.playerName || p.name || p.playerId, worldRank: p.worldRank || 999 }))
      .sort((a, b) => a.worldRank - b.worldRank);
    const updated = await statePost('configure', {
      apiKey, tournId, year,
      tournamentName: data.name || data.tournamentName || tournId,
      field,
    });
    setS(updated);
  });

  const addDrafter = () => {
    if (!newDrafter.trim()) return;
    if (s.drafters.includes(newDrafter.trim())) { setNewDrafter(''); return; }
    const drafters = [...s.drafters, newDrafter.trim()];
    setNewDrafter('');
    wrap(async () => { const u = await statePost('setDrafters', { drafters }); setS(u); });
  };

  const removeDrafter = (name) => {
    const drafters = s.drafters.filter(d => d !== name);
    wrap(async () => { const u = await statePost('setDrafters', { drafters }); setS(u); });
  };

  const startDraft = () => wrap(async () => {
    if (s.drafters.length < 2) throw new Error('Add at least 2 drafters.');
    const draftOrder = buildSnakeOrder(s.drafters.length, PICKS_PER_DRAFTER);
    const u = await statePost('startDraft', { draftOrder });
    setS(u); setTab('draft');
  });

  const makePick = (playerId, name) => wrap(async () => {
    const drafted = new Set(s.picks.map(p => p.playerId));
    if (drafted.has(playerId)) return;
    const pick = { pickIndex: s.currentPickIndex, drafterIndex: s.draftOrder[s.currentPickIndex], playerId, name };
    const u = await statePost('makePick', { pick });
    setS(u); setSearchQ('');
    if (u.draftComplete) { setTab('scores'); refreshScoresFrom(u); }
  });

  const refreshScores = () => wrap(async () => {
    const fresh = await stateGet();
    refreshScoresFrom(fresh);
  });

  const refreshScoresFrom = async (currentState) => {
    try {
      const data = await apiGet('leaderboards', { tournId: currentState.tournId, year: currentState.year });
      if (!data?.leaderboard) return;
      const scores = {};
      for (const p of data.leaderboard) {
        let total = p.total;
        if (typeof total === 'string') total = total === 'E' ? 0 : (parseInt(total) || 0);
        const rounds = (p.rounds || []).map(r => {
          let sc = r.score ?? r.toPar;
          if (typeof sc === 'string') sc = sc === 'E' ? 0 : (parseInt(sc) || null);
          return sc;
        });
        scores[p.playerId] = { total, rounds, status: p.status || 'active', pos: p.position || p.pos || '–', thru: p.thru || '–' };
      }
      const u = await statePost('updateScores', { scores });
      setS(u);
    } catch (e) { console.error('Score refresh failed:', e); }
  };

  const reset = async () => {
    if (!confirm('Reset all league data? This cannot be undone.')) return;
    await fetch('/api/state', { method: 'DELETE' });
    setS(await stateGet());
    setTab('draft');
  };

  // ── derived ──
  const drafted = new Set((s?.picks || []).map(p => p.playerId));
  const filteredField = (s?.field || [])
    .filter(p => p.name.toLowerCase().includes(searchQ.toLowerCase()))
    .slice(0, 20);

  const teams = s?.draftComplete ? buildTeams(s) : [];

  // ── render ──
  if (!s) return <div className="loading">Loading...</div>;

  const showSetup = !s.configured || s.drafters.length === 0 || !s.draftOrder?.length;

  return (
    <>
      <Head>
        <title>The Draft — Golf League</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      </Head>

      <header>
        <div className="logo">The <em>Draft</em></div>
        <div className="header-right">
          {s.tournamentName && <span className="badge">{s.tournamentName}</span>}
          {s.lastRefreshed && <span className="badge dim">↻ {new Date(s.lastRefreshed).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>}
          {s.draftComplete && <button className="btn-ghost" onClick={refreshScores} disabled={busy}>↻ Refresh</button>}
          <button className="btn-ghost danger" onClick={reset}>Reset</button>
        </div>
      </header>

      <main>
        {/* ── SETUP ── */}
        {showSetup && (
          <div className="panel">
            <h2>League Setup</h2>

            {!s.configured && (
              <>
                <div className="grid-4">
                  <div className="field">
                    <label>RapidAPI Key</label>
                    <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Your Slash Golf key" />
                  </div>
                  <div className="field">
                    <label>Tournament ID</label>
                    <input value={tournId} onChange={e => setTournId(e.target.value)} placeholder="e.g. 014" />
                  </div>
                  <div className="field">
                    <label>Year</label>
                    <input value={year} onChange={e => setYear(e.target.value)} placeholder="2026" />
                  </div>
                  <button className="btn" onClick={loadTournament} disabled={busy}>Load Field</button>
                </div>
                {err && <div className="error">{err}</div>}
              </>
            )}

            {s.configured && (
              <div className="configured-note">✓ Field loaded — {s.field.length} players · {s.tournamentName}</div>
            )}

            {s.configured && (
              <div className="drafter-section">
                <div className="field" style={{marginBottom:12}}>
                  <label>Add Drafters</label>
                  <div className="row-gap">
                    <input value={newDrafter} onChange={e => setNewDrafter(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addDrafter()}
                      placeholder="Drafter name..." />
                    <button className="btn" onClick={addDrafter} disabled={busy}>Add</button>
                  </div>
                </div>
                <div className="tags">
                  {s.drafters.map(d => (
                    <div key={d} className="tag">{d}<button onClick={() => removeDrafter(d)}>×</button></div>
                  ))}
                </div>
                {s.drafters.length >= 2 && (
                  <button className="btn" style={{marginTop:16}} onClick={startDraft} disabled={busy}>
                    Start Snake Draft ({s.drafters.length} drafters · {PICKS_PER_DRAFTER} picks each) →
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TABS ── */}
        {s.draftOrder?.length > 0 && (
          <>
            <div className="tabs">
              <button className={`tab ${tab==='draft'?'active':''}`} onClick={() => setTab('draft')}>Draft Board</button>
              <button className={`tab ${tab==='scores'?'active':''}`} onClick={() => setTab('scores')}>Scoreboard</button>
            </div>

            {/* DRAFT TAB */}
            {tab === 'draft' && (
              <div>
                {!s.draftComplete && (
                  <div className="panel search-panel">
                    <h3>
                      {(() => {
                        const curIdx = s.draftOrder[s.currentPickIndex];
                        return `Pick ${s.currentPickIndex + 1} of ${s.draftOrder.length} · On the clock: ${s.drafters[curIdx]}`;
                      })()}
                    </h3>
                    <div className="row-gap" style={{marginBottom:10}}>
                      <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search player..." />
                    </div>
                    <div className="results">
                      {filteredField.map(p => (
                        <div key={p.playerId}
                          className={`result-item ${drafted.has(p.playerId) ? 'drafted' : ''}`}
                          onClick={() => !drafted.has(p.playerId) && makePick(p.playerId, p.name)}>
                          <span>{p.name}</span>
                          <span className="muted">{p.worldRank < 999 ? `WR #${p.worldRank}` : ''} {drafted.has(p.playerId) ? '· drafted' : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {s.draftComplete && <div className="complete-banner">✓ Draft Complete</div>}

                <div className="section-title">Draft Board</div>
                <div className="pick-list">
                  {(s.draftOrder || []).map((drafterIdx, i) => {
                    const pick = s.picks[i];
                    const isCurrent = !s.draftComplete && i === s.currentPickIndex;
                    const roundNum = Math.floor(i / s.drafters.length) + 1;
                    return (
                      <div key={i} className={`pick-row ${isCurrent ? 'current' : ''} ${pick ? 'filled' : ''}`}>
                        <span className="pick-num">#{i + 1}</span>
                        <span className="pick-owner">{s.drafters[drafterIdx]}</span>
                        <span className={`pick-player ${!pick ? 'empty' : ''}`}>{pick ? pick.name : 'Waiting…'}</span>
                        <span className="pick-round">R{roundNum}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SCORES TAB */}
            {tab === 'scores' && (
              <div>
                {!s.draftComplete
                  ? <div className="empty-state">Complete the draft to see scores.</div>
                  : teams.length === 0
                    ? <div className="empty-state">No scores yet — hit Refresh.</div>
                    : (
                      <div className="scoreboard">
                        {teams.map((team, rank) => (
                          <div key={team.name} className={`team-card ${rank === 0 ? 'leader' : ''}`}>
                            <div className="team-header">
                              <span className={`team-rank ${rank === 0 ? 'gold' : ''}`}>{rank + 1}</span>
                              <span className="team-name">{team.name}</span>
                              <span className={`team-total ${scoreClass(team.teamTotal)}`}>{fmtScore(team.teamTotal)}</span>
                            </div>
                            <div className="team-golfers">
                              {team.golfers.map(g => (
                                <div key={g.playerId} className="golfer-row">
                                  <span className={`golfer-name ${g.counting ? 'counting' : 'nc'}`}>
                                    {g.name}
                                    {g.counting && <span className="star">★</span>}
                                    {!g.counting && <span className="ex">✕</span>}
                                  </span>
                                  <span className={`golfer-status ${g.cut ? 'cut' : ''}`}>
                                    {g.cut ? g.status.toUpperCase() : (g.thru !== '–' ? `T${g.thru}` : '')}
                                  </span>
                                  <span className={`golfer-score ${g.cut ? '' : scoreClass(g.total)}`}>
                                    {g.cut ? '–' : fmtScore(g.total)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                }
                {s.lastRefreshed && (
                  <div className="last-refreshed">Last updated: {new Date(s.lastRefreshed).toLocaleString()}</div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

// ── team scoring logic ────────────────────────────────────────────────────────
function buildTeams(s) {
  const teams = s.drafters.map((name, idx) => {
    const golfers = s.picks
      .filter(p => p.drafterIndex === idx)
      .map(p => {
        const sc = s.scores[p.playerId];
        const cut = sc?.status === 'cut' || sc?.status === 'wd';
        return {
          name: p.name,
          playerId: p.playerId,
          total: sc ? sc.total : null,
          status: sc?.status || 'unknown',
          thru: sc?.thru || '–',
          pos: sc?.pos || '–',
          cut,
          counting: false,
        };
      })
      .sort((a, b) => {
        if (a.cut && !b.cut) return 1;
        if (b.cut && !a.cut) return -1;
        if (a.total === null) return 1;
        if (b.total === null) return -1;
        return a.total - b.total;
      });

    const active = golfers.filter(g => !g.cut && g.total !== null);
    active.slice(0, 2).forEach(g => { g.counting = true; });
    const teamTotal = active.length >= 2 ? active[0].total + active[1].total : null;

    return { name, golfers, teamTotal };
  });

  return teams.sort((a, b) => {
    if (a.teamTotal === null) return 1;
    if (b.teamTotal === null) return -1;
    return a.teamTotal - b.teamTotal;
  });
}
