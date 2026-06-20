-- 018_security_fixes.sql
-- Fixes 3 security/integrity issues:
--
-- 1. merge_slip_queue in 017 references nonexistent columns (extracted_data,
--    line_items, original_image_uri, category_suggestion) and omits real columns
--    (error_message, slip_date, raw_response_json, images_deleted_at,
--    openai_cost_cents). Also restores creator-only authz check that was
--    replaced with a weaker household-membership check.
--
-- 2. user_households table missing role + created_at columns referenced by the
--    sync_household_member_to_user_households trigger (created in 005).
--
-- 3. merge_slip_queue: re-add created_by ownership guard (regression from 017
--    which replaced the strict created_by check with generic household membership).

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Add missing columns to user_households so the trigger from 005 works
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.user_households
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

ALTER TABLE public.user_households
  ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')::TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Fix merge_slip_queue to match the actual table schema (from 006) and
--    restore the created_by ownership guard
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.merge_slip_queue(r public.slip_queue)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
BEGIN
  -- Ownership guard: only the slip creator may merge their own rows.
  -- This is stricter than household membership and prevents one household
  -- member from overwriting another member's slip scan results.
  IF r.created_by != caller_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.slip_queue (
    id, household_id, created_by, image_uris, status,
    error_message, merchant, slip_date, total_cents,
    raw_response_json, images_deleted_at, openai_cost_cents,
    created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.created_by, r.image_uris, r.status,
    r.error_message, r.merchant, r.slip_date, r.total_cents,
    r.raw_response_json, r.images_deleted_at, r.openai_cost_cents,
    r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      status            = EXCLUDED.status,
      error_message     = EXCLUDED.error_message,
      merchant          = EXCLUDED.merchant,
      slip_date         = EXCLUDED.slip_date,
      total_cents       = EXCLUDED.total_cents,
      raw_response_json = EXCLUDED.raw_response_json,
      images_deleted_at = EXCLUDED.images_deleted_at,
      openai_cost_cents = EXCLUDED.openai_cost_cents,
      image_uris        = EXCLUDED.image_uris,
      updated_at        = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > slip_queue.updated_at
       OR (EXCLUDED.updated_at = slip_queue.updated_at AND EXCLUDED.id > slip_queue.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_slip_queue(public.slip_queue) TO authenticated;
