import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import { useSession, signIn, signOut } from "next-auth/react";

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

function buildDraftGrid(drafters, draftOrder, picks) {
  // grid[drafterIndex][round] = pick object or null
  const rounds = Math.ceil(draftOrder.length / drafters.length);
  const grid = drafters.map(() => Array(rounds).fill(null));
  const roundCount = drafters.map(() => 0);

  draftOrder.forEach((drafterIdx, i) => {
    const round = roundCount[drafterIdx]++;
    if (picks[i]) grid[drafterIdx][round] = picks[i];
  });

  // Current pick position: which drafter + which round cell is active
  const currentSlot = picks.filter(Boolean).length; // next unfilled slot index

  // Recompute current round properly
  const currentRoundCount = drafters.map(() => 0);
  for (let i = 0; i < currentSlot; i++) {
    currentRoundCount[draftOrder[i]]++;
  }
  const activeDrafterIdx = draftOrder[currentSlot] ?? -1;
  const activeRound = activeDrafterIdx >= 0 ? currentRoundCount[activeDrafterIdx] : -1;

  return { grid, rounds, activeDrafterIdx, activeRound };
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
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 401) throw new Error("AUTH_REQUIRED");
  if (!res.ok) throw new Error(`State API ${res.status}`);
  return res.json();
}

// ── Auth Screen ───────────────────────────────────────────────────────────────
function AuthScreen() {
  const [authTab, setAuthTab] = useState("login");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register form state
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regVenmo, setRegVenmo] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const result = await signIn("credentials", {
        email: loginEmail,
        password: loginPassword,
        redirect: false,
      });
      if (result?.error) {
        setErr("Invalid email or password.");
      }
    } catch {
      setErr("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: regName,
          email: regEmail,
          password: regPassword,
          venmoHandle: regVenmo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Registration failed. Please try again.");
        return;
      }
      // Auto-login after successful registration
      const result = await signIn("credentials", {
        email: regEmail,
        password: regPassword,
        redirect: false,
      });
      if (result?.error) {
        setSuccessMsg("Account created! Please sign in.");
        setAuthTab("login");
        setLoginEmail(regEmail);
      }
    } catch {
      setErr("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Password strength
  const getStrength = (pw) => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw) || /[^a-zA-Z0-9]/.test(pw)) score++;
    return score;
  };
  const strengthScore = getStrength(regPassword);
  const strengthClass = strengthScore <= 1 ? "weak" : strengthScore <= 2 ? "medium" : "strong";

  return (
    <>
      <Head>
        <title>Sign In — Golf League</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <header>
        <div className="logo">Randy Sucks Golf League</div>
      </header>

      <div className="auth-container">
        <div className="auth-card">
          {/* Tab switcher */}
          <div className="auth-tabs">
            <button
              className={`auth-tab ${authTab === "login" ? "active" : ""}`}
              onClick={() => { setAuthTab("login"); setErr(""); setSuccessMsg(""); }}
            >
              Log In
            </button>
            <button
              className={`auth-tab ${authTab === "register" ? "active" : ""}`}
              onClick={() => { setAuthTab("register"); setErr(""); setSuccessMsg(""); }}
            >
              Create Account
            </button>
          </div>

          {/* Success message */}
          {successMsg && (
            <div className="auth-success" role="status">{successMsg}</div>
          )}

          {/* Error message */}
          {err && (
            <div className="auth-error" role="alert">{err}</div>
          )}

          {/* LOGIN FORM */}
          {authTab === "login" && (
            <form onSubmit={handleLogin}>
              <div className="auth-title">Welcome Back</div>
              <div className="auth-subtitle">Sign in to your account</div>

              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="Enter your password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              <button className="btn-auth-primary" type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign In"}
              </button>

              <div className="auth-switch">
                <span>No account? </span>
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => { setAuthTab("register"); setErr(""); }}
                >
                  Create one
                </button>
              </div>
            </form>
          )}

          {/* REGISTER FORM */}
          {authTab === "register" && (
            <form onSubmit={handleRegister}>
              <div className="auth-title">Join the League</div>
              <div className="auth-subtitle">Create your account</div>

              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="How you'll appear in drafts"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  required
                  autoComplete="name"
                />
                <div className="form-hint">This is the name shown on the draft board and scoreboard</div>
              </div>

              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="you@example.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
                {regPassword.length > 0 && (
                  <div className="password-strength">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`strength-bar ${i <= strengthScore ? strengthClass : ""}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="auth-section-heading">Get Paid</div>

              <div className="form-group">
                <label className="form-label">Venmo Username</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="@your-venmo (optional)"
                  value={regVenmo}
                  onChange={(e) => setRegVenmo(e.target.value)}
                  autoComplete="off"
                />
                <div className="form-hint">Venmo handle (optional) — for collecting your winnings</div>
              </div>

              <button className="btn-auth-primary" type="submit" disabled={busy}>
                {busy ? "Creating account…" : "Create Account"}
              </button>

              <div className="auth-switch">
                <span>Already have an account? </span>
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => { setAuthTab("login"); setErr(""); }}
                >
                  Sign in
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  const { data: session, status } = useSession();

  const [s, setS] = useState(null); // server state
  const [tab, setTab] = useState("draft");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [searchQ, setSearchQ] = useState("");

  // setup form
  const [schedule, setSchedule] = useState(null);
  const [selectedTournId, setSelectedTournId] = useState("");
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  // lobby join
  const [addDrafterName, setAddDrafterName] = useState("");

  // commissioner
  const [assignDrafter, setAssignDrafter] = useState("");
  const [assignSearch, setAssignSearch] = useState("");

  const [highlightIndex, setHighlightIndex] = useState(-1);
  const resultsRef = useRef(null);

  const pollingRef = useRef(null);
  const refreshRef = useRef(null);

  const [loadError, setLoadError] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");

  // Derived from session
  const myName = session?.user?.name || "";
  const isCommissioner = session?.user?.isCommissioner || false;

  const wrap = async (fn) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // initial load
  useEffect(() => {
    if (status === "authenticated") {
      stateGet()
        .then((data) => {
          setS(data);
          if (data.draftComplete) setTab("scores");
        })
        .catch(() => setLoadError(true));
    }
  }, [status]);

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
  const isCreator =
    myName && (s?.creator === myName || isCommissioner);
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
      if (!selectedTournId)
        throw new Error("Select a tournament.");
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
      });
      setS(updated);
    });

  const joinDraft = () =>
    wrap(async () => {
      const u = await statePost("joinDraft", {});
      setS(u);
    });

  const leaveDraft = () =>
    wrap(async () => {
      const u = await statePost("leaveDraft", {});
      setS(u);
    });

  const addDrafter = () =>
    wrap(async () => {
      const name = addDrafterName.trim();
      if (!name) throw new Error("Enter a name.");
      const u = await statePost("addDrafter", { name });
      setAddDrafterName("");
      setS(u);
    });

  const assignGolferToDrafter = (playerId, playerName) =>
    wrap(async () => {
      if (!assignDrafter) throw new Error("Select a drafter first.");
      const u = await statePost("assignGolfer", {
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
        },
        body: JSON.stringify({
          action: "makePick",
          payload: { pick },
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
          if (typeof v === "number") return v;
          if (v && typeof v === "object" && v.$numberInt)
            return parseInt(v.$numberInt) || null;
          return parseInt(v) || null;
        };
        const hole = parseNum(p.currentHole);
        const curRound = parseNum(p.currentRound);
        // Determine thru status
        let thru;
        if (p.status === "complete") thru = "F";
        else if (p.roundComplete) thru = "F";
        else if (p.thru && p.thru !== "") thru = p.thru;
        else if (p.status === "not started") thru = p.teeTime || "Not started";
        else if (hole && hole > 1) thru = `${hole}`;
        else thru = "–";
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
      setLiveMsg('Scores updated');
      setTimeout(() => setLiveMsg(''), 3000);
    } catch (e) {
      console.error("Score refresh failed:", e);
    }
  };

  const reset = () =>
    wrap(async () => {
      if (!confirm("Reset all league data? This cannot be undone.")) return;
      await stateDelete();
      setSchedule(null);
      setS(await stateGet());
      setTab("draft");
    });

  // scroll highlighted result into view
  useEffect(() => {
    if (highlightIndex >= 0 && resultsRef.current) {
      const items = resultsRef.current.querySelectorAll('.result-item');
      if (items[highlightIndex]) {
        items[highlightIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightIndex]);

  // ── Render: loading spinner while session loads ──
  if (status === "loading") {
    return <div className="loading">Loading...</div>;
  }

  // ── Render: auth screen when not logged in ──
  if (status === "unauthenticated") {
    return <AuthScreen />;
  }

  // ── Render: load error ──
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

  // ── derived ──
  const lastPickIndex = (s?.currentPickIndex ?? 0) - 1;
  const lastPick = lastPickIndex >= 0 ? (s?.picks?.[lastPickIndex] ?? null) : null;
  const lastPickDrafter = lastPick ? s.drafters[lastPick.drafterIndex] : null;
  const lastPickRound = lastPick && s.drafters.length > 0
    ? Math.floor(lastPickIndex / s.drafters.length) + 1
    : null;

  const drafted = new Set((s?.picks || []).map((p) => p.playerId));
  const filteredField = (s?.field || [])
    .filter((p) => p.name.toLowerCase().includes(searchQ.toLowerCase()))
    .slice(0, 20);

  const teams = s?.draftComplete ? buildTeams(s, s.previousRankings) : [];

  const tournamentComplete =
    s?.draftComplete &&
    teams.length > 0 &&
    (s?.picks || []).length > 0 &&
    (s?.picks || []).every((p) => {
      const sc = s.scores?.[p.playerId];
      return (
        sc && (sc.thru === "F" || sc.status === "cut" || sc.status === "wd")
      );
    });

  // App phases
  const inLobby = s.configured && !s.draftOrder?.length;
  const inDraft = s.draftOrder?.length > 0 && !s.draftComplete;
  const draftDone = s.draftComplete;

  return (
    <>
      <a href="#main-content" className="skip-nav">Skip to main content</a>
      <div role="status" aria-live="polite" className="sr-only">{liveMsg}</div>
      <Head>
        <title>
          {!s?.configured ? 'Setup — Golf League'
            : inLobby ? 'Lobby — Golf League'
            : inDraft ? 'Draft — Golf League'
            : 'Scoreboard — Golf League'}
        </title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <header>
        <div className="logo">{s?.tournamentName || "The Masters"}</div>
        <div className="header-right">
          {myName && (
            <span className="badge dim">
              {myName}
              {isCommissioner && (
                <span className="commissioner-star" title="Commissioner" aria-label="Commissioner">★</span>
              )}
            </span>
          )}
          {s.lastRefreshed && (
            <span className="badge dim timestamp">
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
              ↻<span className="refresh-label"> Refresh</span>
            </button>
          )}
          {isCreator && (
            <button className="btn-ghost danger" onClick={reset}>
              Reset
            </button>
          )}
          <button
            className="btn-ghost"
            onClick={() => signOut()}
          >
            Log out
          </button>
        </div>
      </header>

      <main id="main-content">
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

                <button
                  className="btn"
                  onClick={loadTournament}
                  disabled={busy || !selectedTournId}
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

            {err && <div className="error" role="alert">{err}</div>}
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
                      <button onClick={leaveDraft} disabled={busy} aria-label={`Remove ${d}`}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {!isJoined && (
                <div className="field" style={{ marginTop: 16 }}>
                  <button className="btn" onClick={joinDraft} disabled={busy}>
                    Join as {myName}
                  </button>
                </div>
              )}

              {isJoined && !isCreator && (
                <div className="empty-state" style={{ marginTop: 12 }}>
                  You&apos;re in! Waiting for {s.creator} to start the draft...
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
            </div>

            {err && <div className="error" role="alert">{err}</div>}
          </div>
        )}

        {/* ── TABS ── */}
        {s.draftOrder?.length > 0 && (
          <>
            <div className="tabs" role="tablist">
              <button
                className={`tab ${tab === "draft" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "draft"}
                aria-controls="panel-draft"
                onClick={() => setTab("draft")}
              >
                Draft Board
              </button>
              <button
                className={`tab ${tab === "scores" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "scores"}
                aria-controls="panel-scores"
                onClick={() => setTab("scores")}
              >
                Scoreboard
              </button>
            </div>

            {/* DRAFT TAB */}
            {tab === "draft" && (
              <div role="tabpanel" id="panel-draft">
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
                        aria-label="Search player"
                        value={searchQ}
                        onChange={(e) => { setSearchQ(e.target.value); setHighlightIndex(-1); }}
                        placeholder="Search player..."
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setHighlightIndex(prev => {
                              let next = prev + 1;
                              while (next < filteredField.length && drafted.has(filteredField[next].playerId)) next++;
                              return next < filteredField.length ? next : prev;
                            });
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setHighlightIndex(prev => {
                              let next = prev - 1;
                              while (next >= 0 && drafted.has(filteredField[next].playerId)) next--;
                              return next >= 0 ? next : prev;
                            });
                          } else if (e.key === 'Enter') {
                            if (highlightIndex >= 0 && highlightIndex < filteredField.length) {
                              const p = filteredField[highlightIndex];
                              if (!drafted.has(p.playerId)) makePick(p.playerId, p.name);
                            }
                          } else if (e.key === 'Escape') {
                            setHighlightIndex(-1);
                          }
                        }}
                      />
                    </div>
                    <div className="results" ref={resultsRef}>
                      {filteredField.map((p, i) => (
                        <div
                          key={p.playerId}
                          className={`result-item ${drafted.has(p.playerId) ? "drafted" : ""} ${i === highlightIndex ? "highlighted" : ""}`}
                          role="button"
                          tabIndex={drafted.has(p.playerId) ? -1 : 0}
                          onClick={() =>
                            !drafted.has(p.playerId) &&
                            makePick(p.playerId, p.name)
                          }
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && !drafted.has(p.playerId)) {
                              e.preventDefault();
                              makePick(p.playerId, p.name);
                            }
                          }}
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

                {lastPick && (
                  <div className="last-pick-banner">
                    <span className="last-pick-label">Last Pick</span>
                    <span className="last-pick-body">
                      <strong>{lastPickDrafter}</strong> selected <strong>{lastPick.name}</strong>
                    </span>
                    <span className="last-pick-meta">Rd {lastPickRound} · Pick #{lastPickIndex + 1}</span>
                  </div>
                )}

                {draftDone && (
                  <div className="complete-banner">Draft Complete</div>
                )}

                <div className="section-title">Draft Board</div>
                {s.drafters?.length > 0 && s.draftOrder?.length > 0 && (() => {
                  const { grid, rounds, activeDrafterIdx, activeRound } = buildDraftGrid(
                    s.drafters, s.draftOrder, s.picks || []
                  );
                  return (
                    <div className="draft-table-wrap">
                      <table className="draft-table">
                        <thead>
                          <tr>
                            <th className="dt-participant">Participant</th>
                            {Array.from({ length: rounds }, (_, r) => (
                              <th key={r} className="dt-round">Rd {r + 1}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {s.drafters.map((drafter, di) => (
                            <tr key={drafter}>
                              <td className="dt-participant-cell">{drafter}</td>
                              {Array.from({ length: rounds }, (_, r) => {
                                const pick = grid[di][r];
                                const isActive = inDraft && di === activeDrafterIdx && r === activeRound;
                                return (
                                  <td
                                    key={r}
                                    className={`dt-pick-cell ${isActive ? "dt-active" : ""} ${pick ? "dt-filled" : "dt-empty"}`}
                                  >
                                    {pick ? pick.name : isActive ? <span className="dt-picking">picking…</span> : null}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {err && <div className="error" role="alert">{err}</div>}
              </div>
            )}

            {/* SCORES TAB */}
            {tab === "scores" && (
              <div role="tabpanel" id="panel-scores">
                {!draftDone ? (
                  <div className="empty-state">
                    Complete the draft to see scores.
                  </div>
                ) : teams.length === 0 ? (
                  <div className="empty-state">
                    No scores yet — hit Refresh.
                  </div>
                ) : (
                  <>
                    {tournamentComplete && teams[0] && (
                      <div className="champion-banner">
                        <div className="champion-trophy">🏆</div>
                        <div className="champion-label">Champion</div>
                        <div className="champion-name">{teams[0].name}</div>
                        <div className="champion-score">
                          {fmtScore(teams[0].teamTotal)}
                        </div>
                        <div className="champion-divider" />
                        <div className="venmo-section">
                          {" "}
                          <a
                            className="venmo-link"
                            href="https://venmo.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Pay on Venmo
                          </a>
                        </div>
                      </div>
                    )}
                    <div className="scoreboard">
                      {teams.map((team, rank) => (
                        <div
                          key={team.name}
                          className={`team-card ${rank === 0 ? "leader" : ""}`}
                        >
                          <div className="team-header">
                            <div
                              className={`move-pip ${team.movement > 0 ? "up" : team.movement < 0 ? "down" : ""}`}
                            />
                            <div className="team-header-inner">
                              <div className="rank-group">
                                <span
                                  className={`team-rank ${rank === 0 ? "gold" : ""}`}
                                >
                                  {team.displayPos}
                                </span>
                                {team.movement !== 0 && (
                                  <span
                                    className={`move-indicator ${team.movement > 0 ? "up" : "down"}`}
                                  >
                                    {team.movement > 0
                                      ? `▲${team.movement}`
                                      : `▼${Math.abs(team.movement)}`}
                                  </span>
                                )}
                                {team.movement === 0 && (
                                  <span className="move-indicator same">–</span>
                                )}
                              </div>
                              <span className="team-name">{team.name}</span>
                              <span
                                className={`team-total ${scoreClass(team.teamTotal)}`}
                              >
                                {fmtScore(team.teamTotal)}
                              </span>
                            </div>
                          </div>
                          <div className="team-golfers">
                            {team.golfers.map((g) => (
                              <div key={g.playerId} className="golfer-row">
                                <span
                                  className={`golfer-name ${g.counting ? "counting" : "nc"}`}
                                >
                                  {g.name}
                                  {g.counting && (
                                    <span className="star" aria-hidden="true">★</span>
                                  )}
                                  {!g.counting && <span className="ex" aria-hidden="true">✕</span>}
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
                  </>
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
                        <button
                          className="btn"
                          onClick={addDrafter}
                          disabled={busy}
                        >
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
                            aria-label="Search player"
                            value={assignSearch}
                            onChange={(e) => setAssignSearch(e.target.value)}
                            placeholder="Search player..."
                            style={{ marginBottom: 6 }}
                          />
                          <div className="results" style={{ maxHeight: 200 }}>
                            {(s.field || [])
                              .filter((p) =>
                                p.name
                                  .toLowerCase()
                                  .includes(assignSearch.toLowerCase()),
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
                                    role="button"
                                    tabIndex={taken ? -1 : 0}
                                    onClick={() =>
                                      !taken &&
                                      assignGolferToDrafter(p.playerId, p.name)
                                    }
                                    onKeyDown={(e) => {
                                      if ((e.key === 'Enter' || e.key === ' ') && !taken) {
                                        e.preventDefault();
                                        assignGolferToDrafter(p.playerId, p.name);
                                      }
                                    }}
                                  >
                                    <span>{p.name}</span>
                                    <span className="muted">
                                      {p.worldRank < 999
                                        ? `WR #${p.worldRank}`
                                        : ""}
                                      {taken ? " · drafted" : ""}
                                    </span>
                                  </div>
                                );
                              })}
                          </div>
                        </>
                      )}
                    </div>

                    {err && <div className="error" role="alert">{err}</div>}
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
function buildTeams(s, previousRankings = {}) {
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
          thru:
            typeof sc?.thru === "string" || typeof sc?.thru === "number"
              ? sc.thru
              : "–",
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
    if (sorted[i].teamTotal === null) {
      sorted[i].position = "–";
      continue;
    }
    const pos =
      i > 0 && sorted[i].teamTotal === sorted[i - 1].teamTotal
        ? sorted[i - 1].position
        : i + 1;
    sorted[i].position = pos;
  }
  for (const t of sorted) {
    const tied =
      sorted.filter((o) => o.position === t.position && o.teamTotal !== null)
        .length > 1;
    t.displayPos =
      t.teamTotal === null ? "–" : tied ? `T${t.position}` : `${t.position}`;
    const prev = previousRankings?.[t.name];
    t.movement =
      prev != null && t.position != null && typeof t.position === "number"
        ? prev - t.position
        : 0;
  }

  return sorted;
}
