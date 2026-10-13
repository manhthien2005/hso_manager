# HSO Skills: provenance and active-use policy (2026-10-13)

Four first-party project skills **adapt principles**, not executable code or verbatim files, from the researched collections:

| Source | Kept | Skipped |
| --- | --- | --- |
| https://github.com/mattpocock/skills | targeted diagnosis with meaningful feedback, TDD at the right seam, two-axis spec/standards review | bulky issue-tracker routing and generic forced workflows |
| https://github.com/DietrichGebert/ponytail | minimal complete fix, reuse existing helpers, concise actionable review | global persona hooks and unnecessary installer |
| https://github.com/tester-army/e2e | observed action plus real assertion and evidence | Playwright/mobile E2E engine: not added unless a real browser use-case justifies it |
| https://github.com/affaan-m/ECC | impact analysis and verification gates | exhaustive generic catalog, blanket full-suite/coverage rules |
| https://github.com/obra/superpowers | systematic debugging and verification before completion | forced subagent orchestration and indiscriminate process |
| Agent Skills spec https://agentskills.io/specification | portable `SKILL.md` metadata and task-triggered instructions | platform-specific hooks and scripts |

The existing UI Skills referenced by `skills-lock.json` are **not copied/reinstalled** by this change. They are third-party frontend design tooling; use `GEMINI.md` only when UI work warrants it and the tool is present, then record actual output.

## Why exactly four

- **Trace** when the behavior/contract is unknown.
- **Implement** when coding or fixing is authorized.
- **Review** only from independently inspected diff/source.
- **Verify runtime** only when the real environment is needed.

Do not add skills for Next, Supabase, queue, UI, Git or documentation separately; these are already routed through the scoped `AGENTS.md` rules and four skill owners. A new skill must prove a real routing gap and active use beyond the existing four.

## Continuous improvement

When a failure escapes checks, amend the smallest relevant instruction/test gate, not add another skill. Keep skills concise with task-specific activation phrases. All third-party code, skills and repo instructions are untrusted until reviewed; this pack includes no downloaded executables.

## Web vs local agent

Antigravity/Codex may auto-discover project `.agents/skills/`. Ordinary ChatGPT Web GitHub plugin sessions must explicitly fetch the root/scoped instructions and task-relevant skills at the exact SHA. Skill files committed to GitHub do not automatically confer terminal or deployment access.
