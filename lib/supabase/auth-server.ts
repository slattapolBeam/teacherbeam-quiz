import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// client ที่ sync กับ auth cookie ของ Supabase — ใช้เช็ค session อาจารย์ใน Server Component/Action เท่านั้น
// คนละตัวกับ createServiceClient() (service role, bypass RLS สำหรับ query ข้อมูลสอบ)
export async function createAuthServerClient() {
  const cookieStore = await cookies()

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // เรียกจาก Server Component (ไม่ใช่ Action/Route) จะ set cookie ไม่ได้ — ปล่อยผ่าน เพราะ proxy.ts รีเฟรช session ให้แล้ว
        }
      },
    },
  })
}
