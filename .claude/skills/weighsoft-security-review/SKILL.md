---
name: weighsoft-security-review
formerly: security-review
description: Red team / blue team / verify security review of source on dev — offensive agents find exploitable weaknesses, defensive agents fix + add regression tests, a verification pass re-attacks the patched code to confirm each finding is closed
version: 1.0.0
category: security
tags:
  - security
  - red-team
  - blue-team
  - review
  - owasp
  - dev
---

> 🔁 **Renamed:** this skill is now **weighsoft-security-review** (formerly **security-review**). Update any references.

# /weighsoft-security-review — Red Team / Blue Team Source Review

A structured, white-box security assessment of the codebase, run as three
phases: **Red Team** (offensive, find weaknesses) → **Blue Team** (defensive,
fix + harden + test) → **Verify** (re-attack the patch, confirm closed). Spawn
specialist agents in parallel within each phase, then synthesize.

> Honest caveat to state in every report: an LLM review + scanners substantially
> reduces risk but **cannot prove a system is unhackable**. Treat it as one
> strong layer. Keep a human reviewer on Critical findings and anything touching
> **auth, crypto, payments, or multi-tenant isolation**.

## When to use

- Before exposing a service publicly, or on a schedule against `dev`.
- On a PR/branch diff as a merge gate.
- After any change to auth, sessions, secrets, the data layer, or external I/O.

## Step 1 — Scope & stack

1. Determine the target (in priority order): open PR diff → uncommitted/staged
   changes → a path the user named → the whole repo.
2. Detect the stack from the repo (e.g. Express, SQLite/Postgres/Supabase,
   React/Vite, the deploy target). Tailor every check to what's actually used.
3. Read existing security-relevant config: `Dockerfile`, `deploy/`, helmet/CSP
   setup, auth middleware, migrations, `.env.example`, CI workflows.

## Step 2 — Red Team (offensive)

Spawn these agents **in parallel** (Task tool, `run_in_background: true`). Each
is white-box with full source access and assumes a motivated adversary. Each
returns ONLY a findings list — no fixes.

- **RT1 — Injection & input handling:** SQL/NoSQL injection (raw queries, string
  concatenation, ORM/filter/RPC injection), command injection, SSTI, header
  injection, path traversal, prototype pollution, unsafe deserialization, mass
  assignment, type confusion, oversized/malformed body DoS.
- **RT2 — AuthN/AuthZ:** broken access control, IDOR / missing ownership checks,
  privilege escalation, role confusion, JWT flaws (alg=none, weak secret,
  expiry/audience), session fixation, brute-force/rate-limit weaknesses
  (esp. limits keyed on a shared proxy IP), account enumeration, RLS gaps.
- **RT3 — Web & client:** XSS (reflected/stored/DOM, `dangerouslySetInnerHTML`,
  unescaped output), CSP weaknesses, CSRF (state-changing requests, cookie auth,
  SameSite), SSRF (server-side fetch of user-controlled URLs), CORS
  misconfiguration, clickjacking, missing security headers.
- **RT4 — Secrets, crypto & supply chain (OWASP A03/A04):** hardcoded/committed
  secrets, secrets in the client bundle or git history, weak hashing/randomness,
  homegrown crypto, insecure cookie flags, verbose errors leaking internals,
  vulnerable/unpinned/typosquatted deps, risky postinstall scripts, lockfile
  integrity, GitHub Actions referenced by floating tag instead of full commit SHA.
- **RT5 — Infra & deploy:** container runs as root, missing securityContext /
  NetworkPolicy, mutable `:latest` in prod, exposed admin/debug routes, public
  exposure of sensitive surfaces, registry/secret exposure, CI/runner trust
  boundary (does untrusted PR code run on a privileged runner?).

**Extended agents — dispatch ONLY when the subsystem exists** (the remaining
Critical-severity findings, esp. cross-tenant isolation, usually hide here):

