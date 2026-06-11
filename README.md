# Alcovia — Gamified Offline-First Study App

A production-quality take-home assignment demonstrating event sourcing, Hybrid Logical Clocks, and offline-first sync architecture.

```
 ┌─────────────────────────────────────────────────────┐
 │  Browser Tab 1              Browser Tab 2            │
 │  localhost:3000?client=A    localhost:3000?client=B  │
 │  ┌────────────────┐         ┌────────────────┐       │
 │  │ Expo Web App   │         │ Expo Web App   │       │
 │  │ LocalStore A   │         │ LocalStore B   │       │
 │  └───────┬────────┘         └────────┬───────┘       │
 │          │ POST /sync                │ POST /sync     │
 └──────────┼───────────────────────────┼───────────────┘
            ▼                           ▼
     ┌──────────────────────────────────────┐
     │   Express + TypeScript  (:4000)      │
     │   Reward RPC (FOR UPDATE)            │
     │   Event deduplication                │
     └──────────────────┬───────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    Supabase DB    n8n Cloud      Twilio
    (PostgreSQL)   Webhook        WhatsApp
```

---

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo>
cd alcovia
npm install
```

### 2. Configure environment

```bash
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

N8N_WEBHOOK_URL=https://your-n8n.app.n8n.cloud/webhook/alcovia-session-success

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_WHATSAPP_TO=whatsapp:+91XXXXXXXXXX
```

Get Supabase keys from: **Dashboard → Project → Settings → API**

### 3. Run Supabase migrations

```bash
# Option A: Supabase CLI
npx supabase db push

# Option B: paste each file manually in Supabase SQL editor
# Run in order: 001 → 002 → 003
```

### 4. Seed initial data

```bash
npm run seed --workspace=apps/server
```

Inserts: `student_001` stats, Physics/Mathematics/History subjects, 2 chapters × 4 tasks each.

### 5. Start backend

```bash
npm run dev --workspace=apps/server
# Runs on http://localhost:4000
```

### 6. Start frontend

```bash
npm run web --workspace=apps/client
# Runs on http://localhost:3000
```

### 7. Open two client instances

| Client | URL | Instructions |
|---|---|---|
| A | `http://localhost:3000?client=A` | Normal browser window |
| B | `http://localhost:3000?client=B` | Incognito / private window |

Both are `student_001`. Each has its own isolated localStorage namespace.

### 8. Import n8n workflow

1. Go to n8n Cloud → **Workflows → Import from file**
2. Upload `n8n-workflow.json`
3. Set environment variables in n8n: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
4. Create a Twilio credential (Account SID + Auth Token)
5. Activate the workflow
6. Copy the webhook URL → paste as `N8N_WEBHOOK_URL` in `apps/server/.env`
7. Restart the server

---

## Conflict Scenarios

### Scenario 1: Same task edited on both devices while offline

**Steps:**
1. Open Dev Panel on Client A → toggle **Offline**
2. Open Dev Panel on Client B → toggle **Offline**
3. Client A: tap Physics Ch1 Task1 pill → **Done**
4. Client B: tap Physics Ch1 Task1 pill → **In Progress**
5. Client A: toggle **Online** → Force Sync
6. Client B: toggle **Online** → Force Sync

**Expected result:** The client with the higher HLC value wins. Since Client B's edit happened after Client A's (higher wall time or logical counter), the final status is **In Progress** on both. The "winner" is shown in the Dev Panel's Last Synced HLC display.

**Why this converges:** Both clients receive the same two events after sync. HLC comparison deterministically picks the winner — same result on every device.

---

### Scenario 2: Task deleted on one, edited on other

**Steps:**
1. Both clients offline
2. Client A: Dev Panel → "Delete Physics Task"
3. Client B: tap Physics Ch1 Task1 → **Done**
4. Both reconnect and sync

**Expected result:** Task is **deleted** on both clients. The edit (Done) is recorded in the event log but not applied. This is delete-wins — see DECISIONS.md §6.

---

### Scenario 3: Focus session completed on both devices offline

**Steps:**
1. Client A: toggle offline
2. Client A: Dev Panel → "Complete focus session (Client A, offline)"
3. Client B: toggle offline
4. Client B: Dev Panel → "Complete focus session (Client B, offline)"
5. Reconnect Client A → sync
6. Reconnect Client B → sync

**Expected result:**
- `student_stats.coins` increases by exactly **50** (not 100) after both syncs
- `focus_sessions` has **two rows** (one per session) — different UUIDs, different clients
- `reward_processed = TRUE` on both rows
- n8n fires **twice** (once per session, different session_ids)

Note: this is NOT a double-reward scenario — these are genuinely two different sessions. The idempotency protection prevents the same session from being rewarded twice.

---

### Scenario 4: Same sync event replayed

**Steps:**
1. Complete a focus session normally (online)
2. In Dev Panel: "Force Sync" again immediately

