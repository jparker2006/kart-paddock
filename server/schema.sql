CREATE TABLE IF NOT EXISTS community_ratings (
  namespace text NOT NULL,
  voter_hash text NOT NULL CHECK (voter_hash ~ '^[a-f0-9]{64}$'),
  game text NOT NULL CHECK (game IN ('a','b','c','d','e')),
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, voter_hash, game)
);
CREATE TABLE IF NOT EXISTS rating_write_limits (
  namespace text NOT NULL,
  voter_hash text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1,
  PRIMARY KEY (namespace, voter_hash)
);