- **RT6 — Auth subsystem deep-dive** _(if there's step-up/MFA, device pairing /
  key exchange, fingerprint/2FA, an auth-audit trail):_ synchronous bcrypt
  (`compareSync`/`hashSync`) blocking the event loop → DoS under concurrent
  logins (find every call site, give the async fix); step-up auth replay/bypass
  and whether elevated state is session-bound + time-boxed; is the "second
  factor" real or client-spoofable; device key exchange / hub pairing
  authenticated (MITM-resistant), keys stored securely, replay-protected; all
  authZ failures + privilege changes logged with no secrets; timing-safe token
  compares; CSPRNG for generated secrets.
- **RT7 — Integrations & orchestration** _(if there's an event outbox, rules
  engine, job state machine, or multi-tenant routing):_ **cross-tenant isolation
  (Critical if an event/job/route can leak across tenants)**; event outbox
  at-least-once + idempotent consumers, drained transactionally with the state
  change; webhook signature verification + replay protection + redelivery
  idempotency; job state machine stuck-states / dead-letter; malformed/malicious
  rule → infinite loop / resource exhaustion / unintended cross-tenant action;
  integration failure handling (no silent drops).
- **RT8 — CI/CD & deploy pipeline:** is the post-deploy smoke step authenticated
  (or can a broken authed path reach prod green)?; are ALL test layers + E2E
  actually **blocking** merges vs advisory; deploy atomic + health-gated + auto
  rollback on failed smoke, or fire-and-forget?; secrets injected from a store,
  never echoed/logged; self-hosted runner isolation (untrusted PRs can't execute
  on it; token minimally scoped); actions pinned by **commit SHA** not floating
  tags; build reproducibility & cache correctness. End with a "what can reach
  prod untested today" summary.

**Finding format (required for every item):**

```text
ID & Title
Severity: Critical | High | Medium | Low   (CVSS 4.0-style reasoning)
Location: file:line
Category: OWASP Top 10:2025 / CWE id
Exploit scenario: concrete step-by-step
PoC: minimal, illustrative input/request — NOT a weaponized exploit
Impact: what the attacker gains
Confidence: confirmed | needs manual confirmation
```

**Map to OWASP Top 10:2025** (announced Nov 2025 at Global AppSec, finalized early
2026 — use these IDs, not 2021's):
A01 Broken Access Control (now absorbs SSRF) · A02 Security Misconfiguration ·
**A03 Software Supply Chain Failures (new — was "Vulnerable & Outdated Components",
broadened)** · A04 Cryptographic Failures · A05 Injection · A06 Insecure Design ·
A07 Authentication Failures · A08 Software or Data Integrity Failures · A09 Security
Logging & **Alerting** Failures · **A10 Mishandling of Exceptional Conditions (new)**.
The two new buckets (A03 supply chain, A10 error/exception handling) and the SSRF→A01
move are the deltas most likely to be miscategorised. ([OWASP Top 10:2025][owasp])

**Red-team rules:** prioritize exploitable over theoretical; never produce
weaponized exploits or malware (PoCs minimal & illustrative); mark anything
unverified as "needs manual confirmation."

Also run the deterministic scanners and fold their hits into the findings (LLMs
miss what these catch):

```bash
npm audit --omit=dev            # dependency CVEs — Node; per stack instead:
pip-audit                       #   Python (requirements/poetry/pip)
govulncheck ./...               #   Go
cargo audit                     #   Rust (RustSec advisory DB)
git log -p -S '<secret-pattern>' --oneline   # secret ever committed?
# if available: gitleaks detect ; semgrep --config auto ; CodeQL ; OWASP ZAP (running app)
```

## Step 3 — Blue Team (defensive)

Deduplicate the red-team findings, then for **each** produce:

```text
Root cause (not just the symptom)
Fix: secure, minimal, idiomatic diff for THIS stack
Why it closes the vector — and what it does NOT cover
Regression test: a test that fails if the bug is reintroduced
Defense-in-depth: a second control if the first is bypassed
```

Enforce this hardening baseline across the codebase:

- Parameterized queries everywhere (prepared statements; never concatenation).
  RLS enabled on every table; service/admin keys never shipped client-side.
- Centralized authZ middleware; ownership checks on every record (never trust
  client-supplied IDs). Rate-limit by **account/key**, not just a shared IP.
- Input validation at the boundary (schema, e.g. zod/joi) + output encoding.
- Secrets only in env / platform secret stores; nothing sensitive in the client
  bundle or git history; generic client errors, detailed logs server-side only.
- Security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy); cookies HttpOnly + Secure + SameSite.
- Strict CORS allowlist (no wildcard with credentials).
- Non-root container, readOnlyRootFilesystem, dropped caps, NetworkPolicy,
  SHA-pinned images; untrusted PR code never on a privileged runner.
