-- ============================================================
-- ALCOVIA — Complete Database Setup Script
-- Paste this entire file into the Supabase SQL Editor and run.
-- Creates all tables, the reward function, disables RLS,
-- and inserts mock data for student_001.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- STEP 1: Extensions
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ─────────────────────────────────────────────────────────────
-- STEP 2: Tables
-- ─────────────────────────────────────────────────────────────

-- Student stats (coins, streak, focus minutes)
CREATE TABLE IF NOT EXISTS student_stats (
  student_id          TEXT PRIMARY KEY,
  coins               INT NOT NULL DEFAULT 0,
  streak_days         INT NOT NULL DEFAULT 0,
  last_success_date   DATE,
  today_focus_minutes INT NOT NULL DEFAULT 0,
  last_updated_hlc    TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Focus sessions
CREATE TABLE IF NOT EXISTS focus_sessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              TEXT NOT NULL DEFAULT 'student_001',
  client_id               TEXT NOT NULL,
  target_duration_minutes INT NOT NULL,
  started_at              TIMESTAMPTZ NOT NULL,
  ended_at                TIMESTAMPTZ,
  status                  TEXT CHECK (status IN ('in_progress', 'success', 'failed')),
  fail_reason             TEXT CHECK (fail_reason IN ('give_up', 'app_switch')),
  coins_awarded           INT DEFAULT 0,
  synced_at               TIMESTAMPTZ,
  reward_processed        BOOLEAN NOT NULL DEFAULT FALSE,
  notification_sent       BOOLEAN NOT NULL DEFAULT FALSE,
  hlc_timestamp           TEXT NOT NULL,
  UNIQUE (id)
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_student_status
  ON focus_sessions (student_id, status);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_student_date
  ON focus_sessions (student_id, started_at);

-- Subjects
CREATE TABLE IF NOT EXISTS subjects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL
);

-- Chapters
CREATE TABLE IF NOT EXISTS chapters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  order_index INT NOT NULL
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id              UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'done')),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_client       TEXT NOT NULL DEFAULT 'server',
  hlc_timestamp           TEXT NOT NULL,
  is_deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  last_writer_wins_vector TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_chapter ON tasks (chapter_id);

-- Sync events log (all events from all clients)
CREATE TABLE IF NOT EXISTS sync_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  hlc         TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_events_hlc     ON sync_events (hlc);
CREATE INDEX IF NOT EXISTS idx_sync_events_student ON sync_events (student_id, hlc);

