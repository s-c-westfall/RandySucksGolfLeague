// pages/api/register.js
// POST { name, email, password, venmoHandle }
// Creates a new user in the users table.

import bcrypt from 'bcryptjs';
import { sql, ensureTable } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name, email, password, venmoHandle } = req.body || {};

  // Validate inputs
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    return res.status(400).json({ error: 'Display name is required.' });
  }

  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  await ensureTable();

  // Check for duplicate email
  const existing = await sql`
    SELECT id FROM users WHERE email = ${trimmedEmail} LIMIT 1
  `;
  if (existing.length > 0) {
    return res.status(409).json({ error: 'That email is already registered.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const venmo = (venmoHandle || '').trim() || null;

  await sql`
    INSERT INTO users (name, email, password_hash, venmo_handle)
    VALUES (${trimmedName}, ${trimmedEmail}, ${passwordHash}, ${venmo})
  `;

  return res.status(200).json({ ok: true });
}
