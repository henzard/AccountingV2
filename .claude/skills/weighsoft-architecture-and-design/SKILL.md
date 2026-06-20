---
name: weighsoft-architecture-and-design
formerly: architecture-and-design
description: Enforces SOLID and Clean/Hexagonal Architecture — business logic isolated from frameworks/DB/UI, source dependencies pointing inward only, distinct data models per layer, and the DRY/YAGNI/KISS discipline — and rejects the named code smells (bloaters, coupling, change preventers, dispensables, OOP violations). Use when designing a module/service, reviewing structure, drawing layer boundaries, or judging whether a change respects dependency direction — and when someone asks "where should this code live?" or "is this the right shape?".
version: 1.0.0
category: architecture
tags:
  - solid
  - clean-architecture
  - hexagonal
  - ports-and-adapters
  - dependency-inversion
  - code-smells
  - dry-yagni-kiss
  - layering
  - boundaries
---

# weighsoft-architecture-and-design — business logic owns the center; frameworks orbit it

> 🔁 **Renamed:** this skill is now **weighsoft-architecture-and-design** (formerly **architecture-and-design**). Update any references; other systems keying off the old name should rename to match.

The job of structure is to keep what changes for _business_ reasons separate from what
changes for _technical_ reasons, and to make the dependency arrows point the right way.

> **Source code dependencies point INWARD only.** The domain knows nothing of the database,
> the framework, or the UI — they know about it. ([Clean Architecture][ca], [Hexagonal][hex])

## The rules

### SOLID, concretely

- **SRP** — a class/module has exactly one reason to change. If its description needs "and",
  split it (see change-preventers below).
- **OCP** — extend behavior by adding an implementation behind an interface, never by editing
  a tested class to bolt on a branch. New requirement ⇒ new adapter, not a new `if`.
- **LSP** — a subtype must be substitutable for its base everywhere, with no caller doing
  `if (x instanceof Y)` to undo it. A subtype that throws on an inherited method fails LSP.
- **ISP** — many focused interfaces over one fat one; no implementer forced to stub methods
  it doesn't use.
- **DIP** — depend on abstractions; inject dependencies (constructor/params), never `new` a
  concrete infrastructure class inside domain code.

### Clean / Hexagonal layering

- **Dependency direction:** `infrastructure → application → domain`. The domain is the
  innermost ring and imports nothing outward. Verify with the import graph, not vibes. ([Clean Architecture][ca])
- **Ports & adapters:** the domain declares **ports** (interfaces it needs); infrastructure
  supplies **adapters** (DB, HTTP, queue, filesystem). Swapping Postgres for SQLite, or REST
  for gRPC, must not touch a domain file. ([Hexagonal][hex])
- **Distinct data models — never one shared struct across layers:** request/response DTOs ≠
  domain entities ≠ DB row/ORM models. Map at the boundary. A DB column rename must not
  ripple into the API contract.
- **Keep the domain framework-free:** no ORM annotations, no HTTP decorators, no `@Inject`
  on domain entities — keep them plain. ([Hexagonal][hex])
- **Ports speak the domain's language, not infrastructure's:** a port that mentions SQL, HTTP
  status codes, or JSON has already leaked the adapter inward and lost the isolation it exists
  for. Name and shape it for the business operation. ([Hexagonal pitfalls][hexp])
- **Rich domain, not anemic:** behavior lives with the data it guards — `order.pay(processor)`,
  not `orderService.pay(order)` with the entity a bare data holder. An anemic model scatters
  the invariants the domain exists to protect. ([Hexagonal pitfalls][hexp])

### Practical principles (the governors)

- **DRY** — eliminate _repeated logic_ (not coincidental similarity); extract the rule once.
- **YAGNI** — build only what a current, named requirement needs; no speculative generality.
- **KISS** — the simplest design that meets the requirement wins; don't add a layer "for
  flexibility" you have no requirement for (a real 2025 hexagonal pitfall — over-abstraction). ([Hexagonal][hex])

### Code smells to eliminate

- **Bloaters** — methods > ~30 lines, oversized classes, long parameter lists (> 3),
  primitives where a value object belongs (money, email, ID).
- **Coupling** — feature envy, broken encapsulation, message chains (`a.b().c().d()` — Law of
  Demeter: talk to friends, not strangers).
- **Change preventers** — divergent change (one class edited for many reasons → split per
  SRP), shotgun surgery (one change touches many classes → consolidate).
- **Dispensables** — duplicate, dead, or unreachable code; classes that barely earn their keep.
- **OOP violations** — type-based conditionals (`switch (type)`) → replace with polymorphism;
  inheritance used where composition fits → prefer composition.

### When to relax (and document it)

