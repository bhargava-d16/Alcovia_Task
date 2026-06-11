import { Router, Request, Response } from 'express';
import { supabase } from '../db';
import { SyncRequest, SyncResponse, SyncEvent } from '@alcovia/sync-engine';
import { sortEventsByHLC, deduplicateEvents } from '@alcovia/sync-engine';
import { processSessionReward } from '../services/rewardService';
import { fireN8nWebhook } from '../services/n8nService';

const router = Router();

/**
 * POST /api/v1/sync
 *
 * The main sync endpoint. Protocol:
 * 1. Client sends all unsynced local events
 * 2. Server stores them (ON CONFLICT DO NOTHING — idempotent)
 * 3. Server processes focus_session_completed events (reward logic)
 * 4. Server returns all events the client hasn't seen (HLC > lastSyncedHLC)
 * 5. Client merges server events, updates UI, marks events as synced
 *
 * WHY SEND EVERYTHING SINCE lastSyncedHLC:
 * This is incremental sync — client only gets events it hasn't seen.
 * On first sync, lastSyncedHLC is '' so client gets everything.
 * After that, the cursor advances and sync is efficient.
 *
 * IDEMPOTENCY: Every sync can be safely retried. ON CONFLICT DO NOTHING
 * on sync_events means replaying the same event has no effect.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { clientId, studentId, lastSyncedHLC, events }: SyncRequest = req.body;

    if (!clientId || !studentId) {
      return res.status(400).json({ error: 'clientId and studentId are required' });
    }

    // ── Step 1: Deduplicate incoming events ──────────────────────────────────
    const incomingEvents = deduplicateEvents(events ?? []);

    // ── Step 2: Upsert events to server (idempotent) ─────────────────────────
    if (incomingEvents.length > 0) {
      const rows = incomingEvents.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        hlc: e.hlc,
        client_id: e.clientId,
        student_id: e.studentId,
      }));

      const { error: insertError } = await supabase
        .from('sync_events')
        .insert(rows)
        .select()
        // ON CONFLICT DO NOTHING — replaying same event is a no-op
        // Supabase REST achieves this with upsert + ignoreDuplicates
        ;

      if (insertError && !insertError.message.includes('duplicate')) {
        console.error('[sync] Event insert error:', insertError);
      }
    }

    // ── Step 3: Process focus_session_completed events ───────────────────────
    const completedEvents = sortEventsByHLC(
      incomingEvents.filter((e) => e.type === 'focus_session_completed'),
    );

    for (const event of completedEvents) {
      const payload = event.payload as {
        sessionId: string;
        targetDurationMinutes: number;
        startedAt: string;
        endedAt: string;
      };

      // Upsert the focus_session record first
      await supabase.from('focus_sessions').upsert(
        {
          id: payload.sessionId,
          student_id: studentId,
          client_id: clientId,
          target_duration_minutes: payload.targetDurationMinutes,
          started_at: payload.startedAt,
          ended_at: payload.endedAt,
          status: 'in_progress', // will be updated by reward RPC
          hlc_timestamp: event.hlc,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );

      // Run atomic reward transaction
      const result = await processSessionReward(
        payload.sessionId,
        studentId,
        payload.targetDurationMinutes,
        event.hlc,
      );

      // Fire n8n AFTER commit, outside transaction
      if (!result.alreadyProcessed) {
        const stats = await supabase
          .from('student_stats')
          .select('coins')
          .eq('student_id', studentId)
          .single();

        await fireN8nWebhook({
          session_id: payload.sessionId,
          student_id: studentId,
          streak_days: result.newStreakDays,
          coins_awarded: result.coinsAwarded,
          total_coins: result.newTotalCoins,
          event_type: 'session_success',
        });
      }
    }

    // Process failed sessions
    const failedEvents = incomingEvents.filter(
      (e) => e.type === 'focus_session_failed',
    );
    for (const event of failedEvents) {
      const payload = event.payload as {
        sessionId: string;
        targetDurationMinutes: number;
        startedAt: string;
        endedAt: string;
        failReason: string;
      };

      await supabase.from('focus_sessions').upsert(
        {
          id: payload.sessionId,
          student_id: studentId,
          client_id: clientId,
          target_duration_minutes: payload.targetDurationMinutes,
          started_at: payload.startedAt,
          ended_at: payload.endedAt,
          status: 'failed',
          fail_reason: payload.failReason,
          coins_awarded: 0,
          reward_processed: true, // failed sessions don't need reward processing
          hlc_timestamp: event.hlc,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
    }

    // Process task_status_changed events (LWW — server records all, last HLC wins)
    const taskEvents = sortEventsByHLC(
      incomingEvents.filter((e) => e.type === 'task_status_changed'),
    );
    for (const event of taskEvents) {
      const payload = event.payload as {
        taskId: string;
        newStatus: string;
      };

      // Only apply if this event's HLC is newer than what's in the DB
      const { data: currentTask } = await supabase
        .from('tasks')
        .select('hlc_timestamp, is_deleted')
        .eq('id', payload.taskId)
        .single();

      // Delete-wins: never overwrite a deleted task
      if (currentTask?.is_deleted) continue;

      // LWW: only apply if incoming HLC > current HLC
      if (
        !currentTask?.hlc_timestamp ||
        event.hlc > currentTask.hlc_timestamp
      ) {
        await supabase
          .from('tasks')
          .update({
            status: payload.newStatus,
            updated_at: new Date().toISOString(),
            updated_by_client: clientId,
            hlc_timestamp: event.hlc,
            last_writer_wins_vector: event.hlc,
          })
          .eq('id', payload.taskId);
      }
    }

    // ── Step 4: Fetch all server events since lastSyncedHLC ──────────────────
    let query = supabase
      .from('sync_events')
      .select('*')
      .eq('student_id', studentId)
      .order('hlc', { ascending: true });

    if (lastSyncedHLC) {
      query = query.gt('hlc', lastSyncedHLC);
    }

    const { data: serverEventRows, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    const serverEvents: SyncEvent[] = (serverEventRows ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      hlc: row.hlc,
      clientId: row.client_id,
      studentId: row.student_id,
      synced: true,
      createdAt: new Date(row.received_at).getTime(),
    }));

    // ── Step 5: Fetch authoritative student stats ─────────────────────────────
    const { data: statsRow } = await supabase
      .from('student_stats')
      .select('*')
      .eq('student_id', studentId)
      .single();

    const studentStats = statsRow
      ? {
          studentId: statsRow.student_id,
          coins: statsRow.coins,
          streakDays: statsRow.streak_days,
          lastSuccessDate: statsRow.last_success_date,
          todayFocusMinutes: statsRow.today_focus_minutes,
          lastUpdatedHlc: statsRow.last_updated_hlc,
        }
      : {
          studentId,
          coins: 0,
          streakDays: 0,
          lastSuccessDate: null,
          todayFocusMinutes: 0,
          lastUpdatedHlc: null,
        };

    // Server's current HLC = max HLC of all stored events
    const serverTimestamp =
      serverEventRows && serverEventRows.length > 0
        ? serverEventRows[serverEventRows.length - 1].hlc
        : lastSyncedHLC;

    const response: SyncResponse = {
      serverEvents,
      studentStats,
      timestamp: serverTimestamp,
    };

    return res.json(response);
  } catch (err) {
    console.error('[sync] Error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
});

export default router;
