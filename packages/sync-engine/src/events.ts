/**
 * SyncEvent types — the unit of truth in our event-sourcing model.
 *
 * Every mutation the client makes is captured as a SyncEvent before
 * any network call. Events are:
 * - Stored locally (AsyncStorage / IndexedDB)
 * - Sent to the server during sync
 * - Applied on the server in HLC order
 * - Returned to other clients who haven't seen them
 *
 * Events are immutable once created. The server never modifies them —
 * it only records them and derives state by replaying in HLC order.
 */

// ─── Payload types ───────────────────────────────────────────────────────────

export interface FocusSessionCompletedPayload {
  sessionId: string;
  targetDurationMinutes: number;
  startedAt: string; // ISO 8601
  endedAt: string;   // ISO 8601
}

export interface FocusSessionFailedPayload {
  sessionId: string;
  targetDurationMinutes: number;
  startedAt: string;
  endedAt: string;
  failReason: 'give_up' | 'app_switch';
}

export interface TaskStatusChangedPayload {
  taskId: string;
  chapterId: string;
  subjectId: string;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'done';

export type SyncEventType =
  | 'focus_session_completed'
  | 'focus_session_failed'
  | 'task_status_changed';

export type SyncEventPayload =
  | FocusSessionCompletedPayload
  | FocusSessionFailedPayload
  | TaskStatusChangedPayload;

// ─── Core SyncEvent interface ─────────────────────────────────────────────────

export interface SyncEvent {
  /** Stable UUID — used for deduplication (ON CONFLICT DO NOTHING on server) */
  id: string;
  type: SyncEventType;
  payload: SyncEventPayload;
  /** HLC string — used for causal ordering and LWW resolution */
  hlc: string;
  /** Which device created this event */
  clientId: string;
  studentId: string;
  /** Whether this event has been acknowledged by the server */
  synced: boolean;
  /** Wall-clock ms at creation — used only for local display, never for ordering */
  createdAt: number;
}

// ─── StudentStats (authoritative copy from server) ───────────────────────────

export interface StudentStats {
  studentId: string;
  coins: number;
  streakDays: number;
  lastSuccessDate: string | null; // ISO date string "YYYY-MM-DD"
  todayFocusMinutes: number;
  lastUpdatedHlc: string | null;
}

// ─── Sync protocol types ─────────────────────────────────────────────────────

export interface SyncRequest {
  clientId: string;
  studentId: string;
  /** HLC string of the last server event this client received */
  lastSyncedHLC: string;
  /** New local events that haven't been sent yet */
  events: SyncEvent[];
}

export interface SyncResponse {
  /** Events from server with HLC > lastSyncedHLC */
  serverEvents: SyncEvent[];
  /** Authoritative reward state — always use server's version, never client's */
  studentStats: StudentStats;
  /** Server's current HLC — client updates its lastSyncedHLC to this */
  timestamp: string;
}

// ─── Factory function ────────────────────────────────────────────────────────

/**
 * Create a new SyncEvent with a stable UUID.
 * Uses crypto.randomUUID() which is available in modern browsers and Node 19+.
 * Falls back to a timestamp-based ID in older environments.
 */
export function createSyncEvent(
  type: SyncEventType,
  payload: SyncEventPayload,
  hlc: string,
  clientId: string,
  studentId: string,
): SyncEvent {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    id,
    type,
    payload,
    hlc,
    clientId,
    studentId,
    synced: false,
    createdAt: Date.now(),
  };
}
