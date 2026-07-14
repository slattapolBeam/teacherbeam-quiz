'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { saveExamQuestions, deleteExamQuestionSet, deleteSubject } from '@/app/actions/import'
import { signOutTeacher } from '@/app/actions/auth'

type ParsedSet = {
  setName: string
  title: string
  code: string
  answers: string[]
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

// ── แปลง "___" เป็น <input id="qN"> ตามลำดับ ────────────────
function buildCodeFromTemplate(template: string, answers: string[]): { code: string; blanks: number; ok: boolean; errorMsg?: string } {
  const blanks = (template.match(/___/g) || []).length
  if (blanks !== answers.length || blanks === 0) {
    return {
      code: '', blanks, ok: false,
      errorMsg: `พบ "___" ${blanks} ช่อง แต่มีคำตอบ ${answers.length} คำตอบ (ต้องเท่ากัน)`,
    }
  }
  let index = 0
  const code = template.replace(/___/g, () => {
    const width = Math.max(60, (answers[index]?.length || 4) * 11 + 40)
    const html = `<input type="text" class="code-input" style="width: ${width}px;" id="q${index}"><button class="hint-btn" onclick="useHint(${index})">💡</button>`
    index++
    return html
  })
  return { code, blanks, ok: true }
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

  useEffect(() => {
    loadExisting()
  }, [])

  async function loadExisting() {
    setIsLoadingExisting(true)
    try {
      const [{ data: subjectRows }, { data: setRows }] = await Promise.all([
        supabase.from('subjects').select('name').eq('is_active', true).order('name'),
        supabase.from('exam_questions').select('project_name, set_name, question').order('project_name').order('set_name'),
      ])
      setSubjects((subjectRows || []).map((s: any) => s.name))
      setExistingSets(setRows || [])
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
      const built = buildCodeFromTemplate(String(set.code || ''), answers)
      return {
        setName,
        title: set.title || '(ไม่มีชื่อชุด)',
        code: built.code,
        answers,
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
      answers: s.answers,
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
                      <span className={`text-xs whitespace-nowrap ${s.ok ? 'text-gray-500' : 'text-red-500'}`}>
                        {s.blanks} ช่อง / {s.answers.length} คำตอบ
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
            <button onClick={loadExisting} className="text-xs text-gray-400 hover:text-gray-600 transition">🔄 รีเฟรช</button>
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
                            <button
                              onClick={() => handleDeleteSet(s.project_name, s.set_name)}
                              disabled={deletingKey === key}
                              title="ลบชุดข้อสอบนี้"
                              className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-60 border border-red-200 text-red-500 rounded-lg transition active:scale-95 text-xs shrink-0"
                            >
                              {deletingKey === key ? '⏳' : '🗑️'}
                            </button>
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
    </div>
  )
}
