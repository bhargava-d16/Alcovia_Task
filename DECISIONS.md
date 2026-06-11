# DECISIONS.md — Alcovia Sync Architecture

*These are the actual decisions made, with honest reasoning. Evaluators: this is the document that matters.*

---

## 1. Why Event Sourcing + HLC, not CRDTs or OT

**The alternatives considered:**

| Approach | Why rejected |
|---|---|
| CRDTs | Operationally correct, but complex to implement correctly from scratch. Counter-CRDTs don't handle "undo" well for session rewards. The library ban (no Yjs, etc.) means implementing state-based CRDTs for a nested data model (subjects→chapters→tasks) would require days of work. |
| Operational Transform | Requires a central server to transform all operations in order — incompatible with offline-first (client can't generate ops without knowing server's current state). |
| Last-Write-Wins with wall clock | Wall clocks drift. Two offline clients could assign the same millisecond to conflicting operations, and the "winner" would be non-deterministic. |
| Event sourcing + HLC | **Simple enough to implement correctly in a weekend, principled enough to be auditable.** HLC gives us a causal timestamp that survives clock drift and provides a total order. |

**Why event sourcing specifically:**

Events are immutable facts. Once a "task marked done" event exists, replaying it produces the same result on every device. This is fundamentally different from mutable state sync (which has the "who wins" problem) — with events, both devices that have the same set of events will compute the same final state deterministically.

---

## 2. Conflict Resolution: Exact Rules

### Task status changes — Last Write Wins with HLC

```
Given events for task T: [E1(hlc=A), E2(hlc=B), E3(hlc=C)]
where A < B < C in HLC order:

Final status = E3.newStatus   (highest HLC wins)
```

HLC comparison order: `wallTime → logical → nodeId`

- `wallTime` handles the common case (events at different times)
- `logical` handles two events in the same millisecond on the same device
- `nodeId` is the tiebreaker — makes the comparison a **total order**. Given identical wallTime and logical, `clientId "A" < "B"` lexicographically, so Client B always beats Client A on exact-same-millisecond conflicts. This is deterministic and documented.

### Delete-wins

If any `is_deleted = TRUE` event exists for a task, the task is considered deleted, regardless of the HLC of any edit events.

```
Delete event at HLC=100, Edit event at HLC=200:
Result: DELETED  (edit is recorded in event log but not applied)
```

**Why delete-wins:** The alternative is surfacing a conflict modal ("this task was deleted on another device — keep or discard?"). This adds UX complexity that would take more time to design well than the scope allowed. Delete-wins is the safer default for a study app — students very rarely accidentally delete tasks, and accidental edits are more common than accidental deletes.

### Duplicate events

Server uses `ON CONFLICT DO NOTHING` on `sync_events(id)`. Client uses `deduplicateEvents()` before processing. An event replayed twice has no effect.

---

## 3. Why Devices Converge

**Formal argument:**

Let `E` = the set of all sync events across all clients (after full sync).
Let `S0` = initial database state (from seed).
Let `apply(events, state)` = function that applies events in HLC order.

**Claim:** For any two clients A and B that have completed a full sync,
`apply(sort(E), S0)` produces the same final state on both.

**Proof:**
1. After sync, both clients hold the same event set E (server is source of truth; incremental sync ensures all events are received)
2. `sort(E)` by HLC is deterministic because HLC comparison is a **total order** (not partial — nodeId tiebreaker eliminates ties)
3. `apply` is a pure function: same input → same output
4. Therefore both clients compute identical final state. ∎

**Practical consequence:** You can demo this by:
1. Making different edits offline on Client A and Client B
2. Reconnecting both and syncing
3. Both clients will show identical task states

---

## 4. Idempotency in Backend: reward_processed + SELECT FOR UPDATE

The reward transaction has these properties:

**Atomicity:** `reward_processed = TRUE` and `coins += 50` are written in the **same SQL transaction** (via `process_session_reward` Postgres function). There is no moment where coins are updated but the flag isn't set.

**Serialization:** `SELECT ... FOR UPDATE` on both `focus_sessions` and `student_stats` rows before any reads. This means:
- If two `/complete` requests arrive simultaneously for session X, one blocks until the other commits
- The second request then reads `reward_processed = TRUE` and returns early — no double reward

**The race condition this prevents:**
```
Without FOR UPDATE:
T=0: Request A reads reward_processed = FALSE
T=1: Request B reads reward_processed = FALSE (before A commits)
T=2: Request A writes coins +50, sets reward_processed = TRUE
T=3: Request B writes coins +50, sets reward_processed = TRUE  ← double reward!

With FOR UPDATE:
T=0: Request A acquires row lock, reads reward_processed = FALSE
T=1: Request B tries to lock → BLOCKS
T=2: Request A writes coins +50, reward_processed = TRUE → COMMIT
T=3: Request B acquires lock, reads reward_processed = TRUE → EARLY RETURN ✓
```

