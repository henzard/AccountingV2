-- 0001_baseline.sql
--
-- Server schema baseline. Squashes the 22 drifted migrations (001-022) that
-- previously lived in supabase/migrations/ into a single, clean starting
-- point for the new sync protocol. Source of truth for the 13 carried-over
-- tables + 4 surviving functions was a --schema-only pg_dump of the local DB
-- after replaying 001-022 (see docs/superpowers/sdd/task-1-report.md).
--
-- Changes made relative to the live dump (nothing else was redesigned):
--   * created_at/updated_at/joined_at/*_at TEXT columns -> timestamptz
--   * deleted_at timestamptz added to the 8 household-scoped entity tables
--   * cleanup_old_slip_images() audit trail re-pointed from audit_events to
--     the new job_log table
--   * NEW tables: job_log, score_history
--   * DROPPED: all merge_* RPCs, delete_sync_row, claim_invite,
--     lookup_invite_by_code, sync_household_member_to_user_households (+
--     its trigger), user_households, audit_events (server-side only; the
--     client-local audit_events table is untouched)
--   * RLS is ENABLED on every table; no policies/grants are declared here
--     (Task 2 owns policies + grants)
--
-- ============================================================================
-- 1. DROP guards (idempotent re-apply against a database that still has the
--    old 001-022 schema; on a fresh `supabase db reset` these are no-ops).
--    Signatures are intentionally omitted so these do not require the
--    (soon-to-be-created) table/composite types to already exist.
-- ============================================================================

DROP FUNCTION IF EXISTS public.merge_audit_event;
DROP FUNCTION IF EXISTS public.merge_baby_step;
DROP FUNCTION IF EXISTS public.merge_debt;
DROP FUNCTION IF EXISTS public.merge_envelope;
DROP FUNCTION IF EXISTS public.merge_household;
DROP FUNCTION IF EXISTS public.merge_household_member;
DROP FUNCTION IF EXISTS public.merge_meter_reading;
DROP FUNCTION IF EXISTS public.merge_slip_queue;
DROP FUNCTION IF EXISTS public.merge_transaction;
DROP FUNCTION IF EXISTS public.merge_user_consent;
DROP FUNCTION IF EXISTS public.delete_sync_row;
DROP FUNCTION IF EXISTS public.claim_invite;
DROP FUNCTION IF EXISTS public.lookup_invite_by_code;
DROP FUNCTION IF EXISTS public.sync_household_member_to_user_households;

DROP TABLE IF EXISTS public.user_households CASCADE;
DROP TABLE IF EXISTS public.audit_events CASCADE;

-- ============================================================================
-- 2. Extensions required by surviving infrastructure (pg_cron schedule below)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- 3. Tables (carried over from the live dump; timestamptz conversion +
--    deleted_at additions applied as noted above)
-- ============================================================================

CREATE TABLE public.households (
    id text NOT NULL,
    name text NOT NULL,
    payday_day integer DEFAULT 1 NOT NULL,
    user_level integer DEFAULT 1 NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz,
    CONSTRAINT households_payday_day_range CHECK (((payday_day >= 1) AND (payday_day <= 31)))
);

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_pkey PRIMARY KEY (id);

CREATE TABLE public.household_members (
    id text NOT NULL,
    household_id text NOT NULL,
    user_id text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamptz NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    deleted_at timestamptz
);

ALTER TABLE ONLY public.household_members
    ADD CONSTRAINT household_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.household_members
    ADD CONSTRAINT household_members_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id);

CREATE INDEX idx_household_members_household_id ON public.household_members USING btree (household_id);

-- Drop guard for the retired user_households sync trigger; must run after
-- household_members exists so the relation reference resolves.
DROP TRIGGER IF EXISTS tr_household_members_sync_user_households ON public.household_members;

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    household_id text NOT NULL,
    created_by text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_by text,
    used_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_code_key UNIQUE (code);

CREATE INDEX idx_invitations_code ON public.invitations USING btree (code);

CREATE TABLE public.envelopes (
    id text NOT NULL,
    household_id text NOT NULL,
    name text NOT NULL,
    allocated_cents integer DEFAULT 0 NOT NULL,
    spent_cents integer DEFAULT 0 NOT NULL,
    envelope_type text DEFAULT 'spending'::text NOT NULL,
    is_savings_locked boolean DEFAULT false NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    period_start text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    target_amount_cents integer,
    target_date text,
    deleted_at timestamptz,
    CONSTRAINT envelopes_envelope_type_check CHECK ((envelope_type = ANY (ARRAY['spending'::text, 'savings'::text, 'emergency_fund'::text, 'baby_step'::text, 'utility'::text, 'income'::text, 'sinking_fund'::text])))
);

ALTER TABLE ONLY public.envelopes
    ADD CONSTRAINT envelopes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.envelopes
    ADD CONSTRAINT envelopes_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id);

CREATE TABLE public.transactions (
    id text NOT NULL,
    household_id text NOT NULL,
    envelope_id text NOT NULL,
    amount_cents integer NOT NULL,
    payee text,
    description text,
    transaction_date text NOT NULL,
    is_business_expense boolean DEFAULT false NOT NULL,
    spending_trigger_note text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    slip_id text,
    deleted_at timestamptz
);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_envelope_id_fkey FOREIGN KEY (envelope_id) REFERENCES public.envelopes(id);

CREATE INDEX idx_transactions_slip_id ON public.transactions USING btree (slip_id);

CREATE TABLE public.debts (
    id text NOT NULL,
    household_id text NOT NULL,
    creditor_name text NOT NULL,
    debt_type text NOT NULL,
    outstanding_balance_cents integer NOT NULL,
    interest_rate_percent real NOT NULL,
    minimum_payment_cents integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_paid_off boolean DEFAULT false NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    initial_balance_cents bigint DEFAULT 0 NOT NULL,
    total_paid_cents bigint DEFAULT 0 NOT NULL,
    deleted_at timestamptz
);

ALTER TABLE ONLY public.debts
    ADD CONSTRAINT debts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.debts
    ADD CONSTRAINT debts_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id);

CREATE INDEX idx_debts_household_id ON public.debts USING btree (household_id);

CREATE TABLE public.meter_readings (
    id text NOT NULL,
    household_id text NOT NULL,
    meter_type text NOT NULL,
    reading_value real NOT NULL,
    reading_date text NOT NULL,
    cost_cents integer,
    vehicle_id text,
    notes text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.meter_readings
    ADD CONSTRAINT meter_readings_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id);

CREATE TABLE public.baby_steps (
    id text NOT NULL,
    household_id text NOT NULL,
    step_number integer NOT NULL,
    is_completed boolean DEFAULT false NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    is_manual boolean DEFAULT false NOT NULL,
    celebrated_at timestamptz,
    deleted_at timestamptz
);

ALTER TABLE ONLY public.baby_steps
    ADD CONSTRAINT baby_steps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.baby_steps
    ADD CONSTRAINT baby_steps_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id);

CREATE UNIQUE INDEX idx_baby_steps_household_step ON public.baby_steps USING btree (household_id, step_number);

CREATE TABLE public.slip_queue (
    id text NOT NULL,
    household_id text NOT NULL,
    created_by text NOT NULL,
    image_uris text NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    error_message text,
    merchant text,
    slip_date text,
    total_cents integer,
    raw_response_json text,
    images_deleted_at timestamptz,
    openai_cost_cents integer DEFAULT 0 NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);

ALTER TABLE ONLY public.slip_queue
    ADD CONSTRAINT slip_queue_pkey PRIMARY KEY (id);

CREATE INDEX idx_slip_queue_created_at ON public.slip_queue USING btree (created_at);

CREATE INDEX idx_slip_queue_household_user_created ON public.slip_queue USING btree (household_id, created_by, created_at);

CREATE TABLE public.user_consent (
    user_id text NOT NULL,
    slip_scan_consent_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT user_consent_slip_scan_consent_at_iso CHECK (((slip_scan_consent_at IS NULL) OR ((slip_scan_consent_at)::timestamp with time zone IS NOT NULL)))
);

ALTER TABLE ONLY public.user_consent
    ADD CONSTRAINT user_consent_pkey PRIMARY KEY (user_id);

CREATE TABLE public.notify_send_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notify_send_log
    ADD CONSTRAINT notify_send_log_pkey PRIMARY KEY (id);

CREATE INDEX idx_notify_send_log_sender_sent ON public.notify_send_log USING btree (sender_id, sent_at DESC);

CREATE TABLE public.user_fcm_tokens (
    user_id text NOT NULL,
    token text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_fcm_tokens
    ADD CONSTRAINT user_fcm_tokens_pkey PRIMARY KEY (user_id);

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    theme_preference text DEFAULT 'system'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_preferences_theme_preference_check CHECK ((theme_preference = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text])))
);

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ============================================================================
-- 4. Surviving functions, verbatim from the dump except where the
--    timestamptz conversion above requires a matching type fix (documented
--    inline) and cleanup_old_slip_images' audit trail re-point to job_log.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_and_reserve_notify_send(p_sender_id text, p_max_per_hour integer DEFAULT 20) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  recent_count int;
BEGIN
  SELECT COUNT(*)::int INTO recent_count
  FROM public.notify_send_log
  WHERE sender_id = p_sender_id
    AND sent_at >= NOW() - interval '1 hour';

  IF recent_count >= p_max_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO public.notify_send_log (sender_id) VALUES (p_sender_id);
  RETURN true;
END;
$$;

-- NOTE: v_cutoff is now timestamptz (was text) and the updated_at assignment
-- drops its ::text cast, both required because slip_queue.created_at/
-- updated_at are now native timestamptz columns.
CREATE OR REPLACE FUNCTION public.check_and_reserve_slip_slot(p_household_id text, p_user_id text, p_slip_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cutoff        timestamptz;
  v_household_cnt int;
  v_user_cnt      int;
  v_caller_id     text;
BEGIN
  -- Verify the RPC caller matches the claimed user_id.
  v_caller_id := auth.uid()::text;
  IF v_caller_id IS NULL OR v_caller_id <> p_user_id THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unauthorized');
  END IF;

  -- Serialize all concurrent calls for this household.
  PERFORM pg_advisory_xact_lock(hashtext(p_household_id));

  v_cutoff := NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_household_cnt
  FROM public.slip_queue
  WHERE household_id = p_household_id
    AND created_at  >= v_cutoff;

  IF v_household_cnt >= 50 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'household_limit');
  END IF;

  SELECT COUNT(*) INTO v_user_cnt
  FROM public.slip_queue
  WHERE household_id = p_household_id
    AND created_by  = p_user_id
    AND created_at  >= v_cutoff;

  IF v_user_cnt >= 25 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_limit');
  END IF;

  -- Reserve the slot: transition slip from pending -> processing atomically.
  UPDATE public.slip_queue
  SET status     = 'processing',
      updated_at = NOW()
  WHERE id           = p_slip_id
    AND status       = 'pending'
    AND household_id = p_household_id
    AND created_by   = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'slot_not_reserved');
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- NOTE: audit trail re-pointed from audit_events (dropped) to job_log per
-- the brief; images_deleted_at/updated_at assignments drop their ::text
-- casts now that slip_queue carries native timestamptz columns.
CREATE OR REPLACE FUNCTION public.cleanup_old_slip_images() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'storage'
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
          PERFORM storage.delete_object('slip-images', image_path);
        EXCEPTION WHEN OTHERS THEN
          storage_ok := false;
          INSERT INTO public.job_log (job, detail)
          VALUES (
            'cleanup_old_slip_images',
            jsonb_build_object(
              'event', 'STORAGE_DELETE_FAILED',
              'household_id', slip_row.household_id,
              'slip_id', slip_row.id,
              'error', SQLERRM,
              'path', image_path
            )
          );
        END;
      END LOOP;

      UPDATE public.slip_queue
      SET
        raw_response_json = NULL,
        images_deleted_at = CASE WHEN storage_ok THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE id = slip_row.id;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.job_log (job, detail)
      VALUES (
        'cleanup_old_slip_images',
        jsonb_build_object(
          'event', 'CLEANUP_FAILED',
          'household_id', slip_row.household_id,
          'slip_id', slip_row.id,
          'error', SQLERRM
        )
      );
    END;
  END LOOP;
END;
$$;

-- NOTE: re-pointed from public.user_households (dropped) to
-- public.household_members, which carries the same (household_id, user_id)
-- membership shape. This function is one of the "surviving functions" but
-- its dump body cannot resolve against the post-baseline schema without
-- this substitution.
CREATE OR REPLACE FUNCTION public.validate_slip_path(first_segment text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
BEGIN
  -- UUID allowlist; rejects any path traversal, URL-encoded or otherwise
  IF first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;
  RETURN first_segment IN (
    SELECT household_id FROM public.household_members WHERE user_id::text = auth.uid()::text
  );
END;
$_$;

-- NOT in the brief's "4 surviving functions" list, but kept: client code
-- (src/domain/households/AcceptInviteUseCase.ts) calls this RPC directly for
-- the invite-acceptance flow, it does not reference user_households, and it
-- supersedes the two legacy functions explicitly dropped above
-- (claim_invite, lookup_invite_by_code). Dropping it would regress a live
-- feature outside this task's sync-protocol scope. See task-1-report.md for
-- the full rationale.
-- NOTE: now_ts is now timestamptz (was text) because household_members
-- (joined_at, updated_at) and invitations (used_at) are native timestamptz.
CREATE OR REPLACE FUNCTION public.join_household_via_invite(p_invite_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  caller_id text := auth.uid()::text;
  invite_row public.invitations%ROWTYPE;
  member_id text := gen_random_uuid()::text;
  now_ts timestamptz := NOW();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO invite_row
  FROM public.invitations
  WHERE code = UPPER(TRIM(p_invite_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF invite_row.used_by IS NOT NULL THEN
    RAISE EXCEPTION 'invite already used' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF invite_row.expires_at::timestamptz <= NOW() THEN
    RAISE EXCEPTION 'invite expired' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = invite_row.household_id AND hm.user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'already a member of this household' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.household_members (id, household_id, user_id, role, joined_at, updated_at)
  VALUES (member_id, invite_row.household_id, caller_id, 'member', now_ts, now_ts);

  UPDATE public.invitations
  SET used_by = caller_id, used_at = now_ts
  WHERE id = invite_row.id
    AND used_by IS NULL
    AND expires_at::timestamptz > NOW();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite claim failed' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'member_id', member_id,
    'household_id', invite_row.household_id
  );
END;
$$;

-- ============================================================================
-- 5. New tables
-- ============================================================================

CREATE TABLE public.job_log (
    id bigserial PRIMARY KEY,
    job text,
    detail jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE public.score_history (
    id text PRIMARY KEY,
    household_id text REFERENCES public.households(id),
    period_start text NOT NULL,
    score int NOT NULL,
    components jsonb,
    created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 6. Row Level Security — enabled everywhere, no policies declared (Task 2)
-- ============================================================================

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baby_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slip_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notify_send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_fcm_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_history ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 7. Storage bucket + policies + pg_cron schedule (from 006/007/015)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('slip-images', 'slip-images', false)
ON CONFLICT (id) DO NOTHING;

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
