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

-- Partial unique index: at most one ACTIVE (deleted_at IS NULL) membership
-- row per (household_id, user_id). Soft-deleted rows are excluded so a
-- removed member can rejoin later. This closes a TOCTOU window in
-- join_household_via_invite where two concurrent joins (e.g. via two valid
-- invites to the same household) could both pass the pre-insert EXISTS
-- check and insert duplicate active membership rows; the second INSERT now
-- raises unique_violation instead, which the function catches as a no-op.
CREATE UNIQUE INDEX household_members_household_id_user_id_active_idx
  ON public.household_members (household_id, user_id) WHERE deleted_at IS NULL;

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
    updated_at timestamptz NOT NULL
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
  -- Schema-qualified call to private.is_household_member (defined later in
  -- this file, section 8) so search_path resolution isn't needed and the
  -- deleted_at IS NULL membership check is single-sourced: a soft-deleted
  -- (removed) member must NOT keep slip-path access.
  RETURN private.is_household_member(first_segment);
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

  -- Only an ACTIVE membership blocks a re-join; a previously-removed
  -- (soft-deleted) member is allowed to rejoin via a fresh invite.
  IF EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = invite_row.household_id
      AND hm.user_id = caller_id
      AND hm.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'already a member of this household' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The EXISTS check above is a TOCTOU-vulnerable pre-check: two concurrent
  -- joins (e.g. via two different valid invites to the same household) can
  -- both pass it and race to insert. The partial unique index on
  -- (household_id, user_id) WHERE deleted_at IS NULL is the actual guard;
  -- a loser of the race hits unique_violation here and is treated as a
  -- no-op success (the caller ends up an active member either way) instead
  -- of surfacing a spurious error.
  BEGIN
    INSERT INTO public.household_members (id, household_id, user_id, role, joined_at, updated_at)
    VALUES (member_id, invite_row.household_id, caller_id, 'member', now_ts, now_ts);
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

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

REVOKE ALL ON FUNCTION public.join_household_via_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_household_via_invite(text) TO authenticated;

-- Task 4: public.create_invitation — owner-only invite creation. Direct
-- `INSERT INTO invitations` from the client is permission-denied (no INSERT
-- grant for authenticated); this SECURITY DEFINER RPC is the only way to
-- mint a code. Code generation replicates CreateInviteUseCase's client-side
-- algorithm (32-char alphabet excluding 0/O/1/I, byte % 32 — unbiased because
-- 256 is an exact multiple of 32) but server-side, using pgcrypto's CSPRNG.
CREATE OR REPLACE FUNCTION public.create_invitation(p_household_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  caller_id text := (select auth.uid())::text;
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 chars, no 0/O/1/I
  v_id uuid;
  v_code text;
  v_expires_at timestamptz := now() + interval '48 hours';
  v_bytes bytea;
  v_attempt int := 0;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = p_household_id
      AND hm.user_id = caller_id
      AND hm.role = 'owner'
      AND hm.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'only an owner can create an invitation' USING ERRCODE = 'insufficient_privilege';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    FOR i IN 0..5 LOOP
      v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % length(c_alphabet)) + 1, 1);
    END LOOP;
    v_id := gen_random_uuid();

    BEGIN
      INSERT INTO public.invitations (id, code, household_id, created_by, expires_at)
      VALUES (v_id, v_code, p_household_id, caller_id, v_expires_at);
      EXIT; -- inserted without a code collision
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION 'failed to generate a unique invite code' USING ERRCODE = 'insufficient_privilege';
      END IF;
      -- retry with a freshly generated code
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invitation(text) TO authenticated;

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

-- ============================================================================
-- 8. Task 2: private.is_household_member helper + RLS policies + grants.
--    `private` is never exposed via PostgREST (only `public` is in the
--    exposed-schemas list), so this helper is safe to keep out of `public`.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_household_member(hid text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = ''
    AS $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = hid
      and m.user_id = (select auth.uid())::text
      and m.deleted_at is null
  );
$$;

