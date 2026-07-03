# Architecture — <project / subsystem name>

> Purpose: capture the high-level design, boundaries, and tech decisions so a new
> contributor (human or AI) can orient fast. Copy to `docs/architecture.md`, fill
> every `<!-- fill-in -->`, delete examples. Link ADRs — don't duplicate them.
> Ref: [BMAD](https://github.com/bmad-code-org/BMAD-METHOD),
> [Spec Kit plan](https://github.com/github/spec-kit),
> [C4 model](https://c4model.com/),
> [Clean Architecture dependency rule](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html).

**Status:** Draft · **Last updated:** <!-- YYYY-MM-DD --> · **Owner:** <!-- name -->

---

## Overview

<!-- fill-in: one paragraph — main components and how data/control flows. A C4
     sketch (even ASCII) is worth more than prose. Use only the levels that earn
     their keep: the System Context (your system + users + external systems) and
     Container (apps/services/DBs and how they talk) diagrams are enough for most
     teams — add Component only for a complex container, and skip Code entirely. -->

_Describe the high-level design and data flow._

```
<!-- fill-in: e.g.
[Client] --HTTPS--> [API layer] --> [Domain] --> [Repository] --> [(DB)]
                                       ^
                              business rules (no framework/DB imports)
-->
```

## Boundaries

<!-- fill-in: components/layers and what each may depend on.
     INVARIANT: dependencies point INWARD. Domain depends on nothing outward;
     UI/API/DB adapters depend on the domain, never the reverse. -->

| Component               | Responsibility                                 | May depend on              |
| ----------------------- | ---------------------------------------------- | -------------------------- |
| _UI / presentation_     | _render, input, WCAG 2.2 AA_                   | _API client, domain types_ |
| _API layer_             | _HTTP, auth, validation_                       | _Domain (services)_        |
| _Domain_                | _business rules; money in integer minor units_ | _Nothing outward (pure)_   |
| _Repository / adapters_ | _persistence, external APIs_                   | _Domain interfaces_        |
| _Database_              | _storage; snake_case, 3NF_                     | _—_                        |

## Data model (high level)

<!-- fill-in: key entities + relationships. snake_case columns, 3NF unless an ADR
     records a deliberate denormalisation. Money columns are integer/decimal, never FLOAT. -->

- _e.g. `users (id, email, created_at)` 1—N `orders (id, user_id, total_cents)`._

## Key decisions

<!-- fill-in: link ADRs; one line each. Don't restate the ADR body here. -->

- _e.g. Data store: see `docs/adr/0001-database.md`._
- _e.g. Auth strategy: see `docs/adr/0002-auth.md`._

## Tech stack

<!-- fill-in: keep brief; the WHY belongs in an ADR. -->

- **Runtime**: _e.g. Node 24 LTS (current Active LTS; 22 in maintenance)_
- **Framework**: _e.g. Express / Next.js_
- **Database**: _e.g. PostgreSQL (Supabase) / SQLite (local)_
- **Infra**: _e.g. Vercel + Railway_

## Cross-cutting concerns

<!-- fill-in -->

- **Security**: _secrets via env only; no PII in logs; authZ at the boundary._
- **Observability**: _structured logs, metrics, alerting._
- **Error handling**: _consistent error shape; no stack traces in prod responses._
- **Testing**: _see `docs/testing-strategy.md` (Unit / UI / Integration × happy / edge)._

## Scale-up triggers

<!-- fill-in: name the signal that forces the NEXT architectural step, so you don't
     over-build now. -->

- _e.g. > 10k concurrent users → extract sync into its own service (new ADR)._
