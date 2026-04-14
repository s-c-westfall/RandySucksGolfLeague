import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

let _initialized = false;

export async function ensureTable() {
  if (_initialized) return;
  await sql`
    CREATE TABLE IF NOT EXISTS league_state (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      state JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      venmo_handle TEXT,
      is_commissioner BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  _initialized = true;
}

export { sql };
