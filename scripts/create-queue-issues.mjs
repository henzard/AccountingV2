#!/usr/bin/env node
/**
 * Bulk-create GitHub issues from docs/queue.md open findings.
 * Usage: node scripts/create-queue-issues.mjs [--dry-run]
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const LABELS = [
  ['security', 'd73a4a', 'Security / red team findings'],
  ['sync', '1d76db', 'Sync and replication correctness'],
  ['data-loss', 'b60205', 'Data integrity / silent write loss'],
  ['critical', 'b60205', 'Critical severity'],
  ['high', 'd93f0b', 'High severity'],
  ['medium', 'd97706', 'Medium severity'],
  ['low', '16a34a', 'Low severity'],
  ['tier-0', '5319e7', 'Architectural known gap (Tier 0)'],
  ['quality', '0e8a16', 'Quality review finding'],
  ['tests', 'fbca04', 'Test coverage / authenticity'],
  ['ux', 'c5def5', 'UX / accessibility'],
  ['database', '006b75', 'Database / schema / RLS'],
  ['api', '8250df', 'API / edge functions'],
  ['ci', 'ededed', 'CI/CD pipeline'],
];

const findings = [
  // Tier 0
  { id: 'LWW-001', sev: 'high', tier: 'tier-0', labels: ['sync', 'data-loss', 'high', 'tier-0'], domain: 'sync', title: 'Concurrent spentCents increments lost to LWW', location: 'merge_envelope RPC', fix: 'Delta-based SQL for counter fields', effort: 'L', refs: 'docs/known-gaps/lww-data-loss.md' },
  { id: 'LWW-002', sev: 'high', tier: 'tier-0', labels: ['sync', 'data-loss', 'high', 'tier-0'], domain: 'sync', title: 'Kruger multi-user scenario — same LWW counter loss', location: 'src/__tests__/sync/concurrent-user-sync.test.ts', fix: 'Same as LWW-001', effort: 'L', refs: 'docs/known-gaps/lww-data-loss.md' },
  { id: 'LWW-003', sev: 'high', tier: 'tier-0', labels: ['sync', 'data-loss', 'high', 'tier-0'], domain: 'sync', title: 'Debt outstandingBalanceCents absolute overwrite', location: 'merge_debt RPC', fix: 'Server-side original - total_paid', effort: 'M', refs: 'docs/known-gaps/lww-data-loss.md' },
  { id: 'LWW-004', sev: 'medium', tier: 'tier-0', labels: ['sync', 'data-loss', 'medium', 'tier-0'], domain: 'sync', title: 'No field-level merge — whole row dropped', location: 'All merge_* RPCs', fix: 'Per-column timestamps or CRDT', effort: 'L', refs: 'docs/known-gaps/lww-data-loss.md' },
  { id: 'LWW-005', sev: 'medium', tier: 'tier-0', labels: ['sync', 'medium', 'tier-0'], domain: 'sync', title: 'Merge RPC returns success when LWW rejects row', location: 'SyncOrchestrator.ts + RPCs', fix: 'Return conflict flag + user toast', effort: 'M', refs: 'docs/known-gaps/lww-data-loss.md' },
  { id: 'RESTORE-001', sev: 'high', tier: 'tier-0', labels: ['sync', 'data-loss', 'high', 'tier-0'], domain: 'sync', title: 'Restore overwrites local dirty rows', location: 'RestoreService.ts ~177', fix: 'onConflictDoNothing when isSynced=false', effort: 'M', refs: 'docs/known-gaps/restore-ordering.md' },
  { id: 'RESTORE-002', sev: 'medium', tier: 'tier-0', labels: ['sync', 'medium', 'tier-0'], domain: 'sync', title: 'pending_sync not cleared after restore overwrite', location: 'RestoreService.ts', fix: 'DELETE stale pending rows post-restore', effort: 'S', refs: 'docs/known-gaps/restore-ordering.md' },
  { id: 'RESTORE-003', sev: 'high', tier: 'tier-0', labels: ['sync', 'data-loss', 'high', 'tier-0'], domain: 'sync', title: 'Row is isSynced=false but holds remote data', location: 'restoreTable()', fix: 'Combine RESTORE-001 + conditional conflict', effort: 'M', refs: 'docs/known-gaps/restore-ordering.md' },
  { id: 'SOFTDEL-001', sev: 'high', tier: 'tier-0', labels: ['sync', 'data-loss', 'high', 'tier-0'], domain: 'sync', title: 'Hard DELETE locally, no tombstone', location: 'DeleteTransactionUseCase.ts', fix: 'Soft-delete + query filters', effort: 'L', refs: 'src/__tests__/sync/soft-delete-gaps.test.ts' },
  { id: 'SOFTDEL-002', sev: 'high', tier: 'tier-0', labels: ['sync', 'data-loss', 'high', 'tier-0'], domain: 'sync', title: 'Hard DELETE on Supabase push', location: 'SyncOrchestrator.ts:186', fix: 'Tombstone upsert instead of .delete()', effort: 'L', refs: 'src/__tests__/sync/soft-delete-gaps.test.ts' },
  { id: 'SOFTDEL-003', sev: 'high', tier: 'tier-0', labels: ['sync', 'data-loss', 'high', 'tier-0'], domain: 'sync', title: 'Deletes do not propagate to offline devices', location: 'Sync + restore', fix: 'End-to-end tombstone pipeline', effort: 'L', refs: 'src/__tests__/sync/soft-delete-gaps.test.ts' },
  { id: 'SOFTDEL-004', sev: 'medium', tier: 'tier-0', labels: ['sync', 'medium', 'tier-0'], domain: 'sync', title: 'Restore never purges orphaned local rows', location: 'RestoreService.restoreTable()', fix: 'Delete locals not in remote set', effort: 'M', refs: 'src/__tests__/sync/soft-delete-gaps.test.ts' },

  // Tier 1 — Sync
  { id: 'QR-SYNC-001', sev: 'critical', tier: 'quality', labels: ['sync', 'data-loss', 'critical', 'quality'], domain: 'sync', title: 'No incremental pull — other members changes never reach local replicas', location: 'App.tsx:88-179, RestoreService.ts', fix: 'Add PullService (cursor/updated_at per table) on reconnect, household switch, foreground; skip dirty rows', effort: 'L' },
  { id: 'QR-SYNC-002', sev: 'high', tier: 'quality', labels: ['sync', 'high', 'quality'], domain: 'sync', title: 'Module-level isSyncRunning silently drops overlapping sync calls', location: 'SyncOrchestrator.ts:63,76', fix: 'Queue/mutex: chain runs or drain until empty', effort: 'M' },
  { id: 'QR-SYNC-003', sev: 'high', tier: 'quality', labels: ['sync', 'high', 'quality'], domain: 'sync', title: '.limit(100) with no loop — item 101+ waits indefinitely', location: 'SyncOrchestrator.ts:92-93', fix: 'Re-query until empty or paginate with cursor', effort: 'S' },
  { id: 'QR-SYNC-004', sev: 'high', tier: 'quality', labels: ['sync', 'high', 'quality', 'ux'], domain: 'sync', title: 'deadLettered count never surfaced to user', location: 'App.tsx:127-136, SyncOrchestrator.ts:146-151', fix: 'Toast + Settings Sync issues list with retry', effort: 'M' },
  { id: 'QR-SYNC-005', sev: 'medium', tier: 'quality', labels: ['sync', 'medium', 'quality'], domain: 'sync', title: 'Partial restore failures silent', location: 'RestoreService.ts:168,133', fix: 'Log per-table failures; return { partial, failedTables }', effort: 'S' },
  { id: 'QR-SYNC-006', sev: 'high', tier: 'quality', labels: ['sync', 'data-loss', 'high', 'quality'], domain: 'sync', title: 'isSynced=true without updatedAt snapshot guard', location: 'SyncOrchestrator.ts:224-229', fix: 'WHERE updated_at = snapshot on mark-synced', effort: 'M' },
  { id: 'QR-SYNC-007', sev: 'medium', tier: 'quality', labels: ['sync', 'medium', 'quality'], domain: 'sync', title: 'spentCents can drift from SUM(transactions)', location: 'Domain + sync', fix: 'Reconciliation on boot', effort: 'M' },

  // Tier 1 — Tests
  { id: 'QR-TEST-001', sev: 'high', tier: 'quality', labels: ['tests', 'high', 'quality'], domain: 'tests', title: 'merge-rpc-contracts.test.ts never calls SyncOrchestrator', location: 'merge-rpc-contracts.test.ts:22-35', fix: 'Mock Supabase; assert rpc(name,{r}) per table', effort: 'M' },
  { id: 'QR-TEST-002', sev: 'high', tier: 'quality', labels: ['tests', 'api', 'high', 'quality'], domain: 'tests', title: 'notify-event-handler replica skips auth/membership/IDOR checks', location: 'notify-event-handler.test.ts:27-69', fix: 'Match prod handler or shared module + 401/403 tests', effort: 'M' },
  { id: 'QR-TEST-003', sev: 'high', tier: 'quality', labels: ['tests', 'api', 'high', 'quality'], domain: 'tests', title: 'Deno notify-event suite only tests payload helper', location: 'notify-event/__tests__/notify-event.test.ts', fix: 'Full handler tests (auth, membership, FCM)', effort: 'M' },
  { id: 'QR-TEST-004', sev: 'medium', tier: 'quality', labels: ['tests', 'medium', 'quality'], domain: 'tests', title: 'non-atomic-writes tautological spentCents assertions', location: 'non-atomic-writes.test.ts:237-260', fix: 'Assert rollback when update throws', effort: 'S' },
  { id: 'QR-TEST-005', sev: 'high', tier: 'quality', labels: ['tests', 'high', 'quality'], domain: 'tests', title: 'babyStepsSyncIntegration uses pure mock DB, not SQLite', location: 'babyStepsSyncIntegration.test.ts', fix: 'One in-memory Drizzle round-trip test', effort: 'L' },
  { id: 'QR-TEST-006', sev: 'high', tier: 'quality', labels: ['tests', 'high', 'quality'], domain: 'tests', title: 'CreateTransactionUseCase updates spentCents only checks call count', location: 'CreateTransactionUseCase.test.ts:67-74', fix: 'Assert .set({ spentCents: prior + amount })', effort: 'S' },
  { id: 'QR-TEST-007', sev: 'medium', tier: 'quality', labels: ['tests', 'medium', 'quality'], domain: 'tests', title: 'snowball-lifecycle bypasses LogDebtPaymentUseCase', location: 'snowball-lifecycle.test.ts:54-64', fix: 'Drive via LogDebtPaymentUseCase', effort: 'M' },
  { id: 'QR-TEST-008', sev: 'medium', tier: 'quality', labels: ['tests', 'medium', 'quality'], domain: 'tests', title: 'Slip RPC test uses imageCount; schema has image_uris', location: 'merge-rpc-contracts.test.ts:156-173', fix: 'Fix fixture + assert image_uris in payload', effort: 'S' },
  { id: 'QR-TEST-009', sev: 'high', tier: 'quality', labels: ['tests', 'high', 'quality'], domain: 'tests', title: 'Zero coverage: LineItemRow.tsx', location: 'slipScanning/components/LineItemRow.tsx', fix: 'Component tests for edit/validation', effort: 'S' },
  { id: 'QR-TEST-010', sev: 'high', tier: 'quality', labels: ['tests', 'high', 'quality'], domain: 'tests', title: 'Low coverage: SlipCaptureScreen ~47%', location: 'SlipCaptureScreen.tsx', fix: 'Camera permission, multi-shot, errors', effort: 'M' },
  { id: 'QR-TEST-011', sev: 'high', tier: 'quality', labels: ['tests', 'ci', 'high', 'quality'], domain: 'tests', title: 'No Detox E2E on PR branches', location: 'ci.yml:42-43', fix: 'Smoke E2E on PR or nightly', effort: 'M' },
  { id: 'QR-TEST-012', sev: 'medium', tier: 'quality', labels: ['tests', 'sync', 'medium', 'quality'], domain: 'tests', title: 'No sync property tests (R7)', location: '—', fix: 'Fault-injection harness', effort: 'L' },
  { id: 'QR-TEST-013', sev: 'medium', tier: 'quality', labels: ['tests', 'medium', 'quality'], domain: 'tests', title: 'Scenario seed not run against live Supabase', location: 'scenarioSeed.ts', fix: 'Staging integration (4 users, 2 HH, 200 tx)', effort: 'L' },

  // Tier 1 — UX
  { id: 'QR-UX-001', sev: 'high', tier: 'quality', labels: ['ux', 'high', 'quality'], domain: 'ux', title: 'BudgetScreen shows empty state on hook error', location: 'BudgetScreen.tsx:35,73-78', fix: 'Error banner + retry (like TransactionList)', effort: 'S' },
  { id: 'QR-UX-002', sev: 'high', tier: 'quality', labels: ['ux', 'high', 'quality'], domain: 'ux', title: 'SinkingFundsScreen shows empty state on hook error', location: 'SinkingFundsScreen.tsx:31,47-52', fix: 'Error banner + retry', effort: 'S' },
  { id: 'QR-UX-003', sev: 'medium', tier: 'quality', labels: ['ux', 'medium', 'quality'], domain: 'ux', title: 'ForecastScreen shows empty state on hook error', location: 'ForecastScreen.tsx:33,55-57', fix: 'Error banner + retry', effort: 'S' },
  { id: 'QR-UX-004', sev: 'high', tier: 'quality', labels: ['ux', 'high', 'quality'], domain: 'ux', title: 'DashboardScreen no error from hooks', location: 'DashboardScreen.tsx:50-51', fix: 'Inline error on hero/budget sections', effort: 'M' },
  { id: 'QR-UX-005', sev: 'medium', tier: 'quality', labels: ['ux', 'medium', 'quality'], domain: 'ux', title: 'MeterDashboardScreen failures show blank cards', location: 'MeterDashboardScreen.tsx:37-65', fix: 'error state + retry', effort: 'S' },
  { id: 'QR-UX-006', sev: 'medium', tier: 'quality', labels: ['ux', 'medium', 'quality'], domain: 'ux', title: 'LogPaymentScreen missing debt shows disabled form, no message', location: 'LogPaymentScreen.tsx:29-41', fix: 'Debt not found + back', effort: 'S' },
  { id: 'QR-UX-007', sev: 'medium', tier: 'quality', labels: ['ux', 'medium', 'quality'], domain: 'ux', title: 'EnvelopeCard missing a11y label/role', location: 'EnvelopeCard.tsx:29', fix: 'accessibilityLabel on ripples', effort: 'S' },
  { id: 'QR-UX-008', sev: 'medium', tier: 'quality', labels: ['ux', 'medium', 'quality'], domain: 'ux', title: 'Delete IconButton below 24x24 target', location: 'TransactionListScreen.tsx:158-164', fix: 'size={24} or hitSlop', effort: 'S' },

  // Tier 1 — API/DB/Code
  { id: 'QR-API-001', sev: 'high', tier: 'quality', labels: ['api', 'high', 'quality'], domain: 'api', title: 'notify-event missing payload validation', location: 'notify-event/index.ts:42-43', fix: 'Required fields → 400; try/catch JSON', effort: 'S' },
  { id: 'QR-API-002', sev: 'high', tier: 'quality', labels: ['api', 'tests', 'high', 'quality'], domain: 'api', title: 'Jest handler replicas drift from Deno prod', location: 'extract-slip-gaps.test.ts, notify-event-handler.test.ts', fix: 'Export shared handle() importable by both', effort: 'M' },
  { id: 'QR-DB-001', sev: 'high', tier: 'quality', labels: ['database', 'high', 'quality'], domain: 'database', title: 'Missing indexes on restore hot paths', location: 'RestoreService.ts:163-166', fix: 'idx_transactions_household_id, idx_envelopes_household_period', effort: 'S' },
  { id: 'QR-DB-002', sev: 'medium', tier: 'quality', labels: ['database', 'sync', 'medium', 'quality'], domain: 'database', title: 'No index on pending_sync queue columns', location: 'pendingSync.ts, SyncOrchestrator.ts:83-92', fix: 'Composite index on DLQ/retry/created_at', effort: 'S' },
  { id: 'QR-DB-003', sev: 'medium', tier: 'quality', labels: ['database', 'medium', 'quality'], domain: 'database', title: 'Local SQLite: PRAGMA foreign_keys not enabled', location: 'src/data/local/', fix: 'Enable FK + Drizzle declarations', effort: 'M' },
  { id: 'QR-CODE-001', sev: 'medium', tier: 'quality', labels: ['ci', 'medium', 'quality'], domain: 'code-quality', title: 'GitHub Actions floating @v4 tags', location: 'ci.yml, cd.yml', fix: 'Pin to commit SHA', effort: 'S' },
  { id: 'QR-CODE-002', sev: 'low', tier: 'quality', labels: ['documentation', 'low', 'quality'], domain: 'code-quality', title: 'findings.json metrics stale', location: 'docs/findings.json', fix: 'Refresh to 2013 tests + current fixes', effort: 'S' },

  // Tier 2 — Security
  { id: 'SEC-RT-001', sev: 'critical', tier: 'security', labels: ['security', 'critical'], domain: 'security', title: 'Any user can join any household via household_members INSERT', location: '005_security_and_sync_correctness.sql:173-175', fix: 'Restrict to accept_household_invite RPC; RLS must require invite', effort: 'M', owasp: 'A01 / CWE-862', note: 'RLS only checks user_id = auth.uid() — no invite check' },
  { id: 'SEC-RT-002', sev: 'critical', tier: 'security', labels: ['security', 'critical'], domain: 'security', title: 'Direct user_households INSERT grants access to any household', location: '002_rls_policies.sql:17-18', fix: 'Tighten WITH CHECK or remove client INSERT; trigger-only population', effort: 'M', owasp: 'A01 / CWE-639' },
  { id: 'SEC-RT-003', sev: 'high', tier: 'security', labels: ['security', 'high', 'database'], domain: 'security', title: 'Direct PostgREST PATCH bypasses merge RPC LWW guards', location: '002_rls_policies.sql:27-55, 011', fix: 'REVOKE table DML for authenticated; writes only via merge_* RPCs', effort: 'L', owasp: 'API3 / CWE-841' },
  { id: 'SEC-RT-004', sev: 'high', tier: 'security', labels: ['security', 'high', 'database'], domain: 'security', title: 'Migration 018 dropped completed-slip overwrite protection', location: '018_security_fixes.sql:59-72', fix: 'Restore 007 guard: block overwrite when status=completed', effort: 'S', owasp: 'A04 / CWE-362' },
  { id: 'SEC-RT-005', sev: 'high', tier: 'security', labels: ['security', 'high', 'database'], domain: 'security', title: 'inv_insert allows invites for households user does not belong to', location: '008_phase2_data_integrity.sql:13-15', fix: 'WITH CHECK household membership + owner role', effort: 'S', owasp: 'A01 / CWE-285' },
  { id: 'SEC-RT-006', sev: 'high', tier: 'security', labels: ['security', 'high', 'database'], domain: 'security', title: 'lookup_invite_by_code brute-forceable, no expiry filter', location: '008_phase2_data_integrity.sql:24-46', fix: 'Filter expired/used; rate limit; increase entropy', effort: 'M', owasp: 'A07 / CWE-307' },
  { id: 'SEC-RT-007', sev: 'medium', tier: 'security', labels: ['security', 'api', 'medium'], domain: 'security', title: 'notify-event push spam by any household member', location: 'notify-event/index.ts:42,101-117', fix: 'Rate limit; max title/body length; server-triggered only', effort: 'M', owasp: 'A04 / CWE-799' },
  { id: 'SEC-RT-008', sev: 'medium', tier: 'security', labels: ['security', 'database', 'medium'], domain: 'security', title: 'Any member can set user_level=3 via merge_household', location: '016_lww_direction_independent_tiebreaker.sql:216', fix: 'Remove from client-writable merge; server-computed', effort: 'S', owasp: 'A01 / CWE-269' },
  { id: 'SEC-RT-009', sev: 'medium', tier: 'security', labels: ['security', 'medium'], domain: 'security', title: 'getSession() may accept revoked JWT without server check', location: 'SupabaseAuthService.ts:31-39', fix: 'Use getUser() on foreground + sensitive paths', effort: 'S', owasp: 'A07 / CWE-613' },
  { id: 'SEC-RT-010', sev: 'medium', tier: 'security', labels: ['security', 'medium'], domain: 'security', title: 'Local SQLite unencrypted — financial history on rooted device', location: 'src/data/local/db.ts:7-8', fix: 'SQLCipher + Keystore-derived key', effort: 'L', owasp: 'MASVS / CWE-311' },
  { id: 'SEC-RT-011', sev: 'medium', tier: 'security', labels: ['security', 'api', 'medium'], domain: 'security', title: 'extract-slip accepts unlimited images_base64 array length', location: 'extract-slip/index.ts:80-83', fix: 'Reject if length not in [1,5] before rate-limit', effort: 'S', owasp: 'A04 / CWE-400' },
  { id: 'SEC-RT-012', sev: 'medium', tier: 'security', labels: ['security', 'database', 'medium'], domain: 'security', title: 'Rate-limit griefing via pending slip rows', location: '008_phase2_data_integrity.sql:81-88', fix: 'Count only processing/completed; per-user cap', effort: 'S', owasp: 'A04 / CWE-770' },
  { id: 'SEC-RT-013', sev: 'medium', tier: 'security', labels: ['security', 'database', 'medium'], domain: 'security', title: 'Members can inject fake audit_events', location: '005_security_and_sync_correctness.sql:483', fix: 'Deny authenticated INSERT; service-role triggers only', effort: 'S', owasp: 'A09 / CWE-117' },
  { id: 'SEC-RT-014', sev: 'medium', tier: 'security', labels: ['security', 'sync', 'medium'], domain: 'security', title: 'DELETE sync bypasses merge RPC; silent zero-row delete', location: 'SyncOrchestrator.ts:185-188', fix: 'Route via delete_* RPC; fail if 0 rows', effort: 'M', owasp: 'A01 / CWE-863', note: 'Needs manual confirmation' },
  { id: 'SEC-RT-015', sev: 'low', tier: 'security', labels: ['security', 'api', 'low'], domain: 'security', title: 'FCM legacy HTTP API deprecated', location: 'notify-event/index.ts:103', fix: 'Migrate to HTTP v1 + OAuth2', effort: 'M', owasp: 'A02 / CWE-1104' },
  { id: 'SEC-RT-016', sev: 'low', tier: 'security', labels: ['security', 'ci', 'low'], domain: 'security', title: 'CD pipeline omits Deno edge tests', location: 'cd.yml vs ci.yml', fix: 'Add deno test supabase/functions/ to cd-gate', effort: 'S', owasp: 'CICD / CWE-693' },
  { id: 'SEC-RT-017', sev: 'low', tier: 'security', labels: ['security', 'ci', 'low'], domain: 'security', title: 'Firebase Test Lab uses continue-on-error: true', location: 'cd.yml:117', fix: 'Remove once API enabled', effort: 'S', owasp: 'CICD / CWE-693' },
  { id: 'SEC-RT-018', sev: 'low', tier: 'security', labels: ['security', 'low'], domain: 'security', title: 'Password policy client-only (>=8 chars)', location: 'SignUpScreen.tsx:37-39', fix: 'Enforce in Supabase Auth dashboard', effort: 'S', owasp: 'A07 / CWE-521', note: 'Needs manual confirmation' },
];

function sevLabel(sev) {
  return sev.charAt(0).toUpperCase() + sev.slice(1);
}

function buildBody(f) {
  const lines = [
    '## Summary',
    '',
    f.title,
    '',
    '## Finding metadata',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **ID** | \`${f.id}\` |`,
    `| **Severity** | ${sevLabel(f.sev)} |`,
    `| **Tier** | ${f.tier === 'tier-0' ? 'Tier 0 — Architectural' : f.tier === 'security' ? 'Tier 2 — Security Red Team' : 'Tier 1 — Quality review'} |`,
    `| **Domain** | ${f.domain} |`,
    `| **Effort** | ${f.effort} |`,
    `| **Location** | \`${f.location}\` |`,
  ];
  if (f.owasp) lines.push(`| **OWASP / CWE** | ${f.owasp} |`);
  if (f.note) lines.push(`| **Note** | ${f.note} |`);
  lines.push(
    '',
    '## Suggested fix',
    '',
    f.fix,
    '',
    '## Verification plan',
    '',
    '- [ ] Add or extend a test that fails on the insecure / broken behavior and passes after the fix',
    '- [ ] Full test suite green (`npm test`)',
    '- [ ] Update `docs/queue.md` status to `fixed` when merged',
    '',
    '## References',
    '',
    '- [docs/queue.md](https://github.com/henzard/AccountingV2/blob/main/docs/queue.md)',
    '- [docs/findings.json](https://github.com/henzard/AccountingV2/blob/main/docs/findings.json) (scorecard source)',
    '- [docs/audit-report.html](https://github.com/henzard/AccountingV2/blob/main/docs/audit-report.html)',
  );
  if (f.refs) lines.push(`- ${f.refs}`);
  if (f.tier === 'security') {
    lines.push(
      '',
      '> **Public hardening note:** This finding is already documented in committed audit artifacts (`docs/queue.md`, `docs/findings.json`). For live unpatched exploits not yet in audit docs, use a private GitHub Security Advisory instead.',
    );
  }
  return lines.join('\n');
}

function gh(args, input) {
  return execSync(`gh ${args}`, {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    stdio: input ? ['pipe', 'pipe', 'pipe'] : ['inherit', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
}

function ensureLabels() {
  const existing = new Set(
    gh('label list --limit 200')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t')[0]),
  );
  for (const [name, color, desc] of LABELS) {
    if (existing.has(name)) continue;
    const cmd = `label create "${name}" --color "${color}" --description "${desc}"`;
    if (dryRun) {
      console.log(`[dry-run] gh ${cmd}`);
    } else {
      try {
        gh(cmd);
        console.log(`Created label: ${name}`);
      } catch (e) {
        console.warn(`Label ${name}: ${e.stderr || e.message}`);
      }
    }
  }
}

function main() {
  console.log(`Creating ${findings.length} issues${dryRun ? ' (dry-run)' : ''}...`);
  ensureLabels();

  const created = [];
  for (const f of findings) {
    const title = `[${f.id}] ${f.title}`;
    const body = buildBody(f);
    const labelArgs = [...new Set(f.labels)].map((l) => `--label "${l}"`).join(' ');

    if (dryRun) {
      console.log(`\n--- ${title} ---\n${body.slice(0, 200)}...\nlabels: ${f.labels.join(', ')}`);
      continue;
    }

    const bodyFile = join(repoRoot, 'scripts', '.issue-body.tmp');
    writeFileSync(bodyFile, body, 'utf8');
    try {
      const out = gh(`issue create --title "${title.replace(/"/g, '\\"')}" --body-file "${bodyFile}" ${labelArgs}`);
      const url = out.trim();
      created.push({ id: f.id, url });
      console.log(`Created ${f.id}: ${url}`);
    } catch (e) {
      console.error(`FAILED ${f.id}: ${e.stderr || e.message}`);
      process.exitCode = 1;
    }
  }

  if (!dryRun && created.length) {
    const manifest = join(repoRoot, 'docs', 'issue-manifest.json');
    writeFileSync(manifest, JSON.stringify({ createdAt: new Date().toISOString(), count: created.length, issues: created }, null, 2));
    console.log(`\nWrote manifest: docs/issue-manifest.json (${created.length} issues)`);
  }
}

main();
