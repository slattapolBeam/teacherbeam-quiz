'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getExamSession } from '@/app/actions/session'
import { logActivity } from '@/lib/auditLog'

const TOLERANCE_MS = 500      // server-side grace for victim defense
const COOLDOWN_MS = 30_000
const MAX_PER_SESSION = 5
const MIN_LEN = 4
const MAX_TOKENS = 3

function isTrivial(s: string): boolean {
  if (s.length < MIN_LEN) return true
  // pure operators / punctuation only
  if (/^[+\-*\/=!<>&|^~?:;,.\s"'`()[\]{}\\]+$/.test(s)) return true
  // empty or quoted-empty
  if (/^["'`]{0,2}$/.test(s.trim())) return true
  return false
}

// ─────────────────────────────────────────────
// INITIATE — attacker bets 1 token, pick victim + snippet, broadcast attack
// ─────────────────────────────────────────────
export type InitiateResult =
  | { success: true; heistId: number; snippet: string; victimName: string; heistWindowSecs: number }
  | { success: false; error: string }

export async function initiateHeist(): Promise<InitiateResult> {
  const session = await getExamSession()
  if (!session || session.mode !== 'exam')
    return { success: false, error: 'session หมดอายุหรือไม่ถูกต้อง' }
  if (!session.pin_code)
    return { success: false, error: 'ไม่พบ pin_code ใน session กรุณา login ใหม่' }

  const supabase = createServiceClient()
  const { student_id, project_name, room, class_number, pin_code } = session
  const heistWindowMs = (session.heist_window_seconds ?? 10) * 1000

  // 1. Token balance
  const { data: attacker } = await supabase
    .from('students').select('super_tokens').eq('student_id', student_id).single()
  if (!attacker || attacker.super_tokens < 1)
    return { success: false, error: 'ต้องมี Super Token ≥1 ก่อนปล้น' }

  // 2. Cooldown (30 s)
  const { count: recentCount } = await supabase
    .from('token_heist_log').select('id', { count: 'exact', head: true })
    .eq('attacker_id', student_id).eq('project_name', project_name)
    .gte('created_at', new Date(Date.now() - COOLDOWN_MS).toISOString())
  if ((recentCount ?? 0) > 0)
    return { success: false, error: `Cooldown ยังไม่หมด (${COOLDOWN_MS / 1000} วินาทีระหว่างครั้ง)` }

  // 3. Max 5 per session (last 4 h)
  const { count: totalCount } = await supabase
    .from('token_heist_log').select('id', { count: 'exact', head: true })
    .eq('attacker_id', student_id).eq('project_name', project_name)
    .gte('created_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
  if ((totalCount ?? 0) >= MAX_PER_SESSION)
    return { success: false, error: `ปล้นครบ ${MAX_PER_SESSION} ครั้งแล้วในรอบนี้` }

  // 4. Valid targets: same room, not self, ≥1 token
  const { data: candidates } = await supabase
    .from('students')
    .select('student_id, first_name, last_name, class_number, super_tokens')
    .eq('room', room).neq('student_id', student_id).gte('super_tokens', 1)
  if (!candidates?.length)
    return { success: false, error: 'ไม่มีเป้าหมายที่มีเหรียญในห้องนี้' }

  const { data: submitted } = await supabase
    .from('exam_results').select('student_id').eq('project_name', project_name)
  const submittedSet = new Set((submitted ?? []).map((r: any) => r.student_id as string))

  // victims ที่ attacker เคย target แล้ว (ปล้นได้แค่คนละ 1 ครั้ง)
  const { data: alreadyTargeted } = await supabase
    .from('token_heist_log').select('victim_id')
    .eq('attacker_id', student_id).eq('project_name', project_name)
  const targetedSet = new Set((alreadyTargeted ?? []).map((r: any) => r.victim_id as string))

  const valid = candidates.filter((c: any) =>
    !submittedSet.has(c.student_id) && !targetedSet.has(c.student_id)
  )
  if (!valid.length)
    return { success: false, error: 'ไม่มีเป้าหมายที่ถูกต้องในขณะนี้ (ส่งข้อสอบแล้ว หรือ Protection window)' }

  const victim = valid[Math.floor(Math.random() * valid.length)]

  // 5. Snippet from a DIFFERENT set than victim's current set
  const { data: allSets } = await supabase
    .from('exam_questions').select('set_name, answers').eq('project_name', project_name)

  let snippet = ''
  if (allSets?.length) {
    const setNames = [...new Set(allSets.map((r: any) => r.set_name as string))].sort()
    const victimSet = setNames[(victim.class_number ?? 0) % setNames.length]
    const others = allSets.filter((r: any) => r.set_name !== victimSet)
    const pool = (others.length ? others : allSets)
      .flatMap((r: any) => (r.answers as string[]) ?? [])
      .filter(s => !isTrivial(s))
    if (pool.length) snippet = pool[Math.floor(Math.random() * pool.length)]
  }
  if (!snippet)
    return { success: false, error: 'ไม่สามารถสร้างโจทย์พิมพ์ได้ในขณะนี้' }

  // 6. session_id in token_heist_log is bigint — exam_sessions.id is UUID so can't use it;
  //    pass 0 as a placeholder (column has no FK constraint, just NOT NULL)
  const sessionId = 0

  // 7. Deduct token atomically (optimistic lock on current value)
  const { data: deducted } = await supabase
    .from('students')
    .update({ super_tokens: attacker.super_tokens - 1 })
    .eq('student_id', student_id).eq('super_tokens', attacker.super_tokens)
    .select('super_tokens').maybeSingle()
  if (!deducted)
    return { success: false, error: 'ยอด Token เปลี่ยนแปลงระหว่างดำเนินการ ลองอีกครั้ง' }

  // 8. Insert heist record
  const { data: heistRow, error: heistErr } = await supabase
    .from('token_heist_log').insert([{
      session_id: sessionId,
      project_name,
      attacker_id: student_id,
      victim_id: victim.student_id,
      snippet,
      outcome: 'pending',
      stake_amount: 1,
    }]).select('id').single()

  if (heistErr || !heistRow) {
    await supabase.from('students')
      .update({ super_tokens: attacker.super_tokens }).eq('student_id', student_id)
    return { success: false, error: `บันทึกการปล้นไม่สำเร็จ: ${heistErr?.message ?? 'ไม่มีข้อมูลแถว'}` }
  }

  // 9. Broadcast to victim via HTTP (no subscribe — avoids WebSocket race in server actions)
  const deadline = new Date(Date.now() + heistWindowMs).toISOString()
  try {
    await supabase.channel('heist-broadcast').send({
      type: 'broadcast', event: 'heist_attack',
      payload: {
        victim_id: victim.student_id,
        heist_id: heistRow.id,
        snippet,
        attacker_name: session.full_name,
        deadline,
      },
    })
  } catch {
    // non-fatal — victim fallback-polls every 2 s anyway
  }

  await logActivity({ type: 'student', id: student_id }, 'heist_initiated', project_name, {
    victim_id: victim.student_id, heist_id: heistRow.id,
  })

  return {
    success: true,
    heistId: heistRow.id,
    snippet,
    victimName: `${victim.first_name} ${victim.last_name}`,
    heistWindowSecs: session.heist_window_seconds ?? 10,
  }
}

// ─────────────────────────────────────────────
// RESOLVE (attacker side) — called after the heist window elapses
// ─────────────────────────────────────────────
export type ResolveResult =
  | { success: true; outcome: 'success' | 'already_resolved'; tokensGained: number }
  | { success: false; error: string }

export async function resolveHeistAttacker(heistId: number): Promise<ResolveResult> {
  const session = await getExamSession()
  if (!session) return { success: false, error: 'session หมดอายุ' }

  const supabase = createServiceClient()
  const heistWindowMs = (session.heist_window_seconds ?? 10) * 1000
  // created_at must be ≤ NOW() - window (window fully elapsed)
  const windowEnd = new Date(Date.now() - heistWindowMs).toISOString()

  const { data: updated } = await supabase
    .from('token_heist_log')
    .update({ outcome: 'success', resolved_at: new Date().toISOString() })
    .eq('id', heistId).eq('attacker_id', session.student_id).eq('outcome', 'pending')
    .lte('created_at', windowEnd)
    .select('victim_id, stake_amount').maybeSingle()

  if (!updated) {
    // Either already defended, or called too early
    return { success: true, outcome: 'already_resolved', tokensGained: 0 }
  }

  // Transfer: stake refund (+1) + steal 1 from victim (if still has ≥1)
  const { data: vicData } = await supabase
    .from('students').select('super_tokens').eq('student_id', updated.victim_id).single()

  let stolen = 0
  if (vicData && vicData.super_tokens >= 1) {
    await supabase.from('students')
      .update({ super_tokens: vicData.super_tokens - 1 })
      .eq('student_id', updated.victim_id).gte('super_tokens', 1)
    stolen = 1
  }

  const { data: atkData } = await supabase
    .from('students').select('super_tokens').eq('student_id', session.student_id).single()
  const gained = updated.stake_amount + stolen
  const newAtkTokens = Math.min((atkData?.super_tokens ?? 0) + gained, MAX_TOKENS)
  await supabase.from('students')
    .update({ super_tokens: newAtkTokens })
    .eq('student_id', session.student_id)

  await logActivity({ type: 'student', id: session.student_id }, 'heist_success', session.project_name, {
    heist_id: heistId, victim_id: updated.victim_id, gained,
  })

  return { success: true, outcome: 'success', tokensGained: gained }
}

// ─────────────────────────────────────────────
// DEFEND (victim side) — victim types the snippet to block the heist
// ─────────────────────────────────────────────
export type DefendResult =
  | { success: true; defended: boolean }
  | { success: false; error: string }

export async function defendHeist(heistId: number, typedText: string): Promise<DefendResult> {
  const session = await getExamSession()
  if (!session || session.mode !== 'exam')
    return { success: false, error: 'session หมดอายุหรือไม่ถูกต้อง' }

  const supabase = createServiceClient()

  const { data: row } = await supabase
    .from('token_heist_log')
    .select('snippet, outcome, created_at, stake_amount, attacker_id')
    .eq('id', heistId).eq('victim_id', session.student_id).maybeSingle()
  if (!row) return { success: false, error: 'ไม่พบข้อมูลการโจมตี' }
  if (row.outcome !== 'pending') return { success: true, defended: false }

  // Timing: victim must respond within the configured window + tolerance
  const heistWindowMs = (session.heist_window_seconds ?? 10) * 1000
  const elapsed = Date.now() - new Date(row.created_at).getTime()
  if (elapsed > heistWindowMs + TOLERANCE_MS) return { success: true, defended: false }

  // Exact case-sensitive match
  if (typedText !== row.snippet) return { success: true, defended: false }

  // Try to claim defended — outcome='pending' WHERE clause prevents double resolution atomically
  const { data: claimed } = await supabase
    .from('token_heist_log')
    .update({ outcome: 'defended', resolved_at: new Date().toISOString() })
    .eq('id', heistId).eq('victim_id', session.student_id).eq('outcome', 'pending')
    .select('stake_amount, attacker_id').maybeSingle()

  if (!claimed) return { success: true, defended: false } // race: attacker resolved first

  // Give stake to victim (capped at MAX_TOKENS)
  const { data: vicData } = await supabase
    .from('students').select('super_tokens').eq('student_id', session.student_id).single()
  await supabase.from('students')
    .update({ super_tokens: Math.min((vicData?.super_tokens ?? 0) + claimed.stake_amount, MAX_TOKENS) })
    .eq('student_id', session.student_id)

  await logActivity({ type: 'student', id: session.student_id }, 'heist_defended', session.project_name, {
    heist_id: heistId, attacker_id: claimed.attacker_id,
  })

  return { success: true, defended: true }
}

// ─────────────────────────────────────────────
// POLL — victim polls every ~2 s as fallback for missed broadcast
// ─────────────────────────────────────────────
export type PendingHeistInfo = {
  heistId: number
  snippet: string
  attackerName: string
  deadline: string
} | null

export async function getPendingHeistForVictim(): Promise<PendingHeistInfo> {
  const session = await getExamSession()
  if (!session || session.mode !== 'exam') return null

  const supabase = createServiceClient()
  const windowMs = (session.heist_window_seconds ?? 10) * 1000
  const cutoff = new Date(Date.now() - windowMs - 1000).toISOString()

  const { data: row } = await supabase
    .from('token_heist_log')
    .select('id, snippet, created_at, attacker_id')
    .eq('victim_id', session.student_id)
    .eq('outcome', 'pending')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!row) return null

  const { data: attacker } = await supabase
    .from('students').select('first_name, last_name')
    .eq('student_id', row.attacker_id).single()

  return {
    heistId: row.id,
    snippet: row.snippet,
    attackerName: attacker ? `${attacker.first_name} ${attacker.last_name}` : 'ผู้โจมตี',
    deadline: new Date(new Date(row.created_at).getTime() + windowMs).toISOString(),
  }
}
