-- Lock down the anon/authenticated roles. Run once in the Supabase SQL Editor. Safe to re-run.
--
-- After this, the browser (anon key) can only:
--   * SELECT active rows of `subjects`
--   * SELECT `exam_sessions_public` (no pin_code)
-- Everything else goes through Server Actions using the service-role key, which bypasses RLS.
-- Deploy the matching app code BEFORE running this, otherwise the old login page breaks.

-- 1) RLS on, drop every existing policy, revoke every table privilege from anon/authenticated
DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students', 'subjects', 'exam_sessions', 'exam_results', 'exam_questions',
    'token_heist_log', 'activity_logs', 'exam_presence'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- 2) subjects: anon may read active subjects only
GRANT SELECT ON public.subjects TO anon;
CREATE POLICY subjects_anon_read_active ON public.subjects
  FOR SELECT TO anon USING (is_active = true);

-- 3) exam_sessions without pin_code (view runs as its owner, so it bypasses the table's RLS)
CREATE OR REPLACE VIEW public.exam_sessions_public AS
  SELECT id, project_name, is_active, created_at FROM public.exam_sessions;
REVOKE ALL ON public.exam_sessions_public FROM anon, authenticated;
GRANT SELECT ON public.exam_sessions_public TO anon;

-- 4) RPCs are only called by the service role; functions are executable by PUBLIC by default
REVOKE EXECUTE ON FUNCTION public.grant_super_tokens(text, int, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.defend_heist_claim(bigint, text, int) FROM PUBLIC, anon, authenticated;
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolve_heist_success' LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
