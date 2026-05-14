-- Run this in the Supabase SQL editor after creating your project.
-- Supabase manages auth.users automatically.

CREATE TABLE saved_routes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users NOT NULL,
  name            text NOT NULL,
  short_name      text,
  color           text,
  is_custom       boolean DEFAULT false,
  base_route_id   text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE route_stops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id        uuid REFERENCES saved_routes ON DELETE CASCADE,
  stop_sequence   int NOT NULL,
  stop_id         text,
  stop_name       text NOT NULL,
  stop_lat        double precision NOT NULL,
  stop_lon        double precision NOT NULL
);

-- Auto-update updated_at on saved_routes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER saved_routes_updated_at
  BEFORE UPDATE ON saved_routes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE saved_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stops  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own routes"
  ON saved_routes FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own stops via route"
  ON route_stops FOR ALL
  USING (
    route_id IN (
      SELECT id FROM saved_routes WHERE user_id = auth.uid()
    )
  );
