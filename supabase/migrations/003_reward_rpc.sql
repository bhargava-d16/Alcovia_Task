-- ============================================================
-- Migration 003: Reward Processing RPC
-- ============================================================
-- This stored procedure implements the atomic reward transaction.
--
-- WHY A STORED PROCEDURE:
-- Supabase JS client doesn't expose raw BEGIN/COMMIT control.
-- Using an RPC (called via supabase.rpc()) lets us run the entire
-- transaction server-side in Postgres where FOR UPDATE is native.
-- The app server calls this once; Postgres handles all the locking.

CREATE OR REPLACE FUNCTION process_session_reward(
  p_session_id      UUID,
  p_student_id      TEXT,
  p_duration_minutes INT,
  p_hlc_timestamp   TEXT
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
  -- ── Step 1: Lock session row ──────────────────────────────────────────────
  SELECT reward_processed
  INTO v_reward_processed
  FROM focus_sessions
  WHERE id = p_session_id
  FOR UPDATE;                    -- prevents concurrent /complete for same session

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;

  -- ── Step 2: Idempotency check INSIDE the lock ─────────────────────────────
  IF v_reward_processed THEN
    RETURN jsonb_build_object(
      'already_processed',  TRUE,
      'coins_awarded',      0,
      'new_total_coins',    0,
      'new_streak_days',    0,
      'today_focus_minutes', 0
    );
  END IF;

  -- ── Step 3: Lock student_stats row ───────────────────────────────────────
  -- Insert if first session ever (idempotent with ON CONFLICT DO NOTHING)
  INSERT INTO student_stats (student_id, coins, streak_days, today_focus_minutes)
  VALUES (p_student_id, 0, 0, 0)
  ON CONFLICT (student_id) DO NOTHING;

  SELECT coins, streak_days, last_success_date, today_focus_minutes
  INTO v_coins, v_streak_days, v_last_success_date, v_today_minutes
  FROM student_stats
  WHERE student_id = p_student_id
  FOR UPDATE;                    -- serializes concurrent reward writes

  -- ── Step 4: Compute new streak ────────────────────────────────────────────
  IF v_last_success_date = v_today THEN
    -- Already had a successful session today — don't double-increment streak
    v_new_streak := v_streak_days;
  ELSIF v_last_success_date = v_today - INTERVAL '1 day' THEN
    -- Yesterday — extend streak
    v_new_streak := v_streak_days + 1;
  ELSE
    -- Gap or first ever session — reset to 1
    v_new_streak := 1;
  END IF;

  -- ── Step 5: Update student_stats ─────────────────────────────────────────
  UPDATE student_stats SET
    coins               = coins + 50,
    streak_days         = v_new_streak,
    last_success_date   = v_today,
    today_focus_minutes = today_focus_minutes + p_duration_minutes,
    last_updated_hlc    = p_hlc_timestamp,
    updated_at          = NOW()
  WHERE student_id = p_student_id;

  -- ── Step 6: Flip reward_processed IN THE SAME TRANSACTION ────────────────
  -- This is the critical step: both writes commit atomically.
  -- If the server crashes here, BOTH writes are rolled back — the next
  -- retry will see reward_processed = FALSE and process correctly.
  UPDATE focus_sessions SET
    status           = 'success',
    ended_at         = NOW(),
    coins_awarded    = 50,
    reward_processed = TRUE,       -- same tx as student_stats update above
    synced_at        = NOW()
  WHERE id = p_session_id;

  -- ── Step 7: Return result for n8n webhook ─────────────────────────────────
  RETURN jsonb_build_object(
    'already_processed',   FALSE,
    'coins_awarded',       50,
    'new_total_coins',     v_coins + 50,
    'new_streak_days',     v_new_streak,
    'today_focus_minutes', v_today_minutes + p_duration_minutes
  );
END;
$$;
