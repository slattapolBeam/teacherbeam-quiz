'use server'

import { createServiceClient } from '@/lib/supabase/server'

// หน้า login นักศึกษาเดิม query ตาราง students/exam_sessions/exam_results ผ่าน anon key ตรง ๆ
// ย้ายมาเป็น Server Action เพราะตารางเหล่านั้นถอด anon SELECT ออกหมดแล้ว (docs/sql/lock_down_anon.sql)
// คืนเฉพาะ field ที่หน้าจอใช้จริง — ไม่ส่ง select('*') ออกไป

type SubjectStatus = 'active' | 'closed-review' | 'not-open'

export type StudentLookup =
  | { success: true; student: { student_id: string; first_name: string; last_name: string } }
  | { success: false; error: string }

export async function lookupStudent(studentId: string): Promise<StudentLookup> {
  if (!/^\d{13}$/.test(studentId)) return { success: false, error: 'กรุณากรอกรหัสนักศึกษา 13 หลักให้ครบ' }

  const supabase = createServiceClient()
  const { data, error } = await supabase.from('students')
    .select('student_id, first_name, last_name').eq('student_id', studentId).maybeSingle()
  if (error || !data) return { success: false, error: 'ไม่พบรหัสนักศึกษานี้ในระบบ' }
  return { success: true, student: data }
}

export type SubjectsForStudent =
  | {
      success: true
      subjects: { id: string; name: string; description: string | null }[]
      status: Record<string, SubjectStatus>
    }
  | { success: false; error: string }

export async function loadSubjectsForStudent(studentId: string): Promise<SubjectsForStudent> {
  if (!/^\d{13}$/.test(studentId)) return { success: false, error: 'รหัสนักศึกษาไม่ถูกต้อง' }

  const supabase = createServiceClient()
  const { data: subjects, error } = await supabase
    .from('subjects').select('id, name, description').eq('is_active', true).order('name')
  if (error) return { success: false, error: error.message }

  const list = subjects || []
  if (list.length === 0) return { success: true, subjects: list, status: {} }

  const [{ data: activeSessions }, { data: results }] = await Promise.all([
    supabase.from('exam_sessions').select('project_name').eq('is_active', true),
    supabase.from('exam_results').select('project_name').eq('student_id', studentId),
  ])

  const activeNames = new Set((activeSessions || []).map((s: any) => s.project_name))
  const resultNames = new Set((results || []).map((r: any) => r.project_name))

  const status: Record<string, SubjectStatus> = {}
  for (const s of list) {
    if (activeNames.has(s.name)) status[s.name] = 'active'
    else if (resultNames.has(s.name)) status[s.name] = 'closed-review'
    else status[s.name] = 'not-open'
  }
  return { success: true, subjects: list, status }
}

export type TokenCountResult =
  | { success: true; firstName: string; tokens: number }
  | { success: false; error: string }

export async function checkTokenCount(studentId: string): Promise<TokenCountResult> {
  if (!/^\d{13}$/.test(studentId)) return { success: false, error: 'ไม่พบข้อมูลนักศึกษา' }

  const supabase = createServiceClient()
  const { data } = await supabase.from('students')
    .select('super_tokens, first_name').eq('student_id', studentId).maybeSingle()
  if (!data) return { success: false, error: 'ไม่พบข้อมูลนักศึกษา' }
  return { success: true, firstName: data.first_name, tokens: data.super_tokens || 0 }
}
