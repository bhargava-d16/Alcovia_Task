/**
 * n8n Service — fires webhook after a successful reward transaction.
 *
 * IMPORTANT: This is called AFTER the reward transaction commits.
 * It is intentionally outside the DB transaction. Reasons:
 *
 * 1. n8n is an external service — its latency (100–2000ms) would hold
 *    the DB transaction open, increasing lock contention.
 *
 * 2. n8n failure should NOT roll back the student's earned coins.
 *    Coins are the primary value; notification is secondary.
 *
 * 3. n8n has its own deduplication via processed_notifications table,
 *    so if we call it twice (e.g. server restart after COMMIT but before
 *    notification_sent flip), the second call is a no-op in n8n.
 *
 * 4. We flip notification_sent = TRUE in a separate UPDATE after the
 *    n8n call succeeds. This is a best-effort flag — it prevents us from
 *    calling n8n again on the next /complete retry, but even if we do
 *    call n8n again, it deduplicates by session_id.
 */

import axios from 'axios';
import { supabase } from '../db';

export interface N8nPayload {
  session_id: string;
  student_id: string;
  streak_days: number;
  coins_awarded: number;
  total_coins: number;
  event_type: 'session_success';
}

export async function fireN8nWebhook(payload: N8nPayload): Promise<void> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[n8n] N8N_WEBHOOK_URL not set — skipping webhook');
    return;
  }

  try {
    await axios.post(webhookUrl, payload, { timeout: 10_000 });
    console.log(`[n8n] Webhook fired for session ${payload.session_id}`);

    // Flip notification_sent — best-effort, separate from reward transaction
    await supabase
      .from('focus_sessions')
      .update({ notification_sent: true })
      .eq('id', payload.session_id);
  } catch (err) {
    // Log but don't throw — coins are already awarded, notification failure
    // is recoverable (n8n will deduplicate if we retry)
    console.error(`[n8n] Webhook failed for session ${payload.session_id}:`, err);
  }
}
