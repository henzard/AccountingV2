-- 006_slip_scanning.sql
-- Replaces slip_queue with new shape; adds transactions.slip_id, user_consent,
-- Storage bucket + RLS, pg_cron cleanup job.

-- 1. Drop existing slip_queue (CASCADE removes the v005 merge_slip_queue function)
DROP TABLE IF EXISTS public.slip_queue CASCADE;

-- 2. Recreate slip_queue with new shape
CREATE TABLE public.slip_queue (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  image_uris TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  error_message TEXT,
  merchant TEXT,
  slip_date TEXT,
  total_cents INTEGER,
  raw_response_json TEXT,
  images_deleted_at TEXT,
  openai_cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. Indexes
CREATE INDEX idx_slip_queue_created_at ON public.slip_queue(created_at);
CREATE INDEX idx_slip_queue_household_user_created
  ON public.slip_queue(household_id, created_by, created_at);

-- 4. RLS
ALTER TABLE public.slip_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sq_select ON public.slip_queue;
CREATE POLICY sq_select ON public.slip_queue
  FOR SELECT TO authenticated
  USING (
    household_id IN (
      SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS sq_insert ON public.slip_queue;
CREATE POLICY sq_insert ON public.slip_queue
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()::text);

DROP POLICY IF EXISTS sq_update ON public.slip_queue;
CREATE POLICY sq_update ON public.slip_queue
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()::text)
  WITH CHECK (created_by = auth.uid()::text);

DROP POLICY IF EXISTS sq_delete ON public.slip_queue;
CREATE POLICY sq_delete ON public.slip_queue
  FOR DELETE TO authenticated
  USING (created_by = auth.uid()::text);

-- 5. merge_slip_queue RPC with ownership guard + status-precedence LWW
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
      EXCLUDED.updated_at >= slip_queue.updated_at
      OR (slip_queue.status != 'completed' AND EXCLUDED.status = 'completed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_slip_queue(public.slip_queue) TO authenticated;

-- 6. transactions.slip_id
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS slip_id TEXT;
CREATE INDEX IF NOT EXISTS idx_transactions_slip_id ON public.transactions(slip_id);

-- 7. Update merge_transaction RPC to include slip_id
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
      note = EXCLUDED.note,
      slip_id = EXCLUDED.slip_id,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= transactions.updated_at;
END;
$$;

-- 8. user_consent table
CREATE TABLE IF NOT EXISTS public.user_consent (
  user_id TEXT PRIMARY KEY,
  slip_scan_consent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE public.user_consent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uc_select ON public.user_consent;
CREATE POLICY uc_select ON public.user_consent
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS uc_insert ON public.user_consent;
CREATE POLICY uc_insert ON public.user_consent
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS uc_update ON public.user_consent;
CREATE POLICY uc_update ON public.user_consent
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.merge_user_consent(r public.user_consent)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
BEGIN
  IF r.user_id != caller_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.user_consent VALUES (r.*)
  ON CONFLICT (user_id) DO UPDATE
    SET
      slip_scan_consent_at = EXCLUDED.slip_scan_consent_at,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= user_consent.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_user_consent(public.user_consent) TO authenticated;

-- 9. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('slip-images', 'slip-images', false)
ON CONFLICT (id) DO NOTHING;

-- 10. validate_slip_path: guards against path traversal + asserts household membership
CREATE OR REPLACE FUNCTION public.validate_slip_path(first_segment text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard against path traversal; first_segment cannot contain '..'
  IF first_segment LIKE '%..%' THEN
    RETURN false;
  END IF;
  RETURN first_segment IN (
    SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_slip_path(text) TO authenticated;

-- 10b. Storage RLS policies (path: <household_id>/<slip_id>/<index>.jpg)
DROP POLICY IF EXISTS slip_images_read ON storage.objects;
CREATE POLICY slip_images_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'slip-images'
    AND public.validate_slip_path((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS slip_images_write ON storage.objects;
CREATE POLICY slip_images_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'slip-images'
    AND public.validate_slip_path((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS slip_images_delete ON storage.objects;
CREATE POLICY slip_images_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'slip-images'
    AND public.validate_slip_path((storage.foldername(name))[1])
  );

-- 11. Trigger: keep slip_queue.updated_at always set to DB server time
CREATE OR REPLACE FUNCTION public.set_slip_queue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW()::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_slip_queue_set_updated_at ON public.slip_queue;
CREATE TRIGGER tr_slip_queue_set_updated_at
  BEFORE UPDATE ON public.slip_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_slip_queue_updated_at();

-- 12. Enable pg_net for HTTP DELETE and pg_cron for scheduling
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 13. Cleanup function (callable from pg_cron)
CREATE OR REPLACE FUNCTION public.cleanup_old_slip_images()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  slip_row RECORD;
  image_path TEXT;
BEGIN
  FOR slip_row IN
    SELECT id, household_id, image_uris
    FROM public.slip_queue
    WHERE created_at::timestamptz < NOW() - INTERVAL '30 days'
      AND images_deleted_at IS NULL
  LOOP
    BEGIN
      -- Delete each image via storage admin API
      FOR image_path IN
        SELECT jsonb_array_elements_text(slip_row.image_uris::jsonb)
      LOOP
        DELETE FROM storage.objects
          WHERE bucket_id = 'slip-images' AND name = image_path;
      END LOOP;

      -- Mark images deleted + null PII payload
      UPDATE public.slip_queue
      SET
        images_deleted_at = NOW()::text,
        raw_response_json = NULL,
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

-- 14. Schedule daily cleanup at 03:00 UTC
SELECT cron.schedule(
  'cleanup-old-slip-images',
  '0 3 * * *',
  'SELECT public.cleanup_old_slip_images();'
);
