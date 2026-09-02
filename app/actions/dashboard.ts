'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { requireTeacher } from '@/app/actions/auth'
import { logActivity } from '@/lib/auditLog'

type ActionResult<T extends object = {}> = ({ success: true } & T) | { success: false; error: string }

// ── PIN management ────────────────────────────────────────
export async function generatePin(projectName: string, durationMinutes: number, heistWindowSeconds: number = 10): Promise<ActionResult<{ pin: string }>> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()
    const pin = Math.floor(100000 + Math.random() * 900000).toString()

    // ปิด session เก่าที่ยัง active ของวิชานี้ทั้งหมดก่อน (กันมี is_active=true ซ้อนกันหลายแถว)
    const { error: closeErr } = await supabase.from('exam_sessions')
      .update({ is_active: false }).eq('project_name', projectName).eq('is_active', true)
    if (closeErr) throw closeErr

    // exam_sessions ไม่มี unique constraint บน project_name จึงต้อง insert ไม่ใช่ upsert
    const { error: insertErr } = await supabase.from('exam_sessions')
      .insert([{ project_name: projectName, pin_code: pin, is_active: true, duration_minutes: durationMinutes, heist_window_seconds: heistWindowSeconds }])
    if (insertErr) throw insertErr

    await logActivity({ type: 'teacher', id: teacher.email }, 'generate_pin', projectName, { pin, durationMinutes, heistWindowSeconds })
    return { success: true, pin }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function closeSession(projectName: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()
    const { error } = await supabase.from('exam_sessions')
      .update({ is_active: false }).eq('project_name', projectName).eq('is_active', true)
    if (error) throw error

    // แจ้ง client ทุกเครื่องที่กำลังสอบอยู่ให้ส่งคำตอบทันที
    const ch = supabase.channel('exam-broadcast')
    await ch.subscribe()
    await ch.send({ type: 'broadcast', event: 'force_submit', payload: { projectName } })
    await supabase.removeChannel(ch)

    await logActivity({ type: 'teacher', id: teacher.email }, 'close_session', projectName)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── Reset Super Token ของทั้งห้องเรียน ─────────────────────
export async function resetRoomTokens(room: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()
    const { error } = await supabase.from('students')
      .update({ super_tokens: 0 }).eq('room', room).gt('super_tokens', 0)
    if (error) throw error
    await logActivity({ type: 'teacher', id: teacher.email }, 'reset_room_tokens', room)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── Give / remove token per student ────────────────────────
export async function giveTokenToStudent(studentId: string): Promise<ActionResult<{ tokens: number }>> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()
    const { data: st, error: fetchErr } = await supabase.from('students')
      .select('super_tokens').eq('student_id', studentId).single()
    if (fetchErr) throw fetchErr
    let tokens = st ? (st.super_tokens || 0) : 0
    if (tokens >= 3) return { success: true, tokens }

    tokens += 1 // ให้ทีละ 1 เหรียญ (ตันที่ 3)
    const { error: updateErr } = await supabase.from('students')
      .update({ super_tokens: tokens }).eq('student_id', studentId)
    if (updateErr) throw updateErr

    await logActivity({ type: 'teacher', id: teacher.email }, 'give_token', studentId, { tokens })
    return { success: true, tokens }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function removeTokenFromStudent(studentId: string): Promise<ActionResult<{ tokens: number }>> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()
    const { data: st, error: fetchErr } = await supabase.from('students')
      .select('super_tokens').eq('student_id', studentId).single()
    if (fetchErr) throw fetchErr
    let tokens = st ? (st.super_tokens || 0) : 0
    if (tokens <= 0) return { success: true, tokens }

    tokens -= 1
    const { error: updateErr } = await supabase.from('students')
      .update({ super_tokens: tokens }).eq('student_id', studentId)
    if (updateErr) throw updateErr

    await logActivity({ type: 'teacher', id: teacher.email }, 'remove_token', studentId, { tokens })
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
    const teacher = await requireTeacher()
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
    await logActivity({ type: 'teacher', id: teacher.email }, 'distribute_tokens_gacha', projectName, {
      room, count, successCount, blockedCount, selectedIds,
    })
    return { success: true, successCount, blockedCount, selectedIds }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── ลบผลสอบ ────────────────────────────────────────────────
export async function deleteExamResult(studentId: string, projectName: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()
    const { error } = await supabase.from('exam_results')
      .delete().eq('student_id', studentId).eq('project_name', projectName)
    if (error) throw error
    await logActivity({ type: 'teacher', id: teacher.email }, 'delete_exam_result', studentId, { projectName })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── Import นักศึกษา (upsert ตาม student_id) ─────────────────
export type ImportStudentRow = {
  student_id: string
  first_name: string
  last_name: string
  room: string
  class_number: number
}

export async function importStudents(
  rows: ImportStudentRow[]
): Promise<ActionResult<{ count: number }>> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()

    if (!rows || rows.length === 0) {
      return { success: false, error: 'ไม่มีข้อมูลนักศึกษาให้นำเข้า' }
    }
    const invalid = rows.find(r => !r.student_id || !r.first_name || !r.room)
    if (invalid) {
      return { success: false, error: `พบแถวข้อมูลไม่ครบ (รหัส/ชื่อ/ห้อง): ${JSON.stringify(invalid)}` }
    }

    // upsert ตาม student_id ที่ต้องมี unique constraint อยู่แล้วในตาราง students
    const { error } = await supabase.from('students')
      .upsert(rows, { onConflict: 'student_id' })
    if (error) throw error

    await logActivity({ type: 'teacher', id: teacher.email }, 'import_students', 'bulk', {
      count: rows.length,
      rooms: [...new Set(rows.map(r => r.room))],
    })
    return { success: true, count: rows.length }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── ประวัติ Heist (ปล้นเหรียญ) ────────────────────────────────
export type HeistLogRow = {
  id: number
  attacker_id: string
  attacker_name: string
  victim_id: string
  victim_name: string
  snippet: string
  outcome: string
  stake_amount: number
  created_at: string
  resolved_at: string | null
}

export async function getHeistLog(projectName: string): Promise<ActionResult<{ rows: HeistLogRow[] }>> {
  const supabase = createServiceClient()
  try {
    await requireTeacher()
    const { data: rawRows, error } = await supabase
      .from('token_heist_log')
      .select('id, attacker_id, victim_id, snippet, outcome, stake_amount, created_at, resolved_at')
      .eq('project_name', projectName)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error

    const rows = rawRows || []
    const ids = new Set<string>()
    rows.forEach((r: any) => { ids.add(r.attacker_id); ids.add(r.victim_id) })

    const { data: students } = await supabase
      .from('students').select('student_id, first_name, last_name').in('student_id', [...ids])
    const nameMap = new Map((students || []).map((s: any) => [
      s.student_id, `${s.first_name} ${s.last_name}`
    ]))

    return {
      success: true,
      rows: rows.map((r: any) => ({
        ...r,
        attacker_name: nameMap.get(r.attacker_id) ?? r.attacker_id,
        victim_name: nameMap.get(r.victim_id) ?? r.victim_id,
      })),
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── ลบนักศึกษารายคน ──────────────────────────────────────────
export async function deleteStudent(studentId: string): Promise<ActionResult> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()
    const { error } = await supabase.from('students').delete().eq('student_id', studentId)
    if (error) throw error
    await logActivity({ type: 'teacher', id: teacher.email }, 'delete_student', studentId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── ลบนักศึกษาทั้งห้อง ────────────────────────────────────────
export async function deleteRoom(room: string): Promise<ActionResult<{ count: number }>> {
  const supabase = createServiceClient()
  try {
    const teacher = await requireTeacher()
    const { data, error } = await supabase.from('students')
      .delete().eq('room', room).select('student_id')
    if (error) throw error
    const count = data?.length || 0
    await logActivity({ type: 'teacher', id: teacher.email }, 'delete_room', room, { count })
    return { success: true, count }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}