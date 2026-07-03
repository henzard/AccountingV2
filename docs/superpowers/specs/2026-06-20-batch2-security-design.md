# Batch 2 Security Remediation — Design Spec

**Date:** 2026-06-20  
**Issues:** SEC-RT-006, SEC-RT-007, SEC-RT-008, SEC-RT-009, SEC-RT-011 (#93–#97, #98)  
**Branch:** `fix/batch2-security-hardening`  
**Substitutions:** SEC-RT-010 (SQLCipher) → **HUMAN** — requires native Keystore + SQLCipher integration beyond a single migration batch.

## Problem

After batch 1 closed membership/DML holes, five Medium/High findings remain in the auth/notification/invite surface:

| ID         | Gap                                                                                |
| ---------- | ---------------------------------------------------------------------------------- |
| SEC-RT-006 | `lookup_invite_by_code` returns expired/used invites — enables brute-force probing |
| SEC-RT-007 | `notify-event` accepts unbounded payload + no sender rate limit                    |
| SEC-RT-008 | `merge_household` lets any member push `user_level` via sync                       |
| SEC-RT-009 | Cold start uses `getSession()` — may accept locally cached revoked JWT             |
| SEC-RT-011 | `extract-slip` accepts unlimited `images_base64` length — DoS vector               |

## Approach (recommended)

**Migration `020_batch2_security_hardening.sql` + edge-function + client auth hardening.**

| Issue      | Fix                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| SEC-RT-006 | Rewrite `lookup_invite_by_code`: `TRIM`/`UPPER` match, filter `used_by IS NULL` and `expires_at > NOW()`        |
| SEC-RT-008 | `merge_household` ON CONFLICT: stop updating `user_level` (insert-only on create)                               |
| SEC-RT-007 | `notify-event`: validate payload, cap title/body length, log sends in `notify_send_log`, reject >20/hour/sender |
| SEC-RT-009 | `SupabaseAuthService.validateSession()` via `getUser()`; `App.tsx` cold start calls it before trusting session  |
| SEC-RT-011 | `extract-slip`: reject `images_base64` unless length ∈ [1, 5] before OpenAI call                                |

## SEC-RT-010 (HUMAN)

Local DB encryption needs: SQLCipher-compatible driver, Keystore-derived key, migration path for existing `accountingv2-v3.db`, and MASVS validation. **Defer to human** — tracked in batch tracker with `HUMAN` label on #97.

## Testing

- `020-batch2-security.test.ts` — migration markers for invite filter, merge_household, notify_send_log
- Extend `edge-function-auth.test.ts` / `extract-slip-gaps.test.ts` for new guards
- `SupabaseAuthService.test.ts` + `auth-edge-cases.test.ts` for validateSession
- Full suite green (239+ suites)

## Success criteria

- [ ] Expired/used invite codes return empty from lookup RPC
- [ ] Sync cannot elevate `user_level` on existing household
- [ ] notify-event rejects oversize payload (title ≤120, body ≤500) and enforces 20 sends/hour cap
- [ ] App cold start clears session when `getUser()` fails
- [ ] extract-slip accepts 1–5 images and rejects 0 or >5
- [ ] Issues #93–#97, #98 closed on merge; #97 left open as HUMAN
