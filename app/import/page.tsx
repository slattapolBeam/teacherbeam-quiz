'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { saveExamQuestions, deleteExamQuestionSet, deleteSubject, listExamSets, createSubject, getExamSetPreview, type ExamSetPreviewData } from '@/app/actions/import'
import { signOutTeacher } from '@/app/actions/auth'

type BlankType = { type: 'dropdown'; choices: string[] } | null

type ParsedSet = {
  setName: string
  title: string
  code: string | null
  files: { filename: string; code: string }[] | null
  answers: string[]
  blankTypes: BlankType[]
  blanks: number
  ok: boolean
  errorMsg?: string
}

type ValidationResult = {
  valid: boolean
  projectName: string
  sets: ParsedSet[]
  errorMsg?: string
}

type ExistingSetRow = {
  project_name: string
  set_name: string
  question: string
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── แปลง "___" ในไฟล์เดียวเป็น <input>/<select> ตามลำดับ เริ่มนับต่อจาก startIndex ──
// (สำหรับชุดหลายไฟล์ เลขช่องจะนับต่อเนื่องข้ามไฟล์ ไม่รีเซ็ตเป็น 0 ทุกไฟล์)
function buildFileCode(template: string, answers: string[], blankTypes: BlankType[], startIndex: number): { code: string; nextIndex: number; errorMsg?: string } {
  let index = startIndex
  let errorMsg: string | undefined
  const code = template.replace(/___/g, () => {
    const answer = answers[index]
    const meta = blankTypes[index]
    let html: string
    if (meta) {
      if (!meta.choices.includes(answer)) {
        errorMsg = `ช่องที่ ${index} (dropdown): เฉลย "${answer}" ไม่อยู่ในตัวเลือก [${meta.choices.join(', ')}]`
      }
      const options = meta.choices.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
      html = `<select class="code-input code-select" id="q${index}"><option value="">-- เลือก --</option>${options}</select><button class="hint-btn" onclick="useSuperToken(${index})"><img src="/gamecoin.png" alt="coin" style="width:1em;height:1em;display:inline;vertical-align:middle" /></button>`
    } else {
      const width = Math.max(60, (answer?.length || 4) * 11 + 40)
      html = `<input type="text" class="code-input" style="width: ${width}px;" id="q${index}"><button class="hint-btn" onclick="useHint(${index})">💡</button>`
    }
    index++
    return html
  })
  return { code, nextIndex: index, errorMsg }
}

// ── ประกอบชุดข้อสอบจาก JSON ดิบ — รองรับทั้ง "code" (ไฟล์เดียว, แบบเดิม) และ "files" (หลายไฟล์) ──
// "blanks" (ทางเลือก) ระบุประเภทของแต่ละช่องแบบขนานกับ answers — ไม่ระบุ = เติมคำแบบเดิมทุกช่อง
function buildSetFromRaw(rawSet: any, answers: string[]): {
  code: string | null
  files: { filename: string; code: string }[] | null
  blankTypes: BlankType[]
  blanks: number
  ok: boolean
  errorMsg?: string
} {
  const rawBlankTypes: any[] = Array.isArray(rawSet.blanks) ? rawSet.blanks : []
  const blankTypes: BlankType[] = answers.map((_, i) => {
    const b = rawBlankTypes[i]
    if (b && b.type === 'dropdown' && Array.isArray(b.choices)) {
      return { type: 'dropdown', choices: b.choices.map(String) }
    }
    return null
  })

  const hasFiles = Array.isArray(rawSet.files) && rawSet.files.length > 0
  const hasCode = typeof rawSet.code === 'string' && rawSet.code.length > 0

  if (hasFiles && hasCode) {
    return { code: null, files: null, blankTypes, blanks: 0, ok: false, errorMsg: 'มีทั้ง "code" และ "files" พร้อมกัน ต้องเลือกอย่างใดอย่างหนึ่ง' }
  }
  if (!hasFiles && !hasCode) {
    return { code: null, files: null, blankTypes, blanks: 0, ok: false, errorMsg: 'ต้องมี "code" (ไฟล์เดียว) หรือ "files" (หลายไฟล์) อย่างใดอย่างหนึ่ง' }
  }

  const rawFiles: { filename?: string; code: string }[] = hasFiles ? rawSet.files : [{ code: rawSet.code }]

  let index = 0
  const builtFiles: { filename: string; code: string }[] = []
  let errorMsg: string | undefined

  for (const f of rawFiles) {
    if (hasFiles && (!f.filename || typeof f.code !== 'string')) {
      errorMsg = 'แต่ละไฟล์ใน "files" ต้องมี "filename" และ "code"'
      break
    }
    const built = buildFileCode(f.code, answers, blankTypes, index)
    builtFiles.push({ filename: f.filename || '', code: built.code })
    index = built.nextIndex
    if (built.errorMsg) { errorMsg = built.errorMsg; break }
  }

  if (!errorMsg && (index !== answers.length || index === 0)) {
    errorMsg = `พบ "___" รวม ${index} ช่อง แต่มีคำตอบ ${answers.length} คำตอบ (ต้องเท่ากัน)`
  }

  if (hasFiles) {
    return { code: null, files: builtFiles, blankTypes, blanks: index, ok: !errorMsg, errorMsg }
  }
  return { code: builtFiles[0]?.code ?? '', files: null, blankTypes, blanks: index, ok: !errorMsg, errorMsg }
}

export default function ImportPage() {
  const supabase = createClient()

  // ── JSON input / validation ─────────────────────────────
  const [jsonInput, setJsonInput] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [saveMode, setSaveMode] = useState<'replace' | 'append'>('replace')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ text: string; ok: boolean } | null>(null)

  // ── รายการข้อสอบที่มีอยู่แล้ว ─────────────────────────────
  const [subjects, setSubjects] = useState<string[]>([])
  const [existingSets, setExistingSets] = useState<ExistingSetRow[]>([])
  const [isLoadingExisting, setIsLoadingExisting] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [deletingSubject, setDeletingSubject] = useState<string | null>(null)

  // ── preview ──────────────────────────────────────────────────
  const [previewSet, setPreviewSet] = useState<ExamSetPreviewData | null>(null)
  const [previewMode, setPreviewMode] = useState<'student' | 'answer'>('student')
  const [previewFileIndex, setPreviewFileIndex] = useState(0)
  const [loadingPreviewKey, setLoadingPreviewKey] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // ── เพิ่มวิชาใหม่ ──────────────────────────────────────────
  const [showAddSubjectModal, setShowAddSubjectModal] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectDescription, setNewSubjectDescription] = useState('')
  const [isCreatingSubject, setIsCreatingSubject] = useState(false)
  const [addSubjectError, setAddSubjectError] = useState('')

  useEffect(() => {
    loadExisting()
  }, [])

  async function loadExisting() {
    setIsLoadingExisting(true)
    try {
      const [{ data: subjectRows }, setsResult] = await Promise.all([
        supabase.from('subjects').select('name').eq('is_active', true).order('name'),
        listExamSets(),
      ])
      setSubjects((subjectRows || []).map((s: any) => s.name))
      setExistingSets(setsResult.success ? setsResult.sets : [])
      if (!setsResult.success) console.error('โหลดรายการข้อสอบที่มีอยู่ไม่สำเร็จ:', setsResult.error)
    } catch (err) {
      console.error('โหลดรายการข้อสอบที่มีอยู่ไม่สำเร็จ:', err)
    } finally {
      setIsLoadingExisting(false)
    }
  }

  // ── ตรวจสอบ JSON ───────────────────────────────────────
  function handleValidate() {
    setSaveMessage(null)
    const raw = jsonInput.trim()
    if (!raw) {
      setValidation({ valid: false, projectName: '', sets: [], errorMsg: 'กรุณาวาง JSON ก่อนกดตรวจสอบ' })
      return
    }

    let data: any
    try {
      data = JSON.parse(raw)
    } catch (err: any) {
      setValidation({ valid: false, projectName: '', sets: [], errorMsg: 'JSON ไม่ถูกต้อง: ' + err.message })
      return
    }

    if (!data.project_name || !data.sets || typeof data.sets !== 'object') {
      setValidation({ valid: false, projectName: '', sets: [], errorMsg: 'โครงสร้างไม่ถูกต้อง ต้องมี "project_name" และ "sets"' })
      return
    }

    const setNames = Object.keys(data.sets)
    if (setNames.length === 0) {
      setValidation({ valid: false, projectName: data.project_name, sets: [], errorMsg: '"sets" ต้องมีอย่างน้อย 1 ชุด' })
      return
    }

    const parsedSets: ParsedSet[] = setNames.map(setName => {
      const set = data.sets[setName] || {}
      const answers: string[] = Array.isArray(set.answers) ? set.answers : []
      const built = buildSetFromRaw(set, answers)
      return {
        setName,
        title: set.title || '(ไม่มีชื่อชุด)',
        code: built.code,
        files: built.files,
        answers,
        blankTypes: built.blankTypes,
        blanks: built.blanks,
        ok: built.ok,
        errorMsg: built.errorMsg,
      }
    })

    const firstError = parsedSets.find(s => !s.ok)
    setValidation({
      valid: !firstError,
      projectName: data.project_name,
      sets: parsedSets,
      errorMsg: firstError ? `${firstError.setName}: ${firstError.errorMsg}` : undefined,
    })
  }

  // ── บันทึกลง Database ────────────────────────────────────
  async function handleSave() {
    if (!validation || !validation.valid) return
    setIsSaving(true)
    setSaveMessage(null)

    const setNames = validation.sets.map(s => s.setName)
    const rows = validation.sets.map(s => ({
      project_name: validation.projectName,
      set_name: s.setName,
      question_order: 0,
      type: 'fill',
      question: s.title,
      code: s.code,
      files: s.files,
      answers: s.answers,
      blank_types: s.blankTypes.some(b => b) ? s.blankTypes : null,
    }))

    const result = await saveExamQuestions(validation.projectName, setNames, saveMode, rows)

    if (result.success) {
      setSaveMessage({ text: `บันทึกสำเร็จ ${result.savedCount} ชุด สำหรับวิชา "${validation.projectName}"`, ok: true })
      setJsonInput('')
      setValidation(null)
      loadExisting()
    } else {
      setSaveMessage({ text: 'บันทึกไม่สำเร็จ: ' + result.error, ok: false })
    }
    setIsSaving(false)
  }

  // ── เพิ่มวิชาใหม่ ──────────────────────────────────────────
  function openAddSubjectModal(prefillName?: string) {
    setNewSubjectName(prefillName || '')
    setNewSubjectDescription('')
    setAddSubjectError('')
    setShowAddSubjectModal(true)
  }

  async function handleCreateSubject() {
    setIsCreatingSubject(true)
    setAddSubjectError('')
    const result = await createSubject(newSubjectName, newSubjectDescription)
    if (result.success) {
      setShowAddSubjectModal(false)
      await loadExisting()
    } else {
      setAddSubjectError(result.error)
    }
    setIsCreatingSubject(false)
  }

  // ── ลบชุดข้อสอบ ───────────────────────────────────────────
  async function handleDeleteSet(projectName: string, setName: string) {
    const key = `${projectName}::${setName}`
    setDeletingKey(key)
    try {
      const { count } = await supabase.from('exam_results')
        .select('id', { count: 'exact', head: true })
        .eq('project_name', projectName).eq('exam_set', setName)

      const warning = count && count > 0
        ? `\n\n⚠️ มีนักศึกษาส่งข้อสอบชุดนี้ไปแล้ว ${count} คน โหมดทบทวนเฉลยของพวกเขาจะใช้งานไม่ได้ทันทีถ้าลบ`
        : ''

      if (!confirm(`ยืนยันลบ "${setName}" ของวิชา "${projectName}"?${warning}`)) {
        setDeletingKey(null)
        return
      }

      const result = await deleteExamQuestionSet(projectName, setName)
      if (!result.success) throw new Error(result.error)

      await loadExisting()
    } catch (err: any) {
      alert('ลบไม่สำเร็จ: ' + err.message)
    } finally {
      setDeletingKey(null)
    }
  }

  // ── ลบทั้งวิชา ──────────────────────────────────────────────
  async function handleDeleteSubject(subjectName: string) {
    setDeletingSubject(subjectName)
    try {
      const { count } = await supabase.from('exam_results')
        .select('id', { count: 'exact', head: true }).eq('project_name', subjectName)

      const setCount = existingSets.filter(s => s.project_name === subjectName).length
      const warning = count && count > 0
        ? `\n\n⚠️ มีนักศึกษาส่งข้อสอบวิชานี้ไปแล้ว ${count} คน โหมดทบทวนเฉลยของพวกเขาจะใช้งานไม่ได้ทันทีถ้าลบ`
        : ''

      if (!confirm(`ยืนยันลบวิชา "${subjectName}" ทั้งหมด?\n\nจะลบข้อสอบทุกชุด (${setCount} ชุด) และเอาวิชานี้ออกจากตัวเลือกที่นักศึกษาเลือกได้ทันที${warning}`)) {
        setDeletingSubject(null)
        return
      }

      const result = await deleteSubject(subjectName)
      if (!result.success) throw new Error(result.error)

      await loadExisting()
    } catch (err: any) {
      alert('ลบวิชาไม่สำเร็จ: ' + err.message)
    } finally {
      setDeletingSubject(null)
    }
  }

  // ── fill หรือ clear คำตอบใน preview container เมื่อ mode/ไฟล์เปลี่ยน ──
  useEffect(() => {
    const container = previewRef.current
    if (!container || !previewSet) return
    previewSet.answers.forEach((ans, i) => {
      const el = container.querySelector(`#q${i}`) as HTMLInputElement | HTMLSelectElement | null
      if (!el) return
      el.value = previewMode === 'answer' ? ans : ''
    })
  }, [previewMode, previewSet, previewFileIndex])

  async function handlePreview(projectName: string, setName: string) {
    const key = `${projectName}::${setName}`
    setLoadingPreviewKey(key)
    const result = await getExamSetPreview(projectName, setName)
    setLoadingPreviewKey(null)
    if (!result.success) { alert('โหลด preview ไม่สำเร็จ: ' + result.error); return }
    setPreviewSet(result.set)
    setPreviewMode('student')
    setPreviewFileIndex(0)
  }

  const groupedExisting = subjects.map(name => ({
    projectName: name,
    sets: existingSets.filter(s => s.project_name === name),
  }))

  // ── Render: main ────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F5F5F7] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">📥 นำเข้าข้อสอบ (JSON Import)</h1>
            <p className="text-sm text-gray-500 mt-1">วาง JSON ที่ได้จาก Claude แล้วตรวจสอบก่อนบันทึกลงระบบ</p>
          </div>
          <button
            onClick={() => signOutTeacher()}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-gray-700 font-medium rounded-xl transition active:scale-95 text-sm shadow-sm"
          >
            🚪 ออกจากระบบ
          </button>
        </div>

        <div className="bg-white rounded-3xl border border-gray-200 p-6 mb-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">วาง JSON ข้อสอบ</label>
          <textarea
            value={jsonInput}
            onChange={e => { setJsonInput(e.target.value); setValidation(null); setSaveMessage(null) }}
            placeholder='{ "project_name": "...", "sets": { "set_1": {...} } }'
            className="w-full min-h-[180px] p-4 rounded-2xl border border-gray-200 font-mono text-xs leading-relaxed text-gray-700 bg-gray-50 focus:outline-none focus:border-blue-500 transition resize-y"
          />
          <button
            onClick={handleValidate}
            className="w-full mt-4 py-3.5 bg-[#0071E3] hover:bg-[#0077ED] text-white font-medium rounded-2xl transition active:scale-[0.98]"
          >
            ตรวจสอบ
          </button>
        </div>

        {validation && (
          <div className="mb-4">
            {!validation.valid && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-3">
                <p className="text-sm font-medium text-red-900">⚠️ {validation.errorMsg}</p>
              </div>
            )}

            {validation.valid && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-3">
                <p className="text-sm font-medium text-green-900">✓ ตรวจสอบผ่าน พร้อมบันทึก {validation.sets.length} ชุด สำหรับวิชา "{validation.projectName}"</p>
              </div>
            )}

            {validation.valid && !subjects.includes(validation.projectName) && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-3 flex items-center justify-between gap-3">
                <p className="text-sm text-orange-900">⚠️ ยังไม่มีวิชา "{validation.projectName}" ในระบบ ต้องสร้างก่อนถึงจะบันทึกข้อสอบได้</p>
                <button
                  onClick={() => openAddSubjectModal(validation.projectName)}
                  className="shrink-0 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded-lg transition active:scale-95 whitespace-nowrap"
                >
                  + สร้างวิชานี้
                </button>
              </div>
            )}

            {validation.sets.length > 0 && (
              <div className="bg-white rounded-3xl border border-gray-200 p-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">พรีวิว: {validation.projectName}</p>
                <div className="divide-y divide-gray-100">
                  {validation.sets.map(s => (
                    <div key={s.setName} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={s.ok ? 'text-green-600' : 'text-red-500'}>{s.ok ? '✓' : '✕'}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.setName}</p>
                          <p className="text-xs text-gray-400 truncate max-w-[280px]">{s.title}</p>
                        </div>
                      </div>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {s.files && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full whitespace-nowrap">📁 {s.files.length} ไฟล์</span>
                        )}
                        {s.blankTypes.some(b => b) && (
                          <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full whitespace-nowrap">
                            🔽 {s.blankTypes.filter(b => b).length} dropdown
                          </span>
                        )}
                        <span className={`text-xs whitespace-nowrap ${s.ok ? 'text-gray-500' : 'text-red-500'}`}>
                          {s.blanks} ช่อง / {s.answers.length} คำตอบ
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                {validation.valid && (
                  <>
                    <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gray-100">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="radio" name="saveMode" checked={saveMode === 'replace'} onChange={() => setSaveMode('replace')} className="accent-blue-600" />
                        แทนที่ทั้งหมด
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="radio" name="saveMode" checked={saveMode === 'append'} onChange={() => setSaveMode('append')} className="accent-blue-600" />
                        เพิ่มเติม
                      </label>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      {saveMode === 'replace'
                        ? `ลบข้อสอบเดิมทั้งหมดของวิชา "${validation.projectName}" ก่อนบันทึกชุดใหม่`
                        : 'บันทึกเฉพาะชุดที่ชื่อซ้ำกับของเดิมจะถูกแทนที่ ชุดอื่นไม่กระทบ'}
                    </p>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="w-full mt-4 py-3.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium rounded-2xl transition active:scale-[0.98]"
                    >
                      {isSaving ? 'กำลังบันทึก...' : 'บันทึกลง Database'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {saveMessage && (
          <div className={`rounded-2xl p-4 mb-4 border ${saveMessage.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
            <p className="text-sm font-medium">{saveMessage.ok ? '✓' : '⚠️'} {saveMessage.text}</p>
          </div>
        )}

        <div className="bg-white rounded-3xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ข้อสอบที่มีอยู่แล้วในระบบ</p>
            <div className="flex items-center gap-3">
              <button onClick={() => openAddSubjectModal()} className="text-xs text-blue-600 hover:text-blue-700 font-medium transition">+ เพิ่มวิชาใหม่</button>
              <button onClick={loadExisting} className="text-xs text-gray-400 hover:text-gray-600 transition">🔄 รีเฟรช</button>
            </div>
          </div>

          {isLoadingExisting ? (
            <p className="text-sm text-gray-400 py-4 text-center">กำลังโหลด...</p>
          ) : (
            <div className="space-y-4">
              {groupedExisting.map(group => (
                <div key={group.projectName}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900">{group.projectName}</span>
                    <div className="flex items-center gap-2">
                      {group.sets.length === 0 ? (
                        <span className="text-xs text-orange-700 bg-orange-50 px-2.5 py-1 rounded-full">ยังไม่มีข้อสอบ</span>
                      ) : (
                        <span className="text-xs text-green-700 bg-green-50 px-2.5 py-1 rounded-full">{group.sets.length} ชุด</span>
                      )}
                      <button
                        onClick={() => handleDeleteSubject(group.projectName)}
                        disabled={deletingSubject === group.projectName}
                        title="ลบวิชานี้ทั้งหมด (ข้อสอบทุกชุด + เอาวิชาออกจากระบบ)"
                        className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-60 border border-red-200 text-red-500 rounded-lg transition active:scale-95 text-xs shrink-0"
                      >
                        {deletingSubject === group.projectName ? '⏳' : '🗑️ ลบวิชา'}
                      </button>
                    </div>
                  </div>
                  {group.sets.length > 0 && (
                    <div className="space-y-1.5">
                      {group.sets.map(s => {
                        const key = `${s.project_name}::${s.set_name}`
                        return (
                          <div key={key} className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 rounded-xl">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700">{s.set_name}</p>
                              <p className="text-xs text-gray-400 truncate max-w-[320px]">{s.question}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => handlePreview(s.project_name, s.set_name)}
                                disabled={loadingPreviewKey === key}
                                title="พรีวิวข้อสอบ"
                                className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 border border-blue-200 text-blue-600 rounded-lg transition active:scale-95 text-xs"
                              >
                                {loadingPreviewKey === key ? '⏳' : '👁️'}
                              </button>
                              <button
                                onClick={() => handleDeleteSet(s.project_name, s.set_name)}
                                disabled={deletingKey === key}
                                title="ลบชุดข้อสอบนี้"
                                className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-60 border border-red-200 text-red-500 rounded-lg transition active:scale-95 text-xs"
                              >
                                {deletingKey === key ? '⏳' : '🗑️'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewSet && (() => {
        const isMultiFile = Array.isArray(previewSet.files) && previewSet.files.length > 0
        const currentCode = isMultiFile
          ? (previewSet.files![previewFileIndex]?.code ?? '')
          : (previewSet.code ?? '')
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{previewSet.project_name} / {previewSet.set_name}</p>
                  <h2 className="text-base font-semibold text-gray-900 mt-0.5 truncate">{previewSet.title}</h2>
                </div>
                <button
                  onClick={() => setPreviewSet(null)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition text-lg"
                >
                  ✕
                </button>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 shrink-0">
                <span className="text-xs font-semibold text-gray-500">โหมด:</span>
                <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-medium">
                  <button
                    onClick={() => setPreviewMode('student')}
                    className={`px-3 py-1.5 transition ${previewMode === 'student' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    นักศึกษา
                  </button>
                  <button
                    onClick={() => setPreviewMode('answer')}
                    className={`px-3 py-1.5 transition ${previewMode === 'answer' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    เฉลย
                  </button>
                </div>
                <span className="text-xs text-gray-400">{previewSet.answers.length} ช่อง</span>
              </div>

              {/* File tabs (multi-file only) */}
              {isMultiFile && (
                <div className="flex gap-1.5 px-6 py-2 border-b border-gray-100 overflow-x-auto shrink-0">
                  {previewSet.files!.map((f, i) => (
                    <button
                      key={i}
                      onClick={() => setPreviewFileIndex(i)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition whitespace-nowrap ${
                        i === previewFileIndex
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {f.filename}
                    </button>
                  ))}
                </div>
              )}

              {/* Code area */}
              <div className="overflow-auto flex-1 p-6 bg-[#1E1E1E] rounded-b-3xl">
                <div
                  ref={previewRef}
                  className="font-mono text-sm text-gray-300 leading-relaxed whitespace-pre-wrap [&_.hint-btn]:pointer-events-none [&_.hint-btn]:opacity-30"
                  dangerouslySetInnerHTML={{ __html: currentCode }}
                />
              </div>
            </div>
          </div>
        )
      })()}

      {/* Add Subject Modal */}
      {showAddSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">➕ เพิ่มวิชาใหม่</h2>
            <p className="text-sm text-gray-500 mt-1">ชื่อวิชาต้องตรงกับ "project_name" ใน JSON ที่จะ import เป๊ะ</p>

            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mt-4 mb-1.5">ชื่อวิชา (project_name)</label>
            <input
              type="text"
              value={newSubjectName}
              onChange={e => setNewSubjectName(e.target.value)}
              autoFocus
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 font-mono"
              placeholder="เช่น FirebaseSetup"
            />

            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mt-4 mb-1.5">ชื่อที่แสดงผล (ไม่บังคับ)</label>
            <input
              type="text"
              value={newSubjectDescription}
              onChange={e => setNewSubjectDescription(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              placeholder="เช่น การตั้งค่า Firebase (ถ้าเว้นว่างจะใช้ชื่อวิชาแทน)"
            />

            {addSubjectError && (
              <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm font-medium rounded-xl border border-red-100">
                {addSubjectError}
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowAddSubjectModal(false)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleCreateSubject}
                disabled={isCreatingSubject || !newSubjectName.trim()}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium rounded-xl transition"
              >
                {isCreatingSubject ? 'กำลังสร้าง...' : 'สร้างวิชา'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
