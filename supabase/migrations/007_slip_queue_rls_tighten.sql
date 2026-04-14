-- 007_slip_queue_rls_tighten.sql
-- Addresses security and correctness findings from PR #8 review.

-- ============================================================
-- 1. Tighten sq_insert RLS — require household membership
--    (previously only checked created_by = caller, not household membership)
-- ============================================================
DROP POLICY IF EXISTS sq_insert ON public.slip_queue;
CREATE POLICY sq_insert ON public.slip_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()::text
    AND household_id IN (
      SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text
    )
  );

-- ============================================================
-- 2. Tighten merge_slip_queue LWW — prevent stale client from
--    overwriting a completed row
-- ============================================================
CREATE OR REPLACE FUNCTION public.merge_slip_queue(r public.slip_queue)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
BEGIN
  IF r.created_by != caller_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.slip_queue VALUES (r.*)
  ON CONFLICT (id) DO UPDATE
    SET
      status = EXCLUDED.status,
      error_message = EXCLUDED.error_message,
      merchant = EXCLUDED.merchant,
      slip_date = EXCLUDED.slip_date,
      total_cents = EXCLUDED.total_cents,
      raw_response_json = EXCLUDED.raw_response_json,
      images_deleted_at = EXCLUDED.images_deleted_at,
      openai_cost_cents = EXCLUDED.openai_cost_cents,
      image_uris = EXCLUDED.image_uris,
      updated_at = EXCLUDED.updated_at
    WHERE
      (slip_queue.status != 'completed' AND EXCLUDED.updated_at >= slip_queue.updated_at)
      OR (slip_queue.status != 'completed' AND EXCLUDED.status = 'completed');
END;
$$;

-- ============================================================
-- 3. Drop the BEFORE UPDATE trigger that was overwriting updated_at
--    with server time, causing LWW silent data loss when the Edge
--    Function writes via direct adminSupabase.update().
-- ============================================================
DROP TRIGGER IF EXISTS tr_slip_queue_set_updated_at ON public.slip_queue;
DROP FUNCTION IF EXISTS public.set_slip_queue_updated_at();

-- ============================================================
-- 4. CHECK constraint on user_consent.slip_scan_consent_at
--    Ensures the value is either NULL or a valid timestamptz
-- ============================================================
ALTER TABLE public.user_consent
  DROP CONSTRAINT IF EXISTS user_consent_slip_scan_consent_at_iso;
ALTER TABLE public.user_consent
  ADD CONSTRAINT user_consent_slip_scan_consent_at_iso
  CHECK (
    slip_scan_consent_at IS NULL
    OR slip_scan_consent_at::timestamptz IS NOT NULL
  );

-- ============================================================
-- 5. Update merge_transaction to include ALL non-auto columns
--    Fixes missing: description, is_business_expense, spending_trigger_note
-- ============================================================
CREATE OR REPLACE FUNCTION public.merge_transaction(r public.transactions)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = r.household_id AND user_id::text = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', r.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.transactions VALUES (r.*)
  ON CONFLICT (id) DO UPDATE
    SET
      household_id = EXCLUDED.household_id,
      envelope_id = EXCLUDED.envelope_id,
      amount_cents = EXCLUDED.amount_cents,
      transaction_date = EXCLUDED.transaction_date,
      payee = EXCLUDED.payee,
      description = EXCLUDED.description,
      is_business_expense = EXCLUDED.is_business_expense,
      spending_trigger_note = EXCLUDED.spending_trigger_note,
      slip_id = EXCLUDED.slip_id,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= transactions.updated_at;
END;
$$;

-- ============================================================
-- 6. validate_slip_path — use UUID regex instead of LIKE
--    (prevents path traversal via URL-encoded sequences)
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_slip_path(first_segment text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- UUID allowlist; rejects any path traversal, URL-encoded or otherwise
  IF first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;
  RETURN first_segment IN (
    SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text
  );
END;
$$;

-- ============================================================
-- 7. Restructure cleanup_old_slip_images — null PII unconditionally;
--    only set images_deleted_at when storage delete succeeds
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_slip_images()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  slip_row RECORD;
  image_path TEXT;
  storage_ok BOOLEAN;
BEGIN
  FOR slip_row IN
    SELECT id, household_id, image_uris
    FROM public.slip_queue
    WHERE created_at::timestamptz < NOW() - INTERVAL '30 days'
      AND images_deleted_at IS NULL
  LOOP
    BEGIN
      storage_ok := true;

      -- Attempt to delete each image via storage admin API
      FOR image_path IN
        SELECT jsonb_array_elements_text(slip_row.image_uris::jsonb)
      LOOP
        BEGIN
          DELETE FROM storage.objects
            WHERE bucket_id = 'slip-images' AND name = image_path;
        EXCEPTION WHEN OTHERS THEN
          storage_ok := false;
          INSERT INTO public.audit_events (id, household_id, user_id, event_type, entity_type, entity_id, new_value_json, created_at)
          VALUES (
            gen_random_uuid()::text,
            slip_row.household_id,
            NULL,
            'STORAGE_DELETE_FAILED',
            'slip_queue',
            slip_row.id,
            jsonb_build_object('error', SQLERRM, 'path', image_path)::text,
            NOW()::text
          );
        END;
      END LOOP;

      -- Always null PII payload regardless of storage delete success
      UPDATE public.slip_queue
      SET
        raw_response_json = NULL,
        images_deleted_at = CASE WHEN storage_ok THEN NOW()::text ELSE NULL END,
        updated_at = NOW()::text
      WHERE id = slip_row.id;

    EXCEPTION WHEN OTHERS THEN
      -- Log to audit_events; let next cron run retry
      INSERT INTO public.audit_events (id, household_id, user_id, event_type, entity_type, entity_id, new_value_json, created_at)
      VALUES (
        gen_random_uuid()::text,
        slip_row.household_id,
        NULL,
        'CLEANUP_FAILED',
        'slip_queue',
        slip_row.id,
        jsonb_build_object('error', SQLERRM)::text,
        NOW()::text
      );
    END;
  END LOOP;
END;
$$;

-- ============================================================
-- 8. Idempotent pg_cron schedule
-- NOTE: pg_cron must be enabled in the Supabase Dashboard > Database > Extensions
-- before this migration runs. CREATE EXTENSION alone is insufficient on managed Supabase.
-- ============================================================
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-slip-images');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job didn't exist, ignore
END;
$$;

SELECT cron.schedule(
  'cleanup-old-slip-images',
  '0 3 * * *',
  'SELECT public.cleanup_old_slip_images();'
);
