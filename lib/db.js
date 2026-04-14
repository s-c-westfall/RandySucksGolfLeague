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
  await sql`
    CREATE TABLE IF NOT EXISTS tournaments (
      id SERIAL PRIMARY KEY,
      tourn_id TEXT NOT NULL,
      name TEXT NOT NULL,
      year TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ,
      winner_name TEXT,
      winner_user_id INTEGER REFERENCES users(id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tournament_picks (
      id SERIAL PRIMARY KEY,
      tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      drafter_name TEXT NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      pick_index INTEGER NOT NULL,
      round INTEGER NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tournament_standings (
      id SERIAL PRIMARY KEY,
      tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      drafter_name TEXT NOT NULL,
      position INTEGER,
      display_position TEXT,
      team_total INTEGER,
      golfer_scores JSONB
    )
  `;
  await sql`
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
    )
  `;
  _initialized = true;
}

export { sql };
