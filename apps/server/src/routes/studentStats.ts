import { Router, Request, Response } from 'express';
import { supabase } from '../db';

const router = Router();

/** GET /api/v1/student-stats — authoritative reward state */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('student_stats')
      .select('*')
      .eq('student_id', 'student_001')
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    return res.json(
      data ?? {
        student_id: 'student_001',
        coins: 0,
        streak_days: 0,
        last_success_date: null,
        today_focus_minutes: 0,
        last_updated_hlc: null,
      },
    );
  } catch (err) {
    console.error('[student-stats] Fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
