// pages/api/profile.js
// GET /api/profile?name=Alice
// Returns public profile fields for a user by display name.
// No auth required (venmo_handle is public enough for league use).

import { sql, ensureTable } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });
  await ensureTable();
  const rows = await sql`SELECT name, venmo_handle FROM users WHERE name = ${name} LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  return res.status(200).json({ name: rows[0].name, venmoHandle: rows[0].venmo_handle });
}
