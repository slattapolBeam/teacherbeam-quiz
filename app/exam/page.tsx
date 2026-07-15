'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { submitExam, useSuperToken, useHint, getExamQuestionForStudent, getReviewData } from '@/app/actions/exam'
import { getExamSession, clearExamSession } from '@/app/actions/session'
import type { ActiveExamSession, ExamSet } from '@/types/exam'

export default function ExamPage() {
  const router = useRouter()
  const supabase = createClient()

  const [session, setSession] = useState<ActiveExamSession | null>(null)
  const [currentExamSet, setCurrentExamSet] = useState<ExamSet | null>(null)
  const [currentSetName, setCurrentSetName] = useState('')
  const [loadError, setLoadError] = useState('')
  const [timeLeft, setTimeLeft] = useState(15 * 60)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [superTokens, setSuperTokens] = useState(0)
  const [hintsUsed, setHintsUsed] = useState(0)

  // Modal states
  const [showGachaModal, setShowGachaModal] = useState(false)
  const [gachaAmount, setGachaAmount] = useState(1)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [finalScore, setFinalScore] = useState(0)

  // Refs for exam inputs (ต้องใช้ DOM จริง ๆ เพราะ codeTemplate เป็น HTML string)
  const codeContainerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const sessionRef = useRef<ActiveExamSession | null>(null)

  // ── Init ────────────────────────────────────────────────
  useEffect(() => {
    let tokenChannel: ReturnType<typeof supabase.channel> | null = null
    let gachaChannel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    const handleVisibility = () => {
      if (document.hidden && sessionRef.current?.mode !== 'review') {
        console.warn('Tab switch detected')
      }
    }

    ;(async () => {
      // session มาจาก httpOnly cookie ที่ server verify แล้วเท่านั้น ไม่เชื่อ client storage อีกต่อไป
      const activeSession = await getExamSession()
      if (cancelled) return
      if (!activeSession) { router.push('/'); return }

      sessionRef.current = activeSession
      setSession(activeSession)
      setSuperTokens(activeSession.super_tokens || 0)

      if (activeSession.mode === 'review') {
        setupReviewMode()
      } else {
        setupExam()
        startTimer()
        tokenChannel = listenForSuperTokens(activeSession)
        gachaChannel = listenForGachaDrops(activeSession)
      }

      document.addEventListener('visibilitychange', handleVisibility)
    })()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      if (timerRef.current) clearInterval(timerRef.current)
      if (tokenChannel) supabase.removeChannel(tokenChannel)
      if (gachaChannel) supabase.removeChannel(gachaChannel)
    }
  }, [])

  // ── Setup Exam (Phase 7.2: โจทย์มาจาก server เท่านั้น ไม่มี answers ติดมาด้วยเด็ดขาด) ──
  async function setupExam() {
    const result = await getExamQuestionForStudent()
    if (!result.success) { setLoadError(result.error); return }

    const examSet: ExamSet = { title: result.title, codeTemplate: result.codeTemplate }
    setCurrentExamSet(examSet)
    setCurrentSetName(result.setName)

    // inject HTML พร้อม super token buttons หลัง render
    setTimeout(() => {
      if (codeContainerRef.current) {
        const templateWithTokens = examSet.codeTemplate.replace(
          /<button class="hint-btn" onclick="useHint\((\d+)\)">💡<\/button>/g,
          `<button class="hint-btn" onclick="window.__useHint($1)" title="ดูคำใบ้ (จำกัด 3 ครั้ง)">💡</button>
           <button class="hint-btn super-btn" onclick="window.__useSuperToken($1)" title="ใช้ Super Token เติมคำตอบ">🌟</button>`
        )
        codeContainerRef.current.innerHTML = templateWithTokens
      }
    }, 50)
  }

  // ── Setup Review Mode (server เช็คซ้ำว่าห้องสอบปิดแล้วจริง ก่อนส่งเฉลยมาให้) ──
  async function setupReviewMode() {
    const result = await getReviewData()
    if (!result.success) { setLoadError(result.error); return }

    const examSet: ExamSet = { title: result.title, codeTemplate: result.codeTemplate, answers: result.answers }
    setCurrentExamSet(examSet)
    setCurrentSetName(result.setName)

    setTimeout(() => {
      if (!codeContainerRef.current) return
      codeContainerRef.current.innerHTML = examSet.codeTemplate

      const ansArray = result.studentAnswers

      for (let i = 0; i < result.answers.length; i++) {
        const input = codeContainerRef.current.querySelector(`#q${i}`) as HTMLInputElement
        if (!input) continue

        const studentAns = ansArray[i] || ""
        input.value = studentAns
        input.disabled = true

        const cleanStudent = studentAns.trim().toLowerCase().replace(/\s+/g, '')
        const cleanCorrect = result.answers[i].toLowerCase().replace(/\s+/g, '')

        if (cleanStudent === cleanCorrect ||
          (cleanCorrect === "!=null" && cleanStudent === "!=null") ||
          (cleanCorrect === "+=" && cleanStudent === "+=")) {
          input.classList.add('bg-green-100', 'text-green-800', 'border-green-500')
        } else {
          input.classList.add('bg-red-100', 'text-red-800', 'border-red-500')
          const span = document.createElement('span')
          span.className = "text-xs bg-green-500 text-white px-2 py-1 rounded ml-2 shadow-sm font-sans"
          span.innerText = "เฉลย: " + result.answers[i]
          input.parentNode?.insertBefore(span, input.nextSibling)
        }
      }

      // ซ่อน hint buttons ในโหมด review
      codeContainerRef.current.querySelectorAll('.hint-btn').forEach((btn: any) => {
        btn.style.display = 'none'
      })
    }, 50)
  }

  // ── Timer ───────────────────────────────────────────────
  function startTimer() {
    let time = 15 * 60
    timerRef.current = setInterval(() => {
      time--
      setTimeLeft(time)
      if (time <= 0) {
        clearInterval(timerRef.current!)
        alert('⏳ หมดเวลาทำข้อสอบ! ระบบจะส่งคำตอบของคุณโดยอัตโนมัติ')
        handleSubmit()
      }
    }, 1000)
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // ── Hint System ─────────────────────────────────────────
  useEffect(() => {
    // expose functions ไว้บน window เพราะ codeTemplate inject onclick string ตรง ๆ
    ;(window as any).__useHint = async (index: number) => {
      if (hintsUsed >= 3) {
        alert('❌ คุณใช้สิทธิ์คำใบ้ปกติ (💡) ครบ 3 ครั้งแล้วครับ!\nพยายามคิดด้วยตัวเอง หรือใช้ Super Token แทนนะ')
        return
      }
      const remaining = 3 - hintsUsed
      if (!confirm(`คุณมีสิทธิ์คำใบ้ปกติ (💡) เหลือ ${remaining} ครั้ง\nต้องการใช้ 1 สิทธิ์ เพื่อเติมคำใบ้ 2 ตัวอักษรลงในช่องนี้หรือไม่?`)) return
      if (!currentSetName) return

      // เฉลยดึงฝั่ง server เท่านั้น (Phase 7.2) — จำนวนครั้งก็นับฝั่ง server ผ่าน session cookie กันแก้ค่าจาก devtools
      const result = await useHint(currentSetName, index)
      if (!result.success) {
        alert('❌ ' + result.error)
        return
      }
      setHintsUsed(result.hintsUsed)

      const input = codeContainerRef.current?.querySelector(`#q${index}`) as HTMLInputElement
      if (input) {
        input.value = result.hint
        input.focus()
        input.classList.add('border-blue-500', 'bg-blue-900', 'text-white')
        setTimeout(() => input.classList.remove('border-blue-500', 'bg-blue-900', 'text-white'), 1500)
        alert(`💡 เติมคำใบ้ "${result.hint}" ลงในช่องให้แล้วครับ!\n(เหลือสิทธิ์คำใบ้ปกติอีก ${3 - result.hintsUsed} ครั้ง)`)
      }
    }

    ;(window as any).__useSuperToken = async (index: number) => {
      if (superTokens <= 0) {
        alert('❌ คุณไม่มี Super Token เหลือแล้ว! (อาจารย์อาจจะสุ่มแจกให้ในระหว่างการสอบ)')
        return
      }
      if (!confirm(`คุณมีเหรียญ🌟 ${superTokens} เหรียญ\nต้องการใช้ 1 เหรียญ เพื่อเติมคำตอบข้อนี้ทันทีหรือไม่?`)) return
      if (!currentSetName) return

      // เฉลยข้อนี้ดึงฝั่ง server ตอนใช้เหรียญเท่านั้น (Phase 7.2)
      const result = await useSuperToken(currentSetName, index)
      if (!result.success) {
        alert('❌ ' + result.error)
        return
      }

      setSuperTokens(result.tokens)

      const input = codeContainerRef.current?.querySelector(`#q${index}`) as HTMLInputElement
      if (input) {
        input.value = result.answer
        input.classList.add('bg-yellow-100', 'border-yellow-400', 'text-yellow-800')
        input.readOnly = true
      }
    }
  }, [hintsUsed, superTokens, currentSetName])

  // ── Realtime ─────────────────────────────────────────────
  function listenForSuperTokens(activeSession: ActiveExamSession) {
    return supabase.channel('student-token-updates')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'students',
        filter: `student_id=eq.${activeSession.student_id}`
      }, (payload: any) => {
        setSuperTokens(payload.new.super_tokens || 0)
      }).subscribe()
  }

  function listenForGachaDrops(activeSession: ActiveExamSession) {
    return supabase.channel('gacha-broadcast')
      .on('broadcast', { event: 'gacha_drop' }, (msg: any) => {
        const payload = msg.payload || {}
        if (payload.student_id !== activeSession.student_id) return
        setGachaAmount(payload.amount || 1)
        setShowGachaModal(true)
      }).subscribe()
  }

  // ── Submit ───────────────────────────────────────────────
  async function handleSubmit() {
    if (!currentExamSet || !session) return
    setIsSubmitting(true)
    if (timerRef.current) clearInterval(timerRef.current)

    // นับจำนวนข้อจาก DOM โดยตรง (ไม่มี answers.length ให้ใช้แล้ว — เฉลยไม่ถูกส่งมาที่ client อีกต่อไป)
    const studentAnswers: string[] = []
    let i = 0
    while (true) {
      const input = codeContainerRef.current?.querySelector(`#q${i}`) as HTMLInputElement | null
      if (!input) break
      studentAnswers.push(input.value || '')
      i++
    }

    // ตรวจคำตอบ + คำนวณคะแนนฝั่ง server เสมอ (submitExam) — client ส่งได้แค่คำตอบดิบ
    const result = await submitExam({
      exam_set: currentSetName,
      student_answers: studentAnswers,
    })

    if (!result.success) {
      alert('ส่งข้อมูลไม่สำเร็จ กรุณาแจ้งอาจารย์ผู้สอน\n' + result.error)
      setIsSubmitting(false)
      return
    }

    setFinalScore(result.score)
    setShowSuccessModal(true)
    setIsSubmitting(false)
  }

  async function logoutAndExit() {
    await clearExamSession()
    router.push('/')
  }

  // ── Render ───────────────────────────────────────────────
  if (!session) return null

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7] p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-gray-100 p-8 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-5">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">โหลดข้อสอบไม่สำเร็จ</h2>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">{loadError}</p>
          <button
            onClick={logoutAndExit}
            className="w-full py-3 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-2xl transition"
          >
            กลับสู่หน้าหลัก
          </button>
        </div>
      </div>
    )
  }

  const isReview = session.mode === 'review'

  return (
    <div className="min-h-screen antialiased flex flex-col">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center text-xl font-bold">CQ</div>
              <div>
                <h1 className="font-semibold text-gray-900 leading-tight">ห้องสอบปฏิบัติการ</h1>
                <p className="text-xs text-gray-500 font-medium">วิชา: {session.project_name}</p>
              </div>
            </div>

            {!isReview && (
              <div className="hidden sm:flex items-center justify-center">
                <div className="bg-gray-100 px-4 py-2 rounded-full border border-gray-200 flex items-center gap-2 shadow-inner">
                  <span className="text-lg">⏱️</span>
                  <span className={`font-mono text-xl font-medium tracking-wider ${timeLeft <= 60 ? 'timer-warning' : 'text-gray-800'}`}>
                    {formatTime(timeLeft)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-1.5 bg-yellow-50 px-3 py-1.5 rounded-full border border-yellow-200 shadow-sm">
                <span className="text-lg">🌟</span>
                <span className="font-bold text-yellow-700 text-lg">{superTokens}</span>
              </div>
              <div className="hidden md:block text-right">
                <p className="text-sm font-semibold text-gray-900">{session.full_name}</p>
                <p className="text-xs text-gray-500">{session.student_id} • ห้อง {session.room} เลขที่ {session.class_number}</p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-grow bg-[#F5F5F7] py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              {isReview ? '📚 โหมดทบทวนเฉลย' : 'เตรียมตัวให้พร้อม!'}
            </h2>
            <p className="text-gray-600">
              {isReview ? 'ดูคำตอบที่คุณส่งไปและเฉลยที่ถูกต้อง' : 'เติมโค้ดให้ถูกต้องสมบูรณ์ เมื่อทำเสร็จแล้วให้กดปุ่ม "ส่งคำตอบ"'}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-8">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <span className={`px-2.5 py-1 text-xs font-semibold rounded-md mr-2 uppercase tracking-wider ${isReview ? 'bg-indigo-100 text-indigo-800' : 'bg-blue-100 text-blue-800'}`}>
                  {isReview ? 'โหมดทบทวน' : 'โจทย์ที่ได้รับ'}
                </span>
                <span className="text-sm font-medium text-gray-600">{currentExamSet?.title || 'กำลังโหลด...'}</span>
              </div>
              <div className="text-sm text-gray-500 font-medium">คะแนนเต็ม: 10 คะแนน</div>
            </div>
            <div className="p-6">
              <div ref={codeContainerRef} className="code-block text-sm sm:text-base">
                {/* HTML จาก exam database จะถูก inject เข้ามาผ่าน useEffect */}
                กำลังโหลดข้อสอบ...
              </div>
            </div>
          </div>

          <div className="flex justify-end mb-12">
            {isReview ? (
              <button
                onClick={logoutAndExit}
                className="px-8 py-4 bg-gray-900 hover:bg-gray-800 text-white font-medium text-lg rounded-xl transition duration-200 shadow-lg active:scale-95 flex items-center gap-2"
              >
                กลับสู่หน้าหลัก
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="px-8 py-4 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-60 text-white font-medium text-lg rounded-xl transition duration-200 shadow-lg shadow-blue-500/25 active:scale-95 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                    กำลังส่ง...
                  </>
                ) : 'ส่งคำตอบ (Submit Exam)'}
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Gacha Modal */}
      {showGachaModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full mx-4 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">🎁 Mystery Drop!</h2>
            <p className="text-gray-500 mb-6">ผู้สอนได้ทำการสุ่มแจกเหรียญรางวัลพิเศษ!</p>
            <div className="text-7xl mb-6 animate-bounce-gacha">🌟</div>
            <p className="text-lg font-semibold text-yellow-600 mb-6 bg-yellow-50 py-3 rounded-lg border border-yellow-200">
              คุณได้รับ Super Token <span className="text-2xl font-bold">{gachaAmount}</span> เหรียญ
            </p>
            <button
              onClick={() => setShowGachaModal(false)}
              className="w-full py-3 bg-[#0071E3] hover:bg-[#0077ED] text-white font-medium rounded-xl transition shadow-lg active:scale-95"
            >
              รับรางวัลและทำข้อสอบต่อ
            </button>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full mx-4 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5 text-4xl text-green-500">✓</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">ส่งข้อสอบสำเร็จ!</h2>
            <p className="text-gray-500 mb-6">ระบบได้บันทึกคำตอบเรียบร้อยแล้ว รออาจารย์ปิดห้องสอบเพื่อดูเฉลยนะครับ</p>
            <p className="text-lg font-semibold text-blue-600 mb-6 bg-blue-50 py-2 rounded-lg">
              คะแนนที่คุณได้: {finalScore} / 10
            </p>
            <button
              onClick={logoutAndExit}
              className="w-full py-3 bg-gray-900 text-white font-medium rounded-xl"
            >
              กลับสู่หน้าหลัก
            </button>
          </div>
        </div>
      )}
    </div>
  )
}