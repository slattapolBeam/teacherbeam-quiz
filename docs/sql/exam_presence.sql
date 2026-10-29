-- Presence heartbeat for Typing Heist: only students seen recently can be picked as victims.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- Written/read only through the service-role client (bypasses RLS), and deliberately NOT added
-- to the supabase_realtime publication so heartbeats don't trigger postgres_changes events.

CREATE TABLE IF NOT EXISTS exam_presence (
  student_id   text PRIMARY KEY,
  project_name text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exam_presence ENABLE ROW LEVEL SECURITY;
