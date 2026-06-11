/**
 * useFocusSession — state machine for the focus timer.
 *
 * States: idle → running → success | failed
 *
 * Transitions:
 * - idle + start()       → running
 * - running + timer=0    → success (emits focus_session_completed event)
 * - running + giveUp()   → failed  (emits focus_session_failed, reason='give_up')
 * - running + background > 5s → failed (reason='app_switch')
 * - success | failed → idle (after reward/fail card dismissed)
 *
 * Background detection: uses visibilitychange event on web.
 * After 5 seconds hidden, auto-fails the session.
 *
 * NOTE: Reward state (coins, streak) comes from the server response after sync.
 * The client never computes rewards — it only reads them from studentStats
 * returned by the server's sync response.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { v4 as uuid } from 'uuid';
import { useSync } from '../context/SyncContext';

export type SessionState = 'idle' | 'running' | 'success' | 'failed';

export interface SessionResult {
  coinsEarned: number;
  streakDays: number;
  todayMinutes: number;
  failReason?: 'give_up' | 'app_switch';
}

const BACKGROUND_FAIL_TIMEOUT_MS = 5000;

export function useFocusSession() {
  const { emitEvent, triggerSync, studentStats } = useSync();

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [selectedDuration, setSelectedDuration] = useState(25); // minutes
  const [timeLeft, setTimeLeft] = useState(25 * 60); // seconds
  const [result, setResult] = useState<SessionResult | null>(null);

  const sessionIdRef = useRef<string>('');
  const startedAtRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Timer tick ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (sessionState !== 'running') return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          completeSession();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionState]);

  // ─── Background detection ──────────────────────────────────────────────────
  useEffect(() => {
    if (sessionState !== 'running') return;

    if (Platform.OS === 'web') {
      const handleVisibilityChange = () => {
        if (document.hidden) {
          // App went to background — start fail timer
          bgTimerRef.current = setTimeout(() => {
            failSession('app_switch');
          }, BACKGROUND_FAIL_TIMEOUT_MS);
        } else {
          // App came back — cancel fail timer
          if (bgTimerRef.current) clearTimeout(bgTimerRef.current);
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (bgTimerRef.current) clearTimeout(bgTimerRef.current);
      };
    } else {
      // React Native: use AppState
      const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'background' || state === 'inactive') {
          bgTimerRef.current = setTimeout(() => {
            failSession('app_switch');
          }, BACKGROUND_FAIL_TIMEOUT_MS);
        } else if (state === 'active') {
          if (bgTimerRef.current) clearTimeout(bgTimerRef.current);
        }
      });
      return () => {
        sub.remove();
        if (bgTimerRef.current) clearTimeout(bgTimerRef.current);
      };
    }
  }, [sessionState]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const startSession = useCallback(() => {
    sessionIdRef.current = uuid();
    startedAtRef.current = new Date().toISOString();
    setTimeLeft(selectedDuration * 60);
    setResult(null);
    setSessionState('running');
  }, [selectedDuration]);

  const completeSession = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (bgTimerRef.current) clearTimeout(bgTimerRef.current);

    emitEvent('focus_session_completed', {
      sessionId: sessionIdRef.current,
      targetDurationMinutes: selectedDuration,
      startedAt: startedAtRef.current,
      endedAt: new Date().toISOString(),
    });

    setSessionState('success');

    // Trigger sync to get updated stats — but don't block UI on it
    triggerSync();
  }, [selectedDuration, emitEvent, triggerSync]);

  const failSession = useCallback(
    (reason: 'give_up' | 'app_switch') => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (bgTimerRef.current) clearTimeout(bgTimerRef.current);

      emitEvent('focus_session_failed', {
        sessionId: sessionIdRef.current,
        targetDurationMinutes: selectedDuration,
        startedAt: startedAtRef.current,
        endedAt: new Date().toISOString(),
        failReason: reason,
      });

      setResult({ coinsEarned: 0, streakDays: 0, todayMinutes: 0, failReason: reason });
      setSessionState('failed');
    },
    [selectedDuration, emitEvent],
  );

  const giveUp = useCallback(() => failSession('give_up'), [failSession]);

  const dismiss = useCallback(() => {
    setSessionState('idle');
    setTimeLeft(selectedDuration * 60);
    setResult(null);
  }, [selectedDuration]);

  const progress =
    sessionState === 'idle' ? 0 : 1 - timeLeft / (selectedDuration * 60);

  // After sync returns updated stats, update the result
  useEffect(() => {
    if (sessionState === 'success' && studentStats) {
      setResult({
        coinsEarned: 50,
        streakDays: studentStats.streakDays,
        todayMinutes: studentStats.todayFocusMinutes,
      });
    }
  }, [sessionState, studentStats]);

  return {
    sessionState,
    selectedDuration,
    setSelectedDuration: (d: number) => {
      setSelectedDuration(d);
      if (sessionState === 'idle') setTimeLeft(d * 60);
    },
    timeLeft,
    progress,
    result,
    startSession,
    giveUp,
    dismiss,
  };
}
