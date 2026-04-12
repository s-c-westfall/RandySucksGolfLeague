# Backlog

## Development Instructions

### Parallel Development with Subagents
Use subagents (worktree isolation) to develop independent items in parallel. Each subagent works in its own git worktree so there are no merge conflicts during development.

**Items that can be developed in parallel (no dependencies between them):**
- Items #2, #3, #4 (UI-only changes to `pages/index.js` + `styles/globals.css`) — these touch different sections of the file and can be developed together, but review for merge conflicts in `index.js` since they all modify it
- Item #5 (leaderboard movement) is independent of #2–#4 but also touches `index.js` rendering

**Items that must be sequential:**
- Item #1 (auth) must ship first — items #6, #7, #8 depend on the `users` table
- Item #6 (tournament history) should ship before #7 (challenges) for the `tournament_id` foreign key
- Item #10 (Venmo handle on sign up) should ship with or after #1

**Recommended development order:**
1. **Wave 1 (parallel):** Items #2, #3, #4 — pure UI, no backend changes
2. **Wave 2:** Item #1 — auth foundation (blocks everything below)
3. **Wave 3 (parallel):** Items #5, #11 — independent UI/backend tweaks
4. **Wave 4:** Item #6 — tournament history + DB schema expansion
5. **Wave 5 (parallel):** Items #7, #8, #10 — challenges, champion display, Venmo on sign up
6. **Wave 6:** Item #9 — pull to refresh (polish)

### Stress Testing
After each item is developed, stress test the feature before merging:

