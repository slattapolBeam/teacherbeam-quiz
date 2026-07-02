'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { ActiveExamSession } from '@/types/exam'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [pin, setPin] = useState('')
  const [studentId, setStudentId] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)

  // Token modal state
  const [showTokenModal, setShowTokenModal] = useState(false)
  const [checkId, setCheckId] = useState('')
  const [tokenResult, setTokenResult] = useState<string | null>(null)
  const [isFetchingToken, setIsFetchingToken] = useState(false)

  // Review pick modal state
  const [showReviewPickModal, setShowReviewPickModal] = useState(false)
  const [reviewCandidates, setReviewCandidates] = useState<{
    studentData: any
    projects: string[]
  } | null>(null)

  const pinInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    pinInputRef.current?.focus()
  }, [])

  function showError(msg: string) {
    setError(msg)
  }

  // ── Login (เข้าสอบด้วย PIN) ──────────────────────────────
  async function handleStudentLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      // 1. ดึงข้อมูล Session
      const { data: sessionData, error: sessionError } = await supabase
        .from('exam_sessions').select('*').eq('pin_code', pin).single()
      if (sessionError || !sessionData) throw new Error('รหัส PIN ไม่ถูกต้อง')
      const projectName = sessionData.project_name

      // 2. ดึงข้อมูล Student
      const { data: studentData, error: studentError } = await supabase
        .from('students').select('*').eq('student_id', studentId).single()
      if (studentError || !studentData) throw new Error('ไม่พบรหัสนักศึกษานี้ในระบบ')

      // 3. ตรวจสอบการสอบซ้ำ
      const { data: resultData } = await supabase
        .from('exam_results').select('id')
        .eq('student_id', studentId).eq('project_name', projectName)

      const activeSession: ActiveExamSession = {
        student_id: studentId,
        full_name: `${studentData.first_name} ${studentData.last_name}`,
        room: studentData.room,
        class_number: studentData.class_number,
        project_name: projectName,
        pin_code: pin,
        mode: 'exam',
        super_tokens: studentData.super_tokens || 0,
        got_gacha: false,
        gacha_amount: 0,
      }

      if (resultData && resultData.length > 0) {
        if (!sessionData.is_active) {
          activeSession.mode = 'review'
          sessionStorage.setItem('activeExamSession', JSON.stringify(activeSession))
          router.push('/exam')
          return
        } else {
          throw new Error('คุณได้ส่งข้อสอบแล้ว (จะดูเฉลยได้เมื่ออาจารย์ปิดห้องสอบเท่านั้น)')
        }
      }

      if (!sessionData.is_active) throw new Error('ห้องสอบนี้หมดเวลา และถูกปิดรับคำตอบไปแล้ว')

      // 4. เข้าสอบปกติ (Gacha ปิดแล้วตามที่คุยกัน)
      sessionStorage.setItem('activeExamSession', JSON.stringify(activeSession))
      router.push('/exam')

    } catch (err: any) {
      showError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Review Mode (ไม่ต้องใช้ PIN) ─────────────────────────
  async function handleReviewLookup() {
    setError('')
    if (!studentId || !/^\d{13}$/.test(studentId)) {
      return showError('กรุณากรอกรหัสนักศึกษา 13 หลักให้ครบก่อนกดทบทวนเฉลย')
    }
    setIsReviewing(true)

    try {
      const { data: studentData, error: studentError } = await supabase
        .from('students').select('*').eq('student_id', studentId).single()
      if (studentError || !studentData) throw new Error('ไม่พบรหัสนักศึกษานี้ในระบบ')

      const { data: resultsData, error: resultsError } = await supabase
        .from('exam_results').select('project_name').eq('student_id', studentId)
      if (resultsError) throw resultsError
      if (!resultsData || resultsData.length === 0)
        throw new Error('ยังไม่พบประวัติการสอบของรหัสนักศึกษานี้เลย')

      const projectNames = [...new Set(resultsData.map((r: any) => r.project_name as string))]

      const { data: sessionsData, error: sessionsError } = await supabase
        .from('exam_sessions').select('project_name, is_active').in('project_name', projectNames)
      if (sessionsError) throw sessionsError

      const closedProjects = projectNames.filter(pName => {
        const sessionsForProject = sessionsData.filter((s: any) => s.project_name === pName)
        return sessionsForProject.length > 0 && sessionsForProject.every((s: any) => !s.is_active)
      })

      if (closedProjects.length === 0)
        throw new Error('ยังไม่มีวิชาไหนที่ห้องสอบถูกปิดแล้ว กรุณารออาจารย์ปิดห้องสอบก่อน')

      if (closedProjects.length === 1) {
        enterReviewMode(studentData, closedProjects[0])
        return
      }

      setReviewCandidates({ studentData, projects: closedProjects })
      setShowReviewPickModal(true)

    } catch (err: any) {
      showError(err.message)
    } finally {
      setIsReviewing(false)
    }
  }

  function enterReviewMode(studentData: any, projectName: string) {
    const activeSession: ActiveExamSession = {
      student_id: studentData.student_id,
      full_name: `${studentData.first_name} ${studentData.last_name}`,
      room: studentData.room,
      class_number: studentData.class_number,
      project_name: projectName,
      super_tokens: studentData.super_tokens || 0,
      mode: 'review',
      got_gacha: false,
      gacha_amount: 0,
    }
    sessionStorage.setItem('activeExamSession', JSON.stringify(activeSession))
    router.push('/exam')
  }

  // ── Token Check Modal ─────────────────────────────────────
  async function fetchTokenCount() {
    if (!checkId) return
    setIsFetchingToken(true)
    try {
      const { data } = await supabase
        .from('students').select('super_tokens, first_name').eq('student_id', checkId).single()
      if (data) {
        setTokenResult(`สวัสดี ${data.first_name}!<br/>คุณมี Super Token: <span class="text-3xl text-yellow-500">${data.super_tokens || 0}</span> เหรียญ`)
      } else {
        setTokenResult('<span class="text-red-500">ไม่พบข้อมูลนักศึกษา</span>')
      }
    } catch {
      setTokenResult('<span class="text-red-500">เกิดข้อผิดพลาด</span>')
    }
    setIsFetchingToken(false)
  }

  function closeTokenModal() {
    setShowTokenModal(false)
    setTokenResult(null)
    setCheckId('')
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 selection:bg-blue-500 selection:text-white relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-300/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-300/20 rounded-full blur-[120px] pointer-events-none" />

      {/* Login Card */}
      <div className="w-full max-w-md z-10 apple-card p-8 sm:p-10 rounded-[2.5rem] shadow-2xl shadow-gray-200/50">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl text-3xl mb-5 shadow-inner">🧑‍💻</div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-2">Coding Quiz</h1>
          <p className="text-sm text-gray-500 font-medium">เข้าสู่ระบบเพื่อทำข้อสอบ หรือทบทวนเฉลย</p>
        </div>

        <form onSubmit={handleStudentLogin}>
          {/* PIN */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 ml-1">
              รหัสห้องสอบ (PIN){' '}
              <span className="normal-case font-normal text-gray-400">— ไม่ต้องกรอกถ้าต้องการแค่ทบทวนเฉลย</span>
            </label>
            <input
              ref={pinInputRef}
              type="text"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
              maxLength={6}
              autoComplete="off"
              className="w-full px-5 py-4 bg-white rounded-2xl border border-gray-200 focus:outline-none focus:border-blue-500 transition text-center tracking-[0.5em] text-2xl font-mono placeholder:tracking-normal placeholder:text-gray-300 input-glow"
              placeholder="123456"
            />
          </div>

          {/* Student ID */}
          <div className="mb-8">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 ml-1">
              รหัสนักศึกษา (13 หลัก)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              </span>
              <input
                type="text"
                value={studentId}
                onChange={e => setStudentId(e.target.value.replace(/[^0-9]/g, ''))}
                required
                maxLength={13}
                autoComplete="off"
                className="w-full pl-12 pr-5 py-4 bg-white rounded-2xl border border-gray-200 focus:outline-none focus:border-blue-500 transition font-mono text-lg placeholder:text-gray-300 input-glow"
                placeholder="683179xxxxxxx"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm font-medium rounded-xl border border-red-100 flex items-start gap-3">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span dangerouslySetInnerHTML={{ __html: error }} />
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-60 text-white font-semibold rounded-2xl transition duration-200 shadow-lg shadow-blue-500/25 active:scale-[0.98] flex justify-center items-center gap-2 text-lg"
          >
            {isSubmitting ? 'กำลังตรวจสอบ...' : 'ตรวจสอบข้อมูลและเข้าสอบ'}
          </button>

          {/* Review button */}
          <button
            type="button"
            onClick={handleReviewLookup}
            disabled={isReviewing}
            className="w-full mt-3 py-3.5 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 text-indigo-600 font-semibold rounded-2xl transition duration-200 active:scale-[0.98] flex justify-center items-center gap-2 text-sm border border-indigo-100"
          >
            <span>📚</span>
            <span>{isReviewing ? 'กำลังค้นหา...' : 'ทบทวนเฉลยข้อสอบเดิม (ใช้แค่รหัสนักศึกษา)'}</span>
          </button>
        </form>

        {/* Super Token check */}
        <div className="mt-8 text-center pt-6 border-t border-gray-100">
          <button
            onClick={() => setShowTokenModal(true)}
            className="text-sm text-yellow-600 font-medium hover:text-yellow-700 flex items-center justify-center gap-1 mx-auto transition bg-yellow-50 px-4 py-2 rounded-full"
          >
            <span>🌟</span> เช็กยอด Super Token ของฉัน
          </button>
        </div>
      </div>

      {/* Token Modal */}
      {showTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full mx-4 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="text-5xl mb-4">🌟</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">เช็ก Super Token</h2>
            <input
              type="text"
              value={checkId}
              onChange={e => setCheckId(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="กรอกรหัสนักศึกษา..."
              className="w-full text-center px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 mb-4 focus:outline-blue-500 font-mono"
            />
            <button
              onClick={fetchTokenCount}
              disabled={isFetchingToken}
              className="w-full py-3 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-60 text-white font-medium rounded-xl transition mb-2"
            >
              {isFetchingToken ? 'กำลังค้นหา...' : 'ตรวจสอบ'}
            </button>
            {tokenResult && (
              <p
                className="text-lg font-bold text-gray-800 my-4"
                dangerouslySetInnerHTML={{ __html: tokenResult }}
              />
            )}
            <button onClick={closeTokenModal} className="text-sm text-gray-500 hover:text-gray-800 underline">
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      )}

      {/* Review Pick Modal */}
      {showReviewPickModal && reviewCandidates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">📚</div>
              <h2 className="text-xl font-bold text-gray-900">เลือกวิชาที่ต้องการทบทวนเฉลย</h2>
              <p className="text-sm text-gray-500 mt-1">พบผลสอบที่ดูเฉลยได้มากกว่า 1 วิชา</p>
            </div>
            <div className="space-y-2 mb-4">
              {reviewCandidates.projects.map(p => (
                <button
                  key={p}
                  onClick={() => {
                    setShowReviewPickModal(false)
                    enterReviewMode(reviewCandidates.studentData, p)
                  }}
                  className="w-full text-left px-4 py-3 bg-gray-50 hover:bg-indigo-50 border border-gray-100 hover:border-indigo-200 rounded-xl transition font-medium text-gray-800"
                >
                  📖 {p}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowReviewPickModal(false)}
              className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-800 underline"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </main>
  )
}