import { createServiceClient } from '@/lib/supabase/server'

type Actor = { type: 'student' | 'teacher'; id: string }

// เรียกจาก Server Action เท่านั้น — เขียน audit log แบบ fire-and-forget
// ห้าม throw เด็ดขาด: log ล้มเหลว (เช่น ตารางยังไม่มี) ต้องไม่บล็อกงานจริงของผู้ใช้
export async function logActivity(
  actor: Actor,
  action: string,
  target?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('activity_logs').insert([{
      actor_type: actor.type,
      actor_id: actor.id,
      action,
      target: target ?? null,
      metadata: metadata ?? null,
    }])
  } catch (err) {
    console.error('audit log บันทึกไม่สำเร็จ:', err)
  }
}
