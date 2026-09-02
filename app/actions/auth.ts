'use server'

import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { logActivity } from '@/lib/auditLog'

type SignInError = { error: string }

// ── อาจารย์ล็อกอินด้วย email/password (Supabase Auth) — ไม่มีหน้าสมัครสมาชิก สร้าง account ได้ผ่าน Supabase Dashboard เท่านั้น ──
// redirect('/dashboard') ทำงานใน Server Action เพื่อให้ cookies ถูก set ก่อน navigation จาก Proxy
export async function signInTeacher(email: string, password: string): Promise<SignInError | void> {
  const supabase = await createAuthServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    await logActivity({ type: 'teacher', id: email }, 'teacher_login_failed')
    return { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }
  }
  await logActivity({ type: 'teacher', id: email }, 'teacher_login_success')
  redirect('/dashboard')
}

export async function signOutTeacher(): Promise<void> {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.email) await logActivity({ type: 'teacher', id: user.email }, 'teacher_logout')
  await supabase.auth.signOut()
  redirect('/')
}

// เรียกจากทุก Server Action ใน dashboard.ts / import.ts — proxy.ts เช็คแค่หน้าเว็บ ไม่ครอบ Server Action call โดยตรง
// คืนอีเมลกลับไปด้วย เพื่อให้ action ที่เรียกใช้เอาไปเป็น actor ตอนบันทึก audit log ได้เลยโดยไม่ต้อง query auth ซ้ำ
export async function requireTeacher(): Promise<{ email: string }> {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน')
  return { email: user.email }
}
