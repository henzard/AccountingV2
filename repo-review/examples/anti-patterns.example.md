# NutSync — Anti-Patterns Catalogue

**Date:** 2026-06-15 · **Scope:** the whole repo (Expo / React Native + Electron + a Node-RED hub). · **Status:** living document.

This is the lessons-learned register for NutSync. It exists so a recurring class of bug is not shipped twice. Every entry is grounded in a real file in this repo or in one of the committed audits under `docs/`.

> See the full file in the remote repository for the complete catalogue of anti-patterns
> including AP-1 through AP-NS-9 covering: list-blank-on-reload, post-login assertion gap,
> fix-without-backfill, deploy-time blind spot, silent sync skip, markSynced lost-update,
> wall-clock LWW, SQL interpolation, and client-only authorization.

Each anti-pattern follows the same shape:

- **Smell** — what the code looks like when you have it.
- **Trigger** — the runtime condition that turns the smell into a bug.
- **Mitigation rule** — the reviewable rule to apply (and the test that locks it).
- **Example** — a real `file:line` in this repo.

## How to use this doc

- **Before writing code** that touches sync, auth, the hub contract, or a list screen, read the matching entry and pre-empt its mitigation.
- **In review**, treat each "Mitigation rule" as a checklist item; a PR that re-introduces a smell here without its guard does not merge.
- **When a new bug reaches prod or CI catches something review missed**, append a new entry (smell / trigger / rule / `file:line`) here, and — if it recurs — promote it to a hard test gate. This file is the durable record; chat is not.
