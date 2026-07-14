'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { requireTeacher } from '@/app/actions/auth'

type ActionResult<T extends object = {}> = ({ success: true } & T) | { success: false; error: string }

// ── PIN management ────────────────────────────────────────
export async function generatePin(projectName: string): Promise<ActionResult<{ pin: string }>> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const pin = Math.floor(100000 + Math.random() * 900000).toString()

    // ปิด session เก่าที่ยัง active ของวิชานี้ทั้งหมดก่อน (กันมี is_active=true ซ้อนกันหลายแถว)
    const { error: closeErr } = await supabase.from('exam_sessions')
      .update({ is_active: false }).eq('project_name', projectName).eq('is_active', true)
    if (closeErr) throw closeErr

    // exam_sessions ไม่มี unique constraint บน project_name จึงต้อง insert ไม่ใช่ upsert
    const { error: insertErr } = await supabase.from('exam_sessions')
      .insert([{ project_name: projectName, pin_code: pin, is_active: true }])
    if (insertErr) throw insertErr

    return { success: true, pin }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function closeSession(projectName: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { error } = await supabase.from('exam_sessions')
      .update({ is_active: false }).eq('project_name', projectName).eq('is_active', true)
    if (error) throw error
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── Reset Super Token ของทั้งห้องเรียน ─────────────────────
export async function resetRoomTokens(room: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { error } = await supabase.from('students')
      .update({ super_tokens: 0 }).eq('room', room).gt('super_tokens', 0)
    if (error) throw error
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── Give / remove token per student ────────────────────────
export async function giveTokenToStudent(studentId: string): Promise<ActionResult<{ tokens: number }>> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { data: st, error: fetchErr } = await supabase.from('students')
      .select('super_tokens').eq('student_id', studentId).single()
    if (fetchErr) throw fetchErr
    let tokens = st ? (st.super_tokens || 0) : 0
    if (tokens >= 3) return { success: true, tokens }

    tokens += 1 // ให้ทีละ 1 เหรียญ (ตันที่ 3)
    const { error: updateErr } = await supabase.from('students')
      .update({ super_tokens: tokens }).eq('student_id', studentId)
    if (updateErr) throw updateErr

    return { success: true, tokens }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function removeTokenFromStudent(studentId: string): Promise<ActionResult<{ tokens: number }>> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { data: st, error: fetchErr } = await supabase.from('students')
      .select('super_tokens').eq('student_id', studentId).single()
    if (fetchErr) throw fetchErr
    let tokens = st ? (st.super_tokens || 0) : 0
    if (tokens <= 0) return { success: true, tokens }

    tokens -= 1
    const { error: updateErr } = await supabase.from('students')
      .update({ super_tokens: tokens }).eq('student_id', studentId)
    if (updateErr) throw updateErr

    return { success: true, tokens }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── Gacha: สุ่มแจก Super Token ให้นักศึกษาที่ยังสอบไม่เสร็จ ──
export async function distributeSuperTokens(
  projectName: string,
  room: string,
  count: number,
  excludeIds: string[] = []
): Promise<ActionResult<{ successCount: number; blockedCount: number; selectedIds: string[] }>> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { data: session, error: sessionErr } = await supabase.from('exam_sessions')
      .select('*').eq('project_name', projectName).eq('is_active', true).single()
    if (!session || sessionErr) {
      return { success: false, error: 'ยังไม่มีการเปิดห้องสอบสำหรับวิชานี้ หรือห้องสอบถูกปิดไปแล้ว' }
    }

    const { data: students, error: studentsErr } = await supabase.from('students').select('*')
    if (studentsErr) throw studentsErr

    const { data: results, error: resultsErr } = await supabase.from('exam_results')
      .select('student_id').eq('project_name', projectName)
    if (resultsErr) throw resultsErr
    const submittedIds = new Set((results || []).map((r: any) => r.student_id))

    const excludeSet = new Set(excludeIds)
    let eligible = (students || []).filter((s: any) => !submittedIds.has(s.student_id) && !excludeSet.has(s.student_id))
    if (room !== 'ALL') eligible = eligible.filter((s: any) => s.room === room)
    if (eligible.length === 0) {
      return { success: false, error: 'ไม่มีนักศึกษาที่ยังไม่เคยถูกสุ่มได้ในรอบนี้เหลืออยู่แล้ว (ทุกคนส่งข้อสอบแล้ว หรือถูกสุ่มได้ไปหมดแล้ว)' }
    }

    const actualCount = Math.min(count, eligible.length)
    const shuffled = [...eligible].sort(() => 0.5 - Math.random())
    const selected = shuffled.slice(0, actualCount)

    // แยก channel นี้จาก postgres_changes เพื่อไม่ให้การแจกรายคนไปโชว์ป๊อปอัพ Mystery Drop ผิด ๆ
    const gachaChannel = supabase.channel('gacha-broadcast')
    await gachaChannel.subscribe()

    let successCount = 0
    let blockedCount = 0
    const selectedIds: string[] = []

    for (const student of selected) {
      let tokens = student.super_tokens || 0
      if (tokens < 3) {
        tokens += 1
        const { error: updateErr } = await supabase.from('students')
          .update({ super_tokens: tokens }).eq('student_id', student.student_id)
        if (!updateErr) {
          successCount++
          selectedIds.push(student.student_id)
          gachaChannel.send({
            type: 'broadcast', event: 'gacha_drop',
            payload: { student_id: student.student_id, amount: 1 },
          })
        } else {
          blockedCount++
        }
      }
    }

    await supabase.removeChannel(gachaChannel)
    return { success: true, successCount, blockedCount, selectedIds }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── ลบผลสอบ ────────────────────────────────────────────────
export async function deleteExamResult(studentId: string, projectName: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { error } = await supabase.from('exam_results')
      .delete().eq('student_id', studentId).eq('project_name', projectName)
    if (error) throw error
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
