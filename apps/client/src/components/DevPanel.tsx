/**
 * DevPanel — floating debug panel for demonstrating sync scenarios.
 *
 * This is the evaluator-facing component. It makes all 5 convergence
 * scenarios visible and lets you see n8n exactly-once behavior live.
 *
 * Implemented as a floating button (bottom-right, fixed on web)
 * that opens a full-screen modal overlay.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Platform,
  Switch,
  ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import { useClient } from '../context/ClientContext';
import { useSync } from '../context/SyncContext';
import { Colors, Radii, Shadows } from '../constants/design';
import { API_BASE } from '../constants/design';
import {
  hlcNow,
  hlcToString,
  createSyncEvent,
} from '@alcovia/sync-engine';

interface N8nLogEntry {
  timestamp: string;
  sessionId: string;
  message: string;
  skipped: boolean;
}

// We maintain a client-side registry of "the other client" for cross-client scenarios
// In a real multi-window setup this would use BroadcastChannel or server-mediated events
const DEMO_TASK_ID = 'b10000000-0000-0000-0000-000000000001'; // Physics Ch1 Task1

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function DevPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [n8nLog, setN8nLog] = useState<N8nLogEntry[]>([]);
  const { clientId, isOnline, setOnline, store } = useClient();
  const {
    studentStats,
    pendingCount,
    lastSyncedHLC,
    isSyncing,
    triggerSync,
    emitEvent,
  } = useSync();

  // Poll n8n log when panel is open
  useEffect(() => {
    if (!isOpen) return;
    const poll = async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/webhooks/n8n-log`);
        setN8nLog(data);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // ─── Scenario buttons ──────────────────────────────────────────────────────

  const doCompleteFocusSession = useCallback(async () => {
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    emitEvent('focus_session_completed', {
      sessionId,
      targetDurationMinutes: 25,
      startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      endedAt: now,
    });
    appendLog(`[${clientId}] Queued focus session completion (offline=${!isOnline})`);
  }, [clientId, isOnline, emitEvent]);

  const doEditTask = useCallback(
    (newStatus: 'done' | 'in_progress') => {
      emitEvent('task_status_changed', {
        taskId: DEMO_TASK_ID,
        chapterId: 'a1000000-0000-0000-0000-000000000001',
        subjectId: '11111111-1111-1111-1111-111111111111',
        previousStatus: 'not_started',
        newStatus,
      });
      appendLog(`[${clientId}] Queued task → ${newStatus} (offline=${!isOnline})`);
    },
    [clientId, isOnline, emitEvent],
  );

  const doReconnectAndSync = useCallback(async () => {
    setOnline(true);
    appendLog(`[${clientId}] Reconnected — triggering sync...`);
    await triggerSync();
    appendLog(`[${clientId}] Sync complete`);
  }, [clientId, setOnline, triggerSync]);

  const [localLog, setLocalLog] = useState<string[]>([]);
  const appendLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLocalLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 50));
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const allEvents = store.getEvents();
  const syncedCount = allEvents.filter((e) => e.synced).length;

  return (
    <>
      {/* Floating DEV button */}
      <TouchableOpacity
        style={[
          styles.fab,
          { backgroundColor: isOnline ? Colors.primary : Colors.offline },
        ]}
        onPress={() => setIsOpen(true)}
        id="dev-panel-toggle"
      >
        <Text style={styles.fabText}>DEV</Text>
        {pendingCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pendingCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Dev Panel Modal */}
      <Modal
        visible={isOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsOpen(false)}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>🔧 Dev Panel — Client {clientId}</Text>
            <TouchableOpacity onPress={() => setIsOpen(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>

            {/* ── Client State ──────────────────────────────────────────────── */}
            <Section title="Client State">
              <Row label="Client ID" value={clientId} />
              <Row label="Student ID" value="student_001" />
              <Row label="🪙 Coins" value={String(studentStats?.coins ?? '—')} />
              <Row label="🔥 Streak" value={`${studentStats?.streakDays ?? '—'} days`} />
              <Row label="⏱ Today" value={`${studentStats?.todayFocusMinutes ?? '—'} min`} />
              <Row label="Events Total" value={String(allEvents.length)} />
              <Row label="Pending Sync" value={String(pendingCount)} accent={pendingCount > 0} />
              <Row label="Last Synced HLC" value={lastSyncedHLC || 'never'} mono />
            </Section>

            {/* ── Network Toggle ────────────────────────────────────────────── */}
            <Section title="Network">
              <View style={styles.row}>
                <Text style={styles.rowLabel}>
                  {isOnline ? '🟢 Online' : '🔴 Offline'}
                </Text>
                <Switch
                  value={isOnline}
                  onValueChange={setOnline}
                  trackColor={{ false: Colors.danger, true: Colors.success }}
                  thumbColor="#fff"
                />
              </View>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={triggerSync}
                disabled={!isOnline || isSyncing}
                id="force-sync-btn"
              >
                {isSyncing
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.btnText}>⟳ Force Sync Now</Text>
                }
              </TouchableOpacity>
            </Section>

            {/* ── Scenario Buttons ──────────────────────────────────────────── */}
            <Section title="Convergence Scenarios">
              <TouchableOpacity
                style={[styles.btn, styles.btnAccent]}
                onPress={() => { setOnline(false); doCompleteFocusSession(); }}
                id="scenario-complete-offline"
              >
                <Text style={styles.btnText}>
                  ✅ Complete session (Client {clientId}, offline)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => doEditTask('done')}
                id="scenario-edit-done"
              >
                <Text style={styles.btnText}>
                  ✏️ Physics Ch1 Task1 → Done (Client {clientId})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnWarning]}
                onPress={() => doEditTask('in_progress')}
                id="scenario-edit-inprogress"
              >
                <Text style={styles.btnText}>
                  ✏️ Physics Ch1 Task1 → In Progress (Client {clientId})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnSuccess]}
                onPress={doReconnectAndSync}
                id="scenario-reconnect"
              >
                <Text style={styles.btnText}>
                  🔄 Reconnect + Sync
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnDanger]}
                onPress={() => {
                  // Soft-delete by sending a task_status_changed event
                  // Real delete would use a separate 'task_deleted' event type
                  // For demo: mark is_deleted via direct API call
                  axios.delete(`${API_BASE}/tasks/${DEMO_TASK_ID}`, {
                    data: {
                      clientId,
                      hlcTimestamp: hlcToString(hlcNow(clientId)),
                    },
                  }).then(() => appendLog(`[${clientId}] Deleted task (delete-wins)`))
                    .catch(() => appendLog(`[${clientId}] Delete failed (offline?)`));
                }}
                id="scenario-delete"
              >
                <Text style={styles.btnText}>
                  🗑️ Delete Physics Task (Client {clientId})
                </Text>
              </TouchableOpacity>
            </Section>

            {/* ── n8n Notification Log ─────────────────────────────────────── */}
            <Section title="n8n Notification Log">
              {n8nLog.length === 0 ? (
                <Text style={styles.emptyLog}>No notifications yet. Complete a session to trigger n8n.</Text>
              ) : (
                n8nLog.map((entry, i) => (
                  <View key={i} style={[styles.logEntry, entry.skipped && styles.logSkipped]}>
                    <Text style={styles.logTime}>{formatTime(entry.timestamp)}</Text>
                    <Text style={styles.logMsg}>
                      {entry.skipped ? '⏭ ' : '🔔 '}
                      {entry.message} — session {entry.sessionId.slice(0, 8)}…
                    </Text>
                  </View>
                ))
              )}
            </Section>

            {/* ── Local Event Log ───────────────────────────────────────────── */}
            <Section title="Activity Log">
              {localLog.length === 0 ? (
                <Text style={styles.emptyLog}>Use scenario buttons above to see activity here.</Text>
              ) : (
                localLog.map((entry, i) => (
                  <Text key={i} style={styles.logLine}>{entry}</Text>
                ))
              )}
            </Section>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, accent = false, mono = false }: {
  label: string; value: string; accent?: boolean; mono?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, accent && styles.rowValueAccent, mono && styles.mono]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // FAB
  fab: {
    position: Platform.OS === 'web' ? 'fixed' as any : 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    ...Shadows.modal,
  },
  fabText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.danger,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Modal
  modal: { flex: 1, backgroundColor: Colors.surface },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 24,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  closeBtn: { fontSize: 20, color: Colors.textSecondary, padding: 4 },
  modalBody: { flex: 1, padding: 16 },

  // Sections
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },

  // Rows
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: { fontSize: 14, color: Colors.textSecondary },
  rowValue: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  rowValueAccent: { color: Colors.danger },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11 },

  // Buttons
  btn: {
    borderRadius: Radii.button,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  btnPrimary: { backgroundColor: Colors.primary },
  btnAccent: { backgroundColor: Colors.accent },
  btnWarning: { backgroundColor: '#F59E0B' },
  btnSuccess: { backgroundColor: Colors.success },
  btnDanger: { backgroundColor: Colors.danger },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Logs
  logEntry: {
    padding: 10,
    backgroundColor: Colors.card,
    borderRadius: 6,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: Colors.success,
  },
  logSkipped: { borderLeftColor: Colors.textSecondary },
  logTime: { fontSize: 11, color: Colors.textSecondary, marginBottom: 2, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  logMsg: { fontSize: 13, color: Colors.textPrimary },
  logLine: { fontSize: 12, color: Colors.textSecondary, paddingVertical: 3, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  emptyLog: { fontSize: 13, color: Colors.textSecondary, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
});
