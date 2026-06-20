// deep-review.workflow.js — reusable Workflow-tool orchestration for the deep-review kit.
// Run via the Workflow tool:  Workflow({ scriptPath: ".../workflows/deep-review.workflow.js",
//   args: { target: "/abs/path/to/repo", repo: "owner/repo", coverage: "<paste real coverage>" } })
//
// It fans the security + quality specialists out in parallel, adversarially verifies each
// finding, files confirmed findings as GitHub issues, then authors the scaffolding. Branch
// protection / branch creation are done by the shell scripts (need gh admin) — not here.
// Phases 1 (real coverage) and 5/8/9 (score/branches/report) are driven by the skill around
// this workflow; this script covers the parallelizable review + issue + author phases.
export const meta = {
  name: 'deep-review',
  description: 'Multi-agent security + quality deep review of a target repo: find -> adversarially verify -> file issues -> author scaffolding',
  phases: [
    { title: 'Inventory' },
    { title: 'Review' },
    { title: 'Verify' },
    { title: 'File' },
    { title: 'Author' },
    { title: 'Completeness' },
  ],
};

const target = (args && args.target) || '.';
const repo = (args && args.repo) || '';
const coverage = (args && args.coverage) || '(coverage not supplied — instruct the Test agent to run it)';

const FINDING = {
  type: 'object', additionalProperties: false,
  required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['id', 'title', 'severity', 'domain', 'location', 'evidence', 'fix'],
    properties: {
      id: { type: 'string' }, title: { type: 'string' },
      severity: { enum: ['critical', 'high', 'medium', 'low', 'info'] },
      domain: { enum: ['security', 'sync', 'api', 'database', 'code-quality', 'tests', 'ux', 'design-system'] },
      location: { type: 'string', description: 'file:line' },
      evidence: { type: 'string' }, fix: { type: 'string' },
    },
  } } },
};
const VERDICT = { type: 'object', additionalProperties: false, required: ['real', 'why'],
  properties: { real: { type: 'boolean' }, why: { type: 'string' } } };

phase('Inventory');
const inv = await agent(
  `Map the repo at ${target}: languages, test runner, frontend, backend, API style, data layer, infra, and which optional subsystems exist (offline-first/sync? event-outbox/orchestration? multi-tenant? auth step-up?). Return a concise structure inventory and the list of optional subsystems present.`,
  { label: 'inventory', phase: 'Inventory' });
log('Inventory captured');

