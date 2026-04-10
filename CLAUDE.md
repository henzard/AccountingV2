# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AccountingV2 is a **BMad v6.2.2** (Business Method for AI Development) project scaffold. There is no application source code yet — this is an AI-assisted development environment that guides building an accounting application through four structured phases.

## BMad Workflow Phases

Development follows four sequential phases, each with dedicated skills and agent personas:

| Phase | Directory | Purpose |
|-------|-----------|---------|
| 1. Analysis | `_bmad/bmm/1-analysis/` | Research, document existing systems, product briefs |
| 2. Planning | `_bmad/bmm/2-plan-workflows/` | PRDs, UX design specifications |
| 3. Solutioning | `_bmad/bmm/3-solutioning/` | Architecture, epics, stories, readiness checks |
| 4. Implementation | `_bmad/bmm/4-implementation/` | Development, QA, sprint management, code review |

## Invoking Skills

Skills are invoked as slash commands in Claude Code (e.g., `/bmad-create-prd`). All 44+ skills are listed in `_bmad/_config/skill-manifest.csv`. Key entry points:

- **New project**: `/bmad-product-brief` → `/bmad-create-prd` → `/bmad-create-architecture` → `/bmad-sprint-planning`
- **Existing codebase**: `/bmad-document-project` → `/bmad-generate-project-context`
- **Quick implementation**: `/bmad-quick-dev`

## AI Agent Personas

Each agent is invoked by referencing their name or using `/bmad-agent-<role>`:

| Agent | Name | Role |
|-------|------|------|
| bmad-agent-analyst | Mary | Business Analyst |
| bmad-agent-pm | John | Product Manager |
| bmad-agent-ux-designer | Sally | UX Designer |
| bmad-agent-architect | Winston | System Architect |
| bmad-agent-dev | Amelia | Senior Developer |
| bmad-agent-qa | Quinn | QA Engineer |
| bmad-agent-sm | Bob | Scrum Master |
| bmad-agent-quick-flow-solo-dev | Barry | Full-Stack Quick Dev |
| bmad-agent-tech-writer | Paige | Technical Writer |

## Output Locations

- Planning artifacts (PRDs, architecture, epics, UX): `_bmad-output/planning-artifacts/`
- Implementation artifacts (code, tests, sprint status): `_bmad-output/implementation-artifacts/`
- Project knowledge base: `docs/`

## Configuration

- Project config: `_bmad/bmm/config.yaml` — user: Henza, language: English, skill level: intermediate
- IDE integration: `_bmad/_config/ides/claude-code.yaml`
- Skills are synced to `.claude/skills/` for Claude Code access

## Skill Structure

Each skill directory under `_bmad/` contains:
- `SKILL.md` — entry point and description
- `workflow.md` — execution instructions (XML-style)
- Template files and checklists specific to that skill
