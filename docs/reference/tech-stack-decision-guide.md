# Tech stack decision guide

> Read-only reference. Use this **before** writing code. Answer the questions below
> (with your AI in "Act as Interviewer" mode); the answers drive your tech choices
> and prevent expensive rewrites. Record the result in
> `templates/docs/architecture.template.md` + an ADR.
> Ref: [choosing a stack 2026](https://stacksfinder.com/guides/how-to-choose-tech-stack-2026),
> [boring technology](https://mcfunley.com/choose-boring-technology).

> **Rule of thumb:** pick boring technology you (or your AI) know well. Trendy
> stacks cost 2–3× more in debugging time when things go wrong.

> **Kit default stack** (when you have no preference): React + TypeScript (frontend),
> Express.js + TypeScript (backend), SQLite (local dev), Supabase/PostgreSQL
> (production/distributed), Supabase Auth, Tailwind CSS + shadcn/ui. UI must meet
> **WCAG 2.2 AA**; DB is **snake_case, 3NF**; **money is integer minor units, never FLOAT**.

---

## Step 1 — What are you building?

| Question                                                                                    | Your answer |
| ------------------------------------------------------------------------------------------- | ----------- |
| Product type? (SaaS, API, mobile, CLI, content site, dashboard, data pipeline, marketplace) |             |
| Users? (consumers, businesses, internal, developers)                                        |             |
| Concurrent users in year one? (<100, 100–1K, 1K–10K, 10K–100K, 100K+)                       |             |
| MVP/prototype or production-grade from day one?                                             |             |

**Decision output**

- **<1K users, MVP**: monolith + managed hosting. No microservices, no Kubernetes.
- **1K–10K**: monolith or modular monolith; managed DB; CDN for static assets.
- **10K+**: consider service boundaries; load balancer + caching; record in an ADR.

---

## Step 2 — Frontend

| Question                                     | Your answer |
| -------------------------------------------- | ----------- |
| Web UI? Mobile app?                          |             |
| SEO important? (content, landing, blog)      |             |
| Real-time important? (chat, live dashboards) |             |
| Does the team know a framework already?      |             |

| Situation                 | Recommended                     | Why                                 |
| ------------------------- | ------------------------------- | ----------------------------------- |
| Web app, team knows React | **Next.js + TypeScript**        | SSR/SSG, huge ecosystem, AI tooling |
| Web app, want simplicity  | **SvelteKit**                   | less boilerplate, small bundle      |
| Web app, team knows Vue   | **Nuxt**                        | Vue ecosystem, good DX              |
| Content / marketing       | **Astro** or static Next.js     | fast, SEO-first, low JS             |
| Mobile (cross-platform)   | **React Native** or **Flutter** | one codebase iOS+Android            |
| Admin / internal          | **Next.js** or **Refine**       | fast to build                       |
| API only                  | _skip this section_             |                                     |

**UI**: use a component library (shadcn/ui, Radix, Headless UI, MUI, Chakra) rather
than building from scratch. Build to **WCAG 2.2 AA** — keyboard operable, labelled,
contrast-checked. See the kit's `weighsoft-ui-ux-design` skill.

---

## Step 3 — Backend

| Question                                                          | Your answer |
| ----------------------------------------------------------------- | ----------- |
| Team's backend language?                                          |             |
| Business-logic complexity? (CRUD / moderate / complex domain)     |             |
| Real-time (WebSockets/SSE)? Background jobs? Many 3rd-party APIs? |             |

| Situation                           | Recommended                                         | Why                                                                                                             |
| ----------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| JS/TS team, moderate complexity     | **Node + Express** (or **Fastify**)                 | same language front-to-back; Express = largest ecosystem, Fastify = built-in schema validation + ~3× throughput |
| Greenfield TS, edge / multi-runtime | **Hono**                                            | Web-Standards, runs on Node/Bun/Deno/Cloudflare Workers from one codebase, strong TS DX                         |
| Complex/enterprise domain           | **NestJS** / **.NET** / **Spring Boot**             | structured, strong typing                                                                                       |
| Fast MVP, solo                      | **Next.js API routes** / **Laravel** / **Supabase** | batteries included                                                                                              |
| Python / ML / data                  | **FastAPI**                                         | async, type hints                                                                                               |
| Performance critical                | **Go** or **Rust**                                  | low latency/memory                                                                                              |

_Boring still wins:_ Express's ecosystem makes it the safe default; reach for Fastify or Hono when you have a concrete throughput or multi-runtime need, not for novelty.

**Architecture (pick one, record in ADR):** Monolith (<5 devs, unclear boundaries) →
Modular monolith (clear boundaries, single deploy) → Microservices (large team,
independent deploys). **Start monolith.** Premature microservices is the #1 mistake.
Whatever you pick, dependencies point inward (domain has no framework/DB imports).

---

## Step 4 — Database

| Question                                                                    | Your answer |
| --------------------------------------------------------------------------- | ----------- |
| Relational vs. document data? Full-text search? Real-time? Year-one volume? |             |

| Situation               | Recommended                                       | Why                                  |
| ----------------------- | ------------------------------------------------- | ------------------------------------ |
| Relational (most apps)  | **PostgreSQL**                                    | flexible, JSON support, scales, free |
| Document-first          | **MongoDB**                                       | schema flexibility                   |
| Simple/fast             | **SQLite** or **Supabase**                        | zero setup                           |
| Full-text search        | **PostgreSQL** built-in, or Meilisearch/Typesense | avoid Elasticsearch unless huge      |
| Real-time subscriptions | **Supabase** or **Firebase**                      | built-in pub/sub                     |
| Caching                 | **Redis**                                         | in-memory, fast                      |

**Schema rules (kit invariants):** `snake_case` columns, normalise to **3NF** by
default (denormalise only with an ADR), **money as integer minor units or DECIMAL —
never FLOAT/REAL**. See the kit's `weighsoft-database-design` skill.

---

## Step 5 — Authentication

| Situation                           | Recommended                         | Why                                                                                    |
| ----------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| Already on Supabase                 | **Supabase Auth**                   | auth + DB + realtime in one; integrates with Postgres RLS so you write less authZ code |
| Self-hosted, no vendor lock-in (TS) | **Better Auth**                     | runs in your app, stores users in your DB; passkeys/2FA/orgs built in                  |
| Hosted, fastest to a sign-in screen | **Clerk**                           | prebuilt UI + user management (watch per-MAU cost at scale)                            |
| OAuth-first, already on it          | **Auth.js (NextAuth v5)**           | OAuth providers + DB adapters                                                          |
| Enterprise / SSO                    | **Auth0**, **Clerk**, or **WorkOS** | SAML, OIDC, SCIM, orgs                                                                 |
| API-only                            | **API keys** + rate limiting        | simple, stateless                                                                      |
| Roll your own                       | **Don't — use a library.**          | auth is deceptively hard                                                               |

---

## Step 6 — Hosting and deployment

| Situation                | Recommended                             | Why                              |
| ------------------------ | --------------------------------------- | -------------------------------- |
| Frontend + serverless    | **Vercel** / **Netlify**                | auto-deploy, edge CDN, free tier |
| Full-stack, simple       | **Railway** / **Render**                | easy monolith + managed DB       |
| Containers / flexibility | **Fly.io** / **AWS ECS**                | Docker, multi-region             |
| Enterprise / compliance  | **AWS** / **Azure** / **GCP**           | full control, certifications     |
| Static site              | **Cloudflare Pages** / **GitHub Pages** | free, global CDN                 |

---

## Step 7 — Document your decisions

1. Fill `templates/docs/architecture.template.md` with the chosen stack.
2. Record an ADR (`docs/adr/0002-tech-stack.md`) per non-obvious choice.
3. Add any tech constraints to `docs/constitution.md`.
4. Wire `scripts/verify.sh` with the real lint/test/typecheck/build commands.

---

## Quick-start stacks (copy-paste starting points)

**Kit default (no preference):** React + TS + Tailwind + shadcn/ui · Express + TS ·
SQLite (local) → Supabase/Postgres (prod) · Supabase Auth · Vercel/Railway + Supabase.
Cost: free → ~$25/mo. Why: largest ecosystem + hiring pool, instant local dev, one
managed service for DB/auth/realtime/storage when you go distributed.

**Next.js all-in-one:** Next.js + TS + Tailwind + shadcn/ui (API routes) · Postgres
(Supabase/Neon) · Clerk or Auth.js · Vercel. Free → ~$25/mo.

**Laravel express (fast MVP):** Laravel + Livewire/Inertia · Postgres/MySQL · Laravel
auth · Forge + DigitalOcean. ~$12/mo.

**Python data app:** FastAPI + SQLAlchemy · Next.js or Streamlit · Postgres ·
FastAPI-Users or Clerk · Railway or Lambda. Free → ~$20/mo.

**API / platform:** NestJS + TS or Go · Postgres + Redis · API keys + JWT · OpenAPI
docs · Fly.io or AWS. ~$10–50/mo.
