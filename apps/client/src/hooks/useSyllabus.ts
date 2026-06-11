/**
 * useSyllabus — loads subjects/chapters/tasks and manages optimistic updates.
 *
 * OPTIMISTIC UPDATE FLOW:
 * 1. User taps status pill → status updates instantly in local state
 * 2. A task_status_changed SyncEvent is emitted and stored locally
 * 3. Server is NOT called immediately (offline-first)
 * 4. On next sync, the event is sent to server
 * 5. Server applies LWW resolution and returns canonical state
 * 6. Client merges server state — if no conflict, optimistic state wins
 *
 * CONFLICT CASE:
 * If Client B also changed the same task, and B's HLC > A's HLC,
 * the merge will show B's status. The optimistic state on A will
 * be corrected after sync (user sees their change "undone" — this is
 * the expected LWW behavior, documented in DECISIONS.md).
 */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useSync } from '../context/SyncContext';
import { useClient } from '../context/ClientContext';
import { computeTaskStates, TaskStatus } from '@alcovia/sync-engine';
import { API_BASE } from '../constants/design';

export interface Task {
  id: string;
  chapter_id: string;
  title: string;
  status: TaskStatus;
  is_deleted: boolean;
  hlc_timestamp: string;
}

export interface Chapter {
  id: string;
  subject_id: string;
  name: string;
  order_index: number;
  tasks: Task[];
}

export interface Subject {
  id: string;
  name: string;
  color: string;
  chapters: Chapter[];
}

export function useSyllabus() {
  const { emitEvent, allEvents } = useSync();
  const { clientId } = useClient();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch from server on mount
  useEffect(() => {
    let mounted = true;
    axios
      .get(`${API_BASE}/subjects`)
      .then(({ data }) => {
        if (mounted) {
          setSubjects(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError('Could not load syllabus — showing cached state');
          setLoading(false);
        }
      });
    return () => { mounted = false; };
  }, []);

  // Apply local event optimistic overrides on top of server state
  // This recomputes whenever new events are emitted
  const taskOverrides = computeTaskStates(allEvents);

  const subjectsWithOverrides = subjects.map((subject) => ({
    ...subject,
    chapters: subject.chapters.map((chapter) => ({
      ...chapter,
      tasks: chapter.tasks
        .filter((t) => !t.is_deleted)
        .map((task) => {
          const override = taskOverrides.get(task.id);
          if (override && override.winningHLC > task.hlc_timestamp) {
            return { ...task, status: override.winningStatus };
          }
          return task;
        }),
    })),
  }));

  // Cycle task status: not_started → in_progress → done → not_started
  const cycleTaskStatus = useCallback(
    (task: Task, subjectId: string) => {
      const cycle: TaskStatus[] = ['not_started', 'in_progress', 'done'];
      const currentIdx = cycle.indexOf(task.status);
      const newStatus = cycle[(currentIdx + 1) % cycle.length];

      // Emit event (optimistic — no server call yet)
      emitEvent('task_status_changed', {
        taskId: task.id,
        chapterId: task.chapter_id,
        subjectId,
        previousStatus: task.status,
        newStatus,
      });
    },
    [emitEvent],
  );

  // Compute progress
  function chapterProgress(chapter: Chapter): number {
    const tasks = chapter.tasks.filter((t) => !t.is_deleted);
    if (tasks.length === 0) return 0;
    const override = (t: Task) => taskOverrides.get(t.id)?.winningStatus ?? t.status;
    const done = tasks.filter((t) => override(t) === 'done').length;
    return done / tasks.length;
  }

  function subjectProgress(subject: Subject): number {
    const chs = subject.chapters;
    if (chs.length === 0) return 0;
    const avg = chs.reduce((sum, c) => sum + chapterProgress(c), 0) / chs.length;
    return avg;
  }

  return {
    subjects: subjectsWithOverrides,
    loading,
    error,
    cycleTaskStatus,
    chapterProgress,
    subjectProgress,
  };
}
