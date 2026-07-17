'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getExamSession, setSessionCookie } from '@/app/actions/session'
import { logActivity } from '@/lib/auditLog'

// ชุดข้อสอบที่นักศึกษาแต่ละคนได้ กำหนดจาก class_number % จำนวนชุดที่มี (deterministic, ไม่สุ่ม)
async function deriveSetName(supabase: ReturnType<typeof createServiceClient>, projectName: string, classNumber: number) {
  const { data: setRows, error } = await supabase
    .from('exam_questions').select('set_name').eq('project_name', projectName)
  if (error || !setRows || setRows.length === 0) return null

  const availableSets = [...new Set(setRows.map((r: any) => r.set_name as string))].sort()
  return availableSets[(classNumber || 0) % availableSets.length]
}

type SubmitExamInput = {
  exam_set: string
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
    hints_used: session.hints_used || 0,
    student_answers: input.student_answers,
  }])
  if (insertErr) return { success: false, error: insertErr.message }

  await logActivity({ type: 'student', id: session.student_id }, 'exam_submit', session.project_name, {
    exam_set: input.exam_set, score,
  })

  return { success: true, score }
}

type GetQuestionResult =
  | { success: true; setName: string; title: string; codeTemplate: string }
  | { success: false; error: string }

// ── โจทย์สำหรับสอบจริง — ไม่ส่งเฉลยมาด้วยเด็ดขาด (Phase 7.2) ──
// เดิม client ดึง exam_questions ตรงผ่าน anon key เอง ทำให้เห็น answers ทั้งชุดใน Network tab ได้แม้ระหว่างสอบ
export async function getExamQuestionForStudent(): Promise<GetQuestionResult> {
  const session = await getExamSession()
  if (!session || session.mode !== 'exam') {
    return { success: false, error: 'session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' }
  }

  const supabase = createServiceClient()
  const setName = await deriveSetName(supabase, session.project_name, session.class_number)
  if (!setName) {
    return { success: false, error: `ไม่พบข้อสอบสำหรับวิชา "${session.project_name}" ในระบบ กรุณาแจ้งอาจารย์ผู้สอนให้เพิ่มข้อสอบก่อนครับ` }
  }

  const { data: row, error: rowErr } = await supabase.from('exam_questions')
    .select('question, code').eq('project_name', session.project_name).eq('set_name', setName).single()
  if (rowErr || !row) {
    return { success: false, error: `โหลดข้อสอบชุด "${setName}" ไม่สำเร็จ กรุณาแจ้งอาจารย์ผู้สอนครับ` }
  }

  return { success: true, setName, title: row.question, codeTemplate: row.code || '' }
}

type ReviewDataResult =
  | { success: true; setName: string; title: string; codeTemplate: string; answers: string[]; studentAnswers: string[]; score: number | null }
  | { success: false; error: string }

// ── ข้อมูลสำหรับโหมดดูเฉลย — เปิดเผยเฉลยได้ก็ต่อเมื่อห้องสอบปิดแล้วจริง (เช็คซ้ำฝั่ง server ไม่เชื่อแค่ session.mode) ──
export async function getReviewData(): Promise<ReviewDataResult> {
  const session = await getExamSession()
  if (!session || session.mode !== 'review') {
    return { success: false, error: 'session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' }
  }

  const supabase = createServiceClient()

  const { data: activeRow } = await supabase.from('exam_sessions')
    .select('id').eq('project_name', session.project_name).eq('is_active', true).maybeSingle()
  if (activeRow) return { success: false, error: 'ห้องสอบวิชานี้ยังเปิดอยู่ ยังดูเฉลยไม่ได้ครับ' }

  const setName = await deriveSetName(supabase, session.project_name, session.class_number)
  if (!setName) {
    return { success: false, error: `ไม่พบข้อสอบสำหรับวิชา "${session.project_name}" ในระบบ` }
  }

  const { data: row, error: rowErr } = await supabase.from('exam_questions')
    .select('question, code, answers').eq('project_name', session.project_name).eq('set_name', setName).single()
  if (rowErr || !row) {
    return { success: false, error: `โหลดข้อสอบชุด "${setName}" ไม่สำเร็จ` }
  }

  const { data: resultRow } = await supabase.from('exam_results')
    .select('student_answers, score').eq('student_id', session.student_id).eq('project_name', session.project_name).single()

  return {
    success: true,
    setName,
    title: row.question,
    codeTemplate: row.code || '',
    answers: (row.answers as string[]) || [],
    studentAnswers: (resultRow?.student_answers as string[]) || [],
    score: resultRow?.score ?? null,
  }
}

