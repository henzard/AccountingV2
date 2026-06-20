---
name: weighsoft-ui-ux-design
formerly: ui-ux-design
description: Enforce that every user-facing change ships beautiful AND accessible — WCAG 2.2 Level AA as a hard floor (contrast, keyboard, visible focus, target size, dragging alternatives), mobile-first responsive layout from 320px, and a tokenized visual system with no hardcoded hex. Use when adding or reviewing any UI — a screen, component, form, email, or design-system change — or when asked to "make this accessible", "check the UX", "review the front-end", or "does this meet WCAG".
version: 1.0.0
category: ux
tags:
  - accessibility
  - wcag-2-2
  - design-tokens
  - responsive
  - mobile-first
  - semantic-html
  - focus-management
  - interaction-design
  - ux-review
---

# weighsoft-ui-ux-design — beautiful and accessible, never one at the cost of the other

> 🔁 **Renamed:** this skill is now **weighsoft-ui-ux-design** (formerly **ui-ux-design**). Update any references; other systems keying off the old name should rename to match.

This skill governs every user-facing surface. Accessibility and aesthetics are co-requirements,
not a slider you slide between. A gorgeous screen a keyboard user can't operate fails; a
spec-compliant screen nobody wants to use fails too.

> **Ship beautiful AND accessible. These are not trade-offs — both mandatory.**

## The rules

### Perceivable (WCAG 2.2 AA)

- Every non-decorative image, icon-button, and chart carries a **text alternative**; decorative
  images are `alt=""` (empty, not missing).
- **Contrast ≥ 4.5:1** for normal text, **≥ 3:1** for large text (≥ 24px, or ≥ 19px bold) and for
  UI component/graphical boundaries (1.4.11). Measure it — don't eyeball it.
- **Never encode meaning by color alone** — pair color with text, icon, or pattern (error state =
  red _and_ a message _and_ an icon).

### Operable (WCAG 2.2 AA — includes the 2.2 additions)

- **Full keyboard operability**, logical tab order, no keyboard traps; a **visible focus indicator
  ≥ 2px** that is never `outline:none` without a stronger replacement.
- **2.4.11 Focus Not Obscured** — a focused element is never fully hidden behind a sticky header,
  cookie bar, or chat widget. ([WCAG 2.2][wcag], [Vispero][vis])
- **2.5.8 Target Size (Minimum)** — interactive targets ≥ **24×24 CSS px** (with spacing exception);
  treat **44×44** as the design default for primary touch controls (2.5.5). ([Level Access][la])
- **2.5.7 Dragging Movements** — anything draggable (sliders, reorder, kanban, map pan) has a
  single-pointer non-drag alternative (tap/click, arrows, buttons). ([WCAG 2.2][wcag])
- No auto-playing media; provide pause/stop for anything that moves > 5s.

### Understandable

- One **`<h1>`** per page; heading hierarchy descends without skips (H1→H2→H3, never H2→H4).
- Every input has a **visible, persistent `<label>`** — placeholder text is **not** a label.
- Errors are **specific and actionable** ("Email must include an @") and announced to assistive
  tech, not color-only.

### Robust

- **Semantic HTML first** — `<button>`, `<nav>`, `<main>`, `<a href>`, `<table>`. Reach for ARIA
  only to fill genuine gaps, and follow the roles/states/properties contract for custom widgets
  (no `role="button"` without keyboard handlers).

### Visual system

- **Mobile-first from 320px**; tested at **320 / 768 / 1024 / 1440px**; **200% zoom** with no
  horizontal scroll and no clipped content (1.4.10 reflow).
- **≥ 16px base body font**, **1.5 line-height** body; **≤ 3–4 type sizes** per page.
- **Three-tier design tokens** — primitives (`color.blue.500`) → semantic/alias (`color.accent`,
  `color.bg.surface`) → component (`button.primary.bg`); components reference **semantic** tokens,
  never primitives or raw hex. Align to the **W3C DTCG format** — first stable version
  **2025.10**: a token is any object with a reserved **`$value`** (plus optional `$type`,
  `$description`, `$deprecated`) — so tokens are tool-portable. ([W3C DTCG stable spec][dtcg], [naming guide][nam])
