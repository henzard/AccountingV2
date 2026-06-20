---
name: weighsoft-coding-standards
formerly: coding-standards
description: Enforces readable-before-clever code — project formatter applied, intent-revealing names, functions that do one thing under ~30 lines with ≤3 params, small modules with deps flowing inward, errors never swallowed, structured logging with no secrets/PII, comments that explain WHY, and a real Definition of Done. Use when writing or reviewing code, naming things, shaping functions/modules, handling errors and logging, or deciding whether a change is "done".
version: 1.0.0
category: coding
tags:
  - clean-code
  - naming
  - functions
  - error-handling
  - structured-logging
  - comments
  - testing
  - definition-of-done
---

# weighsoft-coding-standards — readable before clever, explicit before implicit

> 🔁 **Renamed:** this skill is now **weighsoft-coding-standards** (formerly **coding-standards**). Update any references; other systems keying off the old name should rename to match.

Code is read far more than it's written; optimize for the next human (often you in six
months) and let the machine sort out the rest.

> **Write code readable before clever. Prefer explicit over implicit.** ([Clean Code 2025][cc])

## The rules

### Formatting & naming

- **Run the project formatter before every commit** — Prettier / Black / Ruff / gofmt — so
  diffs are behavior, not whitespace. No hand-formatting.
- **Language-appropriate casing**, applied consistently; pick one convention and never mix
  `userId` / `user_id` / `userID` in the same surface. ([structured logging][sl])
- **Names reveal intent** — `elapsedDays` not `d`; a reader shouldn't need the definition to
  know the purpose.
- **Booleans read naturally:** `isLoading`, `hasPermission`, `canRetry`.
- **Functions are verbs** (`sendInvoice`, `parseConfig`); classes/values are nouns.
- **No single-letter names** except loop indices (`i`, `j`) and conventional math.

### Functions

- **Each does one thing** — one level of abstraction per function.
- **Keep under ~30 lines;** longer usually means it's doing several things — extract.
- **≤ 3 parameters;** beyond that pass an options object, not a positional pile.
- **Return values, not output params** — don't mutate an argument to "return" through it.
- **No flag arguments** — `render(true)` hides two behaviors; split into `renderVisible()` /
  `renderHidden()`.

### Module structure

- **Small modules, minimal public API** — export the least that callers need.
- **Dependencies flow inward:** `adapters → use cases → domain` (see `weighsoft-architecture-and-design`).
- **Split a module if its description needs "and"** — that's two responsibilities wearing one
  filename.

### Error handling & logging

- **Never silently swallow an error** — no empty `catch {}`. Handle it, or rethrow with context.
- **Log with context,** not a bare message — include the operation, IDs, and a correlation ID
  for tracing across services. Where OpenTelemetry is in play, emit `trace_id`/`span_id` as
  top-level fields (let the OTel-aware appender inject them) so logs join to traces. ([structured logging][sl], [OTel logs][otel])
- **Use a structured logger** (JSON, leveled fields) in production, never `console.log`;
  timestamps in **ISO 8601 UTC**, the level as a field, consistent field names across services. ([structured logging][sl])
- **Level by actionability, not volume** — your app at `INFO`, noisy third-party libraries
  (ORM, HTTP client, framework internals) at `WARN`/`ERROR`; if no human acts on it, it
  isn't a higher level. ([log levels][ll])
- **Don't expose internals to users** — no raw stack traces or DB errors in responses; log the
  detail, return a safe message.
- **Never log secrets or PII** — no passwords, tokens, card numbers, full emails in logs.
  Keep nested log structure shallow (2–3 levels) for queryability. ([structured logging][sl])

### Comments

- **Explain WHY, not WHAT** — the code says what; the comment justifies the non-obvious choice.
- **Delete commented-out and dead code before commit** — version control remembers it for you.
- **Track TODOs as issues,** not as `// TODO` that rots in the tree.

### Testing

- **Test all non-trivial logic;** trivial getters don't need a test, branching logic does.
- **Name tests by behavior** — `rejects_expired_coupon`, not `test1`.
- **Independent & deterministic** — no shared mutable state, no order dependence, no wall-clock
  or network flakiness.
- **Meaningful coverage over 100% line** — exercise the branches that matter, don't chase a
  vanity number.

### Definition of Done

