import { Router, Request, Response } from 'express';
import { supabase } from '../db';

const router = Router();

/**
 * GET /api/v1/subjects
 * Returns the full syllabus tree: subjects → chapters → tasks
 * for the hardcoded student_001.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: subjects, error: sErr } = await supabase
      .from('subjects')
      .select('*')
      .eq('student_id', 'student_001')
      .order('name');

    if (sErr) throw sErr;

    const { data: chapters, error: cErr } = await supabase
      .from('chapters')
      .select('*')
      .in('subject_id', (subjects ?? []).map((s) => s.id))
      .order('order_index');

    if (cErr) throw cErr;

    const { data: tasks, error: tErr } = await supabase
      .from('tasks')
      .select('*')
      .in('chapter_id', (chapters ?? []).map((c) => c.id))
      .eq('is_deleted', false);

    if (tErr) throw tErr;

    // Build tree
    const chapterMap = new Map<string, typeof chapters[number] & { tasks: typeof tasks }>();
    for (const chapter of chapters ?? []) {
      chapterMap.set(chapter.id, { ...chapter, tasks: [] });
    }
    for (const task of tasks ?? []) {
      chapterMap.get(task.chapter_id)?.tasks.push(task);
    }

    const result = (subjects ?? []).map((subject) => ({
      ...subject,
      chapters: (chapters ?? [])
        .filter((c) => c.subject_id === subject.id)
        .map((c) => ({
          ...chapterMap.get(c.id),
          tasks: chapterMap.get(c.id)?.tasks ?? [],
        })),
    }));

    return res.json(result);
  } catch (err) {
    console.error('[subjects] Fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

export default router;
