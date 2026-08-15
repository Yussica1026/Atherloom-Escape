CREATE TABLE IF NOT EXISTS escape_games (
  id TEXT PRIMARY KEY,
  invite_hash TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  world TEXT NOT NULL,
  tone TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS escape_seats (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  client_id TEXT,
  seat_token_hash TEXT,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  seat_no INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(game_id, client_id),
  FOREIGN KEY(game_id) REFERENCES escape_games(id)
);

CREATE INDEX IF NOT EXISTS escape_seats_game ON escape_seats(game_id, seat_no);
CREATE INDEX IF NOT EXISTS escape_seats_token ON escape_seats(seat_token_hash);

CREATE TABLE IF NOT EXISTS escape_audit (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  seat_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS escape_audit_game ON escape_audit(game_id, created_at);
