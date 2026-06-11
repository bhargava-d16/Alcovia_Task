/**
 * Seed script — populates student_001 with subjects, chapters, and tasks.
 * Run with: npm run seed --workspace=apps/server
 *
 * Idempotent: uses upsert so running twice has no effect.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const STUDENT_ID = 'student_001';

// Fixed UUIDs so seed is idempotent (re-running doesn't create duplicates)
const SUBJECTS = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Physics',     color: '#3B82F6' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Mathematics', color: '#8B5CF6' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'History',     color: '#F59E0B' },
];

const CHAPTERS: Array<{
  id: string; subject_id: string; name: string; order_index: number;
}> = [
  // Physics
  { id: 'a1000000-0000-0000-0000-000000000001', subject_id: SUBJECTS[0].id, name: 'Mechanics',        order_index: 1 },
  { id: 'a1000000-0000-0000-0000-000000000002', subject_id: SUBJECTS[0].id, name: 'Thermodynamics',   order_index: 2 },
  // Mathematics
  { id: 'a2000000-0000-0000-0000-000000000001', subject_id: SUBJECTS[1].id, name: 'Algebra',          order_index: 1 },
  { id: 'a2000000-0000-0000-0000-000000000002', subject_id: SUBJECTS[1].id, name: 'Calculus',         order_index: 2 },
  // History
  { id: 'a3000000-0000-0000-0000-000000000001', subject_id: SUBJECTS[2].id, name: 'Ancient Civilisations', order_index: 1 },
  { id: 'a3000000-0000-0000-0000-000000000002', subject_id: SUBJECTS[2].id, name: 'World War II',     order_index: 2 },
];

// 4 tasks per chapter = 24 tasks total
const TASK_NAMES = [
  'Read textbook section',
  'Solve practice problems',
  'Watch lecture video',
  'Complete chapter quiz',
];

// Stable task UUIDs: based on chapter index + task index
// Format: b{chapterIdx}{taskIdx}000000-0000-0000-0000-00000000000{taskIdx}
function taskId(chapterIdx: number, taskIdx: number): string {
  const paddedChapter = String(chapterIdx).padStart(1, '0');
  const paddedTask = String(taskIdx).padStart(1, '0');
  return `b${paddedChapter}${paddedTask}00000-0000-0000-0000-00000000000${taskIdx}`.slice(0, 36);
}

const SEED_HLC = '000000000000000-00000-seed';

async function seed() {
  console.log('🌱 Seeding Alcovia database...\n');

  // ── Student stats ──────────────────────────────────────────────────────────
  const { error: statsErr } = await supabase
    .from('student_stats')
    .upsert(
      {
        student_id: STUDENT_ID,
        coins: 0,
        streak_days: 0,
        today_focus_minutes: 0,
        last_updated_hlc: SEED_HLC,
      },
      { onConflict: 'student_id' },
    );
  if (statsErr) throw statsErr;
  console.log('✅ student_stats seeded');

  // ── Subjects ───────────────────────────────────────────────────────────────
  const { error: subErr } = await supabase
    .from('subjects')
    .upsert(
      SUBJECTS.map((s) => ({ ...s, student_id: STUDENT_ID })),
      { onConflict: 'id' },
    );
  if (subErr) throw subErr;
  console.log(`✅ ${SUBJECTS.length} subjects seeded`);

  // ── Chapters ───────────────────────────────────────────────────────────────
  const { error: chapErr } = await supabase
    .from('chapters')
    .upsert(CHAPTERS, { onConflict: 'id' });
  if (chapErr) throw chapErr;
  console.log(`✅ ${CHAPTERS.length} chapters seeded`);

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const tasks = CHAPTERS.flatMap((chapter, chapterIdx) =>
    TASK_NAMES.map((title, taskIdx) => ({
      id: taskId(chapterIdx, taskIdx),
      chapter_id: chapter.id,
      title,
      status: 'not_started' as const,
      updated_at: new Date().toISOString(),
      updated_by_client: 'seed',
      hlc_timestamp: SEED_HLC,
      is_deleted: false,
    })),
  );

  const { error: taskErr } = await supabase
    .from('tasks')
    .upsert(tasks, { onConflict: 'id' });
  if (taskErr) throw taskErr;
  console.log(`✅ ${tasks.length} tasks seeded`);

  console.log('\n🎉 Seed complete! Open http://localhost:3000?client=A to start.');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
