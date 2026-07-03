# API / interface contract — <service name>

> Purpose: pin down endpoints, payloads, and response shapes BEFORE implementation
> so both sides build to the same contract. Copy per API/service, fill every
> `<!-- fill-in -->`, delete examples. If the API is more than trivial, treat this
> doc as the source for a machine-readable [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.1.html)
> spec (or [3.2](https://spec.openapis.org/oas/v3.2.0.html), Sept 2025) — generate
> clients/docs/contract tests from it rather than hand-syncing.
> Ref: [Spec Kit plan](https://github.com/github/spec-kit),
> [Microsoft REST API guidelines](https://github.com/microsoft/api-guidelines),
> [RFC 9457 problem details](https://www.rfc-editor.org/rfc/rfc9457).

**Status:** Draft · **Last updated:** <!-- YYYY-MM-DD --> · **Owner:** <!-- name -->

---

## Service

- **Name**: <!-- fill-in: e.g. User API -->
- **Base URL**: <!-- fill-in: e.g. `/api/v1/users` -->
- **Auth**: <!-- fill-in: e.g. Bearer JWT; roles: admin, user -->

## Endpoints

### `POST /api/v1/<resource>`

- **Description**: <!-- fill-in -->
- **Auth**: <!-- fill-in: e.g. Admin only -->
- **Request body**:
  ```json
  {
    "email": "string (required)",
    "name": "string (required)",
    "role": "admin | user (default: user)"
  }
  ```
- **Response 201**:
  ```json
  {
    "id": "string (uuid v4)",
    "email": "string",
    "name": "string",
    "role": "string",
    "created_at": "string (ISO 8601 UTC)"
  }
  ```
- **Error responses** (`Content-Type: application/problem+json`, [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)):
  | Status | When | Body |
  |--------|------|------|
  | 400 | Validation fails | `{ "type": "/errors/validation", "title": "Validation failed", "status": 400, "detail": "email is required", "code": "VALIDATION_ERROR", "errors": [{ "field": "email", "message": "required" }] }` |
  | 401 | No / invalid token | `{ "type": "about:blank", "title": "Unauthorized", "status": 401, "code": "UNAUTHORIZED" }` |
  | 409 | Already exists | `{ "type": "/errors/conflict", "title": "Conflict", "status": 409, "detail": "user already exists", "code": "CONFLICT" }` |

### `GET /api/v1/<resource>/:id`

- **Description**: <!-- fill-in -->
- **Auth**: <!-- fill-in -->
- **Response 200**: _same shape as create response._
- **Error responses**: _404 if not found._

<!-- Add more endpoints below using the same format. -->

## Shared types

<!-- fill-in: types used across endpoints. -->

```
User {
  id: string (uuid v4)
  email: string
  name: string
  role: "admin" | "user"
  amount_cents: integer   // money is integer minor units — never FLOAT
  created_at: string (ISO 8601 UTC)
}
```

## Conventions

- Dates: ISO 8601 **UTC**. IDs: UUID v4.
- **Money: integer minor units** (e.g. `amount_cents`) or fixed-precision decimal — never a JSON float.
- Field names: `snake_case` (match the DB) unless the client contract requires camelCase — pick one and state it here.
- Error shape: [RFC 9457 problem details](https://www.rfc-editor.org/rfc/rfc9457) — `application/problem+json` with `type`, `title`, `status`, `detail`, `instance`, plus any extension members you need (a stable machine `code`, a per-field `errors` array). One shape for every error in the API. No stack traces or internal paths in prod.
- Pagination: cursor for large sets (`?cursor=abc&limit=20`), offset for admin tools (`?page=1&limit=20`); response includes `{ "data": [], "next_cursor": "..." }` or `{ "data": [], "total": n, "page": n }`.
- Versioning: URL prefix `/api/v1/...`; bump only on breaking changes.
- HTTP status: `200` read, `201` create, `204` delete, `4xx` client error, `5xx` server.

## When NOT to use this

- Internal-only functions/modules: document with types/JSDoc instead.
- Prototypes/spikes: skip the formal contract; define inline.
