import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import CircularProgress from '../components/CircularProgress';
import { useSyllabus, Task, Chapter, Subject } from '../hooks/useSyllabus';
import { Colors, Radii, Shadows, Typography } from '../constants/design';

type TaskStatus = 'not_started' | 'in_progress' | 'done';

const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  not_started: Colors.textSecondary,
  in_progress: Colors.primary,
  done: Colors.success,
};

const STATUS_BG: Record<TaskStatus, string> = {
  not_started: '#F1F5F9',
  in_progress: '#EFF6FF',
  done: '#ECFDF5',
};

export default function SyllabusScreen() {
  const { subjects, loading, error, cycleTaskStatus, chapterProgress, subjectProgress } =
    useSyllabus();
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      next.has(chapterId) ? next.delete(chapterId) : next.add(chapterId);
      return next;
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading syllabus…</Text>
      </View>
    );
  }

  const displaySubjects = selectedSubject
    ? subjects.filter((s) => s.id === selectedSubject)
    : subjects;

  return (
    <SafeAreaView style={styles.root}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title}>Syllabus</Text>
        {error && <Text style={styles.errorBanner}>{error}</Text>}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* ── Subject Cards ─────────────────────────────────────────────── */}
        <View style={styles.subjectGrid}>
          {subjects.map((subject) => {
            const prog = subjectProgress(subject);
            const isSelected = selectedSubject === subject.id;
            return (
              <TouchableOpacity
                key={subject.id}
                style={[
                  styles.subjectCard,
                  { borderTopColor: subject.color },
                  isSelected && styles.subjectCardSelected,
                ]}
                onPress={() =>
                  setSelectedSubject(isSelected ? null : subject.id)
                }
                id={`subject-card-${subject.id}`}
              >
                <CircularProgress
                  progress={prog}
                  size={52}
                  color={subject.color}
                />
                <Text style={styles.subjectName}>{subject.name}</Text>
                <Text style={styles.subjectChapters}>
                  {subject.chapters.length} chapters
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Chapter + Task list ───────────────────────────────────────── */}
        <View style={styles.chaptersContainer}>
          {displaySubjects.map((subject) => (
            <View key={subject.id} style={styles.subjectSection}>
              <Text style={[styles.subjectSectionTitle, { color: subject.color }]}>
                {subject.name}
              </Text>

              {subject.chapters.map((chapter) => {
                const prog = chapterProgress(chapter);
                const isExpanded = expandedChapters.has(chapter.id);
                const doneCount = chapter.tasks.filter((t) => t.status === 'done').length;

                return (
                  <View key={chapter.id} style={styles.chapterCard}>
                    {/* Chapter header */}
                    <TouchableOpacity
                      style={styles.chapterHeader}
                      onPress={() => toggleChapter(chapter.id)}
                      id={`chapter-${chapter.id}`}
                    >
                      <View style={styles.chapterLeft}>
                        <Text style={styles.chapterName}>{chapter.name}</Text>
                        <Text style={styles.chapterMeta}>
                          {doneCount}/{chapter.tasks.length} tasks
                        </Text>
                      </View>
                      <View style={styles.chapterRight}>
                        {/* Mini progress bar */}
                        <View style={styles.miniBarBg}>
                          <View
                            style={[
                              styles.miniBarFill,
                              {
                                width: `${prog * 100}%`,
                                backgroundColor: subject.color,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.chapterPct}>{Math.round(prog * 100)}%</Text>
                        <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Task list (expanded) */}
                    {isExpanded && (
                      <View style={styles.taskList}>
                        {chapter.tasks.map((task) => (
                          <View key={task.id} style={styles.taskRow}>
                            <Text style={styles.taskTitle}>{task.title}</Text>
                            <TouchableOpacity
                              style={[
                                styles.statusPill,
                                { backgroundColor: STATUS_BG[task.status as TaskStatus] },
                              ]}
                              onPress={() => cycleTaskStatus(task, subject.id)}
                              id={`task-status-${task.id}`}
                            >
                              <Text
                                style={[
                                  styles.statusPillText,
                                  { color: STATUS_COLOR[task.status as TaskStatus] },
                                ]}
                              >
                                {STATUS_LABEL[task.status as TaskStatus]}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { ...Typography.body, color: Colors.textSecondary },

  header: { padding: 24, paddingBottom: 16 },
  title: { ...Typography.heading1 },
  errorBanner: {
    fontSize: 12,
    color: Colors.danger,
    marginTop: 4,
    fontStyle: 'italic',
  },

  // Subject grid
  subjectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 8,
  },
  subjectCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: Colors.card,
    borderRadius: Radii.card,
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 4,
    gap: 8,
    ...Shadows.card,
  },
  subjectCardSelected: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  subjectName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary, textAlign: 'center' },
  subjectChapters: { fontSize: 12, color: Colors.textSecondary },

  // Chapters
  chaptersContainer: { paddingHorizontal: 16, paddingBottom: 40 },
  subjectSection: { marginBottom: 16 },
  subjectSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 8,
    textTransform: 'uppercase',
  },

  chapterCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.card,
    marginBottom: 8,
    overflow: 'hidden',
    ...Shadows.card,
  },
  chapterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  chapterLeft: { flex: 1 },
  chapterName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  chapterMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  chapterRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniBarBg: {
    width: 60,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniBarFill: { height: 4, borderRadius: 2 },
  chapterPct: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, width: 32 },
  chevron: { fontSize: 11, color: Colors.textSecondary },

  // Task list
  taskList: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  taskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  taskTitle: { flex: 1, fontSize: 14, color: Colors.textPrimary, paddingRight: 12 },
  statusPill: {
    borderRadius: Radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusPillText: { fontSize: 12, fontWeight: '600' },
});
