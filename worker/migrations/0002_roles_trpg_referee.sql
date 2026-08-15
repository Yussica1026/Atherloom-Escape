ALTER TABLE escape_games ADD COLUMN game_type TEXT NOT NULL DEFAULT 'escape';
ALTER TABLE escape_seats ADD COLUMN role TEXT NOT NULL DEFAULT 'player';

CREATE TABLE IF NOT EXISTS escape_referees (
  game_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  route_label TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(game_id) REFERENCES escape_games(id)
);