phase('Review');
// Core security (RT1-5) + quality (6 specialists), always dispatched.
const SPECIALISTS = [
  { k: 'sec-injection', d: 'security', p: `Red-team RT1 (injection & input handling) of ${target}: SQL/command/SSTI/path-traversal/proto-pollution/deserialization/mass-assignment. ${coverage}` },
  { k: 'sec-authz', d: 'security', p: `Red-team RT2 (authN/authZ) of ${target}: broken access control, IDOR, privilege escalation, JWT/session, brute-force/rate-limit, enumeration, RLS gaps.` },
  { k: 'sec-web', d: 'security', p: `Red-team RT3 (web/client) of ${target}: XSS, CSP, CSRF, SSRF, CORS, clickjacking, missing security headers.` },
  { k: 'sec-secrets', d: 'security', p: `Red-team RT4 (secrets/crypto/supply-chain) of ${target}: hardcoded/committed secrets, secrets in client bundle/git history, weak hashing/randomness, insecure cookies, verbose errors, vulnerable/unpinned deps, risky postinstall. Run the language's audit (npm audit / pip-audit / govulncheck / cargo audit) + a secret-in-history grep.` },
  { k: 'sec-infra', d: 'security', p: `Red-team RT5 (infra/deploy) of ${target}: container/root, exposed admin/debug routes, mutable :latest, CI/runner trust boundary, registry/secret exposure.` },
  { k: 'q-tests', d: 'tests', p: `Quality: test coverage + AUTHENTICITY of ${target}. Real coverage: ${coverage}. Flag tautological/mock-echo/no-assertion/over-mocked tests, missing edge/error/concurrency, the six-layer matrix gaps (data mutation missing integration-edge = high priority), weak E2E ("page loaded" only).` },
  { k: 'q-ux', d: 'ux', p: `Quality: UX of ${target} vs Nielsen's 10 heuristics + WCAG 2.2 AA (keyboard, focus, contrast, ARIA, labels, target sizes). Per issue: standard, location, severity, fix. End with a usability score. If the system is headless, score operability instead and say so.` },
  { k: 'q-ui', d: 'design-system', p: `Quality: UI/design-system of ${target}: reuse vs duplication, tokens vs magic values, a11y at component level, component API quality, anti-patterns, naming/org.` },
  { k: 'q-api', d: 'api', p: `Quality: API of ${target}: REST verbs/naming/status codes/idempotency, consistent schemas+errors, validation, versioning, pagination, OpenAPI, DB-schema leakage, auth consistency, N+1.` },
  { k: 'q-backend', d: 'code-quality', p: `Quality: backend SOLID + smells of ${target}: SRP/OCP/LSP/ISP/DIP citations, long methods/deep nesting/duplication/primitive-obsession/dead-code/magic-values, layering, error handling, complexity hotspots, concurrency/leaks, logging. End with a maintainability score.` },
  { k: 'q-db', d: 'database', p: `Quality: database of ${target}: schema/types/constraints/CHECK, indexing (missing/redundant/N+1-fixing), parameterized queries/no SELECT */no N+1, migrations (versioned/reversible/guarded), RLS, transactions, DAO separation.` },
];
// Extended specialists (skill Phase 2 RT6-8 + Phase 3 G/H/I) — dispatched ONLY when the
// inventory above reports the subsystem exists.
const EXTENDED = [
  { k: 'sec-auth-deep', d: 'security', subsystem: 'auth step-up / session lifecycle', p: `Red-team RT6 (auth deep-dive) of ${target}: session fixation/rotation, step-up/MFA bypass, password-reset & token flows, account recovery, OAuth/OIDC misconfig.` },
  { k: 'sec-integrations', d: 'security', subsystem: 'third-party integrations or multi-tenant isolation', p: `Red-team RT7 (integrations/multi-tenant) of ${target}: webhook signature/replay, cross-tenant data leakage, SSRF via integrations, untrusted callback handling, tenant-scoping gaps.` },
  { k: 'sec-cicd', d: 'security', subsystem: 'CI/CD pipelines', p: `Red-team RT8 (CI/CD) of ${target}: pipeline injection, poisoned cache/artifacts, secret exposure in CI logs, over-privileged tokens, unpinned third-party actions/steps.` },
  { k: 'q-sync', d: 'sync', subsystem: 'offline-first replication / edge-to-hub sync', p: `Quality: replication/sync correctness of ${target}: can a committed write be silently lost or fail to replicate? Convergence, idempotency, conflict resolution (last-write-wins clocks), soft-delete/tombstones, sync cursor, INSERT-OR-IGNORE foot-guns. Flag any silent-write-loss as Critical.` },
  { k: 'q-orchestration', d: 'code-quality', subsystem: 'event outbox / job orchestration', p: `Quality: orchestration/integrations of ${target}: outbox/inbox patterns, job state machines, retry/backoff/dead-letter, exactly-once vs at-least-once, idempotency keys, cross-tenant job isolation.` },
  { k: 'q-backend-ext', d: 'code-quality', subsystem: 'parsers / projections / key management', p: `Quality: remaining backend of ${target}: read-model projections, hand-rolled parsers (ReDoS), key/secret management & rotation, serialization boundaries.` },
];
const present = await agent(
  `Given this repo inventory for ${target}, decide which of these optional subsystems genuinely EXIST in the code. Reply with the exact keys of those present.\n\nInventory:\n${typeof inv === 'string' ? inv : JSON.stringify(inv)}\n\nCandidates:\n${EXTENDED.map((e) => `- ${e.k}: ${e.subsystem}`).join('\n')}`,
  { label: 'select-extended', phase: 'Review',
    schema: { type: 'object', additionalProperties: false, required: ['present'],
      properties: { present: { type: 'array', items: { enum: EXTENDED.map((e) => e.k) } } } } });
