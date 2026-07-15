'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { requireTeacher } from '@/app/actions/auth'

type ExamQuestionRow = {
  project_name: string
  set_name: string
  question_order: number
  type: string
  question: string
  code: string
  answers: string[]
}

type ActionResult<T extends object = {}> = ({ success: true } & T) | { success: false; error: string }

type ExistingSetRow = { project_name: string; set_name: string; question: string }

// ── รายการชุดข้อสอบที่มีอยู่แล้ว (ไม่มี answers) — เดิมหน้า import อ่านผ่าน anon key ตรง ๆ
// ย้ายมาเป็น Server Action เพราะ exam_questions ถอด anon SELECT ออกหมดแล้ว (Phase 7.2) ──
export async function listExamSets(): Promise<ActionResult<{ sets: ExistingSetRow[] }>> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { data, error } = await supabase.from('exam_questions')
      .select('project_name, set_name, question').order('project_name').order('set_name')
    if (error) throw error
    return { success: true, sets: data || [] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── บันทึกชุดข้อสอบ (แทนที่ทั้งหมด หรือ เพิ่มเติมเฉพาะชุดที่ระบุ) ──
export async function saveExamQuestions(
  projectName: string,
  setNames: string[],
  mode: 'replace' | 'append',
  rows: ExamQuestionRow[]
): Promise<ActionResult<{ savedCount: number }>> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    if (mode === 'replace') {
      const { error: delErr } = await supabase.from('exam_questions')
        .delete().eq('project_name', projectName)
      if (delErr) throw delErr
    } else {
      const { error: delErr } = await supabase.from('exam_questions')
        .delete().eq('project_name', projectName).in('set_name', setNames)
      if (delErr) throw delErr
    }

    const { error: insertErr } = await supabase.from('exam_questions').insert(rows)
    if (insertErr) throw insertErr

    return { success: true, savedCount: rows.length }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── ลบชุดข้อสอบ ────────────────────────────────────────────
export async function deleteExamQuestionSet(projectName: string, setName: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { error } = await supabase.from('exam_questions')
      .delete().eq('project_name', projectName).eq('set_name', setName)
    if (error) throw error
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── ลบทั้งวิชา (ลบข้อสอบทุกชุด + เอาวิชาออกจากตาราง subjects) ──
// exam_questions.project_name มี FK อ้าง subjects.name จึงต้องลบข้อสอบก่อนเสมอ
export async function deleteSubject(subjectName: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { error: delQuestionsErr } = await supabase.from('exam_questions')
      .delete().eq('project_name', subjectName)
    if (delQuestionsErr) throw delQuestionsErr

    const { error: delSubjectErr } = await supabase.from('subjects')
      .delete().eq('name', subjectName)
    if (delSubjectErr) throw delSubjectErr

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
