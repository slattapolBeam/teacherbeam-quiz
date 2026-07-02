'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { ActiveExamSession } from '@/types/exam'

type Role = 'student' | 'teacher'
type StudentStep = 'id' | 'subject' | 'pin'
type SubjectStatus = 'active' | 'closed-review' | 'not-open'

type Subject = {
  id: string
  name: string
  description: string | null
}

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [role, setRole] = useState<Role>('student')
  const [step, setStep] = useState<StudentStep>('id')

  const [studentIdInput, setStudentIdInput] = useState('')
  const [studentData, setStudentData] = useState<any>(null)
  const [idError, setIdError] = useState('')
  const [isCheckingId, setIsCheckingId] = useState(false)

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectStatus, setSubjectStatus] = useState<Record<string, SubjectStatus>>({})
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false)
  const [subjectMessage, setSubjectMessage] = useState<{ text: string; tone: 'info' | 'warning' } | null>(null)
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null)

  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [isEnteringExam, setIsEnteringExam] = useState(false)

  // Token check modal (unchanged feature from baseline)
  const [showTokenModal, setShowTokenModal] = useState(false)
  const [checkId, setCheckId] = useState('')
  const [tokenResult, setTokenResult] = useState<string | null>(null)
  const [isFetchingToken, setIsFetchingToken] = useState(false)

  const idInputRef = useRef<HTMLInputElement>(null)
  const pinInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    idInputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (step === 'pin') pinInputRef.current?.focus()
  }, [step])

  // ── Step 1: รหัสนักศึกษา ──────────────────────────────────
  async function handleContinueFromId(e: React.FormEvent) {
    e.preventDefault()
    setIdError('')
    if (!/^\d{13}$/.test(studentIdInput)) {
      return setIdError('กรุณากรอกรหัสนักศึกษา 13 หลักให้ครบ')
    }
    setIsCheckingId(true)
    try {
      const { data, error } = await supabase.from('students')
        .select('*').eq('student_id', studentIdInput).single()
      if (error || !data) throw new Error('ไม่พบรหัสนักศึกษานี้ในระบบ')
      setStudentData(data)
      setStep('subject')
      loadSubjects(studentIdInput)
    } catch (err: any) {
      setIdError(err.message)
    } finally {
      setIsCheckingId(false)
    }
  }

  // ── Step 2: เลือกวิชา ─────────────────────────────────────
  async function loadSubjects(studentId: string) {
    setIsLoadingSubjects(true)
    setSubjectMessage(null)
    try {
      const { data: subjectsData, error: subjectsErr } = await supabase
        .from('subjects').select('id, name, description').eq('is_active', true).order('name')
      if (subjectsErr) throw subjectsErr

      const list = subjectsData || []
      setSubjects(list)
      if (list.length === 0) return

      const [{ data: activeSessions }, { data: resultsData }] = await Promise.all([
        supabase.from('exam_sessions').select('project_name').eq('is_active', true),
        supabase.from('exam_results').select('project_name').eq('student_id', studentId),
      ])

      const activeNames = new Set((activeSessions || []).map((s: any) => s.project_name))
      const resultNames = new Set((resultsData || []).map((r: any) => r.project_name))

      const status: Record<string, SubjectStatus> = {}
      list.forEach((s: Subject) => {
        if (activeNames.has(s.name)) status[s.name] = 'active'
        else if (resultNames.has(s.name)) status[s.name] = 'closed-review'
        else status[s.name] = 'not-open'
      })
      setSubjectStatus(status)
    } catch (err: any) {
      setSubjectMessage({ text: 'โหลดรายวิชาไม่สำเร็จ: ' + err.message, tone: 'warning' })
    } finally {
      setIsLoadingSubjects(false)
    }
  }

  function handleSubjectClick(subject: Subject) {
    const status = subjectStatus[subject.name]

    if (status === 'active') {
      setSelectedSubject(subject)
      setPin('')
      setPinError('')
      setSubjectMessage(null)
      setStep('pin')
      return
    }

    if (status === 'closed-review') {
      setSubjectMessage({ text: `ห้องสอบวิชา ${subject.name} ปิดแล้ว กำลังพาไปโหมดทบทวนเฉลย...`, tone: 'info' })
      const activeSession: ActiveExamSession = {
        student_id: studentData.student_id,
        full_name: `${studentData.first_name} ${studentData.last_name}`,
        room: studentData.room,
        class_number: studentData.class_number,
        project_name: subject.name,
        super_tokens: studentData.super_tokens || 0,
        mode: 'review',
        got_gacha: false,
        gacha_amount: 0,
      }
      setTimeout(() => {
        sessionStorage.setItem('activeExamSession', JSON.stringify(activeSession))
        router.push('/exam')
      }, 700)
      return
    }

    setSubjectMessage({ text: `วิชา ${subject.name} ยังไม่เปิดสอบครับ ลองเลือกวิชาอื่นก่อนนะ`, tone: 'warning' })
  }

  // ── Step 3: กรอก PIN ──────────────────────────────────────
  async function handleEnterExam(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSubject || !studentData) return
    setPinError('')
    if (!/^\d{6}$/.test(pin)) return setPinError('กรุณากรอกรหัส PIN 6 หลัก')

    setIsEnteringExam(true)
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('exam_sessions').select('*')
        .eq('project_name', selectedSubject.name).eq('pin_code', pin).eq('is_active', true).single()
      if (sessionError || !sessionData) throw new Error('รหัส PIN ไม่ถูกต้อง หรือห้องสอบวิชานี้ถูกปิดไปแล้ว')

      const { data: resultData } = await supabase
        .from('exam_results').select('id')
        .eq('student_id', studentData.student_id).eq('project_name', selectedSubject.name)
      if (resultData && resultData.length > 0) {
        throw new Error('คุณได้ส่งข้อสอบแล้ว (จะดูเฉลยได้เมื่ออาจารย์ปิดห้องสอบเท่านั้น)')
      }

      const activeSession: ActiveExamSession = {
        student_id: studentData.student_id,
        full_name: `${studentData.first_name} ${studentData.last_name}`,
        room: studentData.room,
        class_number: studentData.class_number,
        project_name: selectedSubject.name,
        pin_code: pin,
        mode: 'exam',
        super_tokens: studentData.super_tokens || 0,
        got_gacha: false,
        gacha_amount: 0,
      }
      sessionStorage.setItem('activeExamSession', JSON.stringify(activeSession))
      router.push('/exam')
    } catch (err: any) {
      setPinError(err.message)
    } finally {
      setIsEnteringExam(false)
    }
  }

  function goBackToId() {
    setStep('id')
    setSubjects([])
    setSubjectStatus({})
    setSubjectMessage(null)
    setSelectedSubject(null)
  }

  function goBackToSubject() {
    setStep('subject')
    setPin('')
    setPinError('')
  }

  // ── Super Token check modal (unchanged) ───────────────────
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
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-300/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-300/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md z-10 apple-card p-8 sm:p-10 rounded-[2.5rem] shadow-2xl shadow-gray-200/50">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl text-3xl mb-5 shadow-inner">🧑‍💻</div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-2">Coding Quiz</h1>
          <p className="text-sm text-gray-500 font-medium">เข้าสู่ระบบเพื่อทำข้อสอบ หรือดูแลห้องสอบ</p>
        </div>

        <div className="flex bg-gray-100 rounded-full p-1 mb-6">
          <button
            type="button"
            onClick={() => setRole('student')}
            className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition ${role === 'student' ? 'bg-[#0071E3] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            🎓 นักศึกษา
          </button>
          <button
            type="button"
            onClick={() => setRole('teacher')}
            className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition ${role === 'teacher' ? 'bg-[#0071E3] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            🧑‍🏫 อาจารย์
          </button>
        </div>

        {role === 'teacher' ? (
          <div className="text-center py-2">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-2xl text-2xl mb-4">🧑‍🏫</div>
            <p className="text-sm text-gray-500 mb-6 leading-relaxed">ระบบจะพาไปหน้า Dashboard สำหรับจัดการห้องสอบและดูคะแนน</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="w-full py-4 bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold rounded-2xl transition duration-200 shadow-lg shadow-blue-500/25 active:scale-[0.98]"
            >
              ไปที่ Dashboard →
            </button>
          </div>
        ) : (
          <>
            <div className="flex justify-center gap-1.5 mb-6">
              {(['id', 'subject', 'pin'] as StudentStep[]).map(s => (
                <span key={s} className={`w-2 h-2 rounded-full transition ${step === s ? 'bg-[#0071E3]' : 'bg-gray-200'}`} />
              ))}
            </div>

            {step === 'id' && (
              <form onSubmit={handleContinueFromId}>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 ml-1">รหัสนักศึกษา (13 หลัก)</label>
                <input
                  ref={idInputRef}
                  type="text"
                  value={studentIdInput}
                  onChange={e => setStudentIdInput(e.target.value.replace(/[^0-9]/g, ''))}
                  maxLength={13}
                  autoComplete="off"
                  className="w-full px-5 py-4 bg-white rounded-2xl border border-gray-200 focus:outline-none focus:border-blue-500 transition font-mono text-lg text-center placeholder:text-gray-300 input-glow mb-4"
                  placeholder="683179xxxxxxx"
                />
                {idError && (
                  <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm font-medium rounded-xl border border-red-100 text-center">
                    {idError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isCheckingId}
                  className="w-full py-4 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-60 text-white font-semibold rounded-2xl transition duration-200 shadow-lg shadow-blue-500/25 active:scale-[0.98]"
                >
                  {isCheckingId ? 'กำลังตรวจสอบ...' : 'ถัดไป →'}
                </button>
              </form>
            )}

            {step === 'subject' && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 ml-1">เลือกวิชา</p>

                {isLoadingSubjects ? (
                  <div className="py-10 text-center text-gray-400 text-sm">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent mb-2" /><br />กำลังโหลดรายวิชา...
                  </div>
                ) : subjects.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-sm">ยังไม่มีวิชาที่เปิดให้เลือกในระบบ กรุณาติดต่ออาจารย์ผู้สอน</div>
                ) : (
                  <div className="space-y-2.5 mb-2">
                    {subjects.map(subject => {
                      const status = subjectStatus[subject.name]
                      const badge = status === 'active'
                        ? { text: '🟢 กำลังเปิดสอบ', className: 'text-green-700' }
                        : status === 'closed-review'
                        ? { text: '🔵 ปิดห้องแล้ว · ดูเฉลยได้', className: 'text-blue-700' }
                        : { text: '⚪ ยังไม่เปิดสอบ', className: 'text-gray-400' }
                      return (
                        <button
                          key={subject.id}
                          type="button"
                          onClick={() => handleSubjectClick(subject)}
                          className={`w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-3xl transition hover:border-blue-300 active:scale-[0.99] text-left ${status === 'not-open' ? 'opacity-75' : ''}`}
                        >
                          <div className="w-9 h-9 rounded-2xl bg-blue-50 flex items-center justify-center text-lg shrink-0">📘</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{subject.name}</p>
                            <p className={`text-xs mt-0.5 ${badge.className}`}>{badge.text}</p>
                          </div>
                          <span className="text-gray-300 text-lg">›</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {subjectMessage && (
                  <p className={`text-xs text-center mt-2 mb-1 leading-relaxed ${subjectMessage.tone === 'warning' ? 'text-orange-600' : 'text-blue-600'}`}>
                    {subjectMessage.text}
                  </p>
                )}

                <button type="button" onClick={goBackToId} className="w-full mt-3 py-2.5 text-sm text-gray-500 hover:text-gray-800 transition">
                  ← ย้อนกลับ
                </button>
              </div>
            )}

            {step === 'pin' && selectedSubject && (
              <form onSubmit={handleEnterExam}>
                <div className="text-center mb-5">
                  <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full">{selectedSubject.name}</span>
                </div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 text-center">รหัสห้องสอบ (PIN)</label>
                <input
                  ref={pinInputRef}
                  type="text"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                  maxLength={6}
                  autoComplete="off"
                  className="w-full px-5 py-4 bg-white rounded-2xl border border-gray-200 focus:outline-none focus:border-blue-500 transition text-center tracking-[0.5em] text-2xl font-mono placeholder:tracking-normal placeholder:text-gray-300 input-glow mb-4"
                  placeholder="123456"
                />
                {pinError && (
                  <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm font-medium rounded-xl border border-red-100 text-center">
                    {pinError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isEnteringExam}
                  className="w-full py-4 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-60 text-white font-semibold rounded-2xl transition duration-200 shadow-lg shadow-blue-500/25 active:scale-[0.98] mb-2"
                >
                  {isEnteringExam ? 'กำลังตรวจสอบ...' : 'เข้าสอบ →'}
                </button>
                <button type="button" onClick={goBackToSubject} className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-800 transition">
                  ← เลือกวิชาอื่น
                </button>
              </form>
            )}
          </>
        )}

        {role === 'student' && (
          <div className="mt-8 text-center pt-6 border-t border-gray-100">
            <button
              onClick={() => setShowTokenModal(true)}
              className="text-sm text-yellow-600 font-medium hover:text-yellow-700 flex items-center justify-center gap-1 mx-auto transition bg-yellow-50 px-4 py-2 rounded-full"
            >
              <span>🌟</span> เช็กยอด Super Token ของฉัน
            </button>
          </div>
        )}
      </div>

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
    </main>
  )
}
