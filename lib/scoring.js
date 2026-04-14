// lib/scoring.js
// Server-side scoring logic — mirrors the client-side buildTeams in pages/index.js.
// Keep these in sync if scoring logic ever changes.

export function buildSnakeOrder(n, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r++) {
    const row = Array.from({ length: n }, (_, i) => i);
    if (r % 2 === 1) row.reverse();
    order.push(...row);
  }
  return order;
}

export function buildTeams(s, previousRankings = {}) {
  const teams = s.drafters.map((name, idx) => {
    const golfers = s.picks
      .filter((p) => p.drafterIndex === idx)
      .map((p) => {
        const sc = s.scores[p.playerId];
        const cut = sc?.status === 'cut' || sc?.status === 'wd';
        return {
          name: p.name,
          playerId: p.playerId,
          total: sc ? sc.total : null,
          status: sc?.status || 'unknown',
          thru:
            typeof sc?.thru === 'string' || typeof sc?.thru === 'number'
              ? sc.thru
              : '–',
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
      sorted[i].position = '–';
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
      t.teamTotal === null ? '–' : tied ? `T${t.position}` : `${t.position}`;
    const prev = previousRankings?.[t.name];
    t.movement =
      prev != null && t.position != null && typeof t.position === 'number'
        ? prev - t.position
        : 0;
  }

  return sorted;
}
