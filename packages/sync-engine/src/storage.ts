/**
 * LocalStore — per-client persistent storage abstraction.
 *
 * Each client instance gets its own namespace to prevent cross-contamination
 * when two browser tabs share the same origin's localStorage/IndexedDB.
 *
 * Storage key structure:
 *   alcovia:client_{clientId}:events         → SyncEvent[]
 *   alcovia:client_{clientId}:lastSyncedHLC  → string
 *   alcovia:client_{clientId}:studentStats   → StudentStats
 *
 * WHY PER-CLIENT NAMESPACE:
 * Browser tabs on the same origin share localStorage. Client A and Client B
 * would overwrite each other's events without namespacing. The clientId
 * (derived from ?client=A/B URL param) provides isolation.
 *
 * This implementation uses localStorage for web (synchronous, simple).
 * A React Native version would swap in AsyncStorage with the same interface.
 */

import { SyncEvent, StudentStats } from './events';

const STORAGE_VERSION = 'v1';

export class LocalStore {
  private prefix: string;

  constructor(clientId: string) {
    // e.g. "alcovia:v1:client_A:"
    this.prefix = `alcovia:${STORAGE_VERSION}:client_${clientId}:`;
  }

  private key(suffix: string): string {
    return `${this.prefix}${suffix}`;
  }

  // ─── Event queue ───────────────────────────────────────────────────────────

  /** Load all locally stored events (synced + unsynced) */
  getEvents(): SyncEvent[] {
    try {
      const raw = localStorage.getItem(this.key('events'));
      return raw ? (JSON.parse(raw) as SyncEvent[]) : [];
    } catch {
      return [];
    }
  }

  /** Append a new event to the local queue */
  appendEvent(event: SyncEvent): void {
    const events = this.getEvents();
    // Guard against duplicate appends (e.g. double-tap)
    if (events.some((e) => e.id === event.id)) return;
    events.push(event);
    localStorage.setItem(this.key('events'), JSON.stringify(events));
  }

  /** Append multiple events (e.g. server events received during sync) */
  appendEvents(newEvents: SyncEvent[]): void {
    const existing = this.getEvents();
    const existingIds = new Set(existing.map((e) => e.id));
    const toAdd = newEvents.filter((e) => !existingIds.has(e.id));
    if (toAdd.length === 0) return;
    localStorage.setItem(
      this.key('events'),
      JSON.stringify([...existing, ...toAdd]),
    );
  }

  /** Mark a list of events as synced (by their IDs) */
  markSynced(eventIds: string[]): void {
    const idSet = new Set(eventIds);
    const events = this.getEvents().map((e) =>
      idSet.has(e.id) ? { ...e, synced: true } : e,
    );
    localStorage.setItem(this.key('events'), JSON.stringify(events));
  }

  /** Return only unsynced events — these are sent during the next sync */
  getUnsyncedEvents(): SyncEvent[] {
    return this.getEvents().filter((e) => !e.synced);
  }

  // ─── Sync cursor ───────────────────────────────────────────────────────────

  /**
   * The HLC of the last server event this client has received.
   * Used as the cursor for incremental sync — client only asks for
   * events with HLC > lastSyncedHLC, avoiding full state transfer.
   */
  getLastSyncedHLC(): string {
    return localStorage.getItem(this.key('lastSyncedHLC')) ?? '';
  }

  setLastSyncedHLC(hlc: string): void {
    localStorage.setItem(this.key('lastSyncedHLC'), hlc);
  }

  // ─── Cached student stats ──────────────────────────────────────────────────

  /** Cached authoritative stats from last server sync — for display only */
  getStudentStats(): StudentStats | null {
    try {
      const raw = localStorage.getItem(this.key('studentStats'));
      return raw ? (JSON.parse(raw) as StudentStats) : null;
    } catch {
      return null;
    }
  }

  setStudentStats(stats: StudentStats): void {
    localStorage.setItem(this.key('studentStats'), JSON.stringify(stats));
  }

  // ─── HLC state ─────────────────────────────────────────────────────────────

  /** Persist the last HLC this client generated — needed across page reloads */
  getLastLocalHLC(): string | null {
    return localStorage.getItem(this.key('lastLocalHLC'));
  }

  setLastLocalHLC(hlc: string): void {
    localStorage.setItem(this.key('lastLocalHLC'), hlc);
  }

  // ─── Dev / debug ───────────────────────────────────────────────────────────

  /** Clear all local state — useful in dev panel "reset" scenario */
  clearAll(): void {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }
}
