'use server'

import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { encodeSessionCookie, decodeSessionCookie } from '@/lib/session'
import { logActivity } from '@/lib/auditLog'
import type { ActiveExamSession } from '@/types/exam'

const COOKIE_NAME = 'exam_session'
const MAX_AGE = 60 * 60 * 4 // 4 ชั่วโมง พอสำหรับหนึ่งคาบเรียน

// export ไว้ให้ exam.ts เรียกใช้ตอน re-sign cookie หลังอัปเดต hints_used
export async function setSessionCookie(session: ActiveExamSession) {
  const store = await cookies()
  store.set(COOKIE_NAME, encodeSessionCookie(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

type SessionResult =
  | { success: true; session: ActiveExamSession }
  | { success: false; error: string }

// ── เข้าสอบด้วย PIN — ตรวจสอบทุกอย่างใหม่ฝั่ง server เสมอ ไม่เชื่อค่าที่ client ส่งมา ──
export async function startExamSession(studentId: string, pin: string): Promise<SessionResult> {
  const supabase = createServiceClient()

  const { data: sessionRow, error: sessionErr } = await supabase
    .from('exam_sessions').select('*').eq('pin_code', pin).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (sessionErr || !sessionRow) return { success: false, error: 'รหัส PIN ไม่ถูกต้อง หรือห้องสอบถูกปิดไปแล้ว' }

  const projectName = sessionRow.project_name

  const { data: student, error: studentErr } = await supabase
    .from('students').select('*').eq('student_id', studentId).single()
  if (studentErr || !student) return { success: false, error: 'ไม่พบรหัสนักศึกษานี้ในระบบ' }

  const { data: existingResults } = await supabase
    .from('exam_results').select('id').eq('student_id', studentId).eq('project_name', projectName)
  if (existingResults && existingResults.length > 0) {
    return { success: false, error: 'คุณได้ส่งข้อสอบแล้ว (จะดูเฉลยได้เมื่ออาจารย์ปิดห้องสอบเท่านั้น)' }
  }

  const session: ActiveExamSession = {
    student_id: student.student_id,
    full_name: `${student.first_name} ${student.last_name}`,
    room: student.room,
    class_number: student.class_number,
    project_name: projectName,
    pin_code: pin,
    mode: 'exam',
    super_tokens: student.super_tokens || 0,
    got_gacha: false,
    gacha_amount: 0,
    hints_used: 0,
  }

  await setSessionCookie(session)
  await logActivity({ type: 'student', id: student.student_id }, 'exam_session_start', projectName, { pin })
  return { success: true, session }
}

// ── เข้าโหมดทบทวนเฉลย (ห้องสอบต้องปิดแล้ว + ต้องเคยสอบวิชานี้จริง) ──
export async function startReviewSession(studentId: string, projectName: string): Promise<SessionResult> {
  const supabase = createServiceClient()

  const { data: student, error: studentErr } = await supabase
    .from('students').select('*').eq('student_id', studentId).single()
  if (studentErr || !student) return { success: false, error: 'ไม่พบรหัสนักศึกษานี้ในระบบ' }

  const { data: activeRow } = await supabase
    .from('exam_sessions').select('id').eq('project_name', projectName).eq('is_active', true).maybeSingle()
  if (activeRow) return { success: false, error: 'ห้องสอบวิชานี้ยังเปิดอยู่ ยังดูเฉลยไม่ได้ครับ' }

  const { data: results } = await supabase
    .from('exam_results').select('id').eq('student_id', studentId).eq('project_name', projectName)
  if (!results || results.length === 0) return { success: false, error: 'ไม่พบผลสอบวิชานี้ของคุณ' }

  const session: ActiveExamSession = {
    student_id: student.student_id,
    full_name: `${student.first_name} ${student.last_name}`,
    room: student.room,
    class_number: student.class_number,
    project_name: projectName,
    mode: 'review',
    super_tokens: student.super_tokens || 0,
    got_gacha: false,
    gacha_amount: 0,
  }

  await setSessionCookie(session)
  await logActivity({ type: 'student', id: student.student_id }, 'review_session_start', projectName)
  return { success: true, session }
}

// ── อ่าน session ปัจจุบันจาก cookie (ตรวจลายเซ็นเสมอ) ────────
export async function getExamSession(): Promise<ActiveExamSession | null> {
  const store = await cookies()
  return decodeSessionCookie<ActiveExamSession>(store.get(COOKIE_NAME)?.value)
}

// ── ออกจากระบบ ──────────────────────────────────────────────
export async function clearExamSession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}