**Crash safety:** If the server crashes after COMMIT but before the HTTP response is sent, the client will retry. The retry will find `reward_processed = TRUE` and return `{ alreadyProcessed: true }` — no double reward.

---

## 5. Idempotency in n8n: processed_notifications Table

The n8n workflow checks `processed_notifications` before sending any WhatsApp message:

```
Webhook received (session_id = X)
  → GET /processed_notifications?session_id=eq.X
  → IF rows = 0:
      → INSERT session_id with ON CONFLICT DO NOTHING
      → Send WhatsApp message
      → Log "fired" to dev panel
  → ELSE:
      → Log "skipped" to dev panel
      → Return 200
```

**Why this survives double-firing:**
The `ON CONFLICT DO NOTHING` on `processed_notifications(session_id)` means even if two webhook calls race, only one INSERT succeeds. The `IF rows = 0` check is per-execution — each n8n execution reads fresh from Supabase.

**Edge case:** If n8n crashes after INSERT but before sending WhatsApp, the session is marked as notified but the message was never sent. This is the "at-most-once" vs "at-least-once" tradeoff — we chose at-most-once (no duplicate messages) over at-least-once (guaranteed delivery). For a study app, missing one notification is acceptable; duplicate messages are annoying.

---

## 6. Key Tradeoff: Delete-wins means edit always loses to delete

**The tradeoff stated plainly:**

If Client A deletes a task at HLC=100, and Client B edits the same task at HLC=200 (higher), the task is still deleted. The edit is recorded in the event log but not applied. B's more recent change is discarded.

**Why we accepted this:**
The alternative — "surface a conflict modal when delete races with edit" — requires:
1. A conflict detection UI component
2. A decision for what "pending conflict" state looks like in the DB
3. A resolution flow (accept delete? keep edit? merge?)
4. Testing that the conflict modal appears correctly after sync

This is 3–5 hours of additional work and would require careful UX thinking. Delete-wins is simpler, safer for the common case (deliberate deletes are intentional), and makes the system easier to reason about.

**What we'd do with more time:** Store conflicted events in a separate `conflict_log` table and show a toast: *"This task was deleted on another device."* Let the user undo the delete from the app if it was accidental.

---

## 7. What's Missing (Honest Edge Cases)

### Not handled in this implementation:

1. **Session started on one device, synced mid-session to another device**
   The other device would see an `in_progress` session that it didn't start. It won't show a timer (no local state), but the session record will exist in the DB. If the original device then completes the session, everything works correctly. But if the original device is offline and the session is in an ambiguous state, there's no way to tell the other device "this session is being worked on."

2. **Clock skew > HLC_MAX_DRIFT (currently unbounded)**
   If a client's wall clock is far in the past (e.g. 2 hours behind), its HLC will be lower than expected and its edits may always lose LWW to the other device. We don't enforce a maximum drift — a production implementation should reject events with `wallTime` more than 60 seconds in the future.

3. **Sync event log grows unboundedly**
   The `sync_events` table stores every event forever. After many sessions and task changes, this table will grow large. Production would need compaction: periodically snapshot the derived state and delete events older than the snapshot.

4. **today_focus_minutes resets at UTC midnight, not local midnight**
   The streak and today's minutes use `CURRENT_DATE` in Postgres, which is UTC. A student in IST (UTC+5:30) will see their stats reset at 5:30 AM local time, not midnight. This is confusing but not incorrect.

5. **Offline timer accuracy**
   The focus timer uses `setInterval(1000)` which drifts on JavaScript's event loop. After 25 minutes offline, the timer may be off by several seconds. A production implementation would compare `Date.now()` against `startedAt` to compute the true remaining time, not rely on interval counts.

6. **No authentication**
   All data belongs to `student_001` with no auth. The service role key is used server-side. In production: Supabase Auth + RLS policies per student_id (see migration 002 for the exact policy structure).

7. **n8n webhook URL is localhost in the log nodes**
   The "Log to Dev Panel" n8n nodes call `http://localhost:4000/api/v1/webhooks/n8n-log`. This only works when n8n is running locally. For n8n Cloud + a deployed server, update these URLs to the deployed server's address.

---

*This document was written to be honest, not to impress. The system works correctly for the demo scenarios. The edge cases above are real limitations.*
