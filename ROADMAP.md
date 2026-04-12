# Roadmap

Items are fully spec'd in [BACKLOG.md](BACKLOG.md) with acceptance criteria, visual mockups, and implementation details.

## High priority — before next tournament

### 1. User authentication (NextAuth.js + Neon)
Per-user accounts with email/password, persistent sessions, server-side identity. Foundation for all features that need to know *who* is acting. *(Backlog #1)*

### 2. Draft table — 4-column layout with snake order
Participant | Rd 1 | Rd 2 | Rd 3 columns; snake fill order visualized as picks are made. *(Backlog #2)*

### 3. Last pick display
Inline banner above the draft board showing the most recently drafted golfer and who picked them. *(Backlog #3)*

### 4. Keyboard navigation for golfer selection
Arrow keys to navigate the search results, Enter to confirm. Standard autocomplete behavior. *(Backlog #4)*

### 5. Accessibility fixes
ARIA roles, keyboard access for all interactive elements, color contrast, screen reader support. *(Backlog #12)*

---

## Mid priority — during tournament

### 6. Leaderboard position movement indicators
Green ▲ / red ▼ arrows with delta next to position number, plus colored left-edge pip on each team card. *(Backlog #5)*

### 7. Champion display with Venmo pay link
Auto-triggered champion banner when tournament ends, with a Venmo deep link so losers can pay the winner. *(Backlog #8)*

### 8. Right-align header buttons
Fix header layout wrapping on narrow viewports. *(Backlog #11)*

---

## Post-tournament / next cycle

### 9. Tournament history
Archive tournaments on reset to a normalized schema. Browse past results via a dropdown in the header that replaces the tournament name. *(Backlog #6)*

### 10. Challenges (targeted side bets)
Challenge a specific opponent to a head-to-head bet. Opponent accepts or declines. Auto-settles from final standings. *(Backlog #7)*

### 11. Collect Venmo handle on sign up
Optional Venmo username field during registration, editable in profile. Used by champion display. *(Backlog #10)*

### 12. Pull to refresh on mobile
Native pull-to-refresh gesture for score/state updates. *(Backlog #9)*

---

## Development waves

See [BACKLOG.md — Development Instructions](BACKLOG.md#development-instructions) for parallel subagent workflow and stress testing checklists.

| Wave | Items | Notes |
|------|-------|-------|
| 1 | #2, #3, #4, #5 | UI-only, parallel in worktrees |
| 2 | #1 | Auth foundation, blocks later waves |
| 3 | #6, #8 | Independent UI/backend tweaks, parallel |
| 4 | #9 | Tournament history + DB schema |
| 5 | #7, #10, #11 | Challenges, champion, Venmo — parallel |
| 6 | #12 | Pull to refresh (polish) |