Formatting compliant · test coverage on the new logic · zero lint/type errors · errors
handled (none swallowed) · no credentials or secrets in code.

## Anti-patterns to reject

- **Empty `catch` / swallowed error** — WHY: turns a failure into silent corruption nobody can
  trace; the bug surfaces later, far from its cause.
- **`console.log` in production paths** — WHY: unstructured, unleveled, unsearchable, and prone
  to leaking objects with secrets; defeats centralized aggregation. ([structured logging][sl])
- **Flag-argument function** — WHY: one signature, two behaviors — callers can't read intent
  and the body grows a branch per flag.
- **Function > 30 lines doing several things** — WHY: untestable in isolation, hard to name,
  and a magnet for shotgun-surgery changes.
- **Mixed naming for one concept** (`user_id` vs `userID`) — WHY: breaks grep, breaks joins
  across services, and forces readers to track aliases. ([structured logging][sl])
- **Stack trace returned to the user** — WHY: leaks internal structure (an info-disclosure
  risk) and gives the user nothing actionable.
- **Commented-out code / `// TODO` left in** — WHY: rots, misleads, and hides whether it's
  intentional; the issue tracker is the right home.

## How it composes with the kit

- **add-feature** Phase 4's `weighsoft-coding-standards` row checks the plan against exactly these limits
  (≤30-line functions, ≤3 params, structured logging, no swallowed errors, no dead code).
- **architecture-and-design** owns the layer boundaries; this skill enforces the _inward_ dep
  flow at the module/function grain.
- **verification-quality** is the evidence bar for the Definition of Done — format→lint→test→
  type→build must actually be run and green, not asserted.
- **qa-lead** relies on deterministic, behavior-named tests to make its regression gate trustworthy.

## Conformance checklist

- [ ] Formatter run; diff is behavior, not reformatting
- [ ] Names reveal intent; booleans read naturally; functions are verbs; one casing convention
- [ ] Every function does one thing, ≤ ~30 lines, ≤ 3 params, no flag arguments
- [ ] Module public API is minimal; no module needs "and" to describe it
- [ ] No swallowed errors; structured leveled logger with context + correlation/trace IDs; levels by actionability
- [ ] No secrets/PII in logs; no stack traces leaked to users
- [ ] Comments explain WHY; no commented-out/dead code; TODOs live in issues
- [ ] Non-trivial logic tested by behavior, deterministic; Definition of Done met

## Quick reference

```text
Readable > clever. Explicit > implicit. Run the formatter before commit.
Names reveal intent · booleans read naturally · functions are verbs · one casing convention.
Functions: one thing · ≤30 lines · ≤3 params · return values · no flag args.
Modules: small, minimal API, deps inward; split if the description needs "and".
Errors: never swallow; structured logger (JSON, level, ISO-8601 UTC, correlation/trace_id+span_id).
Level by actionability: app INFO, noisy libs WARN/ERROR. No human acts ⇒ not a higher level.
Never log secrets/PII; never leak stack traces to users.
Comments explain WHY; delete dead code; TODOs → issues.
DoD: format ok · tests on new logic · no lint/type errors · errors handled · no secrets.
```

**The gate, one line:** _every function does one thing within its limits, every name reveals
intent, no error is swallowed and no secret is logged, comments justify the WHY — and "done"
means format/lint/test/type/build all green with no credentials in the tree._

---

Sources / further reading:
[cc]: https://markereviews.com/software-development/coding-practices/programming/what-is-clean-code-principles-guide-2025/ "What Is Clean Code? 2025 Principles — readable over clever, intent-revealing names, consistent conventions"
[sl]: https://uptrace.dev/glossary/structured-logging "Structured Logging Best Practices — JSON, ISO-8601 UTC, leveled fields, correlation IDs, consistent field names, no secrets/PII"
[lb]: https://www.kloudfuse.com/blog/logging-best-practices "10 Essential Logging Best Practices — context, levels, no sensitive data"
[otel]: https://opentelemetry.io/docs/specs/otel/logs/ "OpenTelemetry Logs spec — trace_id/span_id correlation, structured log records joined to traces"
[ll]: https://signoz.io/blog/logging-levels/ "Logging Levels Explained — severity/actionability, app INFO vs noisy libraries at WARN/ERROR"