- **4px spacing scale**; no magic pixel values off-scale.

### Interaction

- Hover/active/focus states on every clickable; transitions **150–300ms** (respect
  `prefers-reduced-motion`).
- **Optimistic UI** for perceived speed, with a real rollback path on failure.

## Anti-patterns to reject

- **Placeholder-as-label** — vanishes on input, fails low-vision and memory users.
- **`<div onClick>`** — not focusable, not keyboard-operable, no role; use `<button>`.
- **`outline: none`** with no replacement — destroys the focus indicator keyboard users depend on.
- **Hardcoded hex / off-scale spacing** — breaks theming, dark mode, and consistency; tokens exist
  for this.
- **Fixed-pixel fonts that ignore zoom**, or **text baked into images** — both fail reflow and
  alt-text.
- **Color-only error/success states** — invisible to color-blind users (1.4.1).
- **Tap targets < 24px / drag-only interactions** — fail 2.5.8 and 2.5.7 motor-impairment criteria.
- **Auto-playing media & infinite scroll with no alternative** — no user control, no footer reach.

## How it composes with the kit

- **add-feature** Phase 4 runs this as its `weighsoft-ui-ux-design` conformance row — a UI plan that can't
  name its tokens or its focus/target-size story goes back to planning.
- **qa-lead** / **quality-review** pull the WCAG + Nielsen checks into the UX specialist agent;
  this skill is the rubric that agent grades against.
- **verification-quality** is the evidence bar — "accessible" means _demonstrated_ (axe/Lighthouse
  run, keyboard walk-through, zoom test), not asserted.

## Conformance checklist

- [ ] Contrast measured: ≥ 4.5:1 text, ≥ 3:1 large/UI boundaries
- [ ] Full keyboard pass: logical order, no traps, visible ≥ 2px focus, focus never obscured (2.4.11)
- [ ] Targets ≥ 24×24px (44×44 for primary touch); every drag has a non-drag alternative (2.5.7/2.5.8)
- [ ] Semantic HTML; ARIA only where needed and contract-complete; one H1, no heading skips
- [ ] Every input has a visible label; errors specific + non-color-only
- [ ] Layout verified at 320/768/1024/1440 and 200% zoom with no horizontal scroll
- [ ] Colors/spacing/type from semantic design tokens — zero hardcoded hex, on a 4px scale
- [ ] No auto-play; reduced-motion honored; optimistic UI has a rollback path

## Quick reference

```text
Perceivable  — alt text · 4.5:1 contrast · never color-only
Operable     — keyboard · visible 2px focus · focus not obscured (2.4.11)
             — targets 24px+ (44 primary, 2.5.8) · drag has tap alt (2.5.7)
Understand.  — one H1, no skips · visible labels · specific errors
Robust       — semantic HTML first, ARIA to fill gaps
Visual       — mobile-first 320px · 16px/1.5 · 4px scale · 3-tier tokens, no hex
Interaction  — hover/focus states · 150-300ms · optimistic UI w/ rollback
Reject       — placeholder-label · div-onClick · outline:none · color-only · <24px targets
```

**The gate, one line:** _no UI ships unless it meets WCAG 2.2 AA (contrast, keyboard, visible
focus, 24px+ targets, drag alternatives), reflows mobile-first from 320px to 200% zoom, and draws
every color/space/type value from semantic design tokens — proven, not asserted._

---

Sources / further reading:
[wcag]: https://www.w3.org/TR/WCAG22/ "Web Content Accessibility Guidelines (WCAG) 2.2 — 2.4.11, 2.5.7, 2.5.8 success criteria"
[la]: https://www.levelaccess.com/blog/wcag-2-2-aa-summary-and-checklist-for-website-owners/ "WCAG 2.2 AA Summary & Checklist (target size, focus, dragging)"
[vis]: https://vispero.com/resources/new-success-criteria-in-wcag22/ "New Success Criteria in WCAG 2.2 — Vispero"
[dtcg]: https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/ "Design Tokens Specification reaches first stable version (2025.10), W3C DTCG"
[nam]: https://www.netguru.com/blog/design-token-naming-best-practices "Design Token Naming Best Practices (3-tier: primitive/semantic/component)"
