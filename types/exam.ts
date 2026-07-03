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

export interface ExamSet {
  title: string
  codeTemplate: string
  answers: string[]
}