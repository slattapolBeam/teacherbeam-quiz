'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getExamSession } from '@/app/actions/session'

type SubmitExamInput = {
  exam_set: string
  hints_used: number
  student_answers: string[]
}

type SubmitExamResult =
  | { success: true; score: number }
  | { success: false; error: string }

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function isCorrect(studentAnswer: string, correctAnswer: string) {
  const cleanStudent = normalize(studentAnswer)
  const cleanCorrect = normalize(correctAnswer)
  return cleanStudent === cleanCorrect ||
    (cleanCorrect === '!=null' && cleanStudent === '!=null') ||
    (cleanCorrect === '+=' && cleanStudent === '+=')
}

// ตรวจคำตอบ + คำนวณคะแนนฝั่ง server เสมอ — client ส่งได้แค่คำตอบดิบ
// student_id/project_name มาจาก session cookie ที่ verify แล้วเท่านั้น ไม่เชื่อค่าที่ client ส่งมาตรง ๆ
// ป้องกันทั้งการแก้คะแนนตัวเองและการปลอมตัวเป็นนักศึกษาคนอื่นผ่าน devtools
export async function submitExam(input: SubmitExamInput): Promise<SubmitExamResult> {
  const session = await getExamSession()
  if (!session || session.mode !== 'exam') {
    return { success: false, error: 'session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' }
  }

  const supabase = createServiceClient()

  const { data: existing, error: existingErr } = await supabase.from('exam_results')
    .select('id').eq('student_id', session.student_id).eq('project_name', session.project_name)
  if (existingErr) return { success: false, error: existingErr.message }
  if (existing && existing.length > 0) {
    return { success: false, error: 'คุณได้ส่งข้อสอบวิชานี้ไปแล้ว' }
  }

  const { data: row, error: rowErr } = await supabase.from('exam_questions')
    .select('answers').eq('project_name', session.project_name).eq('set_name', input.exam_set).single()
  if (rowErr || !row) {
    return { success: false, error: 'ไม่พบข้อสอบชุดนี้ในระบบ' }
  }

  const correctAnswers = row.answers as string[]
  const totalQuestions = correctAnswers.length
  let score = 0

  for (let i = 0; i < totalQuestions; i++) {
    const studentAnswer = input.student_answers[i] || ''
    if (isCorrect(studentAnswer, correctAnswers[i])) {
      score += 10 / totalQuestions
    }
  }
  score = Math.round(score * 10) / 10

  const { error: insertErr } = await supabase.from('exam_results').insert([{
    student_id: session.student_id,
    project_name: session.project_name,
    exam_set: input.exam_set,
    score,
    hints_used: input.hints_used,
    student_answers: input.student_answers,
  }])
  if (insertErr) return { success: false, error: insertErr.message }

  return { success: true, score }
}

type UseSuperTokenResult =
  | { success: true; tokens: number }
  | { success: false; error: string }

// นักศึกษาใช้ Super Token ของตัวเอง 1 เหรียญ เพื่อเติมคำตอบข้อนั้นทันที
// student_id มาจาก session cookie เท่านั้น กันไม่ให้ใช้เหรียญคนอื่นได้
export async function useSuperToken(): Promise<UseSuperTokenResult> {
  const session = await getExamSession()
  if (!session) return { success: false, error: 'session หมดอายุ กรุณาเข้าสู่ระบบใหม่' }

  const supabase = createServiceClient()

  const { data: st, error: fetchErr } = await supabase.from('students')
    .select('super_tokens').eq('student_id', session.student_id).single()
  if (fetchErr) return { success: false, error: fetchErr.message }

  const tokens = st ? (st.super_tokens || 0) : 0
  if (tokens <= 0) return { success: false, error: 'ไม่มี Super Token เหลือแล้ว' }

  const newTokens = tokens - 1
  const { error: updateErr } = await supabase.from('students')
    .update({ super_tokens: newTokens }).eq('student_id', session.student_id)
  if (updateErr) return { success: false, error: updateErr.message }

  return { success: true, tokens: newTokens }
}
