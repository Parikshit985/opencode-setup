---
description: Ship it — quality gate, tests, CI workflow, release notes, commit. Usage: /ship [message]
agent: cicd
---

Ship the current repo for: $ARGUMENTS

1. QA pass: run the test suite; fix failures; add regression tests for any bugs found.
2. CI: if no workflow exists (e.g. .github/workflows/), add the template at ~/.config/opencode/templates/cicd-opencode.yml, adapted to this repo.
3. Build: verify the project builds/starts cleanly.
4. Release notes: short CHANGELOG-style entry.
5. Commit with a concise message matching the repo's style. Do NOT push unless the founder says so.

Report: what passed, what you changed, and the exact commit hash.