**For UI items (#2, #3, #4, #5, #8, #9, #11):**
- Test at mobile (375px), tablet (768px), and desktop (1280px) viewports
- Verify no layout breaks, overflow, or text truncation
- Test with edge case data: 2 drafters, 12 drafters, very long names, ties in standings
- Use the preview server to verify visually — take screenshots as proof

**For backend items (#1, #6, #7):**
- Test all API endpoints with valid and invalid inputs
- Test auth: wrong password, expired session, concurrent sessions, logout
- Test race conditions: two users accepting the same challenge simultaneously
- Test data integrity: archive a tournament, verify all data persists correctly in the new tables
- Test with empty states: no picks, no scores, no history, no challenges

**For auth specifically (#1):**
- Register with duplicate email — should fail gracefully
- Login with wrong password — should show error, not crash
- Refresh page after login — session should persist
- Open two tabs — both should be authenticated
- Logout in one tab — behavior in other tab should be graceful

**For challenges (#7):**
- Challenge yourself — should be blocked
- Accept then try to withdraw — should be blocked
- Two users try to accept same challenge — only one should succeed
- Settle with tied positions — should result in push
- Create challenges after tournament ends — should still work or be blocked (decide)

**For tournament history (#6):**
- Reset with no scores — should handle gracefully
- Reset twice — both tournaments should appear in history
- View history while a live tournament is active — should work without interference
- Switch between history and live rapidly — no stale data

---

## 1. User Authentication with NextAuth.js + Neon

### Problem
The app has two separate, fragile identity systems:
1. **Auth:** A shared secret stored in `sessionStorage` (`pages/index.js:32-35`). Lost on refresh, sent as a raw header on every mutation (`x-league-secret`).
2. **Identity:** A self-reported display name stored in `localStorage` (`pages/index.js:38-49`). Anyone can claim any name. There's no server-side enforcement — picks are attributed to whatever string the browser sends.

This means sessions don't survive refresh, there's no real user identity, and future features (side bets, tournament history per user) have no foundation to build on.

### Goal
Replace both systems with a single NextAuth.js credentials flow backed by a Neon `users` table. Each league member has their own account. Sessions persist across refreshes and tabs. Server-side identity is authoritative for all mutations.

### Current Implementation (to be replaced)
| Component | File | What it does today |
|---|---|---|
| `getSecret()` | `pages/index.js:32-35` | Reads shared secret from `sessionStorage` |
| `getMyName()` / `saveMyName()` | `pages/index.js:38-49` | Reads/writes display name from `localStorage` |
| `handleLogin()` | `pages/index.js:425-443` | POSTs secret to `/api/auth`, stores in `sessionStorage` |
| `/api/auth` | `pages/api/auth.js` | Compares submitted secret to `LEAGUE_SECRET` env var |
| `checkAuth()` | `pages/api/state.js:41-46` | Validates `x-league-secret` header on POST/DELETE |
| `isCommissioner()` | `pages/api/state.js:48-52` | Checks name against `COMMISSIONER_NAME` env var or `state.creator` |
| Auth gate | `pages/index.js:446-465` | Renders password prompt when `needsAuth` is true |
| Name selection | `pages/index.js:532+` | Client-side name input for joining draft |

### Acceptance Criteria
- [ ] A `users` table exists in Neon with columns: `id`, `name` (display name), `email` (unique, login identifier), `password_hash`, `is_commissioner` (boolean), `created_at`
- [ ] Users log in with email + password via a NextAuth.js credentials provider
- [ ] Sessions persist across page refresh, new tabs, and browser restart (NextAuth JWT or database sessions)
- [ ] The logged-in user's display name is shown in the UI header area (replaces the self-reported name badge at `pages/index.js:505`)
- [ ] All API mutations in `pages/api/state.js` validate the session server-side via `getServerSession()` — no more `x-league-secret` header
- [ ] Commissioner status is determined by the `is_commissioner` field on the user record (replaces `COMMISSIONER_NAME` env var and `isCommissioner()` function)
- [ ] Draft picks are attributed to the authenticated user's `name`, not a client-supplied string
- [ ] A "Log out" button is visible when logged in
- [ ] A simple registration flow exists so league members can create accounts (can be a basic form — no email verification required)
- [ ] The `LEAGUE_SECRET` env var and `sessionStorage`/`localStorage` identity code are fully removed

### Suggested Approach

#### 1. Database: Create `users` table
Add to `lib/db.js` `ensureTable()` or create a separate migration:
```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_commissioner BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### 2. Install dependencies
```
npm install next-auth bcryptjs
```
- `next-auth` — session management, credentials provider, JWT handling
- `bcryptjs` — password hashing (pure JS, no native build issues on Vercel)

#### 3. NextAuth config
Create `pages/api/auth/[...nextauth].js`:
- **Credentials provider** with email + password fields
- In `authorize()`: query the `users` table, compare password with `bcryptjs.compare()`
- Return `{ id, name, email, isCommissioner }` to the session
- Use **JWT strategy** (no extra session table needed)
- Set session `maxAge` to 7 days
- Add `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`) and `NEXTAUTH_URL` to Vercel env vars

#### 4. Registration endpoint
Create `pages/api/register.js`:
- Accepts `{ name, email, password, inviteCode }`
- **Validates `inviteCode` against a `LEAGUE_INVITE_CODE` env var** — this gates registration to people who have the code (repurposes the old shared-secret concept as a one-time registration gate)
- Validates: email uniqueness, name not empty, password minimum 8 characters
- Hashes password with `bcryptjs.hash()` (use cost factor 12)
- Inserts into `users` table using the existing `sql` tagged template (parameterized — never string interpolation)
- Returns success (no auto-login — user logs in after registering)

#### 5. Update API routes
In `pages/api/state.js`:
- Replace `checkAuth(req)` with `getServerSession(req, res, authOptions)`
- Extract `session.user.name` and `session.user.isCommissioner` for mutations
- Replace `isCommissioner(name, state)` with `session.user.isCommissioner`
- Any action that currently takes `name` or `creatorName` from the request body should pull from the session instead

#### 6. Update client (`pages/index.js`)
- Replace auth gate (`pages/index.js:446-465`) with a proper login/register form using NextAuth's `signIn("credentials", ...)` and `signOut()`
- Use `useSession()` from `next-auth/react` to get the current user
- Remove: `getSecret()`, `getMyName()`, `saveMyName()`, `clearMyName()`, `secretInput` state, `needsAuth` state
- Replace `myName` state with `session.user.name`
- Remove the self-serve name input for joining drafts — the authenticated user's name is used automatically
- Remove the `x-league-secret` header from `stateGet()` and `statePost()`
- Wrap `_app.js` with `<SessionProvider>`

#### 7. Cleanup
- Delete `pages/api/auth.js` (replaced by `pages/api/auth/[...nextauth].js`)
- Remove `LEAGUE_SECRET` and `COMMISSIONER_NAME` env vars from Vercel (after deploy)
- Add `LEAGUE_INVITE_CODE` env var (shared with league members for registration only)
- Remove all `sessionStorage` and `localStorage` identity code

### Database Architecture Note
This item introduces the first real table (`users`) and marks the beginning of a shift away from the single JSONB blob toward a normalized schema. Future items will add more tables (`tournaments`, `picks`, `bets`) that reference `users` via foreign key.

**When writing the `users` table and `lib/db.js` changes, set up the pattern for what follows:**
- Use `ensureTable()` or a similar auto-migration pattern that can grow to cover multiple tables
- Store the user `id` (integer PK) as the canonical identifier — when the draft state references a drafter, prefer storing `userId` alongside the display name so future queries can join against `users`
- Keep the `sql` tagged template pattern consistent — all new tables should follow the same parameterized query style
- The JSONB blob (`league_state`) will continue to work for real-time draft state, but picks made during the draft should be written in a way that's easy to migrate into a `picks` table later (i.e., each pick already has `drafterIndex` — adding `userId` to the pick object now avoids a retrofit later)

### Migration Notes
- **First deploy:** The `users` table will be empty. The commissioner should register first, then manually set `is_commissioner = true` via Neon console (or create a seed script).
- **Existing state:** The `league_state` JSONB already stores drafter names as strings. These won't match user IDs, but since the app resets state each tournament, this is fine — no migration of existing picks is needed.
- **Drafter list:** Currently `s.drafters` is an array of name strings. This can stay as-is — names come from the `users` table instead of client input, but they're still stored as strings in the state JSONB. Additionally, store `userId` in the drafter/pick objects so the data is ready for relational queries when `tournaments` and `picks` tables are added later.

### Security Requirements
- Registration is gated by `LEAGUE_INVITE_CODE` env var — prevents random account creation
- Passwords hashed with bcryptjs cost factor 12 — no plaintext storage
- `NEXTAUTH_SECRET` must be generated with `openssl rand -base64 32` — weak secrets allow JWT forgery
- All database writes use the `sql` tagged template literal (parameterized queries) — never string concatenation
- Registration endpoint must validate the NextAuth CSRF token from the cookie to prevent cross-site registration attacks
- All API mutations validate server-side session — never trust client-supplied identity

### Scope Boundaries
- No OAuth / social login — email + password only (keep it simple for a friends league)
- No email verification — trust that league members register with real emails
- No password reset flow — commissioner can reset in Neon console if needed, or add later
- No role system beyond commissioner/member — `is_commissioner` boolean is sufficient
- No rate limiting on auth endpoints (acceptable risk for ~12 known users; add later if needed)
- The registration form can be minimal (name, email, password, invite code) — no profile pages

### Files to Touch
- `lib/db.js` — add `users` table to `ensureTable()`
- New: `pages/api/auth/[...nextauth].js` — NextAuth config + credentials provider
- New: `pages/api/register.js` — user registration endpoint
- `pages/api/state.js` — replace `checkAuth()` and `isCommissioner()` with session-based auth
- `pages/api/auth.js` — delete (replaced by NextAuth)
- `pages/index.js` — replace auth gate, identity system, and header with session-based UI
- `pages/_app.js` — wrap with `<SessionProvider>`
- `.env` / Vercel env vars — add `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `LEAGUE_INVITE_CODE`; remove `LEAGUE_SECRET`, `COMMISSIONER_NAME`

### Testing Notes
- Register a new user, log in, refresh — session should persist
- Log out, try to make a pick — should get 401 / auth prompt
- Two users in different browsers — each sees their own name, can only act as themselves
- Commissioner actions (start draft, reset) only available to `is_commissioner` user
- Verify draft picks are attributed to the session user's name, not a client-supplied value
- Test registration with duplicate email — should fail gracefully

---

## 2. Draft Table — 4-Column Layout with Snake Order

### Problem
The current draft board (`pages/index.js:804-826`) is a flat vertical list of all picks in sequential order. Each row shows `#pickNum | drafterName | golferName | roundNum`. This makes it hard to see:
- What each drafter has picked across all rounds at a glance
- The snake order pattern (who picks next, how rounds reverse)
- Empty slots remaining per drafter

### Goal
Replace the flat pick list with a 4-column table: **Participant | Rd 1 | Rd 2 | Rd 3**. Rows are ordered by draft position (1st pick at top, last pick at bottom). As picks happen, golfer names fill into the correct cell based on snake order. The current pick cell is highlighted.

### Data Model Context
The existing data structures do NOT need to change — this is purely a UI transformation.

| Data | Location | Shape |
|---|---|---|
| `s.drafters` | State | `["Alice", "Bob", "Charlie", "Dave"]` — array of names by join order |
| `s.draftOrder` | State | `[0,1,2,3, 3,2,1,0, 0,1,2,3]` — flat array of drafter indices in snake order. Built by `buildSnakeOrder()` at `pages/index.js:8-16`. Even rounds (0,2) go forward, odd rounds (1) go reverse. |
| `s.picks` | State | Parallel array to `draftOrder`. `s.picks[i]` is the pick made at slot `i`. Each pick: `{ pickIndex, drafterIndex, playerId, name }` |
| `s.currentPickIndex` | State | Index into `draftOrder`/`picks` for the next pick to be made |
| `PICKS_PER_DRAFTER` | `pages/index.js:4` | `3` (constant — 3 rounds) |

### Visual Spec

For a 4-drafter league mid-draft (5 picks made, currently pick #6):

```
| Participant | Rd 1         | Rd 2         | Rd 3         |
|-------------|--------------|--------------|--------------|
| Alice       | S. Scheffler | [awaiting]   |              |
| Bob         | R. McIlroy   | [awaiting]   |              |
| Charlie     | J. Rahm      | ← PICKING    |              |
| Dave        | X. Schauffele| B. DeChambeau|              |
```

- **Row order:** Follows draft position (index 0 at top). This is join order / `s.drafters` order.
- **Snake fill pattern:** Rd 1 fills top→bottom, Rd 2 fills bottom→top, Rd 3 fills top→bottom.
- **Current pick cell:** Highlighted (e.g., border or background color) to show whose turn it is and which round.
- **Empty cells:** Blank or subtle placeholder — no "Waiting..." text in every empty cell.
- **Filled cells:** Show golfer name.
- **Completed draft:** All cells filled, no highlight. "Draft Complete" banner remains above the table.

### Mapping Logic
To populate the table, transform the flat `draftOrder` / `picks` arrays into a 2D grid:

```js
// Build a grid: grid[drafterIndex][round] = pick or null
const grid = s.drafters.map(() => Array(PICKS_PER_DRAFTER).fill(null));
const pickRound = s.drafters.map(() => 0); // track next round per drafter

s.draftOrder.forEach((drafterIdx, i) => {
  const round = pickRound[drafterIdx]++;
  if (s.picks[i]) {
    grid[drafterIdx][round] = s.picks[i];
  }
});

// Current pick position
const currentDrafterIdx = s.draftOrder[s.currentPickIndex];
const currentRound = pickRound[currentDrafterIdx]; // next unfilled round for that drafter
```

This replaces the flat `.map()` at `pages/index.js:806-825`.

### Acceptance Criteria
- [ ] Draft board displays as a table with columns: Participant, Rd 1, Rd 2, Rd 3
- [ ] Rows are ordered by draft position (first drafter at top)
- [ ] Golfer names appear in the correct cell as picks are made, following snake order
- [ ] The cell for the current pick is visually highlighted (distinct background or border)
- [ ] The table renders correctly for any number of drafters (tested with 2, 4, 8, 12)
- [ ] The table is readable on mobile (horizontal scroll or responsive layout)
- [ ] After draft completion, all cells are filled with no highlight
- [ ] No changes to the data model, API, or draft logic — UI only

### Suggested Approach
1. Add a helper function (e.g., `buildDraftGrid(drafters, draftOrder, picks)`) that returns the 2D grid and current pick position
2. Replace the `<div className="pick-list">` block (`pages/index.js:805-826`) with an HTML `<table>` or CSS grid
3. Add styles for the table, current-pick highlight, and filled/empty states
4. Keep the existing "Draft Complete" banner above the table

### Scope Boundaries
- This is a **display-only** change — no modifications to draft logic, API, or state shape
- The golfer search/pick UI below the draft board stays as-is
- Column count is fixed at 3 rounds (matches `PICKS_PER_DRAFTER`). If this constant changes later, the table should adapt automatically (map over rounds dynamically, don't hardcode 3 columns)
- No drag-and-drop, reordering, or interactive table features

### Files to Touch
- `pages/index.js` — replace pick-list rendering block (~lines 804-826) with table, add grid-building helper
- `styles/globals.css` — add draft table styles

### Testing Notes
- Test with 2 drafters, 4 drafters, and 12 drafters — table should render correctly at all sizes
- Make picks and verify each golfer lands in the correct cell (snake order: Rd 1 top→bottom, Rd 2 bottom→top, Rd 3 top→bottom)
- Verify the current-pick highlight moves correctly as each pick is made
- Test on mobile viewport — table should be usable (scrollable if needed)
- Verify draft completion state — all filled, no highlight

---

## 3. Last Pick Display

### Problem
During the draft, there's no persistent indicator of what just happened. After a pick is made, the board updates and the turn moves on, but users who weren't watching at that exact moment have no quick way to see the most recent pick without scanning the draft table. This is especially important since the app uses 2-minute polling — a user returning to the tab needs to immediately see what changed.

### Goal
Show a persistent banner/callout displaying the most recently drafted golfer and who picked them. Visible during the draft and updates automatically as new picks come in.

### Data Available
Everything needed is already in the state — no API changes required.

```js
// The last completed pick:
const lastPickIndex = s.currentPickIndex - 1;
const lastPick = lastPickIndex >= 0 ? s.picks[lastPickIndex] : null;
const lastPickDrafter = lastPick ? s.drafters[lastPick.drafterIndex] : null;

// Round number of that pick:
const lastPickRound = Math.floor(lastPickIndex / s.drafters.length) + 1;
```

### Visual Spec

**Style: Inline banner** (positioned in page flow, not sticky). Placed between the search panel and the "Draft Board" section title.

See `public/mockup-lastpick.html` (Option A) for a live reference mockup.

**Layout:** Horizontal flexbox row with three elements:
- Left: "LAST PICK" label (DM Mono, uppercase, gold, 0.62rem)
- Center: "{Drafter} selected {Golfer}" (DM Sans, 0.87rem, drafter/golfer names bold in gold-light)
- Right: "Rd {N} · Pick #{N}" (DM Mono, 0.65rem, text-light, pushed right with `margin-left: auto`)

**Styling:**
- Background: `rgba(201,168,76,0.06)`
- Border: `1px solid rgba(201,168,76,0.2)` with a `3px solid var(--gold)` left accent border
- Border-radius: `var(--radius)`
- Padding: `10px 16px`
- Margin-bottom: `20px`
- Fade-in animation on appear: `opacity 0→1, translateY(-4px)→0, 0.4s ease-out`

**States:**
- **Before any picks are made:** Hidden (don't render)
- **During draft:** Visible, shows most recent pick
- **After draft is complete:** Remains visible showing the final pick

### Acceptance Criteria
- [ ] A banner is visible during the draft showing the most recent pick (drafter name + golfer name + round)
- [ ] The banner is NOT shown before the first pick is made
- [ ] The banner updates when a new pick is made (either via the current user picking or via polling)
- [ ] The banner is positioned above the draft table but below the pick search panel
- [ ] The banner is visible regardless of which user is viewing (not just the active drafter)
- [ ] No API or state changes — derived entirely from existing `s.picks` and `s.currentPickIndex`

### Suggested Approach
1. Derive `lastPick` and `lastPickDrafter` from state (see data section above)
2. Add a conditional render block between the pick/search panel and the draft table (`pages/index.js`, between ~line 798 and ~line 804)
3. Style with the exact CSS from the visual spec above (gold left border, subtle background, fade-in animation)
4. Add a `@keyframes fadeIn` animation (`opacity 0→1, translateY(-4px→0), 0.4s ease-out`) to `styles/globals.css`

### Scope Boundaries
- Display only — no state or API changes
- No notification system (no sounds, no push notifications, no toasts)
- No history of picks beyond the single most recent one (the draft table covers full history)
- Works with the existing 2-minute polling — no need for WebSockets or faster updates

### Files to Touch
- `pages/index.js` — add last-pick banner in the draft tab render block (~line 798-804)
- `styles/globals.css` — add banner styles

### Testing Notes
- Start a draft, verify banner is hidden before first pick
- Make a pick, verify banner appears with correct drafter + golfer + round
- Make another pick, verify banner updates
- View from a different user's perspective (different browser) — banner should show after polling update
- Verify banner doesn't break layout on mobile

---

## 4. Keyboard Navigation for Golfer Selection

### Problem
The golfer search dropdown (`pages/index.js:768-785`) only supports mouse clicks to select a golfer. Users type a name, see filtered results, but must move their hand to the mouse/trackpad to click. There's no way to arrow through the list or press Enter to confirm.

### Goal
Add keyboard navigation to the golfer search results: arrow up/down to move a highlight through the filtered list, Enter to confirm the highlighted selection. Standard autocomplete/combobox behavior.

### Current Implementation
| Component | Location | What it does |
|---|---|---|
| Search input | `pages/index.js:762-766` | Controlled input, filters `s.field` by name match |
| `filteredField` | `pages/index.js:418-420` | Filters field by `searchQ`, capped at 20 results |
| Results list | `pages/index.js:768-785` | Maps `filteredField` to clickable `<div>` rows |
| `makePick()` | `pages/index.js:310-328` | Submits the pick to the API |

The results are plain `<div>` elements with `onClick` — no `role`, no `aria-*`, no keyboard event handling.

### Acceptance Criteria
- [ ] Arrow Down moves the highlight to the next available (non-drafted) golfer in the list
- [ ] Arrow Up moves the highlight to the previous available (non-drafted) golfer in the list
- [ ] Enter on a highlighted golfer calls `makePick()` with that golfer
- [ ] The highlighted item is visually distinct (e.g., same style as hover — `rgba(201,168,76,0.12)` background)
- [ ] The highlight resets to no selection when `searchQ` changes (new search = start fresh)
- [ ] Drafted golfers are skipped during arrow navigation (can't highlight a greyed-out player)
- [ ] Click selection continues to work as before
- [ ] If no item is highlighted, Enter does nothing (doesn't pick the first result by accident)
- [ ] The highlighted item scrolls into view if it's outside the visible area of the results container

### Suggested Approach
1. Add a `highlightIndex` state (`useState(-1)`) tracking which index in `filteredField` is highlighted (-1 = none)
2. Add an `onKeyDown` handler to the search input (`pages/index.js:762`):
   - **ArrowDown:** increment `highlightIndex`, skip drafted players, wrap or clamp at end
   - **ArrowUp:** decrement `highlightIndex`, skip drafted players, wrap or clamp at start
   - **Enter:** if `highlightIndex >= 0` and the player isn't drafted, call `makePick()`
   - **Escape:** reset `highlightIndex` to -1 (deselect)
3. Reset `highlightIndex` to -1 whenever `searchQ` changes (in the `onChange` handler or a `useEffect`)
4. Apply a `highlighted` class to the active result item and add a CSS rule matching the existing hover style
5. Add a `ref` to the results container and use `scrollIntoView()` on the highlighted element when it changes

### Scope Boundaries
- No ARIA/combobox role attributes required (nice-to-have, not blocking)
- No debouncing or async search — the existing synchronous filter is fine
- No multi-select — single highlight, single pick
- Click behavior unchanged

### Files to Touch
- `pages/index.js` — add `highlightIndex` state, `onKeyDown` handler on search input, `highlighted` class on result item, scroll-into-view logic
- `styles/globals.css` — add `.result-item.highlighted` style (can reuse `.result-item:hover` values)

### Testing Notes
- Type a name, arrow down through results — highlight should move and skip drafted players
- Press Enter on highlighted player — pick should be submitted
- Change search text — highlight should reset
- Press Enter with no highlight — nothing should happen
- Arrow past the end of the list — should stop or wrap (either is fine, just be consistent)
- Test with only 1 result — Enter after ArrowDown should pick it
- Test with all results drafted — arrows should have nowhere to go, Enter should do nothing

---

## 5. Leaderboard Position Movement Indicators

### Problem
The scoreboard shows current standings but gives no sense of momentum — who's climbing, who's falling. Users have to remember previous positions to know if anything changed between refreshes.

### Goal
Show position movement indicators on each team card: a colored left-edge pip (green/red) plus an inline arrow+delta (`▲2`, `▼1`) next to the position number, comparing current standings to the previous refresh.

### Visual Spec

See `public/mockup-leaderboard.html` for a live reference mockup.

**Layout:** Two visual elements per team card:
1. **Left edge pip** — a 3px-wide vertical bar on the left edge of the card
   - Green (`--move-up: #5cb85c`) when team moved up
   - Red (`--move-down: #c0392b`) when team moved down
   - Transparent when no change
   - CSS: `width: 3px; flex-shrink: 0; border-radius: 2px 0 0 0;`

2. **Inline arrow + delta** — immediately right of the position number, grouped tightly (3px gap)
   - Green `▲N` for upward movement
   - Red `▼N` for downward movement
   - Muted `–` for no change
   - CSS: `font-family: 'DM Mono'; font-size: 0.6rem; font-weight: 500;`

**Rank group structure:** Position number and delta are wrapped in a flex container (`display: flex; align-items: baseline; gap: 3px; min-width: 44px;`) so they read as a single unit: `1 ▲2`

**Team header restructure:** The `.team-header` becomes a flex container with `align-items: stretch` and no padding. The pip sits flush left, and a `.team-header-inner` div holds rank-group, name, and total with the original padding (`8px 14px`).

### Data Model Change
Currently there's no way to calculate movement — the app only stores current scores, not previous rankings. The delta needs a **previous position** to compare against.

**Approach — store previous rankings in state:**
- When scores are refreshed (the `refreshScores` action in `pages/api/state.js`), before overwriting scores, compute the current team rankings and save them as `state.previousRankings` (an object: `{ "Alice": 1, "Bob": 2, ... }`)
- Then update `state.scores` with the fresh data
- On the client, `buildTeams()` returns each team's current position. Compare against `s.previousRankings[team.name]` to get the delta
- On first refresh (no previous rankings), show `–` for all teams

**State shape addition:**
```js
// Added to league_state JSONB:
{
  ...existingState,
  previousRankings: { "Alice": 1, "Bob": 3, "Charlie": 2, "Dave": 4 }
}
```

### Acceptance Criteria
- [ ] Each team card shows a colored left-edge pip (green=up, red=down, invisible=same)
- [ ] Each team card shows an arrow+delta next to the position number (`▲2`, `▼1`, `–`)
- [ ] Movement is calculated by comparing current position to `previousRankings` from the last score refresh
- [ ] On first score refresh (no previous data), all teams show `–` (no movement)
- [ ] Ties are handled: if a team was T2 and is now T1, that's `▲1`
- [ ] The `previousRankings` object is updated in the API each time scores are refreshed
- [ ] Movement indicators update when scores are refreshed (2-min polling or manual refresh button)

### Suggested Approach

#### 1. API change (`pages/api/state.js` — `refreshScores` action)
Before updating `state.scores`, compute current rankings using the same logic as `buildTeams()`, and save as `state.previousRankings`. This means the rankings saved are from *before* the current refresh — exactly the comparison point we need.

#### 2. Client: update `buildTeams()` (`pages/index.js:993-1049`)
- Accept `previousRankings` as a parameter
- After computing `sorted` positions, add a `movement` field to each team:
  ```js
  const prev = previousRankings?.[team.name];
  team.movement = prev != null ? prev - team.position : 0;
  // positive = moved up, negative = moved down, 0 = same
  ```

#### 3. Client: update scoreboard rendering (`pages/index.js:844-895`)
- Restructure `.team-header` to include the pip and rank-group as shown in the visual spec
- Conditionally apply `.up`, `.down`, or `.same` classes based on `team.movement`

#### 4. CSS (`styles/globals.css`)
Add styles for: `.move-pip`, `.rank-group`, `.move-indicator`, and their `.up`/`.down`/`.same` variants. See mockup file for exact values.

### Scope Boundaries
- Movement is per-refresh, not per-round — it compares current vs. last refresh, not current round vs. previous round
- No animation on movement change (static indicator is sufficient)
- No history of movements — only current vs. previous
- Tie handling uses numeric position (e.g., T2 = position 2)

### Files to Touch
- `pages/api/state.js` — save `previousRankings` before updating scores in `refreshScores` action
- `pages/index.js` — update `buildTeams()` to compute movement, update scoreboard rendering with pip + rank-group structure
- `styles/globals.css` — add `.move-pip`, `.rank-group`, `.move-indicator` styles with `.up`/`.down`/`.same` variants

### Testing Notes
- First refresh — all teams show `–` (no previous data)
- Second refresh with position changes — verify arrows and pip colors match actual movement
- Refresh with no position changes — all teams show `–` with no pip color
- Test with ties (two teams at same score) — movement should still compute correctly
- Verify mobile layout — pip and delta don't break card layout on narrow screens

---

## 6. Tournament History

### Problem
When the commissioner hits Reset (`DELETE /api/state`), the entire `league_state` row is deleted — all picks, scores, and standings are gone permanently. There's no archive, no record of past tournaments, and no way to look back at who won, who picked whom, or what the final standings were.

This also blocks user stats (win/loss records, pick history) since there's no historical data to query.

### Goal
Archive each completed tournament into a normalized relational schema before reset. Provide a UI to browse past tournaments with final standings, picks, and scores.

### Current State
| What | Where | What happens on reset |
|---|---|---|
| All tournament state | `league_state.state` (single JSONB row) | Deleted entirely (`DELETE FROM league_state WHERE id = 1`) |
| Tournament identity | `state.tournId`, `state.tournamentName`, `state.year` | Lost |
| Picks | `state.picks[]` (array in JSONB) | Lost |
| Final scores | `state.scores{}` (object in JSONB) | Lost |
| Draft order | `state.draftOrder[]`, `state.drafters[]` | Lost |

### Database Schema

Add three new tables to Neon (via `lib/db.js` `ensureTable()` or a migration):

```sql
CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  tourn_id TEXT NOT NULL,
  name TEXT NOT NULL,
  year TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  winner_name TEXT,
  winner_user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tournament_picks (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  drafter_name TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  pick_index INTEGER NOT NULL,
  round INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_standings (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  drafter_name TEXT NOT NULL,
  position INTEGER,
  display_position TEXT,
  team_total INTEGER,
  golfer_scores JSONB
);
```

**Note:** `user_id` is nullable for now — it references the `users` table from backlog item #1. If auth hasn't shipped yet, drafter names are stored as strings and `user_id` is left null. Once auth is in, `user_id` becomes the authoritative link.

### Suggested Approach

#### 1. Archive on reset (`pages/api/state.js`)
Replace the `DELETE` handler with an archive-then-reset flow:
- Compute final standings using the same `buildTeams()` logic (extract it to a shared util or duplicate server-side)
- Insert a row into `tournaments` with the tournament metadata and winner
- Insert rows into `tournament_picks` for each pick (derive `round` from pick index and drafter count)
- Insert rows into `tournament_standings` for each team's final position and scores
- Then delete the `league_state` row as before

#### 2. History API endpoint
Create `pages/api/history.js`:
- `GET /api/history` — returns list of past tournaments (id, name, year, winner, date)
- `GET /api/history?id=N` — returns full detail for one tournament (standings, picks, golfer scores)

#### 3. History UI (`pages/index.js`)

See `public/mockup-history.html` for a live reference mockup.

**Tournament selector (header):** Replace the static `.logo` text with a clickable dropdown button:
- Displays current tournament name (e.g., "The Masters") with a `▼` chevron
- On click, opens a dropdown with two sections:
  - **"Current"** — the active tournament with year and a gold "LIVE" badge. Highlighted with a gold left border when active.
  - **"Past Tournaments"** — list of archived tournaments, each showing name, year, and "Won by {name}" in gold text
- Selecting a past tournament switches the view to history mode
- Selecting the current tournament (or "Back to Live") returns to live mode
- Dropdown closes on outside click
- CSS: dropdown is `position: absolute`, dark background (`#1e351e`), gold border, shadow (`0 8px 24px rgba(0,0,0,0.4)`), `dropIn` animation

**History mode changes:**
- Header title updates to "{Tournament Name} — {Year}" (e.g., "The Masters — 2025")
- No refresh timestamp in header (archived, not live)
- An **archived banner** appears below the header, above the scoreboard:
  - Same style as the last-pick banner (gold left accent, subtle background)
  - Shows: "ARCHIVED | {Tournament Name} {Year} — Final Standings | ← Back to Live"
  - "Back to Live" button returns to the current tournament
- Scoreboard renders with **identical card structure** to the live view — same `.team-card`, `.team-header`, `.team-golfers` layout
- **Omitted from history view:** position movement indicators (no pip/delta), round progress (no "Thru X"), refresh button, draft board tab
- Golfer rows show: name, counting/non-counting star/x, final score only

**State management:** Add a `viewingTournament` state (`null` = live, `tournamentId` = history). When set:
- Fetch `GET /api/history?id={tournamentId}` and render the archived standings
- Hide draft/scores tabs — show scoreboard directly
- Show the archived banner

#### 4. Shared `buildTeams()` logic
Currently `buildTeams()` lives in `pages/index.js` (client-side). The archive step needs this logic server-side. Either:
- Extract to `lib/scoring.js` and import in both places, OR
- Duplicate a simplified version in the API route (just needs position calculation, not UI concerns)

### Acceptance Criteria
- [ ] Resetting a completed tournament archives all data (picks, standings, scores) to the new tables
- [ ] Resetting a tournament that hasn't completed (no scores) either skips archival or archives partial data — decide based on preference
- [ ] `GET /api/history` returns a list of past tournaments (id, name, year, winner)
- [ ] `GET /api/history?id=N` returns full standings and golfer scores for a specific tournament
- [ ] The header tournament name is a dropdown that lists the current tournament and all past tournaments
- [ ] Selecting a past tournament from the dropdown shows archived standings in the same scoreboard card layout
- [ ] The header updates to show "{Name} — {Year}" when viewing history
- [ ] An "Archived" banner is shown above the scoreboard with a "Back to Live" button
- [ ] History view omits: position movement indicators, round progress (Thru X), refresh button, draft/scores tabs
- [ ] The dropdown shows "LIVE" badge on the current tournament and "Won by {name}" on past tournaments
- [ ] The archive includes `user_id` when available (auth is in place) or falls back to `drafter_name`
- [ ] Existing reset functionality still works — the state is cleared after archival

### Scope Boundaries
- No editing of historical data — read-only archive
- No per-user stats page yet (that can be a future item querying these tables)
- No export/download of historical data
- No separate history page — it lives inline via the header dropdown
- No migration of past tournaments that were already reset (that data is gone)
- The tournament selector dropdown does not need search/filter — the list will be short

### Dependencies
- Soft dependency on **item #1 (auth)** — if auth ships first, `user_id` foreign keys are populated. If not, the schema still works with `drafter_name` as the identifier.

### Files to Touch
- `lib/db.js` — add `tournaments`, `tournament_picks`, `tournament_standings` table creation
- `pages/api/state.js` — replace `DELETE` handler with archive-then-reset
- New: `pages/api/history.js` — history list + detail endpoint
- New or existing: `lib/scoring.js` — extract `buildTeams()` for server-side use
- `pages/index.js` — replace `.logo` with tournament selector dropdown, add `viewingTournament` state, history fetch, archived banner, and history scoreboard rendering
- `styles/globals.css` — add `.tourn-selector`, `.tourn-dropdown`, `.tourn-dropdown-item`, `.history-banner` styles (see mockup for exact values)

### Testing Notes
- Complete a tournament, reset — verify data appears in `tournaments`, `tournament_picks`, `tournament_standings` tables
- Click the header tournament name — dropdown should appear with "Current" and "Past Tournaments" sections
- Select a past tournament — header updates to "{Name} — {Year}", archived banner appears, scoreboard shows final standings
- Click "Back to Live" — returns to the live tournament view
- Verify past tournament scoreboard matches what was shown before reset (same positions, scores, golfer assignments)
- Reset a second tournament — verify both appear in dropdown
- Reset a tournament that was never completed (no scores) — verify graceful handling
- Test dropdown on mobile — should be usable at narrow widths
- Verify dropdown closes on outside click

---

## 7. Challenges (Targeted Side Bets)

### Problem
There's no way for league members to make side wagers with each other during a tournament. Informal bets happen in group chats but aren't tracked, and there's no resolution mechanism. An open marketplace model would allow people in strong positions to cherry-pick easy bets against weaker teams.

### Goal
A **targeted challenge system** where a user challenges a specific opponent to a head-to-head bet ("I'll finish higher than you — $5"). The challenged person must accept for the bet to go live. This prevents unfair matchups since both sides knowingly agree.

### Challenge Flow
1. **Create:** Alice challenges Bob specifically: "I'll finish higher than you — $5"
2. **Pending:** The challenge appears for Bob to accept or decline
3. **Accept:** Bob accepts — the challenge is locked in as Alice vs. Bob
4. **Active:** During the tournament, the challenge shows both participants and current standings
5. **Settled:** After tournament ends (or on score refresh with `draftComplete`), the system compares final positions and marks a winner

### Database Schema

Add one new table:

```sql
CREATE TABLE IF NOT EXISTS challenges (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  challenger_name TEXT NOT NULL,
  challenger_user_id INTEGER REFERENCES users(id),
  opponent_name TEXT NOT NULL,
  opponent_user_id INTEGER REFERENCES users(id),
  amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  winner_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ
);
```

**Status values:** `pending` → `active` (accepted) or `declined` → `settled`
- `pending`: challenger has issued the challenge, waiting for opponent to respond
- `active`: opponent accepted, bet is locked in
- `declined`: opponent declined (stays visible briefly, then fades)
- `settled`: tournament over, winner determined by final standings
**Note:** `tournament_id` references the `tournaments` table from item #6. If item #6 hasn't shipped yet, this can reference the current tournament via `state.tournId` stored as text instead. However, for clean foreign keys, item #6 should ship first.

### API Endpoints

Create `pages/api/challenges.js`:

- **`GET /api/challenges`** — returns all challenges for the current tournament (pending, active, declined, settled)
- **`POST /api/challenges` `{ action: 'create', opponentName, amount }`** — creates a pending challenge targeting a specific opponent
- **`POST /api/challenges` `{ action: 'accept', challengeId }`** — opponent accepts (status: pending → active)
- **`POST /api/challenges` `{ action: 'decline', challengeId }`** — opponent declines (status: pending → declined)
- **`POST /api/challenges` `{ action: 'withdraw', challengeId }`** — challenger withdraws their own pending challenge (only if status is `pending` — once accepted, the challenge is locked)
- **`POST /api/challenges` `{ action: 'settle' }`** — settles all active challenges based on current standings (called automatically during score refresh, or manually by commissioner)

**Settlement logic:**
- For each active challenge, compare `challenger_name`'s position to `opponent_name`'s position in the final standings (from `buildTeams()`)
- Lower position number = higher finish = winner
- Ties: challenge is a push (no winner) — `status` = `settled`, `winner_name` = null

### UI — Challenges Panel

The challenges panel sits to the **right of the scoreboard** on the Scoreboard tab. The main layout shifts from single-column to a two-column grid.

**Layout change to scoreboard tab:**
```
┌─────────────────────────────────┬──────────────────┐
│                                 │                  │
│     Scoreboard (existing)       │  Challenges      │
│     ~65% width                  │  ~35% width      │
│                                 │                  │
└─────────────────────────────────┴──────────────────┘
```
On mobile (`<= 768px`): the panel is hidden from the grid layout. Instead, a **"Challenges" tab** is added as a third tab alongside Draft Board and Scoreboard. Tapping it shows the full challenges UI at full width (no scoreboard visible). See `public/mockup-sidebets.html` (Mobile: Bets Tab view) for reference.

**Desktop layout:** `grid-template-columns: 1fr 300px; gap: 24px; align-items: start;` — the `main` container max-width increases from `1000px` to `1100px` to accommodate the panel.

See `public/mockup-sidebets.html` for live reference mockups (note: mockup uses older "Side Bets" terminology — implementation should use "Challenges").

**Challenges panel sections:**

**1. Create challenge (top of panel):**
- Form with two inputs: opponent dropdown (select from league members) + amount text input (e.g., "$5", "a beer")
- "Challenge" button to submit
- Label: "SEND A CHALLENGE" (DM Mono, uppercase, 0.58rem)
- Description: "Pick an opponent — you're betting you'll finish above them"
- Opponent dropdown lists all drafters except the current user

**2. Pending challenges:**
- Section header: "PENDING"
- **Challenges you sent:** shows opponent name, amount, "Waiting for {opponent}..." status, "Withdraw" button
- **Challenges you received:** shows challenger name, amount, "Accept" and "Decline" buttons
- Declined challenges show briefly with "Declined" label then fade from view

**3. Active challenges:**
- Section header: "ACTIVE"
- Two-card matchup layout: challenger card vs. opponent card with "vs" divider between
- Leading participant's card has green background/border, trailing has default styling
- Each card shows: name (bold) and current position (e.g., "1st", "2nd") in mono text
- Amount badge centered below the matchup

**4. Settled challenges:**
- Section header: "SETTLED"
- Same two-card matchup layout as active
- Winner's card: gold background/border, name in gold-light
- Loser's card: default styling at 50% opacity
- Result text below: "{Winner} wins" in gold, or "Push" in muted text for ties

### Withdrawal & Decline Rules
- **Pending challenges:** Challenger can withdraw at any time before the opponent responds. Opponent can decline (no obligation to accept).
- **Active challenges:** No cancellation by either side. Once accepted, both parties are locked in until auto-settlement.
- **No mutual cancellation mechanism** — keeps it simple.

### Auto-Settlement

Settlement happens in the `updateScores` action in `pages/api/state.js`:
- After updating scores, if `draftComplete` is true, query all `active` challenges for the current tournament
- Run settlement logic (compare positions)
- Update each challenge's `status`, `winner_name`, and `settled_at`
- This means challenges settle automatically on the final score refresh — no manual step needed

### Acceptance Criteria
- [ ] Authenticated users can create a challenge by selecting a specific opponent from a dropdown + entering an amount
- [ ] The challenge appears as "pending" for the targeted opponent only
- [ ] The opponent can accept or decline the challenge
- [ ] Accepting locks the challenge in (status: pending → active)
- [ ] Declining marks it as declined (status: pending → declined)
- [ ] Challenger can withdraw their own pending challenge before the opponent responds
- [ ] Once accepted, neither side can cancel — the challenge is locked until settlement
- [ ] Active challenges show both participants and current standings during the tournament
- [ ] Challenges auto-settle on score refresh when the draft is complete — winner determined by final position
- [ ] Tied positions result in a push (no winner)
- [ ] Settled challenges show the winner highlighted and the result
- [ ] Desktop: challenges panel appears to the right of the scoreboard in a two-column grid layout
- [ ] Mobile (<=768px): challenges appear as a third "Challenges" tab alongside Draft Board and Scoreboard, full-width when selected
- [ ] Challenges are scoped to the current tournament
- [ ] Challenges are archived with the tournament when reset (item #6)
- [ ] A user cannot challenge themselves

### Scope Boundaries
- **Targeted head-to-head only** — must pick a specific opponent, no open marketplace
- **Amount is a text field** — no real money processing, just a label ("$5", "a beer", etc.)
- **No notifications** — users check the panel to see if they have pending challenges
- **No challenge editing** — create or withdraw (while pending), no modifications after acceptance
- **No challenge history page** — settled challenges from past tournaments visible via tournament history if archived. For MVP, challenges from past tournaments can be lost on reset.

### Dependencies
- **Hard dependency on item #1 (auth)** — challenges require knowing who the authenticated user is to show/hide accept/decline buttons and prevent self-challenges.
- **Soft dependency on item #6 (tournament history)** — for `tournament_id` foreign key and archiving challenges with tournament data. Can work without it by scoping to the current state.

### Files to Touch
- `lib/db.js` — add `challenges` table creation
- New: `pages/api/challenges.js` — CRUD + settlement endpoints
- `pages/api/state.js` — add auto-settlement call in `updateScores` action when `draftComplete` is true
- `pages/index.js` — add challenges panel to scoreboard tab, two-column layout on desktop, "Challenges" tab on mobile, create (with opponent dropdown)/accept/decline/withdraw UI
- `styles/globals.css` — challenges panel styles, challenge cards, two-column scoreboard layout, mobile stack

### Testing Notes
- Challenge Bob as Alice — verify it appears as "pending" for Bob with Accept/Decline buttons
- Bob accepts — verify it moves to active with both names and current positions shown
- Bob declines a different challenge — verify it shows as declined
- Alice withdraws a pending challenge — verify it disappears
- Try to challenge yourself — should be blocked (own name not in dropdown)
- Verify no withdraw option on active challenges — once accepted, it's locked
- Complete the tournament and refresh scores — verify active challenges auto-settle with correct winner
- Create a challenge where both participants tie — verify push result
- Verify opponent dropdown lists all drafters except the current user
- Desktop: verify two-column layout (scoreboard left, challenges panel right) at >= 769px
- Mobile: verify "Challenges" tab appears as third tab, full-width when selected, scoreboard hidden
- Mobile: verify Challenges tab is not visible when viewing tournament history
- Verify challenges panel doesn't appear when viewing tournament history (desktop)

---

## 8. Champion Display with Venmo Pay Link

### Problem
When the tournament ends, there's no celebration moment — the scoreboard just shows final standings like any other refresh. There's also no easy way for losers to pay the winner. People forget, avoid, or delay payment because there's friction.

### Goal
When the tournament is complete (all rounds finished, final scores in), display a prominent champion banner/card at the top of the scoreboard. Include the winner's Venmo handle as a QR code and/or deep link so other league members can pay them instantly.

### Trigger
The champion display appears **automatically** when the tournament ends. The condition is: `draftComplete === true` AND all golfers in the field have a status of `"F"` (finished) or `"cut"`/`"wd"` — meaning no one is still playing. This can be derived from the existing `s.scores` data on score refresh.

Alternatively, a simpler approach: the commissioner already has a "Refresh Scores" button. After the final refresh when all golfers are done, the champion display activates based on the standings being final (all `thru === "F"` for non-cut golfers).

### Data Requirements
- **Winner name:** Already available — first entry in `buildTeams()` sorted results
- **Venmo handle:** New field on the `users` table from item #1. Add `venmo_handle TEXT` column. Users set this in a profile/settings area or during registration.
- **Venmo pay link:** `https://account.venmo.com/pay?recipients={handle}` — opens Venmo's pay screen directly with the champion pre-filled as the recipient. Works on mobile (launches app) and desktop (opens Venmo web).

### Visual Spec

Displayed at the top of the Scoreboard tab, above the team cards, when the tournament is complete:

```
┌──────────────────────────────────────────────────┐
│                    🏆 CHAMPION 🏆                │
│                                                  │
│                     Alice                        │ (large, Playfair Display, gold)
│                      -12                         │ (team total, green)
│                                                  │
│             [ V  Pay Alice on Venmo ]            │ (clickable button/link)
│                                                  │
└──────────────────────────────────────────────────┘
```

See `public/mockup-champion.html` for a live reference mockup.

**Styling:**
- Full-width card with gold border, subtle gold background, radial gradient glow from top
- Gold gradient line across top edge (`linear-gradient(90deg, transparent, var(--gold), transparent)`)
- "CHAMPION" header in DM Mono, uppercase, gold, letter-spaced (`0.25em`)
- Winner's name large in Playfair Display, gold with shimmer animation
- Team total score below name
- Divider line, then Venmo button centered
- Venmo button: blue-tinted background/border (`rgba(0,141,237,...)`), DM Mono, "V Pay {name} on Venmo"
- Links to `https://account.venmo.com/pay?recipients={handle}` — opens Venmo pay screen with champion pre-filled
- No additional labels or handle text — the button is self-explanatory
- If winner has no Venmo handle set: show the banner without the payment button, just the champion display (trophy, name, score)

### Schema Change
Add to `users` table (from item #1):
```sql
ALTER TABLE users ADD COLUMN venmo_handle TEXT;
```
Or include in the initial `users` table creation if item #1 hasn't shipped yet.

### Suggested Approach

#### 1. Detect tournament completion
In `pages/index.js`, add a derived boolean:
```js
const tournamentComplete = draftDone && (s?.field || [])
  .filter(p => {
    const sc = s.scores[p.playerId];
    return sc && sc.status !== 'cut' && sc.status !== 'wd';
  })
  .every(p => s.scores[p.playerId]?.thru === 'F');
```

#### 2. Champion banner component
Render above the scoreboard when `tournamentComplete` is true:
- Pull winner from `teams[0]` (already sorted by `buildTeams()`)
- Fetch winner's Venmo handle from user data (requires the auth system from item #1, or could be stored in the state JSONB as a temporary measure)
- Render a Venmo pay button linking to `https://account.venmo.com/pay?recipients={handle}`

#### 3. Venmo handle storage
- `venmo_handle` column on the `users` table (see item #10 for collecting it during sign up)
- Pass to the client via the session or a user profile endpoint

#### 4. Venmo pay link
- Render an `<a>` tag styled as a button linking to `https://account.venmo.com/pay?recipients={handle}`
- On mobile: opens Venmo app directly to pay screen. On desktop: opens Venmo web.
- No QR code needed — the direct link is simpler and works better on mobile

### Acceptance Criteria
- [ ] When all golfers have finished (thru === "F" or cut/wd), a champion banner appears at the top of the scoreboard
- [ ] The banner shows the winner's name and final team total score
- [ ] If the winner has a Venmo handle set, a "Pay {name} on Venmo" button links to `https://account.venmo.com/pay?recipients={handle}`
- [ ] The Venmo link opens the Venmo pay screen with the champion pre-filled as recipient
- [ ] If the winner has no Venmo handle, the banner still shows without the payment section
- [ ] The champion banner does not appear mid-tournament (only when all rounds are complete)
- [ ] Users can set their Venmo handle during registration (see item #10)
- [ ] The champion display also appears in tournament history (item #6) for past winners — without the Venmo button (just name + score)

### Scope Boundaries
- **Venmo only** — no PayPal, Zelle, or other payment methods
- **No payment tracking** — the app shows the link/QR but doesn't track who has paid
- **No fixed buy-in amount** — the app doesn't know or enforce what people owe. It just makes it easy to pay the winner.
- **No new dependencies** — just a styled `<a>` tag, no QR library needed

### Dependencies
- **Soft dependency on item #1 (auth)** — needs the `users` table to store `venmo_handle`. Without auth, could store Venmo handles in the JSONB state as a workaround.
- **Works independently** — the champion display itself (without Venmo) has no dependencies

### Files to Touch
- `lib/db.js` — add `venmo_handle` column to `users` table
- `pages/index.js` — add `tournamentComplete` detection, champion banner component, Venmo pay link
- `styles/globals.css` — champion banner styles (gold border, centered layout, Venmo button)
- `pages/api/register.js` or new `pages/api/profile.js` — accept/return Venmo handle

### Testing Notes
- Complete a tournament (all golfers finish) — verify champion banner appears automatically
- Verify banner shows correct winner name and score
- Set a Venmo handle for the winner — verify "Pay {name} on Venmo" button appears
- Click the Venmo button — verify it opens `https://account.venmo.com/pay?recipients={handle}`
- Test with winner who has no Venmo handle — verify banner shows without payment section
- Verify banner does NOT appear while golfers are still playing (mid-round)
- Test on mobile — verify Venmo button opens the Venmo app pay screen
- View a past tournament in history — verify champion name shows but no Venmo button

---

## 9. Pull to Refresh on Mobile
*Unrefined — needs spec*

Add pull-to-refresh gesture support on mobile viewports so users can trigger a score/state refresh by pulling down on the page, matching native app behavior. Currently the only way to refresh is the header "Refresh" button or waiting for the 2-minute polling cycle.

---

## 10. Collect Venmo Handle on Sign Up
*Unrefined — needs spec*

Add an optional "Venmo username" field to the registration form (item #1). Store in `users.venmo_handle`. This is used by the champion display (item #8) to generate the pay link. Should also be editable after registration via a simple profile/settings UI.

---

## 11. Right-Align Header Buttons
*Unrefined — needs spec*

The header-right section (`pages/index.js:504-527`, `styles/globals.css:46`) contains the user badge, refresh timestamp, refresh button, and reset button. On some viewports these wrap awkwardly. Ensure buttons are properly right-aligned and don't collide with the tournament name/selector on narrow screens.

---

## 12. Accessibility Fixes

### Problem
The app has significant accessibility gaps that prevent screen reader users, keyboard-only users, and colorblind users from using it effectively.

### P0 — Critical (must fix)

#### Add `lang="en"` to HTML
Screen readers can't determine page language. Add a custom `pages/_document.js` with `<Html lang="en">` or set `i18n.defaultLocale` in `next.config.js`.

**Files:** New `pages/_document.js` or `next.config.js`

#### Add `role="alert"` to error messages
Error divs (`<div className="error">`) are not announced to screen readers. Add `role="alert"` so errors are read aloud immediately.

**Files:** `pages/index.js` — every `{err && <div className="error">...}` block

#### Make clickable divs keyboard-accessible
Draft pick results (`pages/index.js:769-784`) and commissioner assign results (`pages/index.js:948-974`) use `<div onClick>` with no keyboard support. Add `role="button"`, `tabIndex={0}`, and `onKeyDown` (Enter/Space triggers click) to each. Alternatively, replace with `<button>` elements styled as rows.

**Files:** `pages/index.js`

### P1 — Major

#### Fix color contrast for muted text
`--text-light: #8a8a7a` on `--green-deep: #1a2e1a` has ~2.8:1 contrast ratio, below the WCAG AA minimum of 4.5:1. Raise to at least `#a0a090` or lighter.

**Files:** `styles/globals.css` — `:root` variable

#### Add labels to placeholder-only inputs
These inputs have no `<label>` or `aria-label`:
- Password input (`pages/index.js:452-455`)
- Search player input (`pages/index.js:762-766`)
- Join name input (`pages/index.js:539`)
- Add drafter input (`pages/index.js:688`)

Add `aria-label` attributes matching the placeholder text.

**Files:** `pages/index.js`

#### Add ARIA tab pattern
The Draft Board / Scoreboard tabs (`pages/index.js:735-748`) lack proper ARIA roles. Add:
- `role="tablist"` on the tab container
- `role="tab"`, `aria-selected`, `aria-controls` on each tab button
- `role="tabpanel"`, `id` on each content panel

**Files:** `pages/index.js`

#### Add `:focus-visible` styles
Buttons and interactive elements have no custom focus indicator. The dark background makes the browser default focus ring nearly invisible. Add visible `:focus-visible` outlines (gold border or outline).

**Files:** `styles/globals.css` — add `:focus-visible` rules for `.btn`, `.btn-ghost`, `.tab`, `.result-item`, `input`, `select`

### P2 — Moderate

#### Add accessible names to icon indicators
- `★` (counting golfer) and `✕` (non-counting) at `pages/index.js:870-871` — wrap in `<span aria-hidden="true">` and add a `<span className="sr-only">` with text like "counting" / "not counting"
- Tag remove button `×` (`pages/index.js:657`) — add `aria-label="Remove {drafter name}"`

**Files:** `pages/index.js`, `styles/globals.css` (add `.sr-only` utility class)

#### Add skip navigation link
Add a "Skip to main content" link as the first focusable element in the page, visually hidden until focused.

**Files:** `pages/index.js`, `styles/globals.css`

#### Add `aria-live` for score updates
When scores auto-refresh (every 2 min polling), content changes without announcement. Add an `aria-live="polite"` region that announces "Scores updated" when new data arrives.

**Files:** `pages/index.js`

### P3 — Minor

#### Dynamic page title
Update `<title>` based on app state: "Setup — Golf League", "Lobby — Golf League", "Draft — Golf League", "Scoreboard — Golf League".

**Files:** `pages/index.js` — `<Head>` component

#### Focus management on transitions
- Move focus to password input when `needsAuth` becomes true
- Move focus to tab content when switching tabs

**Files:** `pages/index.js` — add `useRef` + `focus()` calls

### Acceptance Criteria
- [ ] Page has `lang="en"` on the `<html>` element
- [ ] Error messages have `role="alert"` and are announced by screen readers
- [ ] All interactive elements are reachable and operable via keyboard (Tab, Enter, Space)
- [ ] Muted text meets WCAG AA contrast ratio (4.5:1 minimum)
- [ ] All form inputs have accessible labels (via `<label>`, `aria-label`, or `aria-labelledby`)
- [ ] Tabs follow the ARIA tablist pattern with proper roles and states
- [ ] All interactive elements have a visible focus indicator
- [ ] Icon-only elements have accessible text alternatives
- [ ] A skip navigation link is present
- [ ] Score updates are announced via `aria-live` region
- [ ] Page title reflects current app state

### Scope Boundaries
- This item covers the existing codebase only — new features from other backlog items should implement accessibility from the start
- No full WCAG AAA compliance — target AA
- No automated testing setup (e.g., axe-core) — manual review is sufficient for this scale

### Files to Touch
- New: `pages/_document.js` — add `lang="en"`
- `pages/index.js` — ARIA roles, labels, keyboard handlers, focus management, dynamic title, live regions
- `styles/globals.css` — contrast fix, `:focus-visible` styles, `.sr-only` utility class

### Testing Notes
- Navigate entire app with keyboard only (no mouse) — every action should be possible
- Test with a screen reader (VoiceOver on Mac) — verify all content and actions are announced
- Check color contrast with browser dev tools or a contrast checker
- Verify error messages are announced immediately when they appear
- Tab through the draft pick list — verify each available golfer is focusable and selectable with Enter
