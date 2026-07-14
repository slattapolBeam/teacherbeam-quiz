import { createHmac, timingSafeEqual } from 'crypto'

const SECRET = process.env.SESSION_SECRET || ''

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url')
}

// เข้ารหัสลายเซ็น (ไม่ได้เข้ารหัสเนื้อหา) — ข้อมูลใน session ไม่ใช่ความลับ
// จุดประสงค์คือกันแก้ไข ไม่ใช่กันอ่าน
export function encodeSessionCookie(data: unknown): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function decodeSessionCookie<T>(cookieValue: string | undefined | null): T | null {
  if (!cookieValue) return null
  const dotIndex = cookieValue.lastIndexOf('.')
  if (dotIndex === -1) return null

  const payload = cookieValue.slice(0, dotIndex)
  const signature = cookieValue.slice(dotIndex + 1)
  const expected = sign(payload)

  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as T
  } catch {
    return null
  }
}
