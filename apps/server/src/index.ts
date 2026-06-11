import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import syncRouter from './routes/sync';
import focusSessionsRouter from './routes/focusSessions';
import subjectsRouter from './routes/subjects';
import tasksRouter from './routes/tasks';
import studentStatsRouter from './routes/studentStats';
import webhooksRouter from './routes/webhooks';

const app = express();
const PORT = process.env.PORT ?? 4000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '2mb' })); // sync payload can have many events

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API v1 routes ─────────────────────────────────────────────────────────────
const api = express.Router();
api.use('/sync', syncRouter);
api.use('/focus-sessions', focusSessionsRouter);
api.use('/subjects', subjectsRouter);
api.use('/tasks', tasksRouter);
api.use('/student-stats', studentStatsRouter);
api.use('/webhooks', webhooksRouter);

app.use('/api/v1', api);

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Alcovia server running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Sync:   http://localhost:${PORT}/api/v1/sync\n`);
});

export default app;