const presentKeys = (present && present.present) || [];
const ACTIVE = [...SPECIALISTS, ...EXTENDED.filter((e) => presentKeys.includes(e.k))];
log(`Dispatching ${ACTIVE.length} specialists (${ACTIVE.length - SPECIALISTS.length} extended for present subsystems: ${presentKeys.join(', ') || 'none'})`);
const reviews = (await parallel(ACTIVE.map((s) => () =>
  agent(`White-box, full source access, motivated adversary. ${s.p}\n\nReturn ONLY findings (no fixes). Every finding: file:line evidence + the standard it violates + a concrete fix. Reject vague findings.`,
    { label: s.k, phase: 'Review', schema: FINDING })
    .then((r) => ({ domain: s.d, findings: (r && r.findings) || [] }))
))).filter(Boolean);
const allFindings = reviews.flatMap((r) => r.findings.map((f) => ({ ...f, domain: f.domain || r.domain })));
log(`Found ${allFindings.length} candidate findings`);

phase('Verify');
const toVerify = allFindings.filter((f) => f.severity === 'critical' || f.severity === 'high');
const verified = await parallel(toVerify.map((f) => () =>
  agent(`Adversarially verify this finding against ${target}. Try to REFUTE it. Read ${f.location}. Default real=false if you cannot confirm with evidence.\n\n${f.title}\n${f.evidence}`,
    { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT })
    .then((v) => ({ ...f, real: v ? v.real : false, why: v ? v.why : 'no verdict' }))));
const confirmed = [
  ...verified.filter((f) => f && f.real),
  ...allFindings.filter((f) => f.severity !== 'critical' && f.severity !== 'high'),
];
log(`${confirmed.length} confirmed findings (${verified.filter((f) => f && !f.real).length} Critical/High refuted)`);

phase('File');
if (repo) {
  await parallel(confirmed.map((f) => () =>
    agent(`File a GitHub issue on ${repo} (gh issue create -R ${repo}) for this finding. Title "[${f.severity}][${f.domain}] ${f.title}". Labels "${f.domain},sev:${f.severity}". Body = location (${f.location}), evidence, and the fix. Return the issue URL.`,
      { label: `file:${f.id}`, phase: 'File' })));
  log(`Filed ${confirmed.length} issues on ${repo}`);
} else {
  log('No repo passed — skipping issue creation (findings returned for manual filing).');
}

phase('Author');
const ARTIFACTS = ['CLAUDE.md', 'docs/testing-strategy.md', 'docs/anti-patterns.md', 'docs/engineering-conventions.md', 'AGENTS.md', 'docs/audit/INDEX.md'];
const authored = await pipeline(ARTIFACTS,
  (a) => agent(`Author ${target}/${a} tailored to THIS repo (read its manifest — package.json / pyproject.toml / go.mod / Cargo.toml / pom.xml / etc. — plus source + the findings). Adapt the shapes in the kit's examples/*.example.md — never copy. Write it with the Write tool. Return a one-line summary.`,
    { label: `author:${a}`, phase: 'Author' }),
  (_s, a) => agent(`Adversarially review ${target}/${a}: verify every referenced path/command/finding exists; fix concrete errors with Edit. Return PASS/FIXED + note.`,
    { label: `review:${a}`, phase: 'Author' }));

phase('Completeness');
let dry = 0, round = 0;
const missed = [];
while (dry < 2 && round < 10) {
  round++;
  const gaps = await agent(
    `Completeness critic pass ${round} for the deep review of ${target}. What attack surface, route, data mutation, data flow, subsystem, or TEST LAYER did we NOT examine? What claim is unverified? Consider: security (each RT category), sync/data-integrity, API contracts, DB, concurrency, CI/deploy, integrations, accessibility. Return ONLY genuinely new gaps as findings; empty if none.`,
    { label: `completeness:${round}`, phase: 'Completeness', schema: FINDING });
  const fresh = (gaps && gaps.findings) || [];
  if (fresh.length === 0) { dry++; } else { dry = 0; missed.push(...fresh); if (repo) {
    await parallel(fresh.map((f) => () => agent(`File issue on ${repo}: gh issue create -R ${repo} --title "[${f.severity}][${f.domain}] ${f.title}" --label "${f.domain},sev:${f.severity}" --body "Location ${f.location}. ${f.evidence} Fix: ${f.fix}"`, { label: `file-gap:${f.id}`, phase: 'Completeness' })));
  } }
}

return {
  candidateFindings: allFindings.length,
  confirmed: confirmed.length,
  refuted: verified.filter((f) => f && !f.real).length,
  completenessGaps: missed.length,
  authored: ARTIFACTS,
};
