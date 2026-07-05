-- ============================================================================
-- 0006_fcm_tokens_multi_device.sql
--
-- Audit 2026-07-05 fix — M18: public.user_fcm_tokens has
-- PRIMARY KEY (user_id) (0001_baseline.sql:287-294), and
-- FcmTokenRegistrar.registerFcmToken upserts {user_id, token} with
-- onConflict: 'user_id'. A single row per user is therefore structurally
-- enforced by Postgres: registering from a second device (e.g. phone then
-- tablet) silently overwrites the first device's row in place. The phone's
-- token is gone from the table with no error, so the phone permanently
-- stops receiving pushes — only the most-recently-registered device is ever
-- notified. This directly contradicts notify-event/index.ts, which already
-- SELECTs and loops over ALL rows for a user_id (array/plural machinery,
-- index.ts:293-296, 367) and prunes stale tokens individually
-- (index.ts:397-405) — the edge function was written to support multiple
-- tokens per user; only the schema forbade it.
--
-- FIX: widen the primary key to (user_id, token). A single physical FCM
-- token is unique per device install, so (user_id, token) is the natural
-- key for "this user's registration on this device" — a user can now hold
-- one row per device, and re-registering the SAME token on the SAME device
-- (e.g. app relaunch) still upserts in place instead of accumulating
-- duplicate rows. RLS is unaffected: user_fcm_tokens_select/insert/
-- update/delete (0001_baseline.sql:817-832) all key off `user_id =
-- auth.uid()::text` only, never the primary key shape, so per-user
-- isolation holds unchanged.
--
-- This is a FORWARD migration (ALTER TABLE), matching 0002's pattern; it
-- does not edit 0001 so historical replay stays intact. CI must run this
-- against a fresh `supabase db reset` to confirm 0001 -> ... -> 0006 applies
-- cleanly end to end (not verified here — verified only against a running
-- Postgres instance per the task's local-verification note).
-- ============================================================================

ALTER TABLE public.user_fcm_tokens
  DROP CONSTRAINT user_fcm_tokens_pkey;

ALTER TABLE public.user_fcm_tokens
  ADD CONSTRAINT user_fcm_tokens_pkey PRIMARY KEY (user_id, token);
