import { Router, Request, Response } from 'express';
import { supabase } from '../db';
import { processSessionReward } from '../services/rewardService';
import { fireN8nWebhook } from '../services/n8nService';

const router = Router();

/** POST /api/v1/focus-sessions — create a session record when it starts */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { id, studentId, clientId, targetDurationMinutes, startedAt, hlcTimestamp } = req.body;

    const { data, error } = await supabase
      .from('focus_sessions')
      .insert({
        id,
        student_id: studentId ?? 'student_001',
        client_id: clientId,
        target_duration_minutes: targetDurationMinutes,
        started_at: startedAt,
        status: 'in_progress',
        hlc_timestamp: hlcTimestamp,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json(data);
  } catch (err) {
    console.error('[focus-sessions] Create error:', err);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * POST /api/v1/focus-sessions/:id/complete
 *
 * Marks a session as successful and runs the atomic reward transaction.
 * This is the critical path — see rewardService.ts for transaction details.
 */
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { studentId, targetDurationMinutes, hlcTimestamp } = req.body;

    const result = await processSessionReward(
      id,
      studentId ?? 'student_001',
      targetDurationMinutes,
      hlcTimestamp,
    );

    if (result.alreadyProcessed) {
      // Idempotent — return success without re-processing
      return res.json(result);
    }

    // Fire n8n AFTER the transaction committed
    await fireN8nWebhook({
      session_id: id,
      student_id: studentId ?? 'student_001',
      streak_days: result.newStreakDays,
      coins_awarded: result.coinsAwarded,
      total_coins: result.newTotalCoins,
      event_type: 'session_success',
    });

    return res.json(result);
  } catch (err) {
    console.error('[focus-sessions] Complete error:', err);
    return res.status(500).json({ error: 'Failed to complete session' });
  }
});

/** POST /api/v1/focus-sessions/:id/fail */
router.post('/:id/fail', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { failReason, hlcTimestamp } = req.body;

    const { error } = await supabase
      .from('focus_sessions')
      .update({
        status: 'failed',
        ended_at: new Date().toISOString(),
        fail_reason: failReason,
        coins_awarded: 0,
        reward_processed: true, // no reward to process for failed sessions
        synced_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    console.error('[focus-sessions] Fail error:', err);
    return res.status(500).json({ error: 'Failed to fail session' });
  }
});

export default router;
