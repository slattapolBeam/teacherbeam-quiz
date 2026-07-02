'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

const ADMIN_PIN = '123456'

const PROJECTS = [
  { value: 'ExpenseNote', label: 'ExpenseNote (Kotlin)' },
  { value: 'BasicPython', label: 'พื้นฐานภาษา Python' },
  { value: 'MidtermExam', label: 'สอบกลางภาค (Midterm)' },
]

type ExamRow = {
  room: string
  class_number: number
  student_id: string
  full_name: string
  has_submitted: boolean
  score: number | null
  timestamp: string
}

type GiveTokenRow = ExamRow & { tokens: number } 

export default function DashboardPage() {
  const supabase = createClient()

  // ── Auth gate ────────────────────────────────────────
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [loginError, setLoginError] = useState(false)

  // ── Project / room controls ────────────────────────────
  const [projectFilter, setProjectFilter] = useState(PROJECTS[0].value)
  const [currentRoom, setCurrentRoom] = useState('ALL')
  const [sortMode, setSortMode] = useState<'default' | 'number'>('default')
  const [realtimeOn, setRealtimeOn] = useState(false)

  // ── Session / PIN ───────────────────────────────────────
  const [pinActive, setPinActive] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [generatingPin, setGeneratingPin] = useState(false)
  const [isDistributing, setIsDistributing] = useState(false)

  // ── Table data ───────────────────────────────────────────
  const [globalExamData, setGlobalExamData] = useState<ExamRow[]>([])
  const [isLoadingTable, setIsLoadingTable] = useState(false)
  const [tableError, setTableError] = useState('')

  // ── Give-token modal ─────────────────────────────────────
  const [showGiveTokenModal, setShowGiveTokenModal] = useState(false)
  const [giveTokenRoom, setGiveTokenRoom] = useState('')
  const [giveTokenList, setGiveTokenList] = useState<GiveTokenRow[] | null>(null)
  const [giveTokenListError, setGiveTokenListError] = useState('')
  const [tokenBusyId, setTokenBusyId] = useState<string | null>(null)

  const projectLabel = PROJECTS.find(p => p.value === projectFilter)?.label || projectFilter

  // ── Fetch results ──────────────────────────────────────
  async function fetchExamResults(project: string) {
    setIsLoadingTable(true)
    setTableError('')
    try {
      const { data: students, error: studentError } = await supabase.from('students').select('*')
      if (studentError) throw new Error(`ไม่สามารถดึงข้อมูลตาราง students ได้: ${studentError.message}`)

      const { data: results, error: resultError } = await supabase.from('exam_results')
        .select('*').eq('project_name', project)
      if (resultError) throw new Error(`ไม่สามารถดึงข้อมูลตาราง exam_results ได้: ${resultError.message}`)

      const mapped: ExamRow[] = (students || []).map((student: any) => {
        const result = (results || []).find((r: any) => r.student_id === student.student_id)
        return {
          room: student.room || 'ไม่ระบุ',
          class_number: student.class_number || 0,
          student_id: student.student_id,
          full_name: `${student.first_name} ${student.last_name}`,
          has_submitted: !!result,
          score: result ? result.score : null,
          timestamp: result?.created_at ? new Date(result.created_at).toLocaleString('th-TH') : '-',
        }
      })

      setGlobalExamData(mapped)

      const rooms = [...new Set(mapped.map(s => s.room).filter(Boolean))]
      setCurrentRoom(prev => (prev !== 'ALL' && !rooms.includes(prev)) ? 'ALL' : prev)
    } catch (err: any) {
      setTableError(err.message)
    } finally {
      setIsLoadingTable(false)
    }
  }

  async function checkSessionStatus(project: string) {
    try {
      const { data } = await supabase.from('exam_sessions')
        .select('pin_code').eq('project_name', project).eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) {
        setPinActive(true)
        setCurrentPin(data.pin_code)
      } else {
        setPinActive(false)
        setCurrentPin('')
      }
    } catch (err) {
      console.error('ตรวจสอบสถานะห้องสอบไม่สำเร็จ:', err)
    }
  }

  useEffect(() => {
    if (!isLoggedIn) return
    checkSessionStatus(projectFilter)
    fetchExamResults(projectFilter)
  }, [isLoggedIn, projectFilter])

  // ── Realtime: refresh table on new submissions ─────────
  useEffect(() => {
    if (!realtimeOn) return
    const channel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exam_results' }, () => {
        fetchExamResults(projectFilter)
      }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [realtimeOn, projectFilter])

  // ── Login ────────────────────────────────────────────────
  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (passwordInput === ADMIN_PIN) {
      setIsLoggedIn(true)
      setLoginError(false)
    } else {
      setLoginError(true)
      setPasswordInput('')
    }
  }

  // ── PIN management ──────────────────────────────────────
  async function generatePin() {
    setGeneratingPin(true)
    try {
      const pin = Math.floor(100000 + Math.random() * 900000).toString()

      // ปิด session เก่าที่ยัง active ของวิชานี้ทั้งหมดก่อน (กันมี is_active=true ซ้อนกันหลายแถว)
      const { error: closeErr } = await supabase.from('exam_sessions')
        .update({ is_active: false }).eq('project_name', projectFilter).eq('is_active', true)
      if (closeErr) throw closeErr

      // exam_sessions ไม่มี unique constraint บน project_name จึงต้อง insert ไม่ใช่ upsert
      const { error: insertErr } = await supabase.from('exam_sessions')
        .insert([{ project_name: projectFilter, pin_code: pin, is_active: true }])
      if (insertErr) throw insertErr

      setPinActive(true)
      setCurrentPin(pin)
    } catch (err: any) {
      alert('สร้าง PIN ไม่สำเร็จ: ' + err.message)
    } finally {
      setGeneratingPin(false)
    }
  }

  async function closeSession() {
    if (!confirm('ยืนยันปิดห้องสอบวิชานี้?\nนักศึกษาจะเข้าสอบใหม่ไม่ได้ (เข้าได้แค่โหมดทบทวนเฉลยเท่านั้น)\n⚠️ Super Token ที่เหลืออยู่ของนักศึกษาทุกคนจะถูกรีเซ็ตเป็น 0')) return
    try {
      const { error } = await supabase.from('exam_sessions')
        .update({ is_active: false }).eq('project_name', projectFilter).eq('is_active', true)
      if (error) throw error

      // เหรียญที่เก็บไว้แต่ไม่ใช้ จะหมดอายุทันทีที่ session การสอบนั้นจบลง
      const { error: resetErr } = await supabase.from('students')
        .update({ super_tokens: 0 }).gt('super_tokens', 0)
      if (resetErr) throw resetErr

      setPinActive(false)
      setCurrentPin('')
    } catch (err: any) {
      alert('ปิดห้องสอบไม่สำเร็จ: ' + err.message)
    }
  }

  // ── Gacha: random distribute super tokens ───────────────
  async function distributeSuperTokens() {
    try {
      const { data: session, error: sessionErr } = await supabase.from('exam_sessions')
        .select('*').eq('project_name', projectFilter).eq('is_active', true).single()
      if (!session || sessionErr) {
        return alert('❌ ไม่สามารถแจกได้: ยังไม่มีการเปิดห้องสอบสำหรับวิชานี้ หรือห้องสอบถูกปิดไปแล้ว')
      }

      const countStr = prompt('🎁 ระบบสุ่มแจก Super Token 🎁\nกรุณาระบุจำนวนนักศึกษาที่ต้องการแจก (ระบบจะสุ่มให้เฉพาะคนที่ยังสอบไม่เสร็จ):')
      if (!countStr) return
      const count = parseInt(countStr)
      if (isNaN(count) || count <= 0) return alert('โปรดระบุจำนวนคนเป็นตัวเลขที่ถูกต้อง')

      let eligible = globalExamData.filter(s => !s.has_submitted)
      if (currentRoom !== 'ALL') eligible = eligible.filter(s => s.room === currentRoom)
      if (eligible.length === 0) return alert('❌ ไม่มีนักศึกษาที่กำลังทำข้อสอบอยู่ในขณะนี้ หรือทุกคนส่งข้อสอบหมดแล้ว')

      const actualCount = Math.min(count, eligible.length)
      const shuffled = [...eligible].sort(() => 0.5 - Math.random())
      const selected = shuffled.slice(0, actualCount)

      setIsDistributing(true)

      // แยก channel นี้จาก postgres_changes เพื่อไม่ให้การแจกรายคนไปโชว์ป๊อปอัพ Mystery Drop ผิด ๆ
      const gachaChannel = supabase.channel('gacha-broadcast')
      await gachaChannel.subscribe()

      let successCount = 0
      let blockedCount = 0

      for (const student of selected) {
        const { data: st } = await supabase.from('students')
          .select('super_tokens').eq('student_id', student.student_id).single()
        let tokens = st ? (st.super_tokens || 0) : 0

        if (tokens < 3) {
          tokens += 1
          const { data: updateData, error: updateErr } = await supabase.from('students')
            .update({ super_tokens: tokens }).eq('student_id', student.student_id).select()
          if (!updateErr && updateData && updateData.length > 0) {
            successCount++
            gachaChannel.send({
              type: 'broadcast',
              event: 'gacha_drop',
              payload: { student_id: student.student_id, amount: 1 },
            })
          } else {
            blockedCount++
          }
        }
      }

      supabase.removeChannel(gachaChannel)
      setIsDistributing(false)

      if (blockedCount > 0) {
        alert(`⚠️ แจกสำเร็จ ${successCount} คน แต่อีก ${blockedCount} คน เขียนข้อมูลไม่ผ่าน (น่าจะติด RLS Policy ของตาราง students ใน Supabase กรุณาตรวจสอบ)`)
      } else {
        alert(`🎉 สุ่มแจกสำเร็จ!\nนักศึกษาผู้โชคดี ${successCount} คน ได้รับ Super Token เพิ่มเรียบร้อยแล้ว (จะเด้งขึ้นหน้าจอของเด็กทันที)`)
      }
    } catch (err: any) {
      setIsDistributing(false)
      alert(`เกิดข้อผิดพลาด: ${err.message}`)
    }
  }

  // ── Give / remove token per student ──────────────────────
  function openGiveTokenModal() {
    if (globalExamData.length === 0) return alert('ยังไม่มีข้อมูลนักศึกษา กรุณากด 🔄 รีเฟรช ก่อนครับ')
    setGiveTokenRoom('')
    setGiveTokenList(null)
    setGiveTokenListError('')
    setShowGiveTokenModal(true)
  }

  function closeGiveTokenModal() {
    setShowGiveTokenModal(false)
  }

  useEffect(() => {
    if (!showGiveTokenModal || !giveTokenRoom) return

    const students = globalExamData
      .filter(s => s.room === giveTokenRoom)
      .sort((a, b) => a.class_number - b.class_number)

    if (students.length === 0) {
      setGiveTokenList([])
      return
    }

    setGiveTokenList(null)
    setGiveTokenListError('')
    ;(async () => {
      try {
        // ดึงจำนวนเหรียญปัจจุบันของทุกคนในห้องนี้แบบ batch ครั้งเดียว (ข้อมูลสดจาก DB เสมอ)
        const { data: tokenData, error } = await supabase.from('students')
          .select('student_id, super_tokens').in('student_id', students.map(s => s.student_id))
        if (error) throw error
        const tokenMap: Record<string, number> = {}
        tokenData?.forEach((t: any) => { tokenMap[t.student_id] = t.super_tokens || 0 })
        setGiveTokenList(students.map(s => ({ ...s, tokens: tokenMap[s.student_id] || 0 })))
      } catch (err: any) {
        setGiveTokenListError('โหลดข้อมูลเหรียญไม่สำเร็จ: ' + err.message)
      }
    })()
  }, [giveTokenRoom, showGiveTokenModal])

  async function giveTokenToStudent(studentId: string) {
    setTokenBusyId(studentId)
    try {
      const { data: st, error: fetchErr } = await supabase.from('students')
        .select('super_tokens').eq('student_id', studentId).single()
      if (fetchErr) throw fetchErr
      let tokens = st ? (st.super_tokens || 0) : 0
      if (tokens >= 3) return

      tokens += 1 // ให้ทีละ 1 เหรียญ (ตันที่ 3)
      const { data: updateData, error: updateErr } = await supabase.from('students')
        .update({ super_tokens: tokens }).eq('student_id', studentId).select()
      if (updateErr) throw updateErr
      if (!updateData || updateData.length === 0) {
        throw new Error('ไม่มีสิทธิ์เขียนข้อมูล (RLS) กรุณาตรวจสอบ Row Level Security Policy ของตาราง students ใน Supabase ว่าอนุญาตให้ UPDATE ด้วย anon key หรือไม่')
      }
      setGiveTokenList(list => list?.map(s => s.student_id === studentId ? { ...s, tokens } : s) ?? list)
    } catch (err: any) {
      alert('ให้เหรียญไม่สำเร็จ: ' + err.message)
    } finally {
      setTokenBusyId(null)
    }
  }

  async function removeTokenFromStudent(studentId: string) {
    setTokenBusyId(studentId)
    try {
      const { data: st, error: fetchErr } = await supabase.from('students')
        .select('super_tokens').eq('student_id', studentId).single()
      if (fetchErr) throw fetchErr
      let tokens = st ? (st.super_tokens || 0) : 0
      if (tokens <= 0) return

      tokens -= 1
      const { data: updateData, error: updateErr } = await supabase.from('students')
        .update({ super_tokens: tokens }).eq('student_id', studentId).select()
      if (updateErr) throw updateErr
      if (!updateData || updateData.length === 0) {
        throw new Error('ไม่มีสิทธิ์เขียนข้อมูล (RLS) กรุณาตรวจสอบ Row Level Security Policy ของตาราง students ใน Supabase ว่าอนุญาตให้ UPDATE ด้วย anon key หรือไม่')
      }
      setGiveTokenList(list => list?.map(s => s.student_id === studentId ? { ...s, tokens } : s) ?? list)
    } catch (err: any) {
      alert('หักเหรียญไม่สำเร็จ: ' + err.message)
    } finally {
      setTokenBusyId(null)
    }
  }

  // ── Delete result ────────────────────────────────────────
  async function deleteExamResult(studentId: string, fullName: string) {
    if (!confirm(`ยืนยันลบผลสอบของ "${fullName}" สำหรับวิชานี้?\n\n⚠️ คะแนนและคำตอบเดิมจะถูกลบทิ้งอย่างถาวร นักศึกษาจะสามารถเข้าสอบวิชานี้ใหม่ได้อีกครั้ง`)) return
    try {
      const { data: deleteData, error } = await supabase.from('exam_results')
        .delete().eq('student_id', studentId).eq('project_name', projectFilter).select()
      if (error) throw error
      if (!deleteData || deleteData.length === 0) {
        throw new Error('ไม่มีสิทธิ์ลบข้อมูล (RLS) กรุณาตรวจสอบ Row Level Security Policy ของตาราง exam_results ใน Supabase ว่าอนุญาตให้ DELETE ด้วย anon key หรือไม่')
      }
      fetchExamResults(projectFilter)
    } catch (err: any) {
      alert('ลบผลสอบไม่สำเร็จ: ' + err.message)
    }
  }

  // ── CSV export ───────────────────────────────────────────
  function exportToCSV() {
    if (globalExamData.length === 0) return alert('ไม่มีข้อมูลสำหรับดาวน์โหลด')
    const exportData = currentRoom !== 'ALL' ? globalExamData.filter(i => i.room === currentRoom) : globalExamData

    let csvContent = `วิชา/โปรเจกต์:,${projectLabel}\nสถานะ,ห้อง,เลขที่,รหัสนักศึกษา,ชื่อ-นามสกุล,คะแนน,เวลาส่ง\n`
    exportData.forEach(row => {
      const statusStr = row.has_submitted ? 'ส่งแล้ว' : 'ยังไม่สอบ'
      const scoreStr = row.has_submitted ? row.score : '-'
      csvContent += `${statusStr},${row.room},${row.class_number},${row.student_id},"${row.full_name}",${scoreStr},${row.timestamp}\n`
    })

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `คะแนน_${projectLabel}_ห้อง_${currentRoom}_${new Date().toLocaleDateString('th-TH').replace(/\//g, '-')}.csv`
    link.click()
  }

  // ── Derived table data ────────────────────────────────────
  const rooms = useMemo(
    () => [...new Set(globalExamData.map(s => s.room).filter(Boolean))].sort(),
    [globalExamData]
  )

  const filteredData = useMemo(() => {
    const base = currentRoom === 'ALL' ? globalExamData : globalExamData.filter(i => i.room === currentRoom)
    return [...base].sort((a, b) => {
      if (sortMode === 'default') {
        if (a.has_submitted !== b.has_submitted) return a.has_submitted ? -1 : 1
        if (a.has_submitted) return (b.score ?? 0) - (a.score ?? 0)
        return a.class_number - b.class_number
      }
      return a.class_number - b.class_number
    })
  }, [globalExamData, currentRoom, sortMode])

  const metrics = useMemo(() => {
    const total = filteredData.length
    const submitted = filteredData.filter(i => i.has_submitted)
    const submittedCount = submitted.length
    if (submittedCount === 0) return { total, submittedCount, avg: '0.00', max: 0, min: 0 }
    const scores = submitted.map(i => i.score as number)
    const avg = (scores.reduce((a, b) => a + b, 0) / submittedCount).toFixed(2)
    const max = Math.max(...scores)
    const nonZero = scores.filter(s => s > 0)
    const min = nonZero.length > 0 ? Math.min(...nonZero) : 0
    return { total, submittedCount, avg, max, min }
  }, [filteredData])

  // ── Render: login gate ─────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F5F5F7]">
        <div className="w-full max-w-md p-8 bg-white rounded-3xl shadow-xl border border-gray-100 mx-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl text-blue-600 mb-4 text-3xl">👨‍🏫</div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">ศูนย์บัญชาการผู้สอน</h1>
            <p className="text-sm text-gray-500 mt-2">กรุณากรอกรหัสผ่านเพื่อเข้าสู่ระบบ Dashboard</p>
          </div>
          <form onSubmit={handleLogin}>
            <div className="mb-6">
              <input
                type="password"
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-center tracking-widest text-lg"
                placeholder="••••••••"
              />
              {loginError && (
                <p className="text-red-500 text-xs mt-2 text-center">❌ รหัสผ่านไม่ถูกต้อง</p>
              )}
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-[#0071E3] hover:bg-[#0077ED] text-white font-medium rounded-xl transition shadow-md shadow-blue-500/10 active:scale-[0.98]"
            >
              เข้าสู่ระบบด่วน
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Render: dashboard ────────────────────────────────────
  return (
    <div className="min-h-screen antialiased selection:bg-blue-500 selection:text-white bg-[#F5F5F7]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-20">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 mb-6 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> Connected to Server
              </span>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full flex items-center gap-1.5 transition-all ${realtimeOn ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                <span className={`w-2 h-2 rounded-full ${realtimeOn ? 'bg-green-500 animate-ping' : 'bg-gray-400'}`} /> {realtimeOn ? 'Realtime On' : 'Realtime Off'}
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mt-2">Coding Quiz Portal 📊</h1>
          </div>

          <div className="mt-4 md:mt-0 flex flex-wrap gap-3">
            <button
              onClick={() => setSortMode(m => (m === 'default' ? 'number' : 'default'))}
              className={`inline-flex items-center gap-2 px-4 py-2.5 border rounded-xl transition active:scale-95 text-sm shadow-sm font-medium ${sortMode === 'number' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'}`}
            >
              {sortMode === 'number' ? '🏆 เรียงตามคะแนน' : '🔢 เรียงตามเลขที่'}
            </button>
            <button
              onClick={() => fetchExamResults(projectFilter)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium rounded-xl transition active:scale-95 text-sm shadow-sm"
            >
              🔄 รีเฟรช
            </button>
            <button
              onClick={openGiveTokenModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-yellow-50 border border-yellow-200 hover:bg-yellow-100 text-yellow-700 font-medium rounded-xl transition active:scale-95 text-sm shadow-sm"
            >
              🌟 แจก Super Token รายคน
            </button>
            <button
              onClick={exportToCSV}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white font-medium rounded-xl transition active:scale-95 text-sm shadow-sm shadow-blue-500/10"
            >
              📥 ดาวน์โหลด CSV
            </button>
          </div>
        </header>

        {tableError && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-xl">
            <div className="flex">
              <div className="flex-shrink-0"><span className="text-red-500">⚠️</span></div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">พบปัญหาในการเชื่อมต่อฐานข้อมูล</h3>
                <p className="text-sm text-red-700 mt-1">{tableError}</p>
              </div>
            </div>
          </div>
        )}

        {/* Project & Room selectors */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg">📚</div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">หัวข้อการสอบ (Project)</label>
                <select
                  value={projectFilter}
                  onChange={e => setProjectFilter(e.target.value)}
                  className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full sm:w-64 p-2.5 font-medium"
                >
                  {PROJECTS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <div className="hidden lg:block w-px h-12 bg-gray-200" />

            <div className="flex-1 overflow-x-auto">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">เลือกห้องเรียน</label>
              <div className="flex items-center gap-2 pb-1">
                <button
                  onClick={() => setCurrentRoom('ALL')}
                  className={`tab-btn px-4 py-2 rounded-xl text-sm font-medium ${currentRoom === 'ALL' ? 'active' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  ทั้งหมด
                </button>
                {rooms.map(room => (
                  <button
                    key={room}
                    onClick={() => setCurrentRoom(room)}
                    className={`tab-btn px-4 py-2 rounded-xl text-sm font-medium ${currentRoom === room ? 'active' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {room}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0 bg-gray-50 px-4 py-3 rounded-xl border border-gray-100">
              <span className="text-sm font-medium text-gray-700">📡 สตรีมมิ่งสด:</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={realtimeOn}
                  onChange={e => setRealtimeOn(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
              </label>
            </div>
          </div>
        </div>

        {/* Session manager / PIN generator */}
        <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 shadow-sm mb-8 flex flex-col md:flex-row items-center justify-between gap-6 transition-all">
          <div>
            <h3 className="text-indigo-900 font-semibold text-xl flex items-center gap-2">
              🔑 ระบบจัดการรหัสเข้าห้องสอบ (PIN)
            </h3>
            <p className="text-sm text-indigo-700 mt-1">
              ใช้สำหรับปลดล็อกให้นักศึกษาเข้าทำข้อสอบวิชา{' '}
              <span className="font-bold bg-indigo-100 px-2 py-0.5 rounded">{projectLabel}</span>
            </p>
          </div>

          <div className="flex items-center gap-4">
            {!pinActive ? (
              <button
                onClick={generatePin}
                disabled={generatingPin}
                className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium rounded-xl shadow-md transition active:scale-95 flex items-center gap-2"
              >
                <span className="text-lg">▶️</span> {generatingPin ? 'กำลังเปิดห้องสอบ...' : 'เปิดห้องสอบ (สุ่มรหัส PIN)'}
              </button>
            ) : (
              <div className="flex items-stretch gap-3">
                <div className="bg-white px-6 py-2 rounded-xl border-2 border-indigo-200 shadow-sm flex flex-col justify-center items-center">
                  <span className="block text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-0.5">รหัส PIN ปัจจุบัน</span>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-3xl font-mono font-bold text-indigo-700 tracking-[0.2em]">{currentPin}</span>
                  </div>
                </div>
                <button
                  onClick={closeSession}
                  title="ปิดรับคำตอบสำหรับวิชานี้"
                  className="px-4 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-medium rounded-xl transition active:scale-95 flex flex-col items-center justify-center"
                >
                  <span className="text-xl mb-1">⏹️</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider">ปิดสอบ</span>
                </button>
                <button
                  onClick={distributeSuperTokens}
                  disabled={isDistributing}
                  title="สุ่มแจก Super Token ให้นักศึกษาที่กำลังสอบอยู่"
                  className="px-4 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-60 border border-yellow-200 text-yellow-700 font-medium rounded-xl transition active:scale-95 flex flex-col items-center justify-center"
                >
                  <span className="text-xl mb-1">{isDistributing ? '⏳' : '🎁'}</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider">{isDistributing ? 'กำลังแจก' : 'สุ่มแจก'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">นักศึกษาในห้อง</p>
            <p className="text-3xl font-semibold text-gray-900 mt-2">{metrics.total}</p>
            <p className="text-xs text-gray-400 mt-1"><span className="text-green-600 font-medium">ส่งแล้ว {metrics.submittedCount}</span> คน</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">คะแนนเฉลี่ยรวม</p>
            <p className="text-3xl font-semibold text-blue-600 mt-2">{metrics.avg}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">คะแนนสูงสุด</p>
            <p className="text-3xl font-semibold text-green-600 mt-2">{metrics.max}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">คะแนนต่ำสุด</p>
            <p className="text-3xl font-semibold text-orange-600 mt-2">{metrics.min}</p>
          </div>
        </div>

        {/* Score table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 text-gray-400 uppercase text-xs tracking-wider font-semibold border-b border-gray-100">
                  <th className="py-4 px-6 text-center w-24">สถานะ</th>
                  <th className="py-4 px-6 text-center w-20">ห้อง</th>
                  <th className="py-4 px-6 text-center w-20">เลขที่</th>
                  <th className="py-4 px-6 w-44">รหัสนักศึกษา</th>
                  <th className="py-4 px-6">ชื่อ - นามสกุล</th>
                  <th className="py-4 px-6 text-center w-36">คะแนนที่ได้</th>
                  <th className="py-4 px-6 text-center w-40 hidden sm:table-cell">เวลาที่ส่ง</th>
                  <th className="py-4 px-6 text-center w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
                {isLoadingTable ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-500">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent mb-2" /><br />กำลังดึงข้อมูล...
                    </td>
                  </tr>
                ) : filteredData.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-gray-400">ยังไม่มีข้อมูลนักศึกษาในห้องนี้</td></tr>
                ) : filteredData.map(item => {
                  let badgeColor = 'bg-gray-100 text-gray-800'
                  if (item.has_submitted && item.score !== null) {
                    if (item.score >= 8) badgeColor = 'bg-green-100 text-green-800 font-semibold'
                    else if (item.score >= 5) badgeColor = 'bg-blue-100 text-blue-800'
                    else if (item.score > 0) badgeColor = 'bg-orange-100 text-orange-800'
                    else badgeColor = 'bg-red-100 text-red-800 border border-red-200'
                  }
                  return (
                    <tr key={item.student_id} className={`hover:bg-gray-50/70 transition-colors border-b border-gray-50 last:border-0 ${!item.has_submitted ? 'bg-gray-50/30 opacity-70' : ''}`}>
                      <td className="py-4 px-6 text-center">
                        {item.has_submitted ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 text-green-600 rounded-full">✓</span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-gray-200 text-gray-400 rounded-full">?</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center font-medium text-gray-500">{item.room}</td>
                      <td className="py-4 px-6 text-center font-semibold text-gray-900">{item.class_number}</td>
                      <td className="py-4 px-6 font-mono text-xs text-gray-500">{item.student_id}</td>
                      <td className="py-4 px-6 font-medium text-gray-800">{item.full_name}</td>
                      <td className="py-4 px-6 text-center">
                        {item.has_submitted ? (
                          <span className={`inline-block px-3 py-1 rounded-full text-xs shadow-sm ${badgeColor}`}>{item.score} คะแนน</span>
                        ) : (
                          <span className="inline-block px-3 py-1 text-xs text-gray-400">⏳ ยังไม่สอบ</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center text-xs text-gray-400 hidden sm:table-cell">{item.timestamp}</td>
                      <td className="py-4 px-6 text-center">
                        {item.has_submitted ? (
                          <button
                            onClick={() => deleteExamResult(item.student_id, item.full_name)}
                            title="ลบผลสอบ (ให้สอบใหม่ได้)"
                            className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded-lg transition active:scale-95 text-xs"
                          >
                            🗑️
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Give Token Modal */}
      {showGiveTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full mx-4 max-h-[85vh] flex flex-col">
            <div className="p-6 pb-4 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🌟 แจก Super Token รายคน</h2>
              <p className="text-sm text-gray-500 mt-1">เลือกห้องเรียน แล้วกดแจกเหรียญให้นักศึกษาทีละคน</p>
              <select
                value={giveTokenRoom}
                onChange={e => setGiveTokenRoom(e.target.value)}
                className="w-full mt-4 bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 font-medium"
              >
                <option value="">-- เลือกห้องเรียน --</option>
                {rooms.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {!giveTokenRoom ? (
                <p className="text-center text-gray-400 text-sm py-8">กรุณาเลือกห้องเรียนก่อนครับ</p>
              ) : giveTokenListError ? (
                <p className="text-center text-red-500 text-sm py-8">{giveTokenListError}</p>
              ) : giveTokenList === null ? (
                <p className="text-center text-gray-400 text-sm py-8">⏳ กำลังโหลดจำนวนเหรียญ...</p>
              ) : giveTokenList.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">ไม่พบนักศึกษาในห้องนี้</p>
              ) : giveTokenList.map(s => {
                const isFull = s.tokens >= 3
                const isEmpty = s.tokens <= 0
                const busy = tokenBusyId === s.student_id
                return (
                  <div key={s.student_id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{s.class_number}. {s.full_name}</p>
                      <p className="text-xs text-gray-400 font-mono">{s.student_id}</p>
                      <p className="text-xs mt-0.5">
                        <span className={`font-semibold ${isFull ? 'text-yellow-600' : 'text-gray-500'}`}>🌟 มีอยู่ {s.tokens}/3 เหรียญ</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => removeTokenFromStudent(s.student_id)}
                        disabled={isEmpty || busy}
                        title="หักเหรียญออก 1 เหรียญ"
                        className={`px-2.5 py-2 border border-red-100 font-medium rounded-lg transition active:scale-95 text-xs ${isEmpty ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-red-50 hover:bg-red-100 text-red-500'}`}
                      >
                        ➖
                      </button>
                      <button
                        onClick={() => giveTokenToStudent(s.student_id)}
                        disabled={isFull || busy}
                        className={`px-3 py-2 border border-yellow-200 font-medium rounded-lg transition active:scale-95 text-xs whitespace-nowrap ${isFull ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-yellow-50 hover:bg-yellow-100 text-yellow-700'}`}
                      >
                        {isFull ? '🔒 ครบแล้ว' : '🌟 ให้เหรียญ'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="p-4 border-t border-gray-100">
              <button onClick={closeGiveTokenModal} className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition">
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
