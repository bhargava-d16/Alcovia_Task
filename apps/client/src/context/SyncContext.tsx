/**
 * SyncContext — manages the sync engine lifecycle.
 *
 * Responsibilities:
 * - Maintains the client's HLC state across renders
 * - Exposes triggerSync() for manual and automatic sync
 * - Tracks studentStats (authoritative from server, cached locally)
 * - Exposes pendingEvents count for Dev Panel display
 *
 * Auto-sync: triggers every 30 seconds when online.
 * Manual sync: triggered by Dev Panel "Force Sync" button.
 *
 * CONVERGENCE NOTE:
 * After sync, the client merges server events into its local event store,
 * then recomputes task states using mergeAndSortEvents() + computeTaskStates().
 * Since both clients eventually receive the same event set and apply the same
 * HLC-ordered merge, they converge to identical final state.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import axios from 'axios';
import {
  SyncEvent,
  StudentStats,
  SyncRequest,
  SyncResponse,
  mergeAndSortEvents,
  hlcNow,
  hlcFromString,
  hlcToString,
  receiveHLC,
  HLC,
  createSyncEvent,
  SyncEventType,
  SyncEventPayload,
} from '@alcovia/sync-engine';
import { useClient } from './ClientContext';
import { API_BASE } from '../constants/design';

interface SyncContextValue {
  studentStats: StudentStats | null;
  pendingCount: number;
  lastSyncedHLC: string;
  isSyncing: boolean;
  lastSyncError: string | null;
  triggerSync: () => Promise<void>;
  emitEvent: (type: SyncEventType, payload: SyncEventPayload) => SyncEvent;
  allEvents: SyncEvent[];
}

const SyncContext = createContext<SyncContextValue | null>(null);

const AUTO_SYNC_INTERVAL_MS = 30_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { clientId, studentId, isOnline, store } = useClient();
  const [studentStats, setStudentStats] = useState<StudentStats | null>(
    () => store.getStudentStats(),
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // force re-render after store mutations

  // HLC state — persisted across page reloads via localStorage
  // useRef with a factory function initializer isn't supported; compute the
  // initial value eagerly (this runs once on mount — fine for localStorage reads)
  const hlcRef = useRef<HLC>(
    (() => {
      const stored = store.getLastLocalHLC();
      return stored
        ? hlcFromString(stored)
        : { wallTime: Date.now(), logical: 0, nodeId: clientId };
    })(),
  );

  /** Create and persist a new sync event with an advanced HLC */
  const emitEvent = useCallback(
    (type: SyncEventType, payload: SyncEventPayload): SyncEvent => {
      // Advance HLC before creating event
      hlcRef.current = hlcNow(clientId, hlcRef.current);
      store.setLastLocalHLC(hlcToString(hlcRef.current));

      const event = createSyncEvent(
        type,
        payload,
        hlcToString(hlcRef.current),
        clientId,
        studentId,
      );

      store.appendEvent(event);
      setTick((t) => t + 1); // trigger re-render to update pendingCount
      return event;
    },
    [clientId, studentId, store],
  );

  const triggerSync = useCallback(async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);
    setLastSyncError(null);

    try {
      const unsyncedEvents = store.getUnsyncedEvents();
      const lastSyncedHLC = store.getLastSyncedHLC();

      const request: SyncRequest = {
        clientId,
        studentId,
        lastSyncedHLC,
        events: unsyncedEvents,
      };

      const { data }: { data: SyncResponse } = await axios.post(
        `${API_BASE}/sync`,
        request,
        { timeout: 15_000 },
      );

      // Advance local HLC past the server's timestamp
      const serverHLC = hlcFromString(data.timestamp || hlcToString(hlcRef.current));
      hlcRef.current = receiveHLC(hlcRef.current, serverHLC);
      store.setLastLocalHLC(hlcToString(hlcRef.current));

      // Store server events locally
      if (data.serverEvents.length > 0) {
        store.appendEvents(data.serverEvents);
      }

      // Mark our sent events as synced
      store.markSynced(unsyncedEvents.map((e) => e.id));

      // Advance sync cursor
      if (data.timestamp) {
        store.setLastSyncedHLC(data.timestamp);
      }

      // Update cached stats
      store.setStudentStats(data.studentStats);
      setStudentStats(data.studentStats);
      setTick((t) => t + 1);
    } catch (err: any) {
      const msg = err?.message ?? 'Sync failed';
      setLastSyncError(msg);
      console.error('[sync] Error:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing, clientId, studentId, store]);

  // Auto-sync when online
  useEffect(() => {
    if (!isOnline) return;
    const interval = setInterval(triggerSync, AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOnline, triggerSync]);

  // Sync when coming back online
  useEffect(() => {
    if (isOnline) {
      triggerSync();
    }
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  const allEvents = store.getEvents();
  const pendingCount = allEvents.filter((e) => !e.synced).length;
  const lastSyncedHLC = store.getLastSyncedHLC();

  return (
    <SyncContext.Provider
      value={{
        studentStats,
        pendingCount,
        lastSyncedHLC,
        isSyncing,
        lastSyncError,
        triggerSync,
        emitEvent,
        allEvents,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within <SyncProvider>');
  return ctx;
}
