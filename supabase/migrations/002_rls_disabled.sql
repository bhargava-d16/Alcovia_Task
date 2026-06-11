-- ============================================================
-- Migration 002: Disable Row Level Security
-- ============================================================
-- RLS is disabled for this assignment. There is only one student
-- (student_001), hardcoded, so RLS would add complexity with no
-- security benefit in this demo context.
--
-- IN PRODUCTION you would:
-- 1. Enable RLS on every table
-- 2. Use Supabase Auth — each user gets a JWT with their student_id
-- 3. Create policies like:
--    CREATE POLICY "students can only see own data"
--      ON focus_sessions FOR ALL
--      USING (student_id = auth.uid()::text);
-- 4. The service role key (used server-side) bypasses RLS entirely,
--    which is fine — only the backend can write reward state.
-- See DECISIONS.md for full discussion.

ALTER TABLE student_stats          DISABLE ROW LEVEL SECURITY;
ALTER TABLE focus_sessions         DISABLE ROW LEVEL SECURITY;
ALTER TABLE subjects               DISABLE ROW LEVEL SECURITY;
ALTER TABLE chapters               DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events            DISABLE ROW LEVEL SECURITY;
ALTER TABLE processed_notifications DISABLE ROW LEVEL SECURITY;
