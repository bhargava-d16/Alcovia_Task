/**
 * Reward Service — the critical path for preventing double rewards.
 *
 * This service implements the transaction pattern discussed before any code
 * was written. Key properties:
 *
 * 1. SELECT ... FOR UPDATE on BOTH rows before any reads
 *    → Serializes concurrent /complete calls for the same session
 *
 * 2. Idempotency check (reward_processed) INSIDE the lock
 *    → Prevents TOCTOU race: check-then-write must be atomic
 *
 * 3. reward_processed = TRUE set in the SAME statement as the coin update
 *    → No crash window between "coins updated" and "flag set"
 *
 * 4. n8n webhook fired AFTER COMMIT, outside the transaction
 *    → n8n latency/failure cannot roll back the student's earned coins
 *    → n8n has its own dedup (processed_notifications) so double-fire is safe
 */

import { supabase } from '../db';

export interface RewardResult {
  alreadyProcessed: boolean;
  coinsAwarded: number;
  newTotalCoins: number;
  newStreakDays: number;
  todayFocusMinutes: number;
}

export async function processSessionReward(
  sessionId: string,
  studentId: string,
  targetDurationMinutes: number,
  hlcTimestamp: string,
): Promise<RewardResult> {
  // Supabase JS client doesn't expose raw transaction control.
  // We use a Postgres RPC (stored procedure) to run the entire
  // reward logic atomically inside BEGIN/COMMIT with FOR UPDATE locks.
  // The RPC is defined in the migration / can be called via rpc().
  //
  // Alternatively, we use the REST API with a single RPC call
  // that encapsulates all the transaction logic server-side.
  //
  // For this implementation we use the RPC approach:
  const { data, error } = await supabase.rpc('process_session_reward', {
    p_session_id: sessionId,
    p_student_id: studentId,
    p_duration_minutes: targetDurationMinutes,
    p_hlc_timestamp: hlcTimestamp,
  });

  if (error) throw new Error(`Reward RPC failed: ${error.message}`);

  return {
    alreadyProcessed: data.already_processed,
    coinsAwarded: data.coins_awarded,
    newTotalCoins: data.new_total_coins,
    newStreakDays: data.new_streak_days,
    todayFocusMinutes: data.today_focus_minutes,
  };
}