-- n8n deduplication table (exactly-once notifications)
CREATE TABLE IF NOT EXISTS processed_notifications (
  session_id   UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────
-- STEP 3: Disable Row Level Security
-- (single hardcoded student — see DECISIONS.md for production guidance)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE student_stats           DISABLE ROW LEVEL SECURITY;
ALTER TABLE focus_sessions          DISABLE ROW LEVEL SECURITY;
ALTER TABLE subjects                DISABLE ROW LEVEL SECURITY;
ALTER TABLE chapters                DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events             DISABLE ROW LEVEL SECURITY;
ALTER TABLE processed_notifications DISABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- STEP 4: Reward Processing RPC (atomic transaction)
--
-- Called by the Express backend via supabase.rpc('process_session_reward', ...)
-- Implements SELECT FOR UPDATE on both rows to prevent double rewards.
-- reward_processed flag is set IN THE SAME TRANSACTION as the coin update.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION process_session_reward(
  p_session_id       UUID,
  p_student_id       TEXT,
  p_duration_minutes INT,
  p_hlc_timestamp    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_reward_processed  BOOLEAN;
  v_coins             INT;
  v_streak_days       INT;
  v_last_success_date DATE;
  v_today_minutes     INT;
  v_new_streak        INT;
  v_today             DATE := CURRENT_DATE;
BEGIN
  -- Step 1: Lock the session row — prevents concurrent /complete for same session
  SELECT reward_processed
  INTO   v_reward_processed
  FROM   focus_sessions
  WHERE  id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;

  -- Step 2: Idempotency gate — checked INSIDE the lock
  IF v_reward_processed THEN
    RETURN jsonb_build_object(
      'already_processed',   TRUE,
      'coins_awarded',       0,
      'new_total_coins',     0,
      'new_streak_days',     0,
      'today_focus_minutes', 0
    );
  END IF;

  -- Step 3: Ensure student_stats row exists
  INSERT INTO student_stats (student_id, coins, streak_days, today_focus_minutes)
  VALUES (p_student_id, 0, 0, 0)
  ON CONFLICT (student_id) DO NOTHING;

  -- Step 4: Lock student_stats row — prevents concurrent coin writes
  SELECT coins, streak_days, last_success_date, today_focus_minutes
  INTO   v_coins, v_streak_days, v_last_success_date, v_today_minutes
  FROM   student_stats
  WHERE  student_id = p_student_id
  FOR UPDATE;

  -- Step 5: Compute new streak
  IF v_last_success_date = v_today THEN
    -- Already had a successful session today — don't double-increment
    v_new_streak := v_streak_days;
  ELSIF v_last_success_date = v_today - INTERVAL '1 day' THEN
    -- Yesterday — extend streak
    v_new_streak := v_streak_days + 1;
  ELSE
    -- Gap or first ever session — reset to 1
    v_new_streak := 1;
  END IF;

  -- Step 6: Update student_stats
  UPDATE student_stats SET
    coins               = coins + 50,
    streak_days         = v_new_streak,
    last_success_date   = v_today,
    today_focus_minutes = today_focus_minutes + p_duration_minutes,
    last_updated_hlc    = p_hlc_timestamp,
    updated_at          = NOW()
  WHERE student_id = p_student_id;

  -- Step 7: Set reward_processed = TRUE in SAME transaction as coin update
  UPDATE focus_sessions SET
    status           = 'success',
    ended_at         = NOW(),
    coins_awarded    = 50,
    reward_processed = TRUE,
    synced_at        = NOW()
  WHERE id = p_session_id;

  -- Step 8: Return result for the backend to use in n8n webhook call
  RETURN jsonb_build_object(
    'already_processed',   FALSE,
    'coins_awarded',       50,
    'new_total_coins',     v_coins + 50,
    'new_streak_days',     v_new_streak,
    'today_focus_minutes', v_today_minutes + p_duration_minutes
  );
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- STEP 5: Seed Data — student_001
-- Fixed UUIDs so this is safe to re-run (idempotent via ON CONFLICT)
-- ─────────────────────────────────────────────────────────────

-- Student stats (starting fresh)
INSERT INTO student_stats (student_id, coins, streak_days, today_focus_minutes, last_updated_hlc)
VALUES ('student_001', 0, 0, 0, '000000000000000-00000-seed')
ON CONFLICT (student_id) DO NOTHING;


-- ── Subjects ──────────────────────────────────────────────────────────────────

INSERT INTO subjects (id, student_id, name, color) VALUES
  ('11111111-1111-1111-1111-111111111111', 'student_001', 'Physics',     '#3B82F6'),
  ('22222222-2222-2222-2222-222222222222', 'student_001', 'Mathematics', '#8B5CF6'),
  ('33333333-3333-3333-3333-333333333333', 'student_001', 'History',     '#F59E0B')
ON CONFLICT (id) DO NOTHING;


-- ── Chapters ──────────────────────────────────────────────────────────────────

INSERT INTO chapters (id, subject_id, name, order_index) VALUES
  -- Physics
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mechanics',        1),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Thermodynamics',   2),
  -- Mathematics
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Algebra',          1),
  ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Calculus',         2),
  -- History
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Ancient Civilisations', 1),
  ('a3000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'World War II',     2)
ON CONFLICT (id) DO NOTHING;


-- ── Tasks (4 per chapter = 24 tasks total) ────────────────────────────────────
-- Some tasks have varied statuses to make the UI look interesting on first load

INSERT INTO tasks (id, chapter_id, title, status, updated_at, updated_by_client, hlc_timestamp, is_deleted) VALUES

  -- Physics › Mechanics
  ('b0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Read textbook section',    'done',        NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Solve practice problems',  'in_progress', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Watch lecture video',      'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'Complete chapter quiz',    'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),

  -- Physics › Thermodynamics
  ('b0000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', 'Read textbook section',    'done',        NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000002', 'Solve practice problems',  'done',        NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000002', 'Watch lecture video',      'in_progress', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000002', 'Complete chapter quiz',    'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),

  -- Mathematics › Algebra
  ('b0000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000001', 'Read textbook section',    'done',        NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000010', 'a2000000-0000-0000-0000-000000000001', 'Solve practice problems',  'done',        NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000011', 'a2000000-0000-0000-0000-000000000001', 'Watch lecture video',      'done',        NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000012', 'a2000000-0000-0000-0000-000000000001', 'Complete chapter quiz',    'done',        NOW(), 'seed', '000000000000000-00000-seed', FALSE),

  -- Mathematics › Calculus
  ('b0000000-0000-0000-0000-000000000013', 'a2000000-0000-0000-0000-000000000002', 'Read textbook section',    'in_progress', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000014', 'a2000000-0000-0000-0000-000000000002', 'Solve practice problems',  'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000015', 'a2000000-0000-0000-0000-000000000002', 'Watch lecture video',      'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000016', 'a2000000-0000-0000-0000-000000000002', 'Complete chapter quiz',    'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),

  -- History › Ancient Civilisations
  ('b0000000-0000-0000-0000-000000000017', 'a3000000-0000-0000-0000-000000000001', 'Read textbook section',    'done',        NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000018', 'a3000000-0000-0000-0000-000000000001', 'Solve practice problems',  'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000019', 'a3000000-0000-0000-0000-000000000001', 'Watch lecture video',      'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000020', 'a3000000-0000-0000-0000-000000000001', 'Complete chapter quiz',    'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),

  -- History › World War II
  ('b0000000-0000-0000-0000-000000000021', 'a3000000-0000-0000-0000-000000000002', 'Read textbook section',    'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000022', 'a3000000-0000-0000-0000-000000000002', 'Solve practice problems',  'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000023', 'a3000000-0000-0000-0000-000000000002', 'Watch lecture video',      'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE),
  ('b0000000-0000-0000-0000-000000000024', 'a3000000-0000-0000-0000-000000000002', 'Complete chapter quiz',    'not_started', NOW(), 'seed', '000000000000000-00000-seed', FALSE)

ON CONFLICT (id) DO NOTHING;


-- ── Mock focus sessions (some history to show in the app) ─────────────────────

INSERT INTO focus_sessions (
  id, student_id, client_id, target_duration_minutes,
  started_at, ended_at, status, coins_awarded,
  reward_processed, notification_sent, hlc_timestamp
) VALUES
  -- Yesterday — successful 45-min session
  (
    'f1000000-0000-0000-0000-000000000001',
    'student_001', 'A', 45,
    NOW() - INTERVAL '1 day 2 hours',
    NOW() - INTERVAL '1 day 1 hour 15 minutes',
    'success', 50, TRUE, TRUE,
    '000000000000001-00000-seed'
  ),
  -- Yesterday — successful 25-min session
  (
    'f1000000-0000-0000-0000-000000000002',
    'student_001', 'B', 25,
    NOW() - INTERVAL '1 day 30 minutes',
    NOW() - INTERVAL '1 day 5 minutes',
    'success', 50, TRUE, TRUE,
    '000000000000002-00000-seed'
  ),
  -- Today — successful 60-min session (so streak = 2, coins = 150, today = 60 min)
  (
    'f1000000-0000-0000-0000-000000000003',
    'student_001', 'A', 60,
    NOW() - INTERVAL '3 hours',
    NOW() - INTERVAL '2 hours',
    'success', 50, TRUE, TRUE,
    '000000000000003-00000-seed'
  ),
  -- Today — a failed session (no coins)
  (
    'f1000000-0000-0000-0000-000000000004',
    'student_001', 'B', 25,
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '45 minutes',
    'failed', 0, TRUE, FALSE,
    '000000000000004-00000-seed'
  )
ON CONFLICT (id) DO NOTHING;


-- ── Update student_stats to reflect the mock sessions above ───────────────────
-- (coins=150 for 3 sessions, streak=2 days, today=60 min)

UPDATE student_stats SET
  coins               = 150,
  streak_days         = 2,
  last_success_date   = CURRENT_DATE,
  today_focus_minutes = 60,
  last_updated_hlc    = '000000000000003-00000-seed',
  updated_at          = NOW()
WHERE student_id = 'student_001';


-- ── Processed notifications (for the 3 successful sessions) ──────────────────

INSERT INTO processed_notifications (session_id) VALUES
  ('f1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000003')
ON CONFLICT (session_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- VERIFICATION: Run these SELECT statements to confirm setup
-- ─────────────────────────────────────────────────────────────

-- SELECT * FROM student_stats;
-- SELECT COUNT(*) AS subject_count FROM subjects;       -- should be 3
-- SELECT COUNT(*) AS chapter_count FROM chapters;       -- should be 6
-- SELECT COUNT(*) AS task_count    FROM tasks;          -- should be 24
-- SELECT COUNT(*) AS session_count FROM focus_sessions; -- should be 4
-- SELECT * FROM processed_notifications;                -- should be 3 rows
