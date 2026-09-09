---
name: memory-protocol
description: Memory consolidation — search the Obsidian memory vault at project start, append a Learnings note at project end, keep entries short and actionable. Use when starting a new project or task, finishing work, or before /retro.
---

# Memory Consolidation Protocol

The team's long-term memory is the Obsidian vault at **`<VAULT_PATH>`**.
It replaces the old `learnings.md` files (deleted 2026-08-26 — the vault holds everything).

- Index / map: `<VAULT_PATH>\Home.md`
- Session lessons: `Learnings/YYYY-MM-DD - <Topic>.md`
- Project state: `Projects/<name>.md`

## How to access the vault

**Preferred — obsidian MCP tools** (live after opencode restart, once the Obsidian CLI is registered):

```
obsidian_search query=<domain keyword>   # locate relevant notes
obsidian_folders                          # structure overview
read <full path>                          # then read matched notes
obsidian_tags                             # browse by tag
```

**Fallback — direct filesystem** (always works, vault is plain markdown):

- Search: Grep tool over `path: <VAULT_PATH>` for domain keywords.
- List: Glob pattern `*` in `<VAULT_PATH>\Learnings`.
- Read/Write: standard Read/Write tools on full paths.

## When to read

At the start of any project or task in a familiar domain: search the vault for
the domain keywords (e.g. "scraping", "vercel", "hyperframes", "metallurgy"),
read the matching notes, and apply past lessons as defaults.

## When to write

At the end of any significant piece of work (feature, fix, research, QA pass,
incident), create a new note `Learnings/YYYY-MM-DD - <Topic>.md`:

```markdown
---
date: YYYY-MM-DD
type: learning
tags: [learning, <domain-tag>]
---

# YYYY-MM-DD — <Topic>

- One line per finding: "what happened -> rule to apply". Be specific:
  "hash collisions in URL shortener", not "stuff broke".
- Include exact versions/commands when they mattered.
```

Format rules:

1. One note per session/topic; do not edit old notes to append new sessions.
2. 3–10 bullets per note; never vague praise; never duplicate an existing lesson.
3. Pick a descriptive `<Topic>` — it is the primary search handle.
4. Domain tags help: `#hyperframes`, `#vercel`, `#scraping`, `#metallurgy`, `#self-improve`, ...
5. For ongoing projects, also maintain `Projects/<name>.md` (goal, key decisions,
   open threads) instead of forcing everything into dated notes.

## Consolidation

- When `Learnings/` grows past ~40 notes, run /retro and merge duplicates into a
  single `_Repeated lessons` note per theme.

## Self-improve entries

The improver agent logs config changes as notes tagged `#self-improve` with the
rationale — these are the audit trail of the self-improving loop.
