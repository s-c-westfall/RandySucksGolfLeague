# Roadmap

Items are fully spec'd in [BACKLOG.md](BACKLOG.md) with acceptance criteria, visual mockups, and implementation details.

## Wave 1 — UI improvements ✅ COMPLETE

### Draft table — 4-column layout with snake order ✅
Participant | Rd 1 | Rd 2 | Rd 3 columns; snake fill order visualized as picks are made. *(Backlog #2)*

### Last pick display ✅
Inline banner above the draft board showing the most recently drafted golfer and who picked them. *(Backlog #3)*

### Keyboard navigation for golfer selection ✅
Arrow keys to navigate the search results, Enter to confirm. Standard autocomplete behavior. *(Backlog #4)*

### Leaderboard position movement indicators ✅
Green ▲ / red ▼ arrows with delta next to position number, plus colored left-edge pip on each team card. *(Backlog #5)*

### Right-align header buttons ✅
Fix header layout wrapping on narrow viewports. *(Backlog #11)*

### Accessibility fixes ✅
ARIA roles, keyboard access for all interactive elements, color contrast, screen reader support. *(Backlog #12)*

---

## Wave 2 — Auth foundation ✅ COMPLETE

### User authentication (NextAuth.js + Neon) ✅
Per-user accounts with email/password, persistent sessions, server-side identity. Includes optional Venmo handle collection during signup. Foundation for all features that need to know *who* is acting. *(Backlog #1, #10)*

---

## Wave 3 — Tournament history ✅ COMPLETE

### Tournament history ✅
Archive tournaments on reset to a normalized schema. Browse past results via a dropdown in the header that replaces the tournament name. *(Backlog #6)*

---

## Wave 4 — Features requiring auth + history (parallel)

### Challenges (targeted side bets) ✅
Challenge a specific opponent to a head-to-head bet. Opponent accepts or declines. Auto-settles from final standings. Requires auth (#1) and tournament history (#6). *(Backlog #7)*

### Champion Venmo pay link ✅
Add Venmo deep link to the existing champion banner so losers can pay the winner. Requires `venmo_handle` from auth (#1). *(Backlog #8)*

---

## Wave 5 — Polish

### Pull to refresh on mobile
Native pull-to-refresh gesture for score/state updates. *(Backlog #9)*

---

## Development waves

See [BACKLOG.md — Development Instructions](BACKLOG.md#development-instructions) for parallel subagent workflow and stress testing checklists.

| Wave | Items | Notes |
|------|-------|-------|
| ~~1~~ | ~~#2, #3, #4, #5, #11, #12~~ | ✅ Complete |
| ~~2~~ | ~~#1 (+#10)~~ | ✅ Complete |
| ~~3~~ | ~~#6~~ | ✅ Complete |
| ~~4~~ | ~~#7, #8~~ | ✅ Complete |
| 5 | #9 | Pull to refresh (polish) |
