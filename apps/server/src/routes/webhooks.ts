import { Router, Request, Response } from 'express';

const router = Router();

/**
 * In-memory ring buffer for n8n notification logs.
 * Shows evaluators the exactly-once behavior visually in the Dev Panel.
 * Max 100 entries — wraps around (oldest dropped first).
 */
const MAX_LOG_ENTRIES = 100;
const notificationLog: Array<{
  timestamp: string;
  sessionId: string;
  message: string;
  skipped: boolean;
}> = [];

/**
 * POST /api/v1/webhooks/n8n-log
 * Called by the n8n workflow after processing (or skipping) a session notification.
 * The Dev Panel polls this endpoint to show the notification log.
 */
router.post('/n8n-log', (req: Request, res: Response) => {
  const { sessionId, skipped, message } = req.body;

  const entry = {
    timestamp: new Date().toISOString(),
    sessionId: sessionId ?? 'unknown',
    message: message ?? (skipped ? 'Skipped — already notified' : 'n8n webhook fired'),
    skipped: !!skipped,
  };

  notificationLog.push(entry);
  if (notificationLog.length > MAX_LOG_ENTRIES) {
    notificationLog.shift(); // drop oldest
  }

  console.log(`[n8n-log] ${entry.skipped ? '⏭  SKIP' : '🔔 FIRE'} session=${entry.sessionId}`);
  return res.json({ ok: true });
});

/** GET /api/v1/webhooks/n8n-log — Dev Panel fetches this to display the log */
router.get('/n8n-log', (_req: Request, res: Response) => {
  return res.json([...notificationLog].reverse()); // newest first for display
});

export default router;