**Expected result:** Second sync sends the same events (already marked `synced: true` locally, so not re-sent). Server has `ON CONFLICT DO NOTHING` on `sync_events(id)` — replay is a no-op. Coins do not increase again.

---

### Scenario 5: Network drops mid-sync

**Steps:**
1. Toggle offline mid-session
2. Complete the session while offline
3. Toggle online — sync fires
4. If sync returns an error (simulated by server being down), client retries
5. The retry sends the same event IDs

**Expected result:** Same events with same IDs are idempotent on server. Second sync produces the same result as the first. Reward is processed once (checked by `reward_processed` flag).

---

## Architecture

### Sync Engine (`packages/sync-engine`)

The heart of the offline-first architecture. All code in this package is pure TypeScript with no framework dependencies — it runs on both client and server.

| Module | Responsibility |
|---|---|
| `hlc.ts` | HLC generation, serialization, comparison, send/receive semantics |
| `events.ts` | SyncEvent types, factory function |
| `merge.ts` | LWW resolution, delete-wins, deduplication, HLC-ordered sort |
| `storage.ts` | Per-client namespaced localStorage wrapper |

### Sync Protocol

```
Client → POST /api/v1/sync:
{
  clientId: "A",
  studentId: "student_001",
  lastSyncedHLC: "000001749567890123-00000-A",   // cursor
  events: [/* unsynced local events */]
}

Server → Response:
{
  serverEvents: [/* events with HLC > lastSyncedHLC */],
  studentStats: { coins: 50, streakDays: 1, ... },
  timestamp: "000001749567895000-00000-server"   // new cursor
}
```

### Reward Transaction (see DECISIONS.md §4 for full detail)

```sql
BEGIN;
  SELECT ... FROM focus_sessions WHERE id = $1 FOR UPDATE;
  SELECT ... FROM student_stats WHERE student_id = $2 FOR UPDATE;
  IF reward_processed THEN RETURN; END IF;  -- idempotency gate
  UPDATE student_stats SET coins = coins + 50, ...;
  UPDATE focus_sessions SET reward_processed = TRUE, ...;  -- same tx
COMMIT;
-- AFTER commit: fire n8n webhook (best-effort, has own dedup)
```

---

## Project Structure

```
alcovia/
├── apps/
│   ├── client/                 # Expo React Native (web-first)
│   │   ├── App.tsx
│   │   └── src/
│   │       ├── components/     # CircularTimer, CircularProgress, RewardCard, DevPanel
│   │       ├── context/        # ClientContext, SyncContext
│   │       ├── hooks/          # useFocusSession, useSyllabus
│   │       ├── screens/        # HomeScreen, SyllabusScreen
│   │       └── constants/      # design.ts (all tokens)
│   └── server/                 # Express + TypeScript
│       └── src/
│           ├── routes/         # sync, focusSessions, subjects, tasks, studentStats, webhooks
│           ├── services/       # rewardService, n8nService
│           ├── db.ts           # Supabase client
│           └── seed.ts         # Seed script
├── packages/
│   └── sync-engine/            # Shared HLC + event types + merge logic
├── supabase/
│   └── migrations/             # 001 schema, 002 RLS, 003 reward RPC
├── n8n-workflow.json           # Importable n8n workflow
├── DECISIONS.md                # Architecture decisions (read this!)
└── README.md
```

---

## Environment Variables Reference

| Variable | Where | Description |
|---|---|---|
| `SUPABASE_URL` | server | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | server | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Service role key (backend only) |
| `N8N_WEBHOOK_URL` | server | Webhook URL from n8n workflow |
| `TWILIO_ACCOUNT_SID` | n8n credential | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | n8n credential | Twilio auth token |
| `TWILIO_WHATSAPP_FROM` | n8n env | WhatsApp sandbox number |
| `TWILIO_WHATSAPP_TO` | n8n env | Your phone number |
| `PORT` | server | Backend port (default: 4000) |
| `CLIENT_URL` | server | Frontend origin for CORS (default: http://localhost:3000) |

---

## Key Design Decisions

See **[DECISIONS.md](./DECISIONS.md)** for the full discussion. Short version:

- **Event sourcing + HLC** over CRDTs: simpler to implement correctly, easy to audit
- **LWW with HLC** for task conflicts: total order → deterministic convergence
- **Delete-wins**: simpler UX than surfacing a conflict modal
- **reward_processed in same tx**: no crash window between coins update and flag
- **n8n outside the transaction**: keeps DB transaction fast, n8n has own dedup

---

## Honest Caveats

The app works correctly for all demo scenarios. Known limitations:

1. Clock skew > unbounded (no drift rejection on server)
2. sync_events table grows forever (no compaction)
3. today_focus_minutes resets at UTC midnight, not local midnight
4. Timer uses setInterval (drifts over long sessions)
5. No authentication (hardcoded student_001)
6. n8n log nodes point to localhost (won't work with cloud deployment without updating)

See DECISIONS.md §7 for the full list with reasoning.
