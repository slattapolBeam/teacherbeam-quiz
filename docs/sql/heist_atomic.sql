-- Atomic token transfer for Typing Heist.
-- Run once in the Supabase SQL Editor. Safe to re-run (CREATE OR REPLACE).
-- All balance changes happen as single UPDATE statements (col = col ± n),
-- so concurrent heists/defends/gacha can no longer overwrite each other.

-- Add tokens to a student, capped. Returns the new balance (NULL if no such student).
CREATE OR REPLACE FUNCTION grant_super_tokens(p_student_id text, p_amount int, p_max int)
RETURNS int
LANGUAGE sql
AS $$
  UPDATE students
     SET super_tokens = LEAST(COALESCE(super_tokens, 0) + p_amount, p_max)
   WHERE student_id = p_student_id
  RETURNING super_tokens;
$$;

-- Attacker side: claim a pending heist whose window has elapsed, steal 1 from the
-- victim (only if they still have ≥1), refund the stake and pay the attacker — one transaction.
-- outcome: 'success' | 'already_resolved' (defended, unknown, or called too early)
CREATE OR REPLACE FUNCTION resolve_heist_success(
  p_heist_id bigint, p_attacker_id text, p_window_ms int, p_max int
)
RETURNS TABLE (outcome text, tokens_gained int)
LANGUAGE plpgsql
AS $$
DECLARE
  v_victim text;
  v_stake  int;
  v_stolen int := 0;
BEGIN
  UPDATE token_heist_log
     SET outcome = 'success', resolved_at = now()
   WHERE id = p_heist_id
     AND attacker_id = p_attacker_id
     AND token_heist_log.outcome = 'pending'
     AND created_at <= now() - make_interval(secs => p_window_ms / 1000.0)
  RETURNING victim_id, stake_amount INTO v_victim, v_stake;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'already_resolved'::text, 0;
    RETURN;
  END IF;

  UPDATE students
     SET super_tokens = super_tokens - 1
   WHERE student_id = v_victim AND super_tokens >= 1;
  IF FOUND THEN v_stolen := 1; END IF;

  UPDATE students
     SET super_tokens = LEAST(COALESCE(super_tokens, 0) + v_stake + v_stolen, p_max)
   WHERE student_id = p_attacker_id;

  RETURN QUERY SELECT 'success'::text, v_stake + v_stolen;
END;
$$;

-- Victim side: claim a pending heist as defended and pay the stake to the victim — one transaction.
-- Returns true if this call won the claim.
CREATE OR REPLACE FUNCTION defend_heist_claim(p_heist_id bigint, p_victim_id text, p_max int)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_stake int;
BEGIN
  UPDATE token_heist_log
     SET outcome = 'defended', resolved_at = now()
   WHERE id = p_heist_id AND victim_id = p_victim_id AND token_heist_log.outcome = 'pending'
  RETURNING stake_amount INTO v_stake;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE students
     SET super_tokens = LEAST(COALESCE(super_tokens, 0) + v_stake, p_max)
   WHERE student_id = p_victim_id;
  RETURN true;
END;
$$;
