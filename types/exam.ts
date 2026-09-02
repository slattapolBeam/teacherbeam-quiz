export interface ActiveExamSession {
  student_id: string
  full_name: string
  room: string
  class_number: number
  project_name: string
  pin_code?: string
  mode: 'exam' | 'review'
  super_tokens: number
  got_gacha: boolean
  gacha_amount: number
  hints_used?: number
  duration_minutes?: number
  heist_window_seconds?: number
  session_started_at?: string
}

export interface Student {
  student_id: string
  first_name: string
  last_name: string
  room: string
  class_number: number
  super_tokens: number
}

export interface ExamSession {
  id: string
  project_name: string
  pin_code: string
  is_active: boolean
  created_at: string
}

export interface ExamFile {
  filename: string
  codeTemplate: string
}

export interface ExamSet {
  title: string
  // ชุดข้อสอบไฟล์เดียว (แบบเดิม) ใช้ codeTemplate — ชุดหลายไฟล์ใช้ files แทน ไม่ใช้พร้อมกันทั้งคู่
  codeTemplate?: string
  files?: ExamFile[]
  // ไม่มีค่าตอนสอบจริง (Phase 7.2: server ไม่ส่งเฉลยมาให้ client เห็นอีกต่อไป) มีเฉพาะตอนดูเฉลยหลังสอบ
  answers?: string[]
}