- Dependency audit + pinned versions; logging/alerting on authZ failures.

Apply fixes only when the user asked for `--fix`; otherwise propose the diffs.

## Step 4 — Verify (re-attack)

Re-run the relevant red-team agents against the patched code. For each original
finding output: **CLOSED** (with why the attack now fails) / **PARTIAL** /
**STILL OPEN**. Confirm no new finding was introduced by the fixes. Re-run the
test suite and scanners.

## Step 5 — Report

```text
SECURITY REVIEW — {target}
═══════════════════════════════════════
Risk posture: {SAFE-ish to expose | NEEDS WORK | DO NOT EXPOSE}

Findings: {n} Critical · {n} High · {n} Medium · {n} Low
Ranked by exploitability × impact:
  1. [SEV] Title — file:line — status: {open|fixed|verified-closed}
  ...

Remediation table: finding → fix → status → residual risk
Accepted risks (with explicit owner sign-off)
Reusable secure-coding rule added per finding (for the review checklist)
```

End every report with the honest caveat above.

## Optional — file findings as GitHub issues

When asked, open one issue per finding. Use the kit's canonical label scheme —
`sev:<level>` + a domain label — so issues match `bootstrap-labels.sh` and the
`weighsoft-deep-review` pipeline. (If you ran `bootstrap-labels.sh` the labels already
exist; the `--force` upserts below make this snippet self-contained too.)

```bash
for s in critical high medium low info; do gh label create "sev:$s" --force >/dev/null 2>&1; done
gh label create security --color d73a4a --force >/dev/null 2>&1
gh issue create --title "[critical][security] <title>" --label "security,sev:critical" \
  --body "**Location:** file:line · **Category:** OWASP/CWE · **Exploit:** … · **Fix:** …"
```

## Optional — wire into CI

On each PR to `dev`/`master`, feed the changed files through Step 2, post
findings as a PR comment, and block merge on unresolved Critical/High. Pair with
Dependabot, **Semgrep + CodeQL** (complementary — Semgrep for fast broad rules,
CodeQL for deep dataflow/taint; large orgs run both), gitleaks, and OWASP ZAP
(DAST) for coverage LLMs miss. SAST/SCA is noisy — gate on reachability/severity,
not raw count, so the gate stays credible.

## Notes

- Scale the agent count to the change: a small diff may merge RT1–RT5 into one
  pass; a full-repo audit warrants all five in parallel plus a completeness
  critic ("what attack surface did we not examine?").
- This skill is portable — copy `.claude/skills/weighsoft-security-review/` into any repo;
  it adapts to the detected stack.

---

Sources / further reading:
[owasp]: https://owasp.org/Top10/2025/ "OWASP Top 10:2025 — categories & changes"
[gha]: https://docs.github.com/en/actions/reference/security/secure-use "GitHub — secure use: pin actions to a full commit SHA, harden runners"
[semgrep]: https://semgrep.dev/docs/ "Semgrep — SAST rules & CI integration"
