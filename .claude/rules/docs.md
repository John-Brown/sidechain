---
paths:
  - "plans/**/*.md"
  - "reference/**/*.md"
---

# Documentation Conventions

## Lifecycle

- Active plans live in `plans/`
- Completed phase plans move to `plans/archive/` when the phase is done
- Reference material (stable, not phase-bound) lives in `reference/`
- Superseded reference docs move to `plans/archive/phase-0-reference/` (or a similarly named folder) with an archive banner.

## Navigation

- `plans/INDEX.md` is the agent entry point for all documentation
- Any new doc must be added to INDEX.md in the appropriate section
- DEVLOG.md is append-only, newest entries first, each entry includes date + files changed

## Naming

- Phase plans: `phase-{N}-{slug}.md` (kebab-case)
- Everything else: `kebab-case.md`
- Reference docs: numbered prefix `{NN}-{slug}.md` for the original series; unnumbered for later additions
- Split parts of an over-limit doc: `{NN}a-{slug}.md`, `{NN}b-{slug}.md`, … each under 500 lines, cross-linked to the others

## Size

- Target: <300 lines
- Hard limit: 500 lines — split into parts if larger
- Exception: DEVLOG.md grows naturally (append-only)
- Archived docs (`plans/archive/**`) are frozen snapshots, exempt from the size limit; don't edit them beyond a status banner.

## Cross-references

- Use relative paths from the doc's location
- When moving docs, grep for the old path in all `.md` files and update references
