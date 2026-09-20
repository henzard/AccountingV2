// src/data/sync/emergencyFundConflict.ts
//
// SYNC-5. Migration 0013 put a LOCAL partial unique index on envelopes —
// `envelopes_one_active_emf_per_household`, one active `emergency_fund` per
// household. It closes a same-device create race, but it also means an
// INBOUND emergency_fund row can collide with one this device already has:
// two members who each create an Emergency Fund offline produce two rows with
// different ids, both perfectly legal server-side (the server has no such
// index).
//
// What that did before this module:
//   - the puller's `INSERT OR IGNORE` swallowed the index violation along
//     with the id conflict it was meant for, so each device silently DROPPED
//     the other's envelope. Its transactions (and now its
//     `envelope_contributions`) then referenced an envelope that does not
//     exist locally, and `ReconcileEmergencyFundTypeUseCase` — which resolves
//     duplicates by looking for two rows — never saw two rows to resolve;
//   - restore's `onConflictDoUpdate` targets `id` only, so the index
//     violation threw and aborted the ENTIRE household restore.
//
// The rule below replaces both behaviours with one deterministic resolution,
// shared by the puller and by restore so they can never disagree:
//
//   the OLDER row (by `created_at`, ties broken by id) stays
//   `emergency_fund`; the newer one is stored as `savings`.
//
// Deterministic from data both devices already have, so every replica reaches
// the same answer independently — convergence does not depend on the
// demotion op below arriving. Demotion keeps the row's id, so its
// transactions and `envelope_contributions` stay valid, and `savings` is a
// persistent envelope type like `emergency_fund`, so scope/period behaviour
// is unchanged. Nothing is deleted and no money moves.

import { sql } from 'drizzle-orm';
import { randomUUID } from 'expo-crypto';
import { appendOplogRowWithin, type PortableDb } from '../uow/UnitOfWork';
import type { SyncedRepoCtx } from '../uow/createSyncedRepo';
import { logger } from '../../infrastructure/logging/Logger';

export type ActiveEnvelopeType = 'emergency_fund' | 'savings';

interface LocalEmfRow {
  id: string;
  created_at: string | null;
}

/** True when `a` should keep `emergency_fund` over `b`: older wins, and an
 * id comparison breaks a tie (or a missing timestamp) so the answer is total
 * and identical on every device. */
function winsEmergencyFund(
  a: { id: string; createdAt: string },
  b: { id: string; createdAt: string },
): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.id < b.id;
}

/**
 * Resolves an INBOUND active `emergency_fund` envelope against whatever this
 * device already holds, performing the local demotion when the inbound row
 * wins, and returns the `envelope_type` the inbound row must be STORED as.
 *
 * Call this only for an incoming row that is itself an active (not deleted,
 * not archived) `emergency_fund`. Must run inside the same transaction as the
 * write it is resolving, so the demotion and the insert commit together.
 *
 * When the local row is demoted, the entity update AND its `update` oplog op
 * are written through `appendOplogRowWithin` — the same statement every
 * domain write uses — so the demotion replicates to the server instead of
 * being a local-only divergence. Both devices may independently emit that
 * update for their own row; the ops are absolute-value and idempotent, and
 * once a household has a single active EMF this function stops matching, so
 * there is no ping-pong.
 */
export function resolveIncomingEmergencyFund(
  tx: PortableDb,
  params: {
    householdId: string;
    incomingId: string;
    incomingCreatedAt: string;
    ctx: SyncedRepoCtx;
  },
): ActiveEnvelopeType {
  const { householdId, incomingId, incomingCreatedAt, ctx } = params;

  const existing = tx.get<LocalEmfRow>(sql`
    SELECT id, created_at FROM envelopes
    WHERE household_id = ${householdId}
      AND id <> ${incomingId}
      AND envelope_type = 'emergency_fund'
      AND deleted_at IS NULL
      AND is_archived = 0
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `);
  if (!existing) return 'emergency_fund';

  const incoming = { id: incomingId, createdAt: incomingCreatedAt };
  const local = { id: existing.id, createdAt: existing.created_at ?? '' };

  if (!winsEmergencyFund(incoming, local)) {
    // The local row is older — it keeps emergency_fund and the inbound row
    // lands as savings. No local write at all, and no op: the ORIGIN device
    // runs this same rule against the same two rows and demotes its own copy.
    logger.info('SYNC-5: inbound emergency_fund stored as savings (older local EMF wins)', {
      householdId,
      incomingId,
      keptId: local.id,
    });
    return 'savings';
  }

  // The inbound row is older, so THIS device's row must step aside. Written
  // through the oplog so the server converges too.
  const now = ctx.clock();
  tx.run(sql`
    UPDATE envelopes SET envelope_type = 'savings', updated_at = ${now}
    WHERE id = ${local.id} AND household_id = ${householdId}
  `);
  appendOplogRowWithin(tx, {
    opId: ctx.genId ? ctx.genId() : randomUUID(),
    householdId,
    tableName: 'envelopes',
    rowId: local.id,
    opType: 'update',
    payload: { envelope_type: 'savings', updated_at: now },
    actorUserId: ctx.actorUserId,
    deviceId: ctx.deviceId,
    clientCreatedAt: now,
  });
  logger.info('SYNC-5: local emergency_fund demoted to savings (older inbound EMF wins)', {
    householdId,
    demotedId: local.id,
    incomingId,
  });
  return 'emergency_fund';
}

/** True if a row (snake_case, as it arrives from the server or an oplog
 * payload) is an ACTIVE emergency_fund — the only case the rule applies to.
 * `is_archived` arrives as a boolean from PostgREST and as 0/1 from SQLite. */
export function isActiveEmergencyFund(row: Record<string, unknown>): boolean {
  return (
    row.envelope_type === 'emergency_fund' &&
    row.deleted_at == null &&
    !row.is_archived &&
    row.is_archived !== 1
  );
}
