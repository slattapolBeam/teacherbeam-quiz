import { NextResponse, type NextRequest } from 'next/server'
import { getUserForProxy } from '@/lib/supabase/auth-middleware'

const protectedRoutes = ['/dashboard', '/import']

// เช็คแบบ optimistic เท่านั้น (อ่าน session cookie ไม่ query DB เพิ่ม) — กันหน้าเว็บ ไม่ใช่ตัวป้องกันหลัก
// Server Action ทุกตัวใน dashboard/import ต้องเช็ค requireTeacher() ของตัวเองอีกชั้นเสมอ เพราะ proxy ไม่ครอบ Server Action call
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isProtected = protectedRoutes.some((route) => path.startsWith(route))

  const { user, response } = await getUserForProxy(request)

  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
}
