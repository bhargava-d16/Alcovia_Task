import { Router, Request, Response } from 'express';
import { supabase } from '../db';

const router = Router();

/**
 * PATCH /api/v1/tasks/:id
 * Server-side task status update (used after sync applies LWW resolution).
 * Respects delete-wins: won't update a soft-deleted task.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, clientId, hlcTimestamp } = req.body;

    // Check delete-wins before applying
    const { data: current } = await supabase
      .from('tasks')
      .select('is_deleted, hlc_timestamp')
      .eq('id', id)
      .single();

    if (current?.is_deleted) {
      return res.status(409).json({ error: 'Task is deleted — delete wins' });
    }

    // LWW check
    if (current?.hlc_timestamp && hlcTimestamp <= current.hlc_timestamp) {
      return res.status(409).json({ error: 'Stale update — higher HLC already applied' });
    }

    const { data, error } = await supabase
      .from('tasks')
      .update({
        status,
        updated_at: new Date().toISOString(),
        updated_by_client: clientId,
        hlc_timestamp: hlcTimestamp,
        last_writer_wins_vector: hlcTimestamp,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (err) {
    console.error('[tasks] Update error:', err);
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

/**
 * DELETE /api/v1/tasks/:id (soft delete — delete-wins)
 * Sets is_deleted = TRUE. This is terminal — no future edit can undo it.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { clientId, hlcTimestamp } = req.body;

    const { error } = await supabase
      .from('tasks')
      .update({
        is_deleted: true,
        updated_at: new Date().toISOString(),
        updated_by_client: clientId,
        hlc_timestamp: hlcTimestamp,
      })
      .eq('id', id);

    if (error) throw error;
    return res.json({ success: true, deleted: true });
  } catch (err) {
    console.error('[tasks] Delete error:', err);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
