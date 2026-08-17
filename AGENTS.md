<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bugfix reports

Every bugfix gets a report in `fixes/`, written in the format of
`fixes/ind_bugfix_A.md`. Follow that format unless explicitly told otherwise:

1. **Symptom** — the report verbatim.
2. **Root cause** — with `file:line` evidence, not a description of the fix.
3. **Ruled out** — hypotheses eliminated, and what eliminated them.
4. **The change** — what, where, and why each value.
5. **Deliberately not changed** — the plausible-looking fixes that would be wrong.
6. **Verification** — commands run, manual checklist, and harness caveats.
7. **Invariants for future agents** — what silently breaks if this is undone.

Sections 3 and 5 are the point of these documents. They exist so the next agent does
not re-derive a dead end, or "fix" something that is load-bearing.
