-- 0013_emf_unique.sql
-- Partial unique index: at most one ACTIVE (not archived, not soft-deleted)
-- `emergency_fund` envelope per household.
--
-- Closes a same-device TOCTOU race in CreateEnvelopeUseCase's create-time
-- EMF duplicate guard: that guard does a pre-check SELECT for an existing
-- active emergency_fund, then a separate INSERT. Two overlapping execute()
-- calls (e.g. a double-tap, or two in-flight calls in the same process) can
-- both pass the SELECT before either INSERT lands, each inserting its own
-- active emergency_fund row. With this index, the second INSERT now raises
-- a UNIQUE constraint violation instead, which CreateEnvelopeUseCase catches
-- and maps to the same DUPLICATE_EMERGENCY_FUND failure the pre-check
-- returns on the fast path.
--
-- Scope note: this is a LOCAL (same-device) guarantee only. Two different
-- OFFLINE devices each creating their own emergency_fund (different random
-- ids, each device's own local DB only ever seeing its own row) are NOT
-- caught by this local index — that CROSS-DEVICE case remains the job of
-- `ReconcileEmergencyFundTypeUseCase` / `emergencyFundReconcileStore` as a
-- backstop once the two rows sync and meet, unchanged by this migration.
--
-- Dedupe FIRST: any device that accumulated duplicate active emergency_fund
-- rows for a household BEFORE the create-time guard existed would otherwise
-- make `CREATE UNIQUE INDEX` abort — blocking this migration and hanging boot
-- (dbReady never flips) on that device. Keep the earliest-inserted active EMF
-- per household (`MIN(rowid)`) and FLIP the rest to `savings` (NOT soft-delete)
-- so the index can build without hiding money: the losing row may already hold
-- `allocated_cents`/linked transactions, and `EnvelopeBalanceQuery` excludes
-- `deleted_at` rows — soft-deleting would silently drop that balance. Flipping
-- the type preserves the row and its state, matching
-- `ReconcileEmergencyFundTypeUseCase`'s cross-device reconcile. Idempotent: on
-- a re-run each household already has exactly one active EMF, so nothing
-- matches. The `MIN(rowid)` subquery is uncorrelated, so SQLite evaluates it
-- once (before any flip) — the keepers are fixed up front.
--> statement-breakpoint
UPDATE `envelopes`
SET `envelope_type` = 'savings', `updated_at` = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE `envelope_type` = 'emergency_fund'
  AND `deleted_at` IS NULL
  AND `is_archived` = 0
  AND `rowid` NOT IN (
    SELECT MIN(`rowid`) FROM `envelopes`
    WHERE `envelope_type` = 'emergency_fund' AND `deleted_at` IS NULL AND `is_archived` = 0
    GROUP BY `household_id`
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `envelopes_one_active_emf_per_household` ON `envelopes` (`household_id`) WHERE `envelope_type` = 'emergency_fund' AND `deleted_at` IS NULL AND `is_archived` = 0;
