'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getExamSession } from '@/app/actions/session'
import { logActivity } from '@/lib/auditLog'

const TOLERANCE_MS = 500      // server-side grace for victim defense
const COOLDOWN_MS = 30_000
const MAX_PER_SESSION = 5
const MIN_LEN = 4
const MAX_LEN = 40
const ACTIVE_MS = 20_000      // victim ต้องมี heartbeat ภายในช่วงนี้ (client ส่งทุก ~6 วิ)
const MAX_TOKENS = 3
const VICTIM_COOLDOWN_MS = 60_000  // เหยื่อที่เพิ่งถูกปล้น (หรือกำลังถูกปล้น) พักจากการเป็นเป้าหมาย
const VICTIM_FLOOR = 1        // เหยื่อต้องเหลือเหรียญอย่างน้อยเท่านี้ — ปล้นได้เฉพาะคนที่มี > FLOOR

// ต้องพิมพ์ในช่อง input บรรทัดเดียวได้ และมองเห็นครบทุกตัวอักษรใน UI
function isUntypeable(s: string): boolean {
  if (s.length > MAX_LEN) return true
  if (s !== s.trim()) return true                 // ช่องว่างหัว/ท้าย มองไม่เห็นใน UI
  if (/\s{2,}/.test(s)) return true               // ช่องว่างซ้อน HTML จะยุบเหลือตัวเดียว
  if (/\p{C}/u.test(s)) return true               // control / newline / tab / invisible chars
  return false
}