-- ----------------------------------------------------------------------
-- 8a. Household-scoped SELECT policies (member-only; writes go through
--     SECURITY DEFINER RPCs, so no INSERT/UPDATE/DELETE policies here).
-- ----------------------------------------------------------------------

CREATE POLICY households_select ON public.households
  FOR SELECT TO authenticated
  USING (private.is_household_member(id));

CREATE POLICY household_members_select ON public.household_members
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY invitations_select ON public.invitations
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY envelopes_select ON public.envelopes
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY transactions_select ON public.transactions
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY debts_select ON public.debts
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY meter_readings_select ON public.meter_readings
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY baby_steps_select ON public.baby_steps
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY slip_queue_select ON public.slip_queue
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY score_history_select ON public.score_history
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

-- ----------------------------------------------------------------------
-- 8b. Per-user tables. user_preferences.user_id is uuid (compares
--     directly to auth.uid()); user_fcm_tokens/user_consent.user_id are
--     text (cast auth.uid() to text).
-- ----------------------------------------------------------------------

CREATE POLICY user_consent_select ON public.user_consent
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid())::text);

CREATE POLICY user_consent_insert ON public.user_consent
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid())::text);

CREATE POLICY user_consent_update ON public.user_consent
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid())::text)
  WITH CHECK (user_id = (select auth.uid())::text);

CREATE POLICY user_preferences_select ON public.user_preferences
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY user_preferences_insert ON public.user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY user_preferences_update ON public.user_preferences
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY user_fcm_tokens_select ON public.user_fcm_tokens
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid())::text);

CREATE POLICY user_fcm_tokens_insert ON public.user_fcm_tokens
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid())::text);

CREATE POLICY user_fcm_tokens_update ON public.user_fcm_tokens
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid())::text)
  WITH CHECK (user_id = (select auth.uid())::text);

CREATE POLICY user_fcm_tokens_delete ON public.user_fcm_tokens
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid())::text);

-- ----------------------------------------------------------------------
-- 8c. Grants. job_log and notify_send_log are service_role-only (no
--     authenticated/anon grants or policies); every other table gets
--     SELECT for authenticated + anon (mirroring slice-1's 022 for the
--     client-read tables) plus per-user DML grants as above; service_role
--     gets ALL on every table.
-- ----------------------------------------------------------------------

GRANT SELECT ON public.households TO authenticated, anon;
GRANT SELECT ON public.household_members TO authenticated, anon;
GRANT SELECT ON public.invitations TO authenticated, anon;
GRANT SELECT ON public.envelopes TO authenticated, anon;
GRANT SELECT ON public.transactions TO authenticated, anon;
GRANT SELECT ON public.debts TO authenticated, anon;
GRANT SELECT ON public.meter_readings TO authenticated, anon;
GRANT SELECT ON public.baby_steps TO authenticated, anon;
GRANT SELECT ON public.slip_queue TO authenticated, anon;
GRANT SELECT ON public.score_history TO authenticated, anon;

GRANT SELECT ON public.user_consent TO authenticated, anon;
GRANT INSERT, UPDATE ON public.user_consent TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.user_preferences TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_fcm_tokens TO authenticated;

GRANT ALL ON public.households TO service_role;
GRANT ALL ON public.household_members TO service_role;
GRANT ALL ON public.invitations TO service_role;
GRANT ALL ON public.envelopes TO service_role;
GRANT ALL ON public.transactions TO service_role;
GRANT ALL ON public.debts TO service_role;
GRANT ALL ON public.meter_readings TO service_role;
GRANT ALL ON public.baby_steps TO service_role;
GRANT ALL ON public.slip_queue TO service_role;
GRANT ALL ON public.score_history TO service_role;
GRANT ALL ON public.user_consent TO service_role;
GRANT ALL ON public.user_preferences TO service_role;
GRANT ALL ON public.user_fcm_tokens TO service_role;
GRANT ALL ON public.job_log TO service_role;
GRANT ALL ON public.notify_send_log TO service_role;

-- ============================================================================
-- 9. Task 3: oplog table + sync protocol
--    (sync_push / sync_pull / sync_row_state / apply_server_op). Spec §6/§7.
-- ============================================================================

