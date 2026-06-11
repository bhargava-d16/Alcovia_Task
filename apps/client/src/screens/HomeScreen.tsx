import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import CircularTimer from '../components/CircularTimer';
import RewardCard from '../components/RewardCard';
import { useFocusSession } from '../hooks/useFocusSession';
import { useClient } from '../context/ClientContext';
import { useSync } from '../context/SyncContext';
import { Colors, Radii, Shadows, Typography } from '../constants/design';

const DURATIONS = [25, 45, 60, 90, 120];

export default function HomeScreen() {
  const { clientId, isOnline } = useClient();
  const { studentStats } = useSync();
  const {
    sessionState,
    selectedDuration,
    setSelectedDuration,
    timeLeft,
    progress,
    result,
    startSession,
    giveUp,
    dismiss,
  } = useFocusSession();

  const isIdle = sessionState === 'idle';
  const isRunning = sessionState === 'running';
  const isSuccess = sessionState === 'success';
  const isFailed = sessionState === 'failed';

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Focus Mode</Text>
            <Text style={styles.subGreeting}>Client {clientId} · student_001</Text>
          </View>
          <View style={styles.statsRow}>
            {studentStats && (
              <>
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>🪙 {studentStats.coins}</Text>
                </View>
                <View style={[styles.statChip, styles.statChipStreak]}>
                  <Text style={styles.statChipText}>🔥 {studentStats.streakDays}d</Text>
                </View>
              </>
            )}
            {!isOnline && (
              <View style={[styles.statChip, styles.offlineChip]}>
                <Text style={styles.statChipText}>Offline</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Timer ──────────────────────────────────────────────────────── */}
        <View style={styles.timerContainer}>
          <CircularTimer
            progress={progress}
            timeLeft={timeLeft}
            size={270}
            color={
              isRunning
                ? Colors.primary
                : isFailed
                ? Colors.danger
                : isSuccess
                ? Colors.success
                : Colors.primary
            }
            isRunning={isRunning}
          />
        </View>

        {/* ── Duration Picker (only when idle) ───────────────────────────── */}
        {isIdle && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SELECT DURATION</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {DURATIONS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.durationChip,
                    selectedDuration === d && styles.durationChipSelected,
                  ]}
                  onPress={() => setSelectedDuration(d)}
                  id={`duration-chip-${d}`}
                >
                  <Text
                    style={[
                      styles.durationChipText,
                      selectedDuration === d && styles.durationChipTextSelected,
                    ]}
                  >
                    {d} min
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Today's stats card ─────────────────────────────────────────── */}
        {studentStats && isIdle && (
          <View style={styles.statsCard}>
            <Text style={styles.statsCardTitle}>Today</Text>
            <Text style={styles.statsCardValue}>
              {studentStats.todayFocusMinutes} min focused
            </Text>
          </View>
        )}

        {/* ── Fail reason card ────────────────────────────────────────────── */}
        {isFailed && (
          <View style={styles.failCard}>
            <Text style={styles.failTitle}>Session ended.</Text>
            <Text style={styles.failSub}>No rewards earned.</Text>
            {result?.failReason && (
              <Text style={styles.failReason}>
                Reason:{' '}
                {result.failReason === 'app_switch'
                  ? 'You switched away from the app'
                  : 'Session was given up'}
              </Text>
            )}
            <TouchableOpacity
              style={styles.failBtn}
              onPress={dismiss}
              id="fail-dismiss-btn"
            >
              <Text style={styles.failBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Spacer for the bottom CTA ───────────────────────────────────── */}
        <View style={{ flex: 1, minHeight: 40 }} />
      </ScrollView>

      {/* ── Bottom CTA ─────────────────────────────────────────────────────── */}
      <View style={styles.bottomCTA}>
        {isIdle && (
          <TouchableOpacity
            style={styles.startBtn}
            onPress={startSession}
            id="start-focus-btn"
          >
            <Text style={styles.startBtnText}>Start Focus Session</Text>
          </TouchableOpacity>
        )}

        {isRunning && (
          <TouchableOpacity
            style={styles.giveUpBtn}
            onPress={giveUp}
            id="give-up-btn"
          >
            <Text style={styles.giveUpBtnText}>Give Up</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Reward Card (overlays bottom) ──────────────────────────────────── */}
      <RewardCard
        visible={isSuccess && !!result}
        coinsEarned={result?.coinsEarned ?? 50}
        streakDays={result?.streakDays ?? 0}
        todayMinutes={result?.todayMinutes ?? selectedDuration}
        onDismiss={dismiss}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 100 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: 24,
    marginBottom: 8,
  },
  greeting: { ...Typography.heading2 },
  subGreeting: { ...Typography.bodySmall, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  statChip: {
    backgroundColor: Colors.card,
    borderRadius: Radii.chip,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...Shadows.card,
  },
  statChipStreak: { backgroundColor: '#FEF3C7' },
  offlineChip: { backgroundColor: Colors.offline },
  statChipText: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },

  // Timer
  timerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },

  // Duration picker
  section: { marginBottom: 24 },
  sectionLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    marginBottom: 12,
    letterSpacing: 1,
  },
  chipRow: { gap: 8, paddingVertical: 4 },
  durationChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radii.chip,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  durationChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  durationChipText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  durationChipTextSelected: { color: '#fff' },

  // Today stats
  statsCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.card,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.success,
    ...Shadows.card,
    marginBottom: 16,
  },
  statsCardTitle: { ...Typography.label, color: Colors.textSecondary, letterSpacing: 1 },
  statsCardValue: { ...Typography.heading3, marginTop: 4 },

  // Fail card
  failCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.card,
    padding: 20,
    marginTop: 16,
    alignItems: 'center',
    borderTopWidth: 4,
    borderTopColor: Colors.danger,
    ...Shadows.card,
  },
  failTitle: { fontSize: 18, fontWeight: '600', color: Colors.textPrimary, marginBottom: 4 },
  failSub: { fontSize: 14, color: Colors.textSecondary, marginBottom: 8 },
  failReason: { fontSize: 13, color: Colors.danger, marginBottom: 16, textAlign: 'center' },
  failBtn: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.button,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  failBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },

  // Bottom CTA
  bottomCTA: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  startBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.button,
    paddingVertical: 16,
    alignItems: 'center',
    ...Shadows.card,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  giveUpBtn: {
    backgroundColor: 'transparent',
    borderRadius: Radii.button,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.danger,
  },
  giveUpBtnText: { color: Colors.danger, fontSize: 16, fontWeight: '600' },
});