function isTrivial(s: string): boolean {
  if (isUntypeable(s)) return true
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
  | { success: true; heistId: number; snippet: string; victimName: string; heistWindowSecs: number; deadline: string; serverNow: string }
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
    .eq('room', room).neq('student_id', student_id).gte('super_tokens', VICTIM_FLOOR + 1)
  if (!candidates?.length)
    return { success: false, error: 'ไม่มีเป้าหมายที่มีเหรียญเหลือพอให้ปล้นในห้องนี้ (เหยื่อต้องมี ≥2 เหรียญ)' }

  const { data: submitted } = await supabase
    .from('exam_results').select('student_id').eq('project_name', project_name)
  const submittedSet = new Set((submitted ?? []).map((r: any) => r.student_id as string))

  // victims ที่ attacker เคย target แล้ว (ปล้นได้แค่คนละ 1 ครั้ง)
  const { data: alreadyTargeted } = await supabase
    .from('token_heist_log').select('victim_id')
    .eq('attacker_id', student_id).eq('project_name', project_name)
  const targetedSet = new Set((alreadyTargeted ?? []).map((r: any) => r.victim_id as string))

  // victims ที่กำลังถูกปล้นอยู่ (heist pending ยังอยู่ในหน้าต่างเวลา) — ป้องกันได้ทีละอันเท่านั้น
  const { data: underAttack } = await supabase
    .from('token_heist_log').select('victim_id')
    .eq('project_name', project_name).eq('outcome', 'pending')
    .gte('created_at', new Date(Date.now() - heistWindowMs - TOLERANCE_MS).toISOString())
  const underAttackSet = new Set((underAttack ?? []).map((r: any) => r.victim_id as string))

  // victims ที่เพิ่งถูกปล้นสำเร็จ — ให้พัก VICTIM_COOLDOWN_MS ก่อนเป็นเป้าหมายอีก (กันโดนรุมจนหมดตัว)
  const { data: recentlyRobbed } = await supabase
    .from('token_heist_log').select('victim_id')
    .eq('project_name', project_name).eq('outcome', 'success')
    .gte('resolved_at', new Date(Date.now() - VICTIM_COOLDOWN_MS).toISOString())
  for (const r of recentlyRobbed ?? []) underAttackSet.add((r as any).victim_id as string)

  // เฉพาะ นศ. ที่เข้าสอบจริงด้วย PIN นี้ (มี exam_session_start ใน activity_logs)
  let participantSet: Set<string> | null = null
  try {
    const { data: participants } = await supabase
      .from('activity_logs')
      .select('actor_id')
      .eq('actor_type', 'student')
      .eq('action', 'exam_session_start')
      .eq('target', project_name)
      .filter('metadata->>pin', 'eq', pin_code)
    if (participants) participantSet = new Set(participants.map((r: any) => r.actor_id as string))
  } catch {}

  // เฉพาะคนที่ยังเปิดหน้าสอบอยู่ (heartbeat ล่าสุด) — คนปิดแท็บ/เน็ตหลุดป้องกันไม่ได้ จึงไม่ควรเป็นเหยื่อ
  // ถ้า query ล้ม (เช่นยังไม่ได้สร้างตาราง exam_presence) ให้ข้ามตัวกรองนี้ ไม่ให้ระบบ heist ใช้ไม่ได้ทั้งหมด
  const { data: presence, error: presenceErr } = await supabase
    .from('exam_presence').select('student_id')
    .eq('project_name', project_name)
    .gte('last_seen_at', new Date(Date.now() - ACTIVE_MS).toISOString())
  const activeSet = presenceErr ? null : new Set((presence ?? []).map((r: any) => r.student_id as string))

  const valid = candidates.filter((c: any) =>
    !submittedSet.has(c.student_id) &&
    !targetedSet.has(c.student_id) &&
    !underAttackSet.has(c.student_id) &&
    (activeSet === null || activeSet.has(c.student_id)) &&
    (participantSet === null || participantSet.has(c.student_id))
  )
  if (!valid.length)
    return { success: false, error: 'ไม่มีเป้าหมายที่ถูกต้องในขณะนี้ (ส่งข้อสอบแล้ว, ออฟไลน์, ถูกปล้นไปแล้ว กำลังถูกคนอื่นปล้นอยู่ หรือเพิ่งถูกปล้นไปไม่นาน)' }

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
    await supabase.rpc('grant_super_tokens', { p_student_id: student_id, p_amount: 1, p_max: MAX_TOKENS })
    return { success: false, error: `บันทึกการปล้นไม่สำเร็จ: ${heistErr?.message ?? 'ไม่มีข้อมูลแถว'}` }
  }

  // 8b. กันสองคนเลือกเหยื่อคนเดียวกันพร้อมกัน (การเช็ก underAttackSet ข้างบนไม่ atomic)
  //     ถ้ามี heist pending ของเหยื่อคนนี้ที่ id น้อยกว่า = เขามาก่อน เราถอนตัว คืนเหรียญ
  const { count: earlier } = await supabase
    .from('token_heist_log').select('id', { count: 'exact', head: true })
    .eq('victim_id', victim.student_id).eq('project_name', project_name).eq('outcome', 'pending')
    .lt('id', heistRow.id)
    .gte('created_at', new Date(Date.now() - heistWindowMs - TOLERANCE_MS).toISOString())
  if ((earlier ?? 0) > 0) {
    await supabase.from('token_heist_log').delete().eq('id', heistRow.id)
    await supabase.rpc('grant_super_tokens', { p_student_id: student_id, p_amount: 1, p_max: MAX_TOKENS })
    return { success: false, error: 'เป้าหมายถูกคนอื่นปล้นพร้อมกันพอดี ลองกดปล้นอีกครั้ง (คืนเหรียญให้แล้ว)' }
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
        server_now: new Date().toISOString(),
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
    deadline,
    serverNow: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────
// RESOLVE (attacker side) — called after the heist window elapses
// ─────────────────────────────────────────────
export type ResolveResult =
  | { success: true; outcome: 'success' | 'already_resolved' | 'too_early'; tokensGained: number }
  | { success: false; error: string }

export async function resolveHeistAttacker(heistId: number): Promise<ResolveResult> {
  const session = await getExamSession()
  if (!session) return { success: false, error: 'session หมดอายุ' }

  const supabase = createServiceClient()
  const heistWindowMs = (session.heist_window_seconds ?? 10) * 1000

  // claim + steal + payout run in one DB transaction (docs/sql/heist_atomic.sql)
  const { data, error } = await supabase.rpc('resolve_heist_success', {
    p_heist_id: heistId, p_attacker_id: session.student_id,
    p_window_ms: heistWindowMs, p_max: MAX_TOKENS, p_floor: VICTIM_FLOOR,
  })
  if (error) return { success: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  if (!row || row.outcome !== 'success') {
    // still pending = the window has not elapsed on the server yet (client clock ahead) → caller retries
    const { data: still } = await supabase
      .from('token_heist_log').select('outcome')
      .eq('id', heistId).eq('attacker_id', session.student_id).maybeSingle()
    if (still?.outcome === 'pending') return { success: true, outcome: 'too_early', tokensGained: 0 }
    return { success: true, outcome: 'already_resolved', tokensGained: 0 }
  }
  const gained: number = row.tokens_gained

  await logActivity({ type: 'student', id: session.student_id }, 'heist_success', session.project_name, {
    heist_id: heistId, gained,
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

  // Claim (outcome='pending' guard) + pay stake to victim in one DB transaction
  const { data: claimed, error } = await supabase.rpc('defend_heist_claim', {
    p_heist_id: heistId, p_victim_id: session.student_id, p_max: MAX_TOKENS,
  })
  if (error) return { success: false, error: error.message }
  if (!claimed) return { success: true, defended: false } // race: attacker resolved first

  await logActivity({ type: 'student', id: session.student_id }, 'heist_defended', session.project_name, {
    heist_id: heistId, attacker_id: row.attacker_id,
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
  serverNow: string
} | null

export async function getPendingHeistForVictim(touchPresence = false): Promise<PendingHeistInfo> {
  const session = await getExamSession()
  if (!session || session.mode !== 'exam') return null

  const supabase = createServiceClient()
  if (touchPresence) {
    // heartbeat — ผิดพลาดได้ ไม่กระทบการแสดง heist
    await supabase.from('exam_presence').upsert(
      { student_id: session.student_id, project_name: session.project_name, last_seen_at: new Date().toISOString() },
      { onConflict: 'student_id' },
    )
  }
  const windowMs = (session.heist_window_seconds ?? 10) * 1000
  const cutoff = new Date(Date.now() - windowMs).toISOString()

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
    serverNow: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────
// BALANCE — client polls so the coin counter follows heists/gacha without relying on postgres_changes
// ─────────────────────────────────────────────
export async function getMyTokens(): Promise<number | null> {
  const session = await getExamSession()
  if (!session) return null
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('students').select('super_tokens').eq('student_id', session.student_id).maybeSingle()
  return data ? Math.min(data.super_tokens || 0, MAX_TOKENS) : null
}