-- ----------------------------------------------------------------------
-- 9a. oplog — the per-household ordered operation log. `seq` (bigserial) is
--     the server-assigned order; per-household writer serialization (the
--     advisory lock taken by EVERY writer below) makes the per-household seq
--     order equal commit order, closing the bigserial visibility race. The
--     wire op's `table` field is stored in the `table_name` column.
-- ----------------------------------------------------------------------

CREATE TABLE public.oplog (
    seq bigserial,
    op_id uuid NOT NULL,
    household_id text NOT NULL,
    table_name text NOT NULL,
    row_id text NOT NULL,
    op_type text NOT NULL,
    payload jsonb,
    actor_user_id uuid,
    device_id text NOT NULL,
    client_created_at timestamptz,
    applied_at timestamptz DEFAULT now(),
    CONSTRAINT oplog_pkey PRIMARY KEY (op_id),
    CONSTRAINT oplog_op_type_check CHECK (op_type IN ('insert', 'update', 'delete', 'increment')),
    CONSTRAINT oplog_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id)
);

CREATE INDEX idx_oplog_household_seq ON public.oplog USING btree (household_id, seq);

ALTER TABLE public.oplog ENABLE ROW LEVEL SECURITY;

CREATE POLICY oplog_select ON public.oplog
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

-- Realtime fan-out: clients subscribe to their household's oplog stream.
ALTER PUBLICATION supabase_realtime ADD TABLE public.oplog;

-- RPC-only: SELECT for authenticated (RLS-scoped), no direct DML for anyone.
-- service_role reaches the log solely through apply_server_op (a SECURITY
-- DEFINER function that inserts as the owner), so it needs no table grant.
REVOKE ALL ON public.oplog FROM anon, authenticated;
GRANT SELECT ON public.oplog TO authenticated;

