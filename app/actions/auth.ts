'use server'

import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

type SignInResult = { success: true } | { success: false; error: string }

// ── อาจารย์ล็อกอินด้วย email/password (Supabase Auth) — ไม่มีหน้าสมัครสมาชิก สร้าง account ได้ผ่าน Supabase Dashboard เท่านั้น ──
export async function signInTeacher(email: string, password: string): Promise<SignInResult> {
  const supabase = await createAuthServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { success: false, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }
  return { success: true }
}

export async function signOutTeacher(): Promise<void> {
  const supabase = await createAuthServerClient()
  await supabase.auth.signOut()
  redirect('/')
}

// เรียกจากทุก Server Action ใน dashboard.ts / import.ts — proxy.ts เช็คแค่หน้าเว็บ ไม่ครอบ Server Action call โดยตรง
export async function requireTeacher(): Promise<void> {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน')
}