type UseSuperTokenResult =
  | { success: true; tokens: number; answer: string }
  | { success: false; error: string }

// นักศึกษาใช้ Super Token ของตัวเอง 1 เหรียญ เพื่อเติมคำตอบข้อนั้นทันที
// student_id มาจาก session cookie เท่านั้น กันไม่ให้ใช้เหรียญคนอื่นได้ — เฉลยข้อนั้นเดียวก็ดึงฝั่ง server เช่นกัน
export async function useSuperToken(setName: string, questionIndex: number): Promise<UseSuperTokenResult> {
  const session = await getExamSession()
  if (!session) return { success: false, error: 'session หมดอายุ กรุณาเข้าสู่ระบบใหม่' }

  const supabase = createServiceClient()

  const { data: st, error: fetchErr } = await supabase.from('students')
    .select('super_tokens').eq('student_id', session.student_id).single()
  if (fetchErr) return { success: false, error: fetchErr.message }

  const tokens = st ? (st.super_tokens || 0) : 0
  if (tokens <= 0) return { success: false, error: 'ไม่มี Super Token เหลือแล้ว' }

  const { data: row, error: rowErr } = await supabase.from('exam_questions')
    .select('answers').eq('project_name', session.project_name).eq('set_name', setName).single()
  if (rowErr || !row) return { success: false, error: 'ไม่พบข้อสอบชุดนี้ในระบบ' }
  const answer = (row.answers as string[])?.[questionIndex] || ''

  const newTokens = tokens - 1
  const { error: updateErr } = await supabase.from('students')
    .update({ super_tokens: newTokens }).eq('student_id', session.student_id)
  if (updateErr) return { success: false, error: updateErr.message }

  await logActivity({ type: 'student', id: session.student_id }, 'super_token_used', setName, { questionIndex })

  return { success: true, tokens: newTokens, answer }
}

type UseHintResult =
  | { success: true; hint: string; hintsUsed: number }
  | { success: false; error: string }

// คำใบ้ปกติ (💡) จำกัด 3 ครั้งต่อการสอบ — นับฝั่ง server ผ่าน session cookie กันแก้ค่าจาก devtools
export async function useHint(setName: string, questionIndex: number): Promise<UseHintResult> {
  const session = await getExamSession()
  if (!session || session.mode !== 'exam') {
    return { success: false, error: 'session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' }
  }

  const hintsUsed = session.hints_used || 0
  if (hintsUsed >= 3) return { success: false, error: 'คุณใช้สิทธิ์คำใบ้ปกติครบ 3 ครั้งแล้วครับ' }

  const supabase = createServiceClient()
  const { data: row, error: rowErr } = await supabase.from('exam_questions')
    .select('answers').eq('project_name', session.project_name).eq('set_name', setName).single()
  if (rowErr || !row) return { success: false, error: 'ไม่พบข้อสอบชุดนี้ในระบบ' }

  const hint = (row.answers as string[])?.[questionIndex]?.substring(0, 2) || ''
  const newHintsUsed = hintsUsed + 1
  await setSessionCookie({ ...session, hints_used: newHintsUsed })

  await logActivity({ type: 'student', id: session.student_id }, 'hint_used', setName, { questionIndex, hintsUsed: newHintsUsed })

  return { success: true, hint, hintsUsed: newHintsUsed }
}