-- ----------------------------------------------------------------------
-- 9b. private.apply_one_op — shared per-op apply path (used by both
--     sync_push and apply_server_op). Assumes the caller already holds the
--     per-household advisory lock. Records the op in oplog, validates, and
--     applies it. Each call runs inside its OWN savepoint (the inner
--     BEGIN/EXCEPTION block): on any unexpected SQL error that savepoint is
--     rolled back, removing this op's oplog row, so the surrounding batch is
--     unaffected. Returns a single {op_id, status, code} object.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.apply_one_op(p_op jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  c_tables   constant text[] := array['households', 'household_members', 'envelopes', 'transactions', 'debts', 'meter_readings', 'baby_steps', 'slip_queue'];
  v_op_id    text  := p_op->>'op_id';
  v_hh       text  := p_op->>'household_id';
  v_table    text  := p_op->>'table';
  v_row_id   text  := p_op->>'row_id';
  v_op_type  text  := p_op->>'op_type';
  v_payload  jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_allowed  text[];
  v_inserted boolean;
  v_actual   text;
  v_cols     text;
  v_vals     text;
  v_set      text;
  v_field    text;
  v_delta    text;
  v_clamp    text;
BEGIN
  -- Validation (pre-oplog): v must be 1, table allowlisted, op_type known.
  -- Rejected here => no oplog row is ever written.
  IF (p_op->>'v') IS DISTINCT FROM '1'
     OR NOT (v_table = ANY (c_tables))
     OR v_op_type IS NULL
     OR NOT (v_op_type = ANY (array['insert', 'update', 'delete', 'increment'])) THEN
    RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'unsupported');
  END IF;

  -- Per-table payload column allowlist: every real column minus the
  -- wire/server-owned id + household_id.
  SELECT array_agg(a.attname)
    INTO v_allowed
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = ('public.' || quote_ident(v_table))::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname NOT IN ('id', 'household_id');

  BEGIN  -- per-op savepoint
    -- Record first so a duplicate op_id short-circuits to 'applied'
    -- (duplicate-ack, spec §6.11) before any apply work happens.
    INSERT INTO public.oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
    VALUES (v_op_id::uuid, v_hh, v_table, v_row_id, v_op_type, v_payload,
            (p_op->>'actor_user_id')::uuid, p_op->>'device_id', (p_op->>'client_created_at')::timestamptz)
    ON CONFLICT (op_id) DO NOTHING
    RETURNING true INTO v_inserted;

    IF v_inserted IS NULL THEN
      RETURN jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'code', 'duplicate');
    END IF;

    IF v_op_type = 'increment' THEN
      -- increment payload is {field, delta, clamp}; the target field is
      -- validated like a settable column.
      v_field := v_payload->>'field';
      v_delta := v_payload->>'delta';
      v_clamp := coalesce(v_payload->>'clamp', 'none');
      IF v_field IS NULL OR NOT (v_field = ANY (v_allowed)) THEN
        DELETE FROM public.oplog WHERE op_id = v_op_id::uuid;
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_column');
      END IF;
    ELSE
      -- insert/update/delete payloads are column maps; any key outside the
      -- allowlist (id/household_id or an unknown column) is forbidden.
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_payload) k WHERE NOT (k = ANY (v_allowed))) THEN
        DELETE FROM public.oplog WHERE op_id = v_op_id::uuid;
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_column');
      END IF;
    END IF;

    -- update/delete/increment must target a row whose ACTUAL household_id
    -- equals the op's household_id.
    IF v_op_type IN ('update', 'delete', 'increment') THEN
      EXECUTE format('SELECT household_id FROM public.%I WHERE id = %L', v_table, v_row_id)
        INTO v_actual;
      IF v_actual IS DISTINCT FROM v_hh THEN
        DELETE FROM public.oplog WHERE op_id = v_op_id::uuid;
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'wrong_household');
      END IF;
    END IF;

    -- Apply.
    IF v_op_type = 'insert' THEN
      SELECT string_agg(format('%I', e.key), ', '), string_agg(format('%L', e.value), ', ')
        INTO v_cols, v_vals
      FROM jsonb_each_text(v_payload) e;
      -- Row already present with the same id => no-op applied (spec §6.6).
      EXECUTE format(
        'INSERT INTO public.%I (id, household_id%s) VALUES (%L, %L%s) ON CONFLICT (id) DO NOTHING',
        v_table,
        CASE WHEN v_cols IS NULL THEN '' ELSE ', ' || v_cols END,
        v_row_id, v_hh,
        CASE WHEN v_vals IS NULL THEN '' ELSE ', ' || v_vals END);
    ELSIF v_op_type = 'update' THEN
      SELECT string_agg(format('%I = %L', e.key, e.value), ', ')
        INTO v_set
      FROM jsonb_each_text(v_payload) e;
      IF v_set IS NOT NULL THEN
        EXECUTE format('UPDATE public.%I SET %s WHERE id = %L', v_table, v_set, v_row_id);
      END IF;
    ELSIF v_op_type = 'delete' THEN
      EXECUTE format('UPDATE public.%I SET deleted_at = now() WHERE id = %L', v_table, v_row_id);
    ELSIF v_op_type = 'increment' THEN
      IF v_clamp = 'floor_zero' THEN
        EXECUTE format('UPDATE public.%I SET %I = greatest(0, %I + (%L)::numeric) WHERE id = %L',
                       v_table, v_field, v_field, v_delta, v_row_id);
      ELSE
        EXECUTE format('UPDATE public.%I SET %I = %I + (%L)::numeric WHERE id = %L',
                       v_table, v_field, v_field, v_delta, v_row_id);
      END IF;
    END IF;

    RETURN jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'code', null);
  EXCEPTION WHEN OTHERS THEN
    -- Any other SQL error: the savepoint rollback already discarded this op's
    -- oplog row; report the SQLSTATE as the rejection code.
    RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', SQLSTATE);
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION private.apply_one_op(jsonb) FROM PUBLIC;

