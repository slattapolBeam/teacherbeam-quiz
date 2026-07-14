import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ใช้ในไฟล์ 'use server' เท่านั้น — service role key bypass RLS ทั้งหมด
// ห้าม import เข้า client component เด็ดขาด
export function createServiceClient() {
  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
