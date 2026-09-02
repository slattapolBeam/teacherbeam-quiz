'use client'

import { useState, useEffect, useRef } from 'react'
import { resolveHeistAttacker, defendHeist } from '@/app/actions/heist'

// ─────────────────────────────────────────────────────────
// ATTACKER modal — appears on the attacker's screen
// Counts down 7.5 s then resolves the heist
// ─────────────────────────────────────────────────────────
interface AttackerProps {
  heistId: number
  snippet: string
  victimName: string
  onDone: () => void
}

type AttackerPhase = 'countdown' | 'resolving' | 'success' | 'defended'

export function HeistAttackerModal({ heistId, snippet, victimName, onDone }: AttackerProps) {
  const TOTAL = 10
  const [secsLeft, setSecsLeft] = useState(TOTAL)
  const [phase, setPhase] = useState<AttackerPhase>('countdown')
  const [gained, setGained] = useState(0)
  const resolvedRef = useRef(false)

  useEffect(() => {
    const start = Date.now()
    const tick = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000
      const remaining = Math.max(0, TOTAL - elapsed)
      setSecsLeft(remaining)
      if (remaining <= 0) {
        clearInterval(tick)
        resolve()
      }
    }, 100)
    return () => clearInterval(tick)
  }, [])

  async function resolve() {
    if (resolvedRef.current) return
    resolvedRef.current = true
    setPhase('resolving')
    const result = await resolveHeistAttacker(heistId)
    if (!result.success || result.outcome === 'already_resolved') {
      setPhase('defended')
    } else {
      setGained(result.tokensGained)
      setPhase('success')
    }
  }

  const pct = (secsLeft / TOTAL) * 100
  const circleLen = 2 * Math.PI * 38
  const circleDash = (pct / 100) * circleLen

  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-gray-950/80 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-5 text-white text-center">
          <div className="text-3xl mb-1">🗡️</div>
          <h2 className="text-xl font-bold">กำลังปล้นเหรียญ!</h2>
          <p className="text-orange-100 text-sm mt-1">เป้าหมาย: <span className="font-semibold text-white">{victimName}</span></p>
        </div>

        {phase === 'countdown' || phase === 'resolving' ? (
          <div className="p-6 text-center">
            {/* Countdown ring */}
            <div className="relative flex justify-center mb-4" style={{ height: 96 }}>
              <svg width="96" height="96" className="rotate-[-90deg]">
                <circle cx="48" cy="48" r="38" stroke="#f3f4f6" strokeWidth="8" fill="none" />
                <circle
                  cx="48" cy="48" r="38"
                  stroke={secsLeft <= 2 ? '#ef4444' : '#f97316'}
                  strokeWidth="8" fill="none"
                  strokeDasharray={`${circleDash} ${circleLen}`}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 0.1s linear' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-mono font-bold text-gray-800">
                  {secsLeft.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Snippet preview */}
            <p className="text-xs text-gray-500 mb-2">โจทย์ที่เป้าหมายต้องพิมพ์:</p>
            <div className="bg-gray-900 text-green-400 font-mono text-sm px-4 py-3 rounded-xl text-left break-all leading-relaxed mb-4">
              {snippet}
            </div>

            <p className="text-sm text-gray-500">
              {phase === 'resolving' ? 'กำลังตรวจผล...' : 'รอให้เวลาหมดหรือเป้าหมายพิมพ์ผิด...'}
            </p>
          </div>
        ) : phase === 'success' ? (
          <div className="p-6 text-center">
            <div className="text-6xl mb-3">🪙</div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">ปล้นสำเร็จ!</h3>
            <p className="text-gray-500 text-sm mb-4">เป้าหมายพิมพ์ไม่ทัน</p>
            <div className="bg-green-50 border border-green-200 rounded-2xl py-4 mb-5">
              <span className="text-4xl font-black text-green-600">+{gained}</span>
              <p className="text-green-700 text-sm mt-1">Super Token</p>
            </div>
            <button
              onClick={onDone}
              className="w-full py-3 bg-gray-900 text-white font-semibold rounded-xl active:scale-95 transition"
            >
              รับรางวัลและทำข้อสอบต่อ
            </button>
          </div>
        ) : (
          <div className="p-6 text-center">
            <div className="text-6xl mb-3">🛡️</div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">ป้องกันสำเร็จ!</h3>
            <p className="text-gray-500 text-sm mb-5">เป้าหมายพิมพ์ทันและถูกต้อง คุณเสีย 1 เหรียญ</p>
            <button
              onClick={onDone}
              className="w-full py-3 bg-gray-900 text-white font-semibold rounded-xl active:scale-95 transition"
            >
              ปิด
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// VICTIM modal — appears on the victim's screen
// Shows typing challenge; victim has until deadline to defend
// ─────────────────────────────────────────────────────────
interface VictimProps {
  heistId: number
  snippet: string
  attackerName: string
  deadline: string   // ISO timestamp
  onDone: () => void
}

type VictimPhase = 'typing' | 'submitting' | 'defended' | 'failed'

export function HeistVictimModal({ heistId, snippet, attackerName, deadline, onDone }: VictimProps) {
  const [typed, setTyped] = useState('')
  const [secsLeft, setSecsLeft] = useState(0)
  const [phase, setPhase] = useState<VictimPhase>('typing')
  const [mismatch, setMismatch] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const resolvedRef = useRef(false)

  const TOTAL = Math.max(0, (new Date(deadline).getTime() - Date.now()) / 1000)
  const totalRef = useRef(TOTAL)

  useEffect(() => {
    inputRef.current?.focus()
    const tick = setInterval(() => {
      const remaining = Math.max(0, (new Date(deadline).getTime() - Date.now()) / 1000)
      setSecsLeft(remaining)
      if (remaining <= 0) {
        clearInterval(tick)
        if (!resolvedRef.current) {
          resolvedRef.current = true
          setPhase('failed')
        }
      }
    }, 100)
    return () => clearInterval(tick)
  }, [deadline])

  async function handleSubmit() {
    if (resolvedRef.current) return
    if (typed !== snippet) {
      setMismatch(true)
      setTimeout(() => setMismatch(false), 800)
      return
    }
    resolvedRef.current = true
    setPhase('submitting')
    const result = await defendHeist(heistId, typed)
    if (result.success && result.defended) {
      setPhase('defended')
    } else {
      setPhase('failed')
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit()
  }

  const pct = totalRef.current > 0 ? (secsLeft / totalRef.current) * 100 : 0
  const isUrgent = secsLeft < 3

  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-red-950/80 backdrop-blur-sm">
      <div className={`bg-white rounded-3xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden ${mismatch ? 'animate-shake' : ''}`}>
        {/* Header */}
        <div className={`px-6 py-5 text-white text-center transition-colors ${isUrgent && phase === 'typing' ? 'bg-red-600' : 'bg-gradient-to-r from-red-600 to-rose-500'}`}>
          <div className="text-3xl mb-1 animate-bounce">🚨</div>
          <h2 className="text-xl font-bold">ถูกโจมตี!</h2>
          <p className="text-red-100 text-sm mt-1">
            <span className="font-semibold text-white">{attackerName}</span> กำลังปล้นเหรียญคุณ!
          </p>
        </div>

        {phase === 'typing' || phase === 'submitting' ? (
          <div className="p-5">
            {/* Timer bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>เวลาป้องกัน</span>
                <span className={`font-mono font-bold ${isUrgent ? 'text-red-600' : 'text-gray-700'}`}>
                  {secsLeft.toFixed(1)}s
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${isUrgent ? 'bg-red-500' : 'bg-orange-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <p className="text-xs text-gray-500 mb-1">พิมพ์ข้อความต่อไปนี้ให้ถูกต้องทุกตัวอักษร (case-sensitive):</p>
            <div className="bg-gray-900 text-green-400 font-mono text-sm px-4 py-3 rounded-xl text-left break-all leading-relaxed mb-3">
              {snippet}
            </div>

            <input
              ref={inputRef}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={handleKey}
              disabled={phase === 'submitting'}
              placeholder="พิมพ์ที่นี่..."
              className={`w-full border-2 rounded-xl px-4 py-3 font-mono text-sm outline-none transition mb-3 ${
                mismatch ? 'border-red-500 bg-red-50' : 'border-gray-200 focus:border-orange-400 bg-gray-50'
              }`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />

            {mismatch && (
              <p className="text-xs text-red-600 text-center mb-2">ข้อความไม่ตรง ตรวจสอบตัวพิมพ์เล็ก/ใหญ่ด้วย</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={phase === 'submitting' || !typed}
              className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl active:scale-95 transition shadow-lg"
            >
              {phase === 'submitting' ? 'กำลังตรวจ...' : '🛡️ ป้องกัน!'}
            </button>
          </div>
        ) : phase === 'defended' ? (
          <div className="p-6 text-center">
            <div className="text-6xl mb-3">🛡️</div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">ป้องกันสำเร็จ!</h3>
            <p className="text-gray-500 text-sm mb-4">คุณพิมพ์ถูกต้องทันเวลา</p>
            <div className="bg-green-50 border border-green-200 rounded-2xl py-4 mb-5">
              <span className="text-4xl font-black text-green-600">+1</span>
              <p className="text-green-700 text-sm mt-1">Super Token (รับเดิมพันของผู้โจมตี)</p>
            </div>
            <button
              onClick={onDone}
              className="w-full py-3 bg-gray-900 text-white font-semibold rounded-xl active:scale-95 transition"
            >
              ทำข้อสอบต่อ
            </button>
          </div>
        ) : (
          <div className="p-6 text-center">
            <div className="text-6xl mb-3">💸</div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">ป้องกันไม่สำเร็จ</h3>
            <p className="text-gray-500 text-sm mb-5">
              {secsLeft <= 0 ? 'หมดเวลาพิมพ์แล้ว' : 'ข้อความไม่ถูกต้องหรือช้าเกินไป'} ผู้โจมตีขโมยเหรียญของคุณไป 1 เหรียญ
            </p>
            <button
              onClick={onDone}
              className="w-full py-3 bg-gray-900 text-white font-semibold rounded-xl active:scale-95 transition"
            >
              ปิด
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-shake { animation: shake 0.4s ease; }
      `}</style>
    </div>
  )
}
