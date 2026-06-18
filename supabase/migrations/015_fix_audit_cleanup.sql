-- 015_fix_audit_cleanup.sql
-- Fixes cleanup_old_slip_images() to use correct audit_events columns.
-- The original function (migrations 006/007) referenced non-existent columns
-- `user_id` and `event_type`; the actual schema uses `action` with no `user_id`.

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

      FOR image_path IN
        SELECT jsonb_array_elements_text(slip_row.image_uris::jsonb)
      LOOP
        BEGIN
          DELETE FROM storage.objects
            WHERE bucket_id = 'slip-images' AND name = image_path;
        EXCEPTION WHEN OTHERS THEN
          storage_ok := false;
          INSERT INTO public.audit_events
            (id, household_id, action, entity_type, entity_id, new_value_json, created_at, is_synced)
          VALUES (
            gen_random_uuid()::text,
            slip_row.household_id,
            'STORAGE_DELETE_FAILED',
            'slip_queue',
            slip_row.id,
            jsonb_build_object('error', SQLERRM, 'path', image_path)::text,
            NOW()::text,
            false
          );
        END;
      END LOOP;

      UPDATE public.slip_queue
      SET
        raw_response_json = NULL,
        images_deleted_at = CASE WHEN storage_ok THEN NOW()::text ELSE NULL END,
        updated_at = NOW()::text
      WHERE id = slip_row.id;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_events
        (id, household_id, action, entity_type, entity_id, new_value_json, created_at, is_synced)
      VALUES (
        gen_random_uuid()::text,
        slip_row.household_id,
        'CLEANUP_FAILED',
        'slip_queue',
        slip_row.id,
        jsonb_build_object('error', SQLERRM)::text,
        NOW()::text,
        false
      );
    END;
  END LOOP;
END;
$$;