Prototypes, throwaway scripts, perf-critical hot paths, and third-party code may bend these
rules — but **write down the exception** (a comment or ADR) so it's a decision, not a leak.

## Anti-patterns to reject

- **Domain importing infrastructure** — WHY: inverts the dependency arrow; the business logic
  can no longer be tested or reused without the DB/framework dragged along.
- **One model reused as DTO + entity + ORM row** — WHY: couples the API contract, business
  rules, and storage schema; any one change breaks the other two.
- **`new ConcreteRepository()` inside a use case** — WHY: kills DIP and testability; the use
  case can't be exercised with a fake. Inject the port instead.
- **`if (instanceof)` / `switch (type)` driving behavior** — WHY: an OCP/LSP violation that
  grows a new branch per type forever; polymorphism scales, conditionals rot.
- **Speculative abstraction "for later"** — WHY: YAGNI/KISS violation; an unused layer is pure
  cost and the 2025-documented hexagonal failure mode. A port for a dependency that will never
  have a second adapter is ceremony, not flexibility. ([Hexagonal][hex], [Hexagonal pitfalls][hexp])
- **Anemic entity + fat service** — WHY: behavior divorced from its data means every caller can
  mutate around the invariant; the rule the domain exists to enforce lives nowhere. ([Hexagonal pitfalls][hexp])
- **Port leaking SQL/HTTP/JSON** — WHY: an infrastructure-shaped port couples the domain to the
  adapter it was meant to hide; swapping the adapter now touches domain code. ([Hexagonal pitfalls][hexp])
- **Message chains across objects** — WHY: every link is a coupling you must keep in sync; one
  internal change cascades.

## How it composes with the kit

- **add-feature** Phase 4 runs its `weighsoft-architecture-and-design` row against the _plan_ before any
  code — this skill is that row's rubric (SOLID, inward deps, no new bloater/coupling smell).
- **quality-review / deep-review** apply the architecture dimension of the 6-dim rubric using
  these smell definitions; this skill is the shared vocabulary.
- **verification-quality** proves a refactor didn't change behavior (tests green) — structure
  changes still need evidence, not just a cleaner diagram.
- **qa-lead** trusts these boundaries: framework-free domains and real ports are what make the
  swarm's integration tests meaningful instead of mock theatre.

## Conformance checklist

- [ ] Import graph confirmed: no `domain → infrastructure` or `domain → framework` edge
- [ ] Every infrastructure dependency reached through an injected **port**, not a `new`
- [ ] Distinct request/response, domain, and DB models — mapped at the boundary
- [ ] Ports phrased in domain terms (no SQL/HTTP/JSON leaking through); domain is rich, not anemic
- [ ] Each class has one reason to change; none needs "and" to describe it
- [ ] No type-based conditionals where polymorphism applies; composition over inheritance
- [ ] No method > ~30 lines, no param list > 3, no primitive-where-value-object
- [ ] No message chains / Law-of-Demeter violations introduced
- [ ] Any relaxation (prototype/perf/3rd-party) documented as an explicit exception

## Quick reference

```text
Deps point INWARD: infrastructure → application → domain. Domain imports nothing out.
SOLID: 1 reason to change · extend via interface · substitutable · focused interfaces · inject.
Ports (domain declares) + Adapters (infra supplies). Swap DB/transport without touching domain.
Ports speak domain language (no SQL/HTTP/JSON). Rich entities (order.pay()), not anemic + fat service.
3 models, never 1: DTO ≠ entity ≠ DB row. Map at the edge.
Governors: DRY (logic, not lookalikes) · YAGNI (current need only) · KISS (no spec. layers).
Smells out: bloaters · coupling/Demeter · divergent-change/shotgun · dead code · type-switch.
Polymorphism over `switch(type)`. Composition over inheritance.
Relax for prototype/perf/3rd-party — but DOCUMENT the exception.
```

**The gate, one line:** _business logic sits in a framework-free domain that imports nothing
outward, every external system is reached through an injected port, each layer keeps its own
model, and no named smell ships unflagged — relax a rule only with a written exception._

---

Sources / further reading:
[ca]: https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html "Robert C. Martin — The Clean Architecture (dependency rule: source deps point inward)"
[hex]: https://www.javacodegeeks.com/2025/06/hexagonal-architecture-in-practice-ports-adapters-and-real-use-cases.html "Hexagonal Architecture in Practice 2025 — ports/adapters, framework-free domain, over-abstraction pitfall"
[hexp]: https://medium.com/@allousas/hexagonal-architecture-common-pitfalls-f155e12388a3 "Hexagonal Architecture: Common Pitfalls — leaky ports, anemic domain, over-porting (a port per dependency)"
