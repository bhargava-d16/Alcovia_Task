-- ============================================================
-- Migration 001: Initial Schema
-- Alcovia — Gamified Study App
-- ============================================================
-- RLS is disabled (see migration 002). In production you would
-- enable RLS with policies per student_id — see DECISIONS.md.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Student stats (rewards, streak, focus minutes) ─────────────────────────
CREATE TABLE IF NOT EXISTS student_stats (
  student_id          TEXT PRIMARY KEY,
  coins               INT NOT NULL DEFAULT 0,
  streak_days         INT NOT NULL DEFAULT 0,
  last_success_date   DATE,                      -- for streak calculation
  today_focus_minutes INT NOT NULL DEFAULT 0,
  last_updated_hlc    TEXT,                      -- HLC of last write (audit)
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Focus sessions ──────────────────────────────────────────────────────────
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
  -- Idempotency gates — both set atomically in the reward transaction
  reward_processed        BOOLEAN NOT NULL DEFAULT FALSE,
  notification_sent       BOOLEAN NOT NULL DEFAULT FALSE,
  hlc_timestamp           TEXT NOT NULL,
  UNIQUE (id)  -- belt-and-suspenders: prevents duplicate sync inserts
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_student_status
  ON focus_sessions (student_id, status);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_student_date
  ON focus_sessions (student_id, started_at);

-- ─── Subjects, Chapters, Tasks (syllabus) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS subjects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL  -- hex color for card accent
);

CREATE TABLE IF NOT EXISTS chapters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  order_index INT NOT NULL
);

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
  last_writer_wins_vector TEXT  -- serialized winning HLC for audit
);

CREATE INDEX IF NOT EXISTS idx_tasks_chapter ON tasks (chapter_id);

-- ─── Sync events log ─────────────────────────────────────────────────────────
-- Server stores ALL events from ALL clients. This is the source of truth.
-- Clients fetch events with HLC > their lastSyncedHLC for incremental sync.
CREATE TABLE IF NOT EXISTS sync_events (
  id          TEXT PRIMARY KEY,       -- UUID from client — stable across retries
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  hlc         TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for incremental sync: "give me all events after HLC X"
-- HLC strings sort lexicographically = causal order (due to zero-padding)
CREATE INDEX IF NOT EXISTS idx_sync_events_hlc ON sync_events (hlc);
CREATE INDEX IF NOT EXISTS idx_sync_events_student ON sync_events (student_id, hlc);

-- ─── n8n deduplication ───────────────────────────────────────────────────────
-- Prevents double WhatsApp notifications even if the webhook fires twice
-- for the same session (e.g. network timeout + retry).
CREATE TABLE IF NOT EXISTS processed_notifications (
  session_id   UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
