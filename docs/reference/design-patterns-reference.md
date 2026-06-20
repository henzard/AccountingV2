# Design patterns quick reference

> Read-only reference. A beginner-friendly guide to the patterns this kit favours.
> **Default to the simplest pattern that solves the problem.** Pick a pattern
> because your problem matches its "Use when" line — not because it sounds
> impressive. Ref: [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html),
> [Refactoring Guru patterns](https://refactoring.guru/design-patterns).

---

## Architecture patterns (system level)

### Layered / N-Tier

```
Presentation → Business Logic → Data Access → Database
```

- **Use when**: standard web app, CRUD, clear separation needed.
- **Avoid when**: complex domain with many cross-cutting concerns.
- **Key rule (dependency rule)**: source dependencies point **inward**. Presentation
  may import business logic; business logic must NOT import presentation, framework,
  or DB drivers. This is what keeps the core testable and the tech swappable.

### MVC (Model-View-Controller)

- **Use when**: server-rendered apps, request-response.
- **Key rule**: views never touch the database; controllers stay thin.

### Modular monolith

- **Use when**: growing app with clear domain boundaries, not ready for microservices.
- **Key rule**: modules depend on each other only through public interfaces — no
  cross-module DB table sharing. This is the recommended default before services.

### Client-server / API-first

- **Use when**: separate frontend/backend, or multiple clients (web/mobile/CLI).
- **Key rule**: define the API contract first (`templates/docs/api-contract.template.md`),
  then build both sides to it.

---

## Code patterns (file / class level)

### Repository pattern

```
Service → Repository (interface) → Database
```

- **Use when**: you want to swap DBs or mock data access in tests.
- **Key rule**: one repository per domain entity; service code never writes raw SQL.
  The repository _interface_ lives in the domain (inner); the implementation lives
  in the adapter layer (outer) — dependencies still point inward.

### Service layer

- **Use when**: business logic is more than simple CRUD.
- **Key rule**: services are stateless; controllers call services, never repositories
  directly. **Never access the database from a controller.**

### DTO (Data Transfer Object)

- **Use when**: data shape differs between layers (API vs. DB row vs. domain model).
- **Key rule**: never expose a DB model directly in an API response. Map at boundaries.
  Money crosses boundaries as integer minor units, never as a float.

### Factory

- **Use when**: object creation is complex or varies by context.
- **Example**: `createNotification(type)` → Email/SMS/Push notification.

### Strategy

- **Use when**: multiple algorithms for one task (payment processors, sorting).
- **Key rule**: prefer this over large `if/else` / `switch` chains.

### Observer / Event

- **Use when**: one action triggers many independent side effects (signup → email +
  profile + log).
- **Key rule**: events are simple data objects; subscribers are independently testable.

### Adapter

- **Use when**: wrapping a third-party SDK or external API behind your own interface.
- **Key rule**: the interface (port) lives in the domain (inner); the adapter
  (implementation) lives outside. This is what lets dependencies point inward and
  the vendor be swapped without touching business logic.

### Decorator / Middleware

- **Use when**: layering cross-cutting behaviour (auth, logging, caching, retry,
  rate-limit) around a call without changing it.
- **Key rule**: each layer does one thing and is composable; order is explicit.
  This is the standard shape for HTTP middleware chains.

---

## API design patterns

| Action           | Method | URL pattern      | Status               |
| ---------------- | ------ | ---------------- | -------------------- |
| List             | GET    | `/resources`     | 200                  |
| Get one          | GET    | `/resources/:id` | 200 (404 if missing) |
| Create           | POST   | `/resources`     | 201                  |
| Update (full)    | PUT    | `/resources/:id` | 200                  |
| Update (partial) | PATCH  | `/resources/:id` | 200                  |
| Delete           | DELETE | `/resources/:id` | 204                  |

- Plural nouns: `/users`, `/orders`. Nest relationships: `/users/:id/orders`.
- Filter via query params: `/orders?status=pending&sort=-created_at`.
- Consistent error shape: [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` (`type`/`title`/`status`/`detail` + extension members like a machine `code`).
- **Pagination**: cursor (`?cursor=abc&limit=20`) for large sets; offset for admin tools.
- **Versioning**: URL prefix `/api/v1/...`; version only on breaking changes.

---

## Error handling patterns

- **Structured errors**: one consistent body for every error — [RFC 9457 problem
  details](https://www.rfc-editor.org/rfc/rfc9457) (`type`/`title`/`status`/`detail`)
  plus a stable machine `code` extension. Map internal errors to HTTP status. Never
  leak stack traces/paths in prod.
- **Error boundaries (frontend)**: wrap sections so one broken component doesn't crash
  the page; show a friendly fallback; log to monitoring.
- **Retry with backoff**: external calls retry 2–3× with exponential backoff; make
  retried operations idempotent.

---

## State management (frontend)

| Scale                   | Pattern                       | Example                       |
| ----------------------- | ----------------------------- | ----------------------------- |
| Component-local         | `useState` / reactive vars    | toggle, form input            |
| Shared (few components) | Context / store               | theme, current user           |
| Complex / global        | Zustand, Redux Toolkit, Pinia | cart, multi-step wizard       |
| Server data             | TanStack Query, SWR           | API data with caching/refetch |

**Key rule**: start simplest, move up only when you feel pain. Most apps need only
`useState` + a query library. When reloading lists, keep last-good data and a
separate `isRefreshing` flag — never blank the UI to `[]` mid-reload.

---

## Testing patterns

| What                       | Pattern                         | Tools                |
| -------------------------- | ------------------------------- | -------------------- |
| Pure functions/utilities   | Unit                            | Vitest, Jest, pytest |
| API endpoints / DB queries | Integration (real in-memory DB) | Supertest, httpx     |
| User flows                 | E2E                             | Playwright, Cypress  |
| Component rendering        | Component                       | Testing Library      |
| Visual appearance          | Snapshot / visual regression    | Chromatic, Percy     |

**Priority**: unit (logic) → integration (API/DB) → E2E (critical flows). Aim for
confidence on the important paths, not 100%. See `templates/docs/testing-strategy.template.md`
for the six-cell matrix (layer × happy/edge) this kit grades against.

---

## Anti-patterns decision tree

1. Copying code? → extract a shared function/component.
2. More than 3 params? → use an options object.
3. Function doing two things? → split it.
4. 200+ line file? → split by responsibility.
5. Adding a `type` field and switching on it? → strategy / polymorphism.
6. DB access from a controller? → add a service layer.
7. Hardcoding config? → move to env vars.
8. Storing money as FLOAT? → integer minor units or fixed-precision decimal.
9. Building auth/payments/email from scratch? → use a proven library/service.

---

## When to create an ADR

Record an ADR (`docs/adr/`, template `templates/docs/adr/0000-template.md`) when you:

- choose a technology (framework, database, hosting),
- choose an architecture pattern (monolith vs. services),
- make a trade-off you'll need to explain later (denormalization, caching),
- decide NOT to do something common.
