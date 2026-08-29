'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { submitExam, useSuperToken, useHint, getExamQuestionForStudent, getReviewData } from '@/app/actions/exam'
import { getExamSession, clearExamSession } from '@/app/actions/session'
import type { ActiveExamSession, ExamSet, ExamFile } from '@/types/exam'

const DRAFT_SAVE_INTERVAL_MS = 30 * 1000
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000 // ร่างเก่าเกินไปไม่ควร auto-restore เผื่อกรณีอาจารย์ลบผลสอบแล้วให้สอบใหม่

function getDraftKey(session: ActiveExamSession, setName: string) {
  return `exam_draft_${session.student_id}_${session.project_name}_${setName}`
}

export default function ExamPage() {
  const router = useRouter()
  const supabase = createClient()

  const [session, setSession] = useState<ActiveExamSession | null>(null)
  const [currentExamSet, setCurrentExamSet] = useState<ExamSet | null>(null)
  const [currentSetName, setCurrentSetName] = useState('')
  const [loadError, setLoadError] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [superTokens, setSuperTokens] = useState(0)
  const [hintsUsed, setHintsUsed] = useState(0)
  const [examFiles, setExamFiles] = useState<ExamFile[] | null>(null)
  const [activeFileIndex, setActiveFileIndex] = useState(0)

  // Modal states
  const [showGachaModal, setShowGachaModal] = useState(false)
  const [gachaAmount, setGachaAmount] = useState(1)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [finalScore, setFinalScore] = useState(0)
  const [showTutorial, setShowTutorial] = useState(false)
  const [tutorialVisible, setTutorialVisible] = useState(false)

  // Refs for exam inputs (ต้องใช้ DOM จริง ๆ เพราะ codeTemplate เป็น HTML string)
  const codeContainerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const sessionRef = useRef<ActiveExamSession | null>(null)
  // ref ชี้ไปที่ handleSubmit เวอร์ชันล่าสุดเสมอ — ใช้ใน force_submit listener เพื่อหลีกเลี่ยง stale closure
  const handleSubmitRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // นับจำนวนข้อจาก DOM โดยตรง (ไม่มี answers.length ให้ใช้ — เฉลยไม่ถูกส่งมาที่ client อีกต่อไป, Phase 7.2)
  function collectAnswersFromDom(): string[] {
    const answers: string[] = []
    let i = 0
    while (true) {
      const input = codeContainerRef.current?.querySelector(`#q${i}`) as HTMLInputElement | null
      if (!input) break
      answers.push(input.value || '')
      i++
    }
    return answers
  }

  // ── Local draft autosave (Phase 7.1) — กันคำตอบหายถ้า tab ปิดไปหรือเน็ตหลุด ──
  function saveDraft(session: ActiveExamSession, setName: string) {
    try {
      const answers = collectAnswersFromDom()
      localStorage.setItem(getDraftKey(session, setName), JSON.stringify({ answers, savedAt: Date.now() }))
    } catch {
      // localStorage อาจเต็มหรือถูกปิด — ไม่ใช่ปัญหาคอขวด ปล่อยผ่านได้
    }
  }

  function restoreDraft(session: ActiveExamSession, setName: string) {
    try {
      const raw = localStorage.getItem(getDraftKey(session, setName))
      if (!raw) return
      const draft = JSON.parse(raw) as { answers: string[]; savedAt: number }
      if (Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
        localStorage.removeItem(getDraftKey(session, setName))
        return
      }
      draft.answers.forEach((value, i) => {
        if (!value) return
        const input = codeContainerRef.current?.querySelector(`#q${i}`) as HTMLInputElement | null
        if (input) input.value = value
      })
    } catch {
      // ร่างเสีย/parse ไม่ได้ — ข้ามไป ไม่กระทบการทำข้อสอบ
    }
  }

  function clearDraft(session: ActiveExamSession, setName: string) {
    try { localStorage.removeItem(getDraftKey(session, setName)) } catch {}
  }

  // ── ต่อสาย hint/super-token ให้ปุ่มที่ inject มากับ codeTemplate ──
  // marker "useHint(N)" = ช่องเติมคำ (มีทั้งปุ่มคำใบ้และ Super Token)
  // marker "useSuperToken(N)" = ช่อง dropdown (มีแค่ปุ่ม Super Token เพราะเผยคำใบ้บางส่วนไม่มีประโยชน์เมื่อมีตัวเลือกให้ไม่กี่อัน)
  function wireButtons(html: string): string {
    return html
      .replace(
        /<button class="hint-btn" onclick="useHint\((\d+)\)">💡<\/button>/g,
        `<button class="hint-btn" onclick="window.__useHint($1)" title="ดูคำใบ้ (จำกัด 3 ครั้ง)">💡</button>
         <button class="hint-btn super-btn" onclick="window.__useSuperToken($1)" title="ใช้ Super Token เติมคำตอบ"><img src="/gamecoin.png" style="width:18px;height:18px;display:inline;vertical-align:middle;" alt="coin" /></button>`
      )
      .replace(
        /<button class="hint-btn" onclick="useSuperToken\((\d+)\)">🌟<\/button>/g,
        `<button class="hint-btn super-btn" onclick="window.__useSuperToken($1)" title="ใช้ Super Token เติมคำตอบ"><img src="/gamecoin.png" style="width:18px;height:18px;display:inline;vertical-align:middle;" alt="coin" /></button>`
      )
  }

  // ── Init ────────────────────────────────────────────────
  useEffect(() => {
    let tokenChannel: ReturnType<typeof supabase.channel> | null = null
    let gachaChannel: ReturnType<typeof supabase.channel> | null = null
    let forceSubmitChannel: ReturnType<typeof supabase.channel> | null = null
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
        const totalSec = (activeSession.duration_minutes ?? 15) * 60
        const elapsedSec = activeSession.session_started_at
          ? Math.floor((Date.now() - new Date(activeSession.session_started_at).getTime()) / 1000)
          : 0
        startTimer(Math.max(10, totalSec - elapsedSec))
        tokenChannel = listenForSuperTokens(activeSession)
        gachaChannel = listenForGachaDrops(activeSession)
        forceSubmitChannel = listenForForceSubmit(activeSession)
      }

      document.addEventListener('visibilitychange', handleVisibility)
    })()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      if (timerRef.current) clearInterval(timerRef.current)
      if (tokenChannel) supabase.removeChannel(tokenChannel)
      if (gachaChannel) supabase.removeChannel(gachaChannel)
      if (forceSubmitChannel) supabase.removeChannel(forceSubmitChannel)
    }
  }, [])

  // ── Setup Exam (Phase 7.2: โจทย์มาจาก server เท่านั้น ไม่มี answers ติดมาด้วยเด็ดขาด) ──
  async function setupExam() {
    const result = await getExamQuestionForStudent()
    if (!result.success) { setLoadError(result.error); return }

    const examSet: ExamSet = result.files
      ? { title: result.title, files: result.files }
      : { title: result.title, codeTemplate: result.codeTemplate }
    setCurrentExamSet(examSet)
    setCurrentSetName(result.setName)
    setExamFiles(result.files ?? null)
    setActiveFileIndex(0)

    // inject HTML พร้อม super token buttons หลัง render
    setTimeout(() => {
      if (!codeContainerRef.current) return
      if (result.files) {
        // mount ทุกไฟล์พร้อมกันหมด (ไฟล์ที่ไม่ active แค่ซ่อนด้วย CSS ไม่ได้เอาออกจาก DOM)
        // เพื่อให้ collectAnswersFromDom/autosave/hint/super-token สแกนหา #q{i} เจอครบทุกไฟล์เสมอ
        codeContainerRef.current.innerHTML = result.files
          .map((f, i) => `<div data-file-panel="${i}"${i === 0 ? '' : ' style="display:none;"'}>${wireButtons(f.codeTemplate)}</div>`)
          .join('')
      } else {
        codeContainerRef.current.innerHTML = wireButtons(result.codeTemplate || '')
      }

      // กู้ร่างคำตอบที่เคย autosave ไว้ (ถ้ามี และยังไม่เก่าเกินไป)
      if (sessionRef.current) restoreDraft(sessionRef.current, result.setName)

      // แสดง tutorial modal พร้อม fade-in
      setShowTutorial(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setTutorialVisible(true)))
    }, 50)
  }

  function closeTutorial() {
    setTutorialVisible(false)
    setTimeout(() => setShowTutorial(false), 300)
  }

  // ── Setup Review Mode (server เช็คซ้ำว่าห้องสอบปิดแล้วจริง ก่อนส่งเฉลยมาให้) ──
  async function setupReviewMode() {
    const result = await getReviewData()
    if (!result.success) { setLoadError(result.error); return }

    const examSet: ExamSet = result.files
      ? { title: result.title, files: result.files, answers: result.answers }
      : { title: result.title, codeTemplate: result.codeTemplate, answers: result.answers }
    setCurrentExamSet(examSet)
    setCurrentSetName(result.setName)
    setExamFiles(result.files ?? null)
    setActiveFileIndex(0)

    setTimeout(() => {
      if (!codeContainerRef.current) return
      if (result.files) {
        codeContainerRef.current.innerHTML = result.files
          .map((f, i) => `<div data-file-panel="${i}"${i === 0 ? '' : ' style="display:none;"'}>${f.codeTemplate}</div>`)
          .join('')
      } else {
        codeContainerRef.current.innerHTML = result.codeTemplate || ''
      }

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
  function startTimer(totalSeconds: number) {
    let time = totalSeconds
    setTimeLeft(time)
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
      if (!confirm(`คุณมีเหรียญ ${superTokens} เหรียญ\nต้องการใช้ 1 เหรียญ เพื่อเติมคำตอบข้อนี้ทันทีหรือไม่?`)) return
      if (!currentSetName) return

      // เฉลยข้อนี้ดึงฝั่ง server ตอนใช้เหรียญเท่านั้น (Phase 7.2)
      const result = await useSuperToken(currentSetName, index)
      if (!result.success) {
        alert('❌ ' + result.error)
        return
      }

      setSuperTokens(result.tokens)

      // ช่อง dropdown เป็น <select> ไม่มี readOnly ต้องใช้ disabled แทน
      const el = codeContainerRef.current?.querySelector(`#q${index}`) as (HTMLInputElement | HTMLSelectElement | null)
      if (el) {
        el.value = result.answer
        el.classList.add('bg-yellow-100', 'border-yellow-400', 'text-yellow-800')
        if (el instanceof HTMLSelectElement) el.disabled = true
        else el.readOnly = true
      }
    }
  }, [hintsUsed, superTokens, currentSetName])

  // ── สลับแท็บไฟล์ (multi-file exam) — ไฟล์อื่นยังอยู่ใน DOM แค่ซ่อนไว้ ──
  useEffect(() => {
    if (!examFiles) return
    codeContainerRef.current?.querySelectorAll('[data-file-panel]').forEach(el => {
      const idx = Number((el as HTMLElement).dataset.filePanel)
      ;(el as HTMLElement).style.display = idx === activeFileIndex ? '' : 'none'
    })
  }, [activeFileIndex, examFiles])

  // ── Local draft autosave ทุก 30 วิ (Phase 7.1) ──────────
  // หยุดทันทีหลังส่งข้อสอบสำเร็จ (showSuccessModal) กัน interval เก่าฟื้นคืนร่างที่เพิ่ง clearDraft() ไปแล้ว
  useEffect(() => {
    if (!session || session.mode !== 'exam' || !currentSetName || showSuccessModal) return
    const intervalId = setInterval(() => saveDraft(session, currentSetName), DRAFT_SAVE_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [session, currentSetName, showSuccessModal])

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

  function listenForForceSubmit(_activeSession: ActiveExamSession) {
    return supabase.channel('exam-broadcast')
      .on('broadcast', { event: 'force_submit' }, () => {
        handleSubmitRef.current()
      }).subscribe()
  }

  // ── Submit ───────────────────────────────────────────────
  async function handleSubmit() {
    if (!currentExamSet || !session) return
    setIsSubmitting(true)
    if (timerRef.current) clearInterval(timerRef.current)

    const studentAnswers = collectAnswersFromDom()

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

    clearDraft(session, currentSetName)
    setFinalScore(result.score)
    setShowSuccessModal(true)
    setIsSubmitting(false)
  }
  // อัพเดต ref ทุก render เพื่อให้ force_submit listener ได้ handleSubmit เวอร์ชันล่าสุดเสมอ
  handleSubmitRef.current = handleSubmit

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
                <img src="/gamecoin.png" className="w-6 h-6" alt="coin" />
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
            {examFiles && examFiles.length > 1 && (
              <div className="flex gap-1 px-6 pt-4 border-b border-gray-200 overflow-x-auto bg-white">
                {examFiles.map((f, i) => (
                  <button
                    key={f.filename}
                    onClick={() => setActiveFileIndex(i)}
                    className={`px-4 py-2 text-sm font-mono rounded-t-lg border-b-2 transition whitespace-nowrap ${
                      i === activeFileIndex ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    📄 {f.filename}
                  </button>
                ))}
              </div>
            )}
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

      {/* Tutorial Modal */}
      {showTutorial && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-900/70 backdrop-blur-sm transition-opacity duration-300"
          style={{ opacity: tutorialVisible ? 1 : 0 }}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full mx-4 overflow-hidden transition-all duration-300"
            style={{ transform: tutorialVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(16px)', opacity: tutorialVisible ? 1 : 0 }}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-5 text-white text-center">
              <div className="text-3xl mb-1">📋</div>
              <h2 className="text-xl font-bold">คำแนะนำการสอบ</h2>
              <p className="text-blue-100 text-sm mt-1">อ่านก่อนเริ่มทำข้อสอบ</p>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Hint */}
              <div className="flex gap-4 items-start bg-blue-50 rounded-2xl p-4 border border-blue-100">
                <div className="text-2xl shrink-0 mt-0.5">💡</div>
                <div>
                  <p className="font-semibold text-gray-900 mb-1">คำใบ้ปกติ (3 ครั้ง/ชุด)</p>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    กดปุ่ม 💡 ข้างช่องเติมคำ ระบบจะ<span className="font-medium text-blue-700">เติม 2 ตัวอักษรแรก</span>ของคำตอบให้เป็นคำใบ้ ใช้ได้สูงสุด 3 ครั้งต่อชุดข้อสอบ
                  </p>
                </div>
              </div>

              {/* Super Token */}
              <div className="flex gap-4 items-start bg-yellow-50 rounded-2xl p-4 border border-yellow-100">
                <div className="shrink-0 mt-0.5">
                  <img src="/gamecoin.png" className="w-7 h-7" alt="coin" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900 mb-1">Super Token (เหรียญรางวัล)</p>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    กดปุ่มเหรียญข้างช่องเติมคำ ระบบจะ<span className="font-medium text-yellow-700">เติมคำตอบที่ถูกต้องให้ทันที</span> เหรียญได้รับจากอาจารย์ระหว่างการสอบ ใช้อย่างฉลาด!
                  </p>
                </div>
              </div>

              {/* Reminder */}
              <p className="text-xs text-center text-gray-400">
                ⏱️ มีเวลา 15 นาที • ระบบบันทึกคำตอบอัตโนมัติทุก 30 วินาที
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6">
              <button
                onClick={closeTutorial}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold rounded-2xl transition-all duration-150 shadow-lg shadow-blue-500/25"
              >
                เข้าใจแล้ว เริ่มทำข้อสอบเลย!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gacha Modal */}
      {showGachaModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full mx-4 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">🎁 Mystery Drop!</h2>
            <p className="text-gray-500 mb-6">ผู้สอนได้ทำการสุ่มแจกเหรียญรางวัลพิเศษ!</p>
            <div className="flex justify-center mb-6 animate-bounce-gacha">
              <img src="/gamecoin.png" className="w-24 h-24" alt="coin" />
            </div>
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