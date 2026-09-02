'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  generatePin as generatePinAction,
  closeSession as closeSessionAction,
  resetRoomTokens as resetRoomTokensAction,
  giveTokenToStudent as giveTokenToStudentAction,
  removeTokenFromStudent as removeTokenFromStudentAction,
  distributeSuperTokens as distributeSuperTokensAction,
  deleteExamResult as deleteExamResultAction,
  importStudents as importStudentsAction,
  deleteStudent as deleteStudentAction,
  deleteRoom as deleteRoomAction,
  getHeistLog as getHeistLogAction,
  type ImportStudentRow,
  type HeistLogRow,
} from '@/app/actions/dashboard'
import { signOutTeacher } from '@/app/actions/auth'

type Project = { value: string; label: string }

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

type BtnVariant = 'ghost' | 'primary' | 'yellow' | 'green' | 'danger' | 'active'
type MBtnVariant = 'cancel' | 'primary' | 'yellow' | 'green' | 'indigo'

function btn(variant: BtnVariant, extra = '') {
  const base = 'inline-flex items-center gap-2 px-4 py-2.5 font-medium rounded-xl transition active:scale-95 text-sm shadow-sm'
  const v: Record<BtnVariant, string> = {
    ghost:   'bg-white border border-gray-200 hover:bg-gray-50 text-gray-700',
    primary: 'bg-[#0071E3] hover:bg-[#0077ED] text-white shadow-blue-500/10',
    yellow:  'bg-yellow-50 border border-yellow-200 hover:bg-yellow-100 text-yellow-700',
    green:   'bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700',
    danger:  'bg-white border border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-gray-700',
    active:  'bg-blue-50 border border-blue-200 text-blue-700',
  }
  return `${base} ${v[variant]}${extra ? ' ' + extra : ''}`
}

function mbtn(variant: MBtnVariant, extra = '') {
  const base = 'py-3 font-medium rounded-xl transition'
  const v: Record<MBtnVariant, string> = {
    cancel:  'bg-gray-100 hover:bg-gray-200 text-gray-700',
    primary: 'bg-[#0071E3] hover:bg-[#0077ED] text-white',
    yellow:  'bg-yellow-500 hover:bg-yellow-600 text-white',
    green:   'bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white active:scale-95',
    indigo:  'bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md',
  }
  return `${base} ${v[variant]}${extra ? ' ' + extra : ''}`
}

export default function DashboardPage() {
  const supabase = createClient()

  // ── Project / room controls ────────────────────────────
  // ดึงจากตาราง subjects จริง (ไม่ hardcode) — วิชาใหม่เพิ่มผ่าน Supabase แล้วโผล่ที่นี่ได้เลย ไม่ต้องแก้โค้ด
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [projectFilter, setProjectFilter] = useState('')
  const [currentRoom, setCurrentRoom] = useState('ALL')
  const [roomMenuOpen, setRoomMenuOpen] = useState(false)
  const roomMenuRef = useRef<HTMLDivElement>(null)
  const [sortMode, setSortMode] = useState<'default' | 'number'>('default')
  const [realtimeOn, setRealtimeOn] = useState(false)

  // ── Session / PIN ───────────────────────────────────────
  const [pinActive, setPinActive] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [generatingPin, setGeneratingPin] = useState(false)
  const [isDistributing, setIsDistributing] = useState(false)
  const [showDurationModal, setShowDurationModal] = useState(false)
  const [durationInput, setDurationInput] = useState('15')
  const [examTimeLeft, setExamTimeLeft] = useState<number | null>(null)
  const examTimerRef = useRef<NodeJS.Timeout | null>(null)
  const examTimeLeftRef = useRef<number>(0)
  const [gachaWinners, setGachaWinners] = useState<string[]>([])
  const [showGachaCountModal, setShowGachaCountModal] = useState(false)
  const [gachaCountInput, setGachaCountInput] = useState('')

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

  // ── Import / manage students modal ────────────────────────
  const [showManageStudentsModal, setShowManageStudentsModal] = useState(false)
  const [manageTab, setManageTab] = useState<'import' | 'manage'>('import')
  const [importText, setImportText] = useState('')
  const [importRows, setImportRows] = useState<ImportStudentRow[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importDoneMsg, setImportDoneMsg] = useState('')
  const [isDeletingRoom, setIsDeletingRoom] = useState<string | null>(null)
  const [manageStudentBusyId, setManageStudentBusyId] = useState<string | null>(null)
  const [manageRoomFilter, setManageRoomFilter] = useState('ALL')

  // ── Heist log modal ───────────────────────────────────────
  const [showHeistLogModal, setShowHeistLogModal] = useState(false)
  const [heistLogRows, setHeistLogRows] = useState<HeistLogRow[]>([])
  const [heistLogLoading, setHeistLogLoading] = useState(false)
  const [heistLogError, setHeistLogError] = useState('')

  const projectLabel = projects.find(p => p.value === projectFilter)?.label || projectFilter

  // ── โหลดรายชื่อวิชาจาก subjects table ─────────────────────
  useEffect(() => {
    (async () => {
      setIsLoadingProjects(true)
      try {
        const { data, error } = await supabase.from('subjects')
          .select('name, description').eq('is_active', true).order('name')
        if (error) throw error
        const list = (data || []).map((s: any) => ({ value: s.name, label: s.description || s.name }))
        setProjects(list)
        setProjectFilter(prev => prev || list[0]?.value || '')
      } catch (err) {
        console.error('โหลดรายชื่อวิชาไม่สำเร็จ:', err)
      } finally {
        setIsLoadingProjects(false)
      }
    })()
  }, [])

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
    if (!projectFilter) return
    checkSessionStatus(projectFilter)
    fetchExamResults(projectFilter)
  }, [projectFilter])

  // ── ปิด dropdown เลือกห้องเรียนเมื่อคลิกนอกกล่อง ──
  useEffect(() => {
    if (!roomMenuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (roomMenuRef.current && !roomMenuRef.current.contains(e.target as Node)) {
        setRoomMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [roomMenuOpen])

  // ── รายชื่อคนที่เคยถูกสุ่มได้ Super Token แล้วในห้องสอบรอบนี้ ──
  // เก็บแยกตามวิชา+PIN เพื่อไม่ให้คนเดิมถูกสุ่มซ้ำในรอบเดียวกัน (เพิ่มโอกาสให้คนที่ยังไม่เคยได้)
  // เปิด PIN ใหม่ = รอบใหม่ = รีเซ็ตรายชื่อ เพราะ key เปลี่ยน
  const gachaWinnersKey = `gacha-winners:${projectFilter}:${currentPin}`
  useEffect(() => {
    if (!currentPin) { setGachaWinners([]); return }
    try {
      const stored = sessionStorage.getItem(gachaWinnersKey)
      setGachaWinners(stored ? JSON.parse(stored) : [])
    } catch {
      setGachaWinners([])
    }
  }, [gachaWinnersKey])

  // ── Realtime: refresh table on new submissions ─────────
  useEffect(() => {
    if (!realtimeOn) return
    const channel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exam_results' }, () => {
        fetchExamResults(projectFilter)
      }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [realtimeOn, projectFilter])

  // ── PIN management ──────────────────────────────────────
  function openDurationModal() {
    setDurationInput('15')
    setShowDurationModal(true)
  }

  async function confirmOpenSession() {
    const minutes = parseInt(durationInput)
    if (!minutes || minutes < 1 || minutes > 180) {
      alert('กรุณาระบุเวลาระหว่าง 1–180 นาที')
      return
    }
    setShowDurationModal(false)
    setGeneratingPin(true)
    const result = await generatePinAction(projectFilter, minutes)
    if (result.success) {
      setPinActive(true)
      setCurrentPin(result.pin)
      startExamTimer(minutes * 60)
    } else {
      alert('สร้าง PIN ไม่สำเร็จ: ' + result.error)
    }
    setGeneratingPin(false)
  }

  function startExamTimer(seconds: number) {
    if (examTimerRef.current) clearInterval(examTimerRef.current)
    examTimeLeftRef.current = seconds
    setExamTimeLeft(seconds)
    examTimerRef.current = setInterval(() => {
      examTimeLeftRef.current -= 1
      if (examTimeLeftRef.current <= 0) {
        clearInterval(examTimerRef.current!)
        examTimerRef.current = null
        setExamTimeLeft(null)
        doCloseSession()
      } else {
        setExamTimeLeft(examTimeLeftRef.current)
      }
    }, 1000)
  }

  async function doCloseSession() {
    const result = await closeSessionAction(projectFilter)
    if (result.success) {
      setPinActive(false)
      setCurrentPin('')
      setExamTimeLeft(null)
      if (examTimerRef.current) { clearInterval(examTimerRef.current); examTimerRef.current = null }
    } else {
      alert('ปิดห้องสอบไม่สำเร็จ: ' + result.error)
    }
  }

  async function closeSession() {
    if (!confirm('ยืนยันปิดห้องสอบวิชานี้?\nนักศึกษาจะเข้าสอบใหม่ไม่ได้ (เข้าได้แค่โหมดทบทวนเฉลยเท่านั้น)')) return
    await doCloseSession()
  }

  // ── Reset Super Token ของทั้งห้องเรียน (scoped ตาม room ที่เลือกอยู่) ─
  const [isResettingRoom, setIsResettingRoom] = useState(false)

  async function resetRoomTokens() {
    if (currentRoom === 'ALL') {
      return alert('กรุณาเลือกห้องเรียนที่ต้องการรีเซ็ตก่อนครับ (ไม่รองรับรีเซ็ตทุกห้องพร้อมกัน)')
    }
    if (!confirm(`ยืนยันรีเซ็ต Super Token ของนักศึกษาห้อง ${currentRoom} ทุกคนเป็น 0?`)) return
    setIsResettingRoom(true)
    const result = await resetRoomTokensAction(currentRoom)
    if (result.success) {
      alert(`รีเซ็ต Super Token ห้อง ${currentRoom} เรียบร้อยแล้ว`)
    } else {
      alert('รีเซ็ต Token ไม่สำเร็จ: ' + result.error)
    }
    setIsResettingRoom(false)
  }

  // ── Gacha: random distribute super tokens ───────────────
  // ใช้ modal ในหน้าเว็บแทน window.prompt() เพราะ prompt() ใช้ไม่ได้ในบาง preview environment (เช่น embedded iframe)
  function openGachaCountModal() {
    setGachaCountInput('')
    setShowGachaCountModal(true)
  }

  async function distributeSuperTokens() {
    const count = parseInt(gachaCountInput)
    if (isNaN(count) || count <= 0) return alert('โปรดระบุจำนวนคนเป็นตัวเลขที่ถูกต้อง')
    setShowGachaCountModal(false)

    setIsDistributing(true)
    const result = await distributeSuperTokensAction(projectFilter, currentRoom, count, gachaWinners)
    setIsDistributing(false)

    if (!result.success) {
      alert('❌ ' + result.error)
      return
    }

    if (result.selectedIds.length > 0) {
      const updated = [...gachaWinners, ...result.selectedIds]
      setGachaWinners(updated)
      sessionStorage.setItem(gachaWinnersKey, JSON.stringify(updated))
    }

    if (result.blockedCount > 0) {
      alert(`⚠️ แจกสำเร็จ ${result.successCount} คน แต่อีก ${result.blockedCount} คน เขียนข้อมูลไม่ผ่าน`)
    } else {
      alert(`🎉 สุ่มแจกสำเร็จ!\nนักศึกษาผู้โชคดี ${result.successCount} คน ได้รับ Super Token เพิ่มเรียบร้อยแล้ว (จะเด้งขึ้นหน้าจอของเด็กทันที)\nรอบถัดไปจะไม่สุ่มโดนคนกลุ่มนี้ซ้ำครับ`)
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
    const result = await giveTokenToStudentAction(studentId)
    if (result.success) {
      setGiveTokenList(list => list?.map(s => s.student_id === studentId ? { ...s, tokens: result.tokens } : s) ?? list)
    } else {
      alert('ให้เหรียญไม่สำเร็จ: ' + result.error)
    }
    setTokenBusyId(null)
  }

  async function removeTokenFromStudent(studentId: string) {
    setTokenBusyId(studentId)
    const result = await removeTokenFromStudentAction(studentId)
    if (result.success) {
      setGiveTokenList(list => list?.map(s => s.student_id === studentId ? { ...s, tokens: result.tokens } : s) ?? list)
    } else {
      alert('หักเหรียญไม่สำเร็จ: ' + result.error)
    }
    setTokenBusyId(null)
  }

  // ── Delete result ────────────────────────────────────────
  async function deleteExamResult(studentId: string, fullName: string) {
    if (!confirm(`ยืนยันลบผลสอบของ "${fullName}" สำหรับวิชานี้?\n\n⚠️ คะแนนและคำตอบเดิมจะถูกลบทิ้งอย่างถาวร นักศึกษาจะสามารถเข้าสอบวิชานี้ใหม่ได้อีกครั้ง`)) return
    const result = await deleteExamResultAction(studentId, projectFilter)
    if (result.success) {
      fetchExamResults(projectFilter)
    } else {
      alert('ลบผลสอบไม่สำเร็จ: ' + result.error)
    }
  }

  // ── Import นักศึกษา: parse CSV (รหัส,ชื่อ,นามสกุล,ห้อง,เลขที่) ──
  function parseStudentCSV(text: string): { rows: ImportStudentRow[]; errors: string[] } {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
    const rows: ImportStudentRow[] = []
    const errors: string[] = []
    const seen = new Set<string>()

    lines.forEach((line, idx) => {
      const cols = line.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1'))
      const [studentId, firstName, lastName, room, classNumberStr] = cols

      // แถวแรกถ้าเป็น header (เช่น "รหัส,ชื่อ,...") ให้ข้ามไปเงียบ ๆ
      if (idx === 0 && (!studentId || isNaN(parseInt(classNumberStr, 10)))) {
        if (!studentId || /รหัส|student.?id/i.test(studentId)) return
      }

      if (cols.length < 4 || !studentId || !firstName || !room) {
        errors.push(`บรรทัดที่ ${idx + 1}: ข้อมูลไม่ครบ ต้องมี รหัส,ชื่อ,นามสกุล,ห้อง,เลขที่ — "${line}"`)
        return
      }
      if (seen.has(studentId)) {
        errors.push(`บรรทัดที่ ${idx + 1}: รหัส ${studentId} ซ้ำกันเองในไฟล์ที่วาง (จะใช้ค่าแถวล่าสุด)`)
      }
      seen.add(studentId)

      const classNumber = parseInt(classNumberStr, 10)
      rows.push({
        student_id: studentId,
        first_name: firstName,
        last_name: lastName || '',
        room,
        class_number: isNaN(classNumber) ? 0 : classNumber,
      })
    })

    // ถ้าซ้ำกันเองในไฟล์ ให้เหลือแค่แถวล่าสุดของแต่ละรหัส
    const dedup = new Map<string, ImportStudentRow>()
    rows.forEach(r => dedup.set(r.student_id, r))

    return { rows: [...dedup.values()], errors }
  }

  useEffect(() => {
    if (!importText.trim()) {
      setImportRows([])
      setImportErrors([])
      return
    }
    const { rows, errors } = parseStudentCSV(importText)
    setImportRows(rows)
    setImportErrors(errors)
  }, [importText])

  function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImportText(String(reader.result || ''))
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  async function submitImportStudents() {
    if (importRows.length === 0) return alert('ยังไม่มีข้อมูลนักศึกษาที่พาร์สได้สำหรับนำเข้า')
    if (!confirm(`ยืนยันนำเข้านักศึกษา ${importRows.length} คน?\n(ถ้ารหัสนักศึกษาซ้ำกับที่มีอยู่แล้ว ข้อมูลเดิมจะถูกอัปเดตทับ)`)) return

    setIsImporting(true)
    setImportDoneMsg('')
    const result = await importStudentsAction(importRows)
    setIsImporting(false)

    if (result.success) {
      setImportDoneMsg(`✅ นำเข้าสำเร็จ ${result.count} คน`)
      setImportText('')
      setImportRows([])
      setImportErrors([])
      fetchExamResults(projectFilter)
    } else {
      alert('นำเข้านักศึกษาไม่สำเร็จ: ' + result.error)
    }
  }

  // ── จัดการนักศึกษาเบื้องต้น: ลบรายคน / ลบทั้งห้อง ─────────────
  async function manageDeleteStudent(studentId: string, fullName: string) {
    if (!confirm(`ยืนยันลบนักศึกษา "${fullName}" (${studentId}) ออกจากระบบ?\n\n⚠️ ข้อมูลนักศึกษาและ Super Token จะถูกลบถาวร (ผลสอบเดิมจะยังอยู่ในตาราง exam_results)`)) return
    setManageStudentBusyId(studentId)
    const result = await deleteStudentAction(studentId)
    setManageStudentBusyId(null)
    if (result.success) {
      fetchExamResults(projectFilter)
    } else {
      alert('ลบนักศึกษาไม่สำเร็จ: ' + result.error)
    }
  }

  async function manageDeleteRoom(room: string) {
    const countInRoom = globalExamData.filter(s => s.room === room).length
    if (!confirm(`ยืนยันลบนักศึกษาทั้งห้อง "${room}" (${countInRoom} คน) ออกจากระบบ?\n\n⚠️ การลบนี้ถาวรและลบทุกคนในห้องนี้ทันที`)) return
    setIsDeletingRoom(room)
    const result = await deleteRoomAction(room)
    setIsDeletingRoom(null)
    if (result.success) {
      alert(`ลบนักศึกษาห้อง ${room} แล้ว ${result.count} คน`)
      if (manageRoomFilter === room) setManageRoomFilter('ALL')
      fetchExamResults(projectFilter)
    } else {
      alert('ลบห้องไม่สำเร็จ: ' + result.error)
    }
  }

  function openManageStudentsModal() {
    setManageTab('import')
    setImportText('')
    setImportRows([])
    setImportErrors([])
    setImportDoneMsg('')
    setManageRoomFilter('ALL')
    setShowManageStudentsModal(true)
  }

  // ── Heist log ─────────────────────────────────────────────
  async function openHeistLog() {
    if (!projectFilter) return alert('เลือกวิชาก่อนดู Heist log')
    setHeistLogError('')
    setShowHeistLogModal(true)
    setHeistLogLoading(true)
    const result = await getHeistLogAction(projectFilter)
    setHeistLogLoading(false)
    if (!result.success) { setHeistLogError(result.error); return }
    setHeistLogRows(result.rows)
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

          <div className="mt-4 md:mt-0 flex items-center gap-3">
            <button onClick={openManageStudentsModal} className={btn('green')}>
              📥 นำเข้า/จัดการนักศึกษา
            </button>
            <button onClick={() => signOutTeacher()} className={btn('danger')}>
              🚪 ออกจากระบบ
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
                  disabled={isLoadingProjects || projects.length === 0}
                  className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full sm:w-64 p-2.5 font-medium disabled:opacity-60"
                >
                  {isLoadingProjects ? (
                    <option>กำลังโหลด...</option>
                  ) : projects.length === 0 ? (
                    <option>ยังไม่มีวิชาในระบบ</option>
                  ) : (
                    projects.map(p => <option key={p.value} value={p.value}>{p.label}</option>)
                  )}
                </select>
              </div>
            </div>

            <div className="hidden lg:block w-px h-12 bg-gray-200" />

            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">เลือกห้องเรียน</label>
              <div className="flex items-center gap-2 pb-1">
                <div className="relative shrink-0" ref={roomMenuRef}>
                  <button
                    type="button"
                    onClick={() => setRoomMenuOpen(o => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={roomMenuOpen}
                    className={`flex items-center justify-between gap-2 min-w-[9rem] px-4 py-2 rounded-xl text-sm font-medium bg-white border transition ${
                      roomMenuOpen ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${currentRoom === 'ALL' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                      <span className="text-gray-800">{currentRoom === 'ALL' ? 'ทั้งหมด' : currentRoom}</span>
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${roomMenuOpen ? 'rotate-180' : ''}`}
                      viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {roomMenuOpen && (
                    <div
                      role="listbox"
                      className="absolute z-20 mt-2 w-56 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1.5"
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={currentRoom === 'ALL'}
                        onClick={() => { setCurrentRoom('ALL'); setRoomMenuOpen(false) }}
                        className={`w-full flex items-center justify-between px-3.5 py-2 text-sm text-left transition ${
                          currentRoom === 'ALL' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        ทั้งหมด
                        {currentRoom === 'ALL' && (
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 10.5L8 14.5L16 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>

                      {rooms.length > 0 && <div className="my-1 border-t border-gray-100" />}

                      {rooms.map(room => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={currentRoom === room}
                          key={room}
                          onClick={() => { setCurrentRoom(room); setRoomMenuOpen(false) }}
                          className={`w-full flex items-center justify-between px-3.5 py-2 text-sm text-left transition ${
                            currentRoom === room ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {room}
                          {currentRoom === room && (
                            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M4 10.5L8 14.5L16 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      ))}

                      {rooms.length === 0 && (
                        <p className="px-3.5 py-2 text-sm text-gray-400">ไม่มีห้องเรียน</p>
                      )}
                    </div>
                  )}
                </div>

                {currentRoom !== 'ALL' && (
                  <button
                    onClick={resetRoomTokens}
                    disabled={isResettingRoom}
                    title={`รีเซ็ต Super Token ของนักศึกษาห้อง ${currentRoom} ทุกคนเป็น 0`}
                    className="px-3 py-2 rounded-xl text-sm font-medium bg-red-50 hover:bg-red-100 disabled:opacity-60 border border-red-200 text-red-600 transition shrink-0 whitespace-nowrap"
                  >
                    {isResettingRoom ? '⏳ กำลังรีเซ็ต...' : `🔄 Reset Token ห้อง ${currentRoom}`}
                  </button>
                )}
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
                onClick={openDurationModal}
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
                {examTimeLeft !== null && (
                  <div className={`bg-white px-4 py-2 rounded-xl border-2 shadow-sm flex flex-col justify-center items-center ${examTimeLeft <= 60 ? 'border-red-300 animate-pulse' : 'border-orange-200'}`}>
                    <span className="block text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-0.5">เวลาคงเหลือ</span>
                    <span className={`text-2xl font-mono font-bold tracking-wider ${examTimeLeft <= 60 ? 'text-red-600' : 'text-orange-600'}`}>
                      {String(Math.floor(examTimeLeft / 60)).padStart(2, '0')}:{String(examTimeLeft % 60).padStart(2, '0')}
                    </span>
                  </div>
                )}
                <button
                  onClick={closeSession}
                  title="ปิดรับคำตอบสำหรับวิชานี้"
                  className="px-4 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-medium rounded-xl transition active:scale-95 flex flex-col items-center justify-center"
                >
                  <span className="text-xl mb-1">⏹️</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider">ปิดสอบ</span>
                </button>
                <button
                  onClick={openGachaCountModal}
                  disabled={isDistributing}
                  title="สุ่มแจก Super Token ให้นักศึกษาที่กำลังสอบอยู่"
                  className="px-4 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-60 border border-yellow-200 text-yellow-700 font-medium rounded-xl transition active:scale-95 flex flex-col items-center justify-center"
                >
                  <span className="text-xl mb-1">{isDistributing ? '⏳' : '🎁'}</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider">{isDistributing ? 'กำลังแจก' : 'สุ่มแจก'}</span>
                </button>
              </div>
            )}
            <button
              onClick={openGiveTokenModal}
              title="แจก Super Token ให้นักศึกษาทีละคน"
              className="px-4 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-sm font-medium rounded-xl transition active:scale-95 flex items-center gap-2 shrink-0"
            >
              <img src="/gamecoin.png" alt="" className="w-4 h-4" /> แจกรายคน
            </button>
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
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">ตารางคะแนน
              <span className="ml-2 text-xs font-normal text-gray-400">({filteredData.length} คน)</span>
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={() => setSortMode(m => (m === 'default' ? 'number' : 'default'))} className={btn(sortMode === 'number' ? 'active' : 'ghost')}>
                {sortMode === 'number' ? '🏆 เรียงคะแนน' : '🔢 เรียงเลขที่'}
              </button>
              <button onClick={() => fetchExamResults(projectFilter)} className={btn('ghost')}>
                🔄 รีเฟรช
              </button>
              <button onClick={exportToCSV} className={btn('primary')}>
                📥 CSV
              </button>
              <button onClick={openHeistLog} className={btn('ghost')}>
                🗡️ Heist Log
              </button>
            </div>
          </div>
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

      {/* Gacha count modal */}
      {showGachaCountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🎁 ระบบสุ่มแจก Super Token</h2>
            <p className="text-sm text-gray-500 mt-1">ระบุจำนวนนักศึกษาที่ต้องการแจก (ระบบจะสุ่มให้เฉพาะคนที่ยังสอบไม่เสร็จ)</p>
            <input
              type="number"
              min={1}
              value={gachaCountInput}
              onChange={e => setGachaCountInput(e.target.value)}
              autoFocus
              className="w-full mt-4 bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 font-medium"
              placeholder="เช่น 3"
            />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowGachaCountModal(false)} className={`flex-1 ${mbtn('cancel')}`}>ยกเลิก</button>
              <button onClick={distributeSuperTokens} className={`flex-1 ${mbtn('yellow')}`}>สุ่มแจก</button>
            </div>
          </div>
        </div>
      )}

      {/* Duration Modal */}
      {showDurationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <div className="text-3xl mb-3 text-center">⏱️</div>
            <h2 className="text-xl font-bold text-gray-900 text-center">กำหนดเวลาสอบ</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4 text-center">เมื่อหมดเวลา ระบบจะปิดห้องสอบและบังคับส่งคำตอบโดยอัตโนมัติ</p>
            <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <input
                type="number"
                min={1}
                max={180}
                value={durationInput}
                onChange={e => setDurationInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmOpenSession()}
                autoFocus
                className="flex-1 bg-transparent text-4xl font-mono font-bold text-indigo-700 text-center outline-none w-0"
              />
              <span className="text-gray-500 font-medium text-lg shrink-0">นาที</span>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowDurationModal(false)} className={`flex-1 ${mbtn('cancel')}`}>ยกเลิก</button>
              <button onClick={confirmOpenSession} className={`flex-1 ${mbtn('indigo')}`}>เปิดห้องสอบ</button>
            </div>
          </div>
        </div>
      )}

      {/* Give Token Modal */}
      {showGiveTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full mx-4 max-h-[85vh] flex flex-col">
            <div className="p-6 pb-4 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><img src="/gamecoin.png" alt="" className="w-5 h-5" /> แจก Super Token รายคน</h2>
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
                        <span className={`font-semibold ${isFull ? 'text-yellow-600' : 'text-gray-500'}`}><img src="/gamecoin.png" alt="" className="inline w-3 h-3 mr-0.5" /> มีอยู่ {s.tokens}/3 เหรียญ</span>
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
                        {isFull ? '🔒 ครบแล้ว' : <><img src="/gamecoin.png" alt="" className="inline w-3 h-3 mr-1" /> ให้เหรียญ</>}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="p-4 border-t border-gray-100">
              <button onClick={closeGiveTokenModal} className={`w-full ${mbtn('cancel')}`}>ปิดหน้าต่าง</button>
            </div>
          </div>
        </div>
      )}

      {/* Import / Manage Students Modal */}
      {showManageStudentsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 pb-0 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">📥 นำเข้า / จัดการนักศึกษา</h2>
              <p className="text-sm text-gray-500 mt-1 mb-4">
                นำเข้ารายชื่อนักศึกษาพร้อมห้องเรียน หรือลบนักศึกษา/ห้องเรียนออกจากระบบ
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => setManageTab('import')}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition ${
                    manageTab === 'import' ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  ⬆️ นำเข้ารายชื่อ (CSV)
                </button>
                <button
                  onClick={() => setManageTab('manage')}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition ${
                    manageTab === 'manage' ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  🗂️ จัดการห้อง/นักศึกษา
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-6">
              {manageTab === 'import' ? (
                <div className="space-y-4">
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-600 leading-relaxed">
                    รูปแบบแต่ละบรรทัด: <span className="font-mono bg-white px-1.5 py-0.5 rounded border">รหัสนักศึกษา,ชื่อ,นามสกุล,ห้อง,เลขที่</span><br />
                    เช่น <span className="font-mono bg-white px-1.5 py-0.5 rounded border">6512345,สมชาย,ใจดี,4/1,15</span><br />
                    ถ้ารหัสนักศึกษาซ้ำกับที่มีอยู่แล้ว ระบบจะ<b>อัปเดตทับข้อมูลเดิม</b> (ชื่อ/ห้อง/เลขที่) โดยอัตโนมัติ
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium rounded-xl transition active:scale-95 text-sm shadow-sm cursor-pointer">
                      📎 อัปโหลดไฟล์ .csv
                      <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFileChange} />
                    </label>
                    <span className="text-xs text-gray-400">หรือวางข้อความด้านล่างโดยตรง</span>
                  </div>

                  <textarea
                    value={importText}
                    onChange={e => setImportText(e.target.value)}
                    placeholder={'6512345,สมชาย,ใจดี,4/1,15\n6512346,สมหญิง,ดีใจ,4/1,16'}
                    rows={7}
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-3 font-mono"
                  />

                  {importErrors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 max-h-32 overflow-y-auto">
                      {importErrors.map((e, i) => (
                        <p key={i} className="text-xs text-red-600">⚠️ {e}</p>
                      ))}
                    </div>
                  )}

                  {importRows.length > 0 && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        พรีวิว ({importRows.length} คน)
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                        {importRows.map(r => (
                          <div key={r.student_id} className="flex items-center justify-between px-4 py-2 text-sm">
                            <span className="font-mono text-xs text-gray-400 w-24 shrink-0">{r.student_id}</span>
                            <span className="flex-1 text-gray-800 truncate">{r.first_name} {r.last_name}</span>
                            <span className="text-xs text-gray-500 shrink-0">ห้อง {r.room} · เลขที่ {r.class_number}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {importDoneMsg && (
                    <p className="text-sm text-green-600 font-medium">{importDoneMsg}</p>
                  )}

                  <button onClick={submitImportStudents} disabled={isImporting || importRows.length === 0} className={`w-full ${mbtn('green')}`}>
                    {isImporting ? '⏳ กำลังนำเข้า...' : `⬆️ นำเข้านักศึกษา ${importRows.length > 0 ? `(${importRows.length} คน)` : ''}`}
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Rooms list */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">ห้องเรียนทั้งหมด</h3>
                    {rooms.length === 0 ? (
                      <p className="text-sm text-gray-400">ยังไม่มีห้องเรียนในระบบ</p>
                    ) : (
                      <div className="space-y-2">
                        {rooms.map(room => {
                          const count = globalExamData.filter(s => s.room === room).length
                          return (
                            <div key={room} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="font-medium text-gray-800">{room}</span>
                                <span className="text-xs text-gray-400">{count} คน</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={() => setManageRoomFilter(f => f === room ? 'ALL' : room)}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
                                    manageRoomFilter === room ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'
                                  }`}
                                >
                                  {manageRoomFilter === room ? 'กำลังดู' : 'ดูรายชื่อ'}
                                </button>
                                <button
                                  onClick={() => manageDeleteRoom(room)}
                                  disabled={isDeletingRoom === room}
                                  title={`ลบนักศึกษาทั้งห้อง ${room}`}
                                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-50 border border-red-200 text-red-600 text-xs font-medium rounded-lg transition active:scale-95"
                                >
                                  {isDeletingRoom === room ? '⏳' : '🗑️ ลบทั้งห้อง'}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Per-student delete */}
                  {manageRoomFilter !== 'ALL' && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">นักศึกษาในห้อง {manageRoomFilter}</h3>
                      <div className="border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto divide-y divide-gray-50">
                        {globalExamData.filter(s => s.room === manageRoomFilter).length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-6">ไม่พบนักศึกษาในห้องนี้</p>
                        ) : globalExamData.filter(s => s.room === manageRoomFilter)
                          .sort((a, b) => a.class_number - b.class_number)
                          .map(s => (
                            <div key={s.student_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-800 truncate">{s.class_number}. {s.full_name}</p>
                                <p className="text-xs text-gray-400 font-mono">{s.student_id}</p>
                              </div>
                              <button
                                onClick={() => manageDeleteStudent(s.student_id, s.full_name)}
                                disabled={manageStudentBusyId === s.student_id}
                                title="ลบนักศึกษาคนนี้"
                                className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-50 border border-red-200 text-red-500 rounded-lg transition active:scale-95 text-xs shrink-0"
                              >
                                {manageStudentBusyId === s.student_id ? '⏳' : '🗑️'}
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100">
              <button onClick={() => setShowManageStudentsModal(false)} className={`w-full ${mbtn('cancel')}`}>ปิดหน้าต่าง</button>
            </div>
          </div>
        </div>
      )}
      {/* Heist Log Modal */}
      {showHeistLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🗡️ ประวัติ Heist — {projectLabel}</h2>
              <button onClick={() => setShowHeistLogModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {heistLogLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-400">กำลังโหลด...</div>
              ) : heistLogError ? (
                <div className="flex items-center justify-center py-16 text-red-500">{heistLogError}</div>
              ) : heistLogRows.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-gray-400">ยังไม่มีประวัติการปล้น</div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-gray-400 uppercase text-xs tracking-wider font-semibold border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="py-3 px-4">เวลา</th>
                      <th className="py-3 px-4">ผู้โจมตี</th>
                      <th className="py-3 px-4">เป้าหมาย</th>
                      <th className="py-3 px-4">โจทย์พิมพ์</th>
                      <th className="py-3 px-4 text-center">ผล</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {heistLogRows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 transition">
                        <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap font-mono text-xs">
                          {new Date(row.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-gray-900 whitespace-nowrap">{row.attacker_name}</td>
                        <td className="py-2.5 px-4 text-gray-700 whitespace-nowrap">{row.victim_name}</td>
                        <td className="py-2.5 px-4 max-w-xs">
                          <code className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded break-all">{row.snippet}</code>
                        </td>
                        <td className="py-2.5 px-4 text-center whitespace-nowrap">
                          {row.outcome === 'success' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold">ปล้นสำเร็จ 🗡️</span>}
                          {row.outcome === 'defended' && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">ป้องกันได้ 🛡️</span>}
                          {row.outcome === 'pending' && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">กำลังดำเนินการ ⏳</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-4 border-t border-gray-100">
              <button onClick={() => setShowHeistLogModal(false)} className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition">ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}