import { useState, useEffect, useRef } from "react";
import Head from "next/head";

const PICKS_PER_DRAFTER = 3;
const CURRENT_YEAR = new Date().getFullYear().toString();

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
  if (n === null || n === undefined) return "–";
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

function scoreClass(n) {
  if (n === null || n === undefined) return "";
  if (n < 0) return "under";
  if (n > 0) return "over";
  return "even";
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function getSecret() {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("league_secret") || "";
}

// ── Identity ─────────────────────────────────────────────────────────────────
function getMyName() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("drafter_name") || "";
}

function saveMyName(name) {
  localStorage.setItem("drafter_name", name);
}

function clearMyName() {
  localStorage.removeItem("drafter_name");
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function apiGet(path, params = {}) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  const res = await fetch(`/api/golf?${qs}`);
  if (!res.ok) throw new Error(`Golf API ${res.status}`);
  return res.json();
}

async function statePost(action, payload = {}) {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-league-secret": getSecret(),
    },
    body: JSON.stringify({ action, payload }),
  });
  if (res.status === 401) throw new Error("AUTH_REQUIRED");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `State API ${res.status}`);
  }
  return res.json();
}

async function stateGet() {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`State API ${res.status}`);
  return res.json();
}

async function stateDelete() {
  const res = await fetch("/api/state", {
    method: "DELETE",
    headers: { "x-league-secret": getSecret() },
  });
  if (res.status === 401) throw new Error("AUTH_REQUIRED");
  if (!res.ok) throw new Error(`State API ${res.status}`);
  return res.json();
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [s, setS] = useState(null); // server state
  const [tab, setTab] = useState("draft");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [searchQ, setSearchQ] = useState("");

  // identity
  const [myName, setMyNameState] = useState("");

  // setup form
  const [schedule, setSchedule] = useState(null);
  const [selectedTournId, setSelectedTournId] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  // lobby join
  const [joinName, setJoinName] = useState("");
  const [addDrafterName, setAddDrafterName] = useState("");

  // commissioner
  const [assignDrafter, setAssignDrafter] = useState("");
  const [assignSearch, setAssignSearch] = useState("");

  const pollingRef = useRef(null);
  const refreshRef = useRef(null);

  const [loadError, setLoadError] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [secretInput, setSecretInput] = useState("");

  const wrap = async (fn) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      if (e.message === "AUTH_REQUIRED") {
        setNeedsAuth(true);
        return;
      }
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // initial load
  useEffect(() => {
    stateGet()
      .then((data) => {
        setS(data);
        if (data.draftComplete) setTab("scores");
      })
      .catch(() => setLoadError(true));
    setMyNameState(getMyName());
  }, []);

  // clear stale identity if name not in drafters list (unless commissioner)
  useEffect(() => {
    if (s && myName && !s.drafters.includes(myName) && s.commissionerName !== myName) {
      clearMyName();
      setMyNameState("");
    }
  }, [s, myName]);

  // auto-fetch schedule on mount (for setup)
  useEffect(() => {
    if (s && !s.configured && !schedule && !loadingSchedule) {
      fetchSchedule();
    }
  }, [s?.configured]);

  // poll during lobby and draft (every 5s) for live updates
  useEffect(() => {
    if (s?.configured && !s?.draftComplete) {
      const interval = setInterval(async () => {
        try {
          setS(await stateGet());
        } catch {}
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [s?.configured, s?.draftComplete, s?.currentPickIndex]);

  // auto-refresh scores every 2 min when draft complete
  useEffect(() => {
    if (s?.draftComplete) {
      pollingRef.current = setInterval(() => refreshRef.current?.(), 120_000);
    }
    return () => clearInterval(pollingRef.current);
  }, [s?.draftComplete]);

  // derived identity
  const isCreator = myName && (s?.creator === myName || s?.commissionerName === myName);
  const isJoined = myName && s?.drafters?.includes(myName);
  const currentDrafterIdx =
    s?.draftOrder?.length > 0 ? s.draftOrder[s.currentPickIndex] : null;
  const currentDrafterName =
    currentDrafterIdx !== null ? s?.drafters?.[currentDrafterIdx] : null;
  const isMyTurn =
    isJoined &&
    !s?.draftComplete &&
    s?.draftOrder?.length > 0 &&
    currentDrafterName === myName;

  // ── handlers ──
  const fetchSchedule = async () => {
    setLoadingSchedule(true);
    setErr("");
    try {
      const data = await apiGet("schedule", { year: CURRENT_YEAR });
      const list =
        data?.schedule || data?.schedules || (Array.isArray(data) ? data : []);
      if (!list.length) throw new Error("No schedule found for this year.");
      setSchedule(list);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoadingSchedule(false);
    }
  };

  const loadTournament = () =>
    wrap(async () => {
      if (!selectedTournId || !creatorName.trim())
        throw new Error("Select a tournament and enter your name.");
      const selectedTourn = schedule?.find(
        (t) => (t.tournId || t.id) === selectedTournId,
      );
      const data = await apiGet("tournament", {
        tournId: selectedTournId,
        year: CURRENT_YEAR,
      });
      if (!data?.players)
        throw new Error("No player data — check tournament selection.");
      const field = data.players
        .filter((p) => p.status !== "wd")
        .map((p) => {
          const name =
            p.firstName && p.lastName
              ? `${p.firstName} ${p.lastName}`
              : p.playerName || p.name || p.playerId;
          return { playerId: p.playerId, name, worldRank: p.worldRank || 999 };
        })
        .sort((a, b) => a.worldRank - b.worldRank);
      const tournName =
        data.name ||
        data.tournamentName ||
        selectedTourn?.name ||
        selectedTournId;
      const updated = await statePost("configure", {
        tournId: selectedTournId,
        year: CURRENT_YEAR,
        tournamentName: tournName,
        field,
        creator: creatorName.trim(),
      });
      saveMyName(creatorName.trim());
      setMyNameState(creatorName.trim());
      setS(updated);
    });

  const joinDraft = () =>
    wrap(async () => {
      const name = joinName.trim();
      if (!name) throw new Error("Enter your name.");
      const u = await statePost("joinDraft", { name });
      saveMyName(name);
      setMyNameState(name);
      setJoinName("");
      setS(u);
    });

  const leaveDraft = () =>
    wrap(async () => {
      const u = await statePost("leaveDraft", { name: myName });
      clearMyName();
      setMyNameState("");
      setS(u);
    });

  const addDrafter = () =>
    wrap(async () => {
      const name = addDrafterName.trim();
      if (!name) throw new Error("Enter a name.");
      const u = await statePost("addDrafter", { name, creatorName: myName });
      setAddDrafterName("");
      setS(u);
    });

  const assignGolferToDrafter = (playerId, playerName) =>
    wrap(async () => {
      if (!assignDrafter) throw new Error("Select a drafter first.");
      const u = await statePost("assignGolfer", {
        creatorName: myName,
        drafterName: assignDrafter,
        playerId,
        playerName,
      });
      setAssignSearch("");
      setS(u);
    });

  const startDraft = () =>
    wrap(async () => {
      if (s.drafters.length < 2)
        throw new Error("Need at least 2 drafters to start.");
      const draftOrder = buildSnakeOrder(s.drafters.length, PICKS_PER_DRAFTER);
      const u = await statePost("startDraft", {
        draftOrder,
        creatorName: myName,
      });
      setS(u);
      setTab("draft");
    });

  const makePick = (playerId, name) =>
    wrap(async () => {
      const drafted = new Set(s.picks.map((p) => p.playerId));
      if (drafted.has(playerId)) return;
      const pick = {
        pickIndex: s.currentPickIndex,
        drafterIndex: s.draftOrder[s.currentPickIndex],
        playerId,
        name,
      };
      const res = await fetch("/api/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-league-secret": getSecret(),
        },
        body: JSON.stringify({
          action: "makePick",
          payload: { pick, drafterName: myName },
        }),
      });
      if (res.status === 401) throw new Error("AUTH_REQUIRED");
      const data = await res.json();
      if (res.status === 409 && data.state) {
        setS(data.state);
        throw new Error(data.error);
      }
      if (!res.ok) throw new Error(data.error || `State API ${res.status}`);
      setS(data);
      setSearchQ("");
      if (data.draftComplete) {
        setTab("scores");
        await refreshScoresFrom(data);
      }
    });

  const refreshScores = () =>
    wrap(async () => {
      const fresh = await stateGet();
      await refreshScoresFrom(fresh);
    });

  refreshRef.current = refreshScores;

  const refreshScoresFrom = async (currentState) => {
    try {
      const data = await apiGet("leaderboard", {
        tournId: currentState.tournId,
        year: currentState.year,
      });
      const rows = data?.leaderboardRows;
      if (!rows) return;
      const scores = {};
      for (const p of rows) {
        let total = p.total;
        if (typeof total === "string")
          total = total === "E" ? 0 : parseInt(total) || 0;
        const rounds = (p.rounds || []).map((r) => {
          let sc = r.scoreToPar ?? r.score ?? r.toPar;
          if (typeof sc === "string")
            sc = sc === "E" ? 0 : parseInt(sc) || null;
          return sc;
        });
        // Parse MongoDB $numberInt format: {"$numberInt":"1"} → 1
        const parseNum = (v) => {
          if (typeof v === 'number') return v;
          if (v && typeof v === 'object' && v.$numberInt) return parseInt(v.$numberInt) || null;
          return parseInt(v) || null;
        };
        const hole = parseNum(p.currentHole);
        const curRound = parseNum(p.currentRound);
        // Determine thru status
        let thru;
        if (p.status === 'complete') thru = 'F';
        else if (p.roundComplete) thru = 'F';
        else if (p.thru && p.thru !== '') thru = p.thru;
        else if (p.status === 'not started') thru = p.teeTime || 'Not started';
        else if (hole && hole > 1) thru = `${hole}`;
        else thru = '–';
        scores[p.playerId] = {
          total,
          rounds,
          status: p.status || "active",
          pos: p.position || "–",
          thru,
          currentRound: curRound,
        };
      }
      const u = await statePost("updateScores", { scores });
      setS(u);
    } catch (e) {
      console.error("Score refresh failed:", e);
    }
  };

  const reset = () =>
    wrap(async () => {
      if (!confirm("Reset all league data? This cannot be undone.")) return;
      await stateDelete();
      clearMyName();
      setMyNameState("");
      setSchedule(null);
      setS(await stateGet());
      setTab("draft");
    });

  // ── derived ──
  const drafted = new Set((s?.picks || []).map((p) => p.playerId));
  const filteredField = (s?.field || [])
    .filter((p) => p.name.toLowerCase().includes(searchQ.toLowerCase()))
    .slice(0, 20);

  const teams = s?.draftComplete ? buildTeams(s) : [];

  // ── render ──
  const handleLogin = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretInput }),
      });
      if (!res.ok) {
        setErr("Wrong password.");
        return;
      }
      sessionStorage.setItem("league_secret", secretInput);
      setNeedsAuth(false);
      setSecretInput("");
    } finally {
      setBusy(false);
    }
  };

  if (needsAuth)
    return (
      <div className="loading">
        <h2>League Password</h2>
        <p>Enter the league password to make changes.</p>
        <div className="row-gap" style={{ marginTop: 12 }}>
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Password..."
          />
          <button className="btn" onClick={handleLogin} disabled={busy}>
            Enter
          </button>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
    );

  if (loadError)
    return (
      <div className="loading">
        <p>Failed to connect to the server.</p>
        <button
          className="btn"
          onClick={() => {
            setLoadError(false);
            stateGet()
              .then(setS)
              .catch(() => setLoadError(true));
          }}
        >
          Retry
        </button>
      </div>
    );
  if (!s) return <div className="loading">Loading...</div>;

  // App phases
  const inLobby = s.configured && !s.draftOrder?.length;
  const inDraft = s.draftOrder?.length > 0 && !s.draftComplete;
  const draftDone = s.draftComplete;

  return (
    <>
      <Head>
        <title>The Draft — Golf League</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <header>
        <div className="logo">{s?.tournamentName || "The Masters"}</div>
        <div className="header-right">
          {myName && <span className="badge dim">{myName}</span>}
          {s.lastRefreshed && (
            <span className="badge dim">
              ↻{" "}
              {new Date(s.lastRefreshed).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {draftDone && (
            <button
              className="btn-ghost"
              onClick={refreshScores}
              disabled={busy}
            >
              ↻ Refresh
            </button>
          )}
          <button className="btn-ghost danger" onClick={reset}>
            Reset
          </button>
        </div>
      </header>

      <main>
        {/* ── IDENTIFY: prompt for name when not recognized ── */}
        {!myName && !isCreator && s.configured && (s.draftOrder?.length > 0 || s.draftComplete) && (
          <div className="panel">
            <h2>Who are you?</h2>
            <div className="field">
              <label>Enter your name to continue</label>
              <div className="row-gap">
                <input
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && joinName.trim()) {
                      saveMyName(joinName.trim());
                      setMyNameState(joinName.trim());
                      setJoinName("");
                    }
                  }}
                  placeholder="Your name..."
                />
                <button
                  className="btn"
                  onClick={() => {
                    if (joinName.trim()) {
                      saveMyName(joinName.trim());
                      setMyNameState(joinName.trim());
                      setJoinName("");
                    }
                  }}
                >
                  Go
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── SETUP: Tournament Picker ── */}
        {!s.configured && (
          <div className="panel">
            <h2>Create a League</h2>

            {loadingSchedule && (
              <div className="empty-state">Loading tournament schedule...</div>
            )}

            {!loadingSchedule && schedule && (
              <>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Tournament ({CURRENT_YEAR})</label>
                  <select
                    value={selectedTournId}
                    onChange={(e) => setSelectedTournId(e.target.value)}
                  >
                    <option value="" disabled>
                      Select a tournament...
                    </option>
                    {schedule.map((t) => {
                      const id = t.tournId || t.id;
                      const name = t.name || t.tournamentName || id;
                      const dates = t.startDate ? ` — ${t.startDate}` : "";
                      return (
                        <option key={id} value={id}>
                          {name}
                          {dates}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Your Name</label>
                  <input
                    value={creatorName}
                    onChange={(e) => setCreatorName(e.target.value)}
                    placeholder="Enter your name..."
                  />
                </div>

                <button
                  className="btn"
                  onClick={loadTournament}
                  disabled={busy || !selectedTournId || !creatorName.trim()}
                >
                  Create League
                </button>
              </>
            )}

            {!loadingSchedule && !schedule && (
              <div>
                <div className="empty-state">
                  Could not load tournament schedule.
                </div>
                <button
                  className="btn"
                  onClick={fetchSchedule}
                  style={{ marginTop: 8 }}
                >
                  Retry
                </button>
              </div>
            )}

            {err && <div className="error">{err}</div>}
          </div>
        )}

        {/* ── LOBBY: Join & Wait ── */}
        {inLobby && (
          <div className="panel">
            <h2>Lobby</h2>
            <div className="configured-note">
              {s.tournamentName} — {s.field.length} players in field
            </div>

            <div className="drafter-section">
              <div className="section-title" style={{ marginTop: 16 }}>
                Drafters ({s.drafters.length})
              </div>
              <div className="tags">
                {s.drafters.map((d) => (
                  <div key={d} className="tag">
                    {d}
                    {d === s.creator ? " (host)" : ""}
                    {d === myName && d !== s.creator && (
                      <button onClick={leaveDraft} disabled={busy}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {!isJoined && (
                <div className="field" style={{ marginTop: 16 }}>
                  <label>Join the Draft</label>
                  <div className="row-gap">
                    <input
                      value={joinName}
                      onChange={(e) => setJoinName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && joinDraft()}
                      placeholder="Your name..."
                    />
                    <button className="btn" onClick={joinDraft} disabled={busy}>
                      Join
                    </button>
                  </div>
                </div>
              )}

              {isCreator && (
                <div className="field" style={{ marginTop: 16 }}>
                  <label>Add Drafter</label>
                  <div className="row-gap">
                    <input
                      value={addDrafterName}
                      onChange={(e) => setAddDrafterName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addDrafter()}
                      placeholder="Drafter name..."
                    />
                    <button
                      className="btn"
                      onClick={addDrafter}
                      disabled={busy}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {isCreator && s.drafters.length >= 2 && (
                <button
                  className="btn"
                  style={{ marginTop: 16 }}
                  onClick={startDraft}
                  disabled={busy}
                >
                  Start Snake Draft ({s.drafters.length} drafters ·{" "}
                  {PICKS_PER_DRAFTER} picks each)
                </button>
              )}

              {isCreator && s.drafters.length < 2 && (
                <div className="empty-state" style={{ marginTop: 12 }}>
                  Waiting for more drafters to join...
                </div>
              )}

              {isJoined && !isCreator && (
                <div className="empty-state" style={{ marginTop: 12 }}>
                  Waiting for {s.creator} to start the draft...
                </div>
              )}
            </div>

            {err && <div className="error">{err}</div>}
          </div>
        )}

        {/* ── TABS ── */}
        {s.draftOrder?.length > 0 && (
          <>
            <div className="tabs">
              <button
                className={`tab ${tab === "draft" ? "active" : ""}`}
                onClick={() => setTab("draft")}
              >
                Draft Board
              </button>
              <button
                className={`tab ${tab === "scores" ? "active" : ""}`}
                onClick={() => setTab("scores")}
              >
                Scoreboard
              </button>
            </div>

            {/* DRAFT TAB */}
            {tab === "draft" && (
              <div>
                {inDraft && (isMyTurn || isCreator) && (
                  <div className="panel search-panel">
                    <h3>
                      {isMyTurn
                        ? "Your Pick!"
                        : `Picking for ${currentDrafterName}`}{" "}
                      — Pick {s.currentPickIndex + 1} of {s.draftOrder.length}
                    </h3>
                    <div className="row-gap" style={{ marginBottom: 10 }}>
                      <input
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        placeholder="Search player..."
                      />
                    </div>
                    <div className="results">
                      {filteredField.map((p) => (
                        <div
                          key={p.playerId}
                          className={`result-item ${drafted.has(p.playerId) ? "drafted" : ""}`}
                          onClick={() =>
                            !drafted.has(p.playerId) &&
                            makePick(p.playerId, p.name)
                          }
                        >
                          <span>{p.name}</span>
                          <span className="muted">
                            {p.worldRank < 999 ? `WR #${p.worldRank}` : ""}{" "}
                            {drafted.has(p.playerId) ? "· drafted" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {inDraft && !isMyTurn && !isCreator && (
                  <div className="panel">
                    <h3>
                      Pick {s.currentPickIndex + 1} of {s.draftOrder.length}
                    </h3>
                    <div className="empty-state">
                      Waiting for {currentDrafterName} to pick...
                    </div>
                  </div>
                )}

                {draftDone && (
                  <div className="complete-banner">Draft Complete</div>
                )}

                <div className="section-title">Draft Board</div>
                <div className="pick-list">
                  {(s.draftOrder || []).map((drafterIdx, i) => {
                    const pick = s.picks[i];
                    const isCurrent = inDraft && i === s.currentPickIndex;
                    const roundNum = Math.floor(i / s.drafters.length) + 1;
                    return (
                      <div
                        key={i}
                        className={`pick-row ${isCurrent ? "current" : ""} ${pick ? "filled" : ""}`}
                      >
                        <span className="pick-num">#{i + 1}</span>
                        <span className="pick-owner">
                          {s.drafters[drafterIdx]}
                        </span>
                        <span className={`pick-player ${!pick ? "empty" : ""}`}>
                          {pick ? pick.name : "Waiting..."}
                        </span>
                        <span className="pick-round">R{roundNum}</span>
                      </div>
                    );
                  })}
                </div>

                {err && <div className="error">{err}</div>}
              </div>
            )}

            {/* SCORES TAB */}
            {tab === "scores" && (
              <div>
                {!draftDone ? (
                  <div className="empty-state">
                    Complete the draft to see scores.
                  </div>
                ) : teams.length === 0 ? (
                  <div className="empty-state">
                    No scores yet — hit Refresh.
                  </div>
                ) : (
                  <div className="scoreboard">
                    {teams.map((team, rank) => (
                      <div
                        key={team.name}
                        className={`team-card ${rank === 0 ? "leader" : ""}`}
                      >
                        <div className="team-header">
                          <span
                            className={`team-rank ${rank === 0 ? "gold" : ""}`}
                          >
                            {team.displayPos}
                          </span>
                          <span className="team-name">{team.name}</span>
                          <span
                            className={`team-total ${scoreClass(team.teamTotal)}`}
                          >
                            {fmtScore(team.teamTotal)}
                          </span>
                        </div>
                        <div className="team-golfers">
                          {team.golfers.map((g) => (
                            <div key={g.playerId} className="golfer-row">
                              <span
                                className={`golfer-name ${g.counting ? "counting" : "nc"}`}
                              >
                                {g.name}
                                {g.counting && <span className="star">★</span>}
                                {!g.counting && <span className="ex">✕</span>}
                              </span>
                              <span
                                className={`golfer-status ${g.cut ? "cut" : ""}`}
                              >
                                {g.cut
                                  ? g.status.toUpperCase()
                                  : g.thru === "F"
                                    ? "Done"
                                    : g.thru === "–"
                                      ? ""
                                      : /^\d+$/.test(g.thru)
                                        ? `Thru ${g.thru}`
                                        : g.thru}
                              </span>
                              <span
                                className={`golfer-score ${g.cut ? "" : scoreClass(g.total)}`}
                              >
                                {g.cut ? "–" : fmtScore(g.total)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {s.lastRefreshed && (
                  <div className="last-refreshed">
                    Last updated: {new Date(s.lastRefreshed).toLocaleString()}
                  </div>
                )}

                {/* COMMISSIONER PANEL */}
                {isCreator && (
                  <div className="panel" style={{ marginTop: 16 }}>
                    <h3>Commissioner</h3>

                    <div className="field" style={{ marginBottom: 12 }}>
                      <label>Add Drafter</label>
                      <div className="row-gap">
                        <input
                          value={addDrafterName}
                          onChange={(e) => setAddDrafterName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addDrafter()}
                          placeholder="Drafter name..."
                        />
                        <button className="btn" onClick={addDrafter} disabled={busy}>
                          Add
                        </button>
                      </div>
                    </div>

                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>Assign Golfer to Drafter</label>
                      <select
                        value={assignDrafter}
                        onChange={(e) => setAssignDrafter(e.target.value)}
                        style={{ marginBottom: 8 }}
                      >
                        <option value="" disabled>
                          Select drafter...
                        </option>
                        {s.drafters.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      {assignDrafter && (
                        <>
                          <input
                            value={assignSearch}
                            onChange={(e) => setAssignSearch(e.target.value)}
                            placeholder="Search player..."
                            style={{ marginBottom: 6 }}
                          />
                          <div className="results" style={{ maxHeight: 200 }}>
                            {(s.field || [])
                              .filter((p) =>
                                p.name.toLowerCase().includes(assignSearch.toLowerCase()),
                              )
                              .slice(0, 15)
                              .map((p) => {
                                const taken = (s.picks || []).some(
                                  (pk) => pk.playerId === p.playerId,
                                );
                                return (
                                  <div
                                    key={p.playerId}
                                    className={`result-item ${taken ? "drafted" : ""}`}
                                    onClick={() =>
                                      !taken &&
                                      assignGolferToDrafter(p.playerId, p.name)
                                    }
                                  >
                                    <span>{p.name}</span>
                                    <span className="muted">
                                      {p.worldRank < 999 ? `WR #${p.worldRank}` : ""}
                                      {taken ? " · drafted" : ""}
                                    </span>
                                  </div>
                                );
                              })}
                          </div>
                        </>
                      )}
                    </div>

                    {err && <div className="error">{err}</div>}
                  </div>
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
      .filter((p) => p.drafterIndex === idx)
      .map((p) => {
        const sc = s.scores[p.playerId];
        const cut = sc?.status === "cut" || sc?.status === "wd";
        return {
          name: p.name,
          playerId: p.playerId,
          total: sc ? sc.total : null,
          status: sc?.status || "unknown",
          thru: typeof sc?.thru === 'string' || typeof sc?.thru === 'number' ? sc.thru : "–",
          pos: sc?.pos || "–",
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

    const active = golfers.filter((g) => !g.cut && g.total !== null);
    active.slice(0, 2).forEach((g) => {
      g.counting = true;
    });
    const teamTotal =
      active.length >= 2 ? active[0].total + active[1].total : null;

    return { name, golfers, teamTotal };
  });

  const sorted = teams.sort((a, b) => {
    if (a.teamTotal === null) return 1;
    if (b.teamTotal === null) return -1;
    return a.teamTotal - b.teamTotal;
  });

  // Assign positions with ties (e.g. T1, T2)
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].teamTotal === null) { sorted[i].position = '–'; continue; }
    const pos = i > 0 && sorted[i].teamTotal === sorted[i - 1].teamTotal
      ? sorted[i - 1].position
      : i + 1;
    sorted[i].position = pos;
  }
  for (const t of sorted) {
    const tied = sorted.filter(o => o.position === t.position && o.teamTotal !== null).length > 1;
    t.displayPos = t.teamTotal === null ? '–' : tied ? `T${t.position}` : `${t.position}`;
  }

  return sorted;
}