-- ----------------------------------------------------------------------
-- 9c. public.sync_push — client entry point. Groups ops by household
--     (input order preserved in the response), validates membership per
--     group (whole group rejected 'not_member' on failure), takes the
--     per-household advisory lock, then applies each op in input order via
--     apply_one_op. The batch is NOT atomic; the response is a jsonb array of
--     {op_id, status, code} in input order.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_push(p_ops jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  v_result     jsonb := '[]'::jsonb;
  v_membership jsonb := '{}'::jsonb;  -- household_id -> boolean (cache)
  v_hh         text;
  v_is_member  boolean;
  v_op         jsonb;
BEGIN
  -- Pass 1: resolve membership once per distinct household and, for member
  -- households, take the per-household advisory lock (writer serialization,
  -- spec §6.1). pg_advisory_xact_lock + hashtextextended is a pg_catalog
  -- internal (stable since PG11; used by hash partitioning) and is NOT listed
  -- in the public SQL reference docs. ORDER BY 1 is required: two concurrent
  -- pushes touching the same household set (e.g. {A,B}) must acquire the
  -- locks in the same order, or they can deadlock AB/BA with one transaction
  -- aborted by Postgres.
  FOR v_hh IN
    SELECT DISTINCT e.value->>'household_id'
    FROM jsonb_array_elements(p_ops) e
    ORDER BY 1
  LOOP
    IF v_hh IS NULL THEN
      CONTINUE;
    END IF;
    v_is_member := private.is_household_member(v_hh);
    v_membership := v_membership || jsonb_build_object(v_hh, v_is_member);
    IF v_is_member THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hh, 0));
    END IF;
  END LOOP;

  -- Pass 2: apply in input order.
  FOR v_op IN SELECT e.value FROM jsonb_array_elements(p_ops) e
  LOOP
    v_hh := v_op->>'household_id';
    v_is_member := coalesce((v_membership->>v_hh)::boolean, false);
    IF NOT v_is_member THEN
      v_result := v_result || jsonb_build_object('op_id', v_op->>'op_id', 'status', 'rejected', 'code', 'not_member');
    ELSE
      v_result := v_result || private.apply_one_op(v_op);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_push(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_push(jsonb) TO authenticated;

-- ----------------------------------------------------------------------
-- 9d. public.sync_pull — ordered incremental fetch. SECURITY INVOKER: the
--     oplog RLS SELECT policy scopes rows to the caller's households.
--     p_limit is capped at 500, ordered by seq.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_pull(p_household_id text, p_after_seq bigint, p_limit int DEFAULT 200)
    RETURNS SETOF public.oplog
    LANGUAGE sql
    STABLE
    SECURITY INVOKER
    SET search_path = ''
    AS $fn$
  SELECT *
  FROM public.oplog
  WHERE household_id = p_household_id
    AND seq > coalesce(p_after_seq, 0)
  ORDER BY seq
  LIMIT least(coalesce(p_limit, 200), 500);
$fn$;

REVOKE ALL ON FUNCTION public.sync_pull(text, bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_pull(text, bigint, int) TO authenticated;

-- ----------------------------------------------------------------------
-- 9e. public.sync_row_state — current server state of one row,
--     membership-checked and table-allowlisted. Returns to_jsonb(row) or null.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_row_state(p_household_id text, p_table text, p_row_id text)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  c_tables constant text[] := array['households', 'household_members', 'envelopes', 'transactions', 'debts', 'meter_readings', 'baby_steps', 'slip_queue'];
  v_row jsonb;
BEGIN
  IF NOT (p_table = ANY (c_tables)) THEN
    RAISE EXCEPTION 'unsupported table: %', p_table USING ERRCODE = '22023';
  END IF;
  IF NOT private.is_household_member(p_household_id) THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = %L AND t.household_id = %L',
                 p_table, p_row_id, p_household_id)
    INTO v_row;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_row_state(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_row_state(text, text, text) TO authenticated;

-- ----------------------------------------------------------------------
-- 9f. public.apply_server_op — service-role entry point for edge functions
--     and crons. Takes the SAME per-household advisory lock and the SAME
--     apply path as one sync_push op, and records the op in oplog like any
--     other writer. No membership check (privileged caller).
--     (hashtextextended: see the note on sync_push above.)
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_server_op(p_op jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  v_hh text := p_op->>'household_id';
BEGIN
  IF v_hh IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hh, 0));
  END IF;
  RETURN private.apply_one_op(p_op);
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_server_op(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_server_op(jsonb) TO service_role;
