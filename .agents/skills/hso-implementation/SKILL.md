---
name: hso-implementation
description: Use when implementing approved HSO Manager Next.js/React UI, Supabase-backed services, authenticated queue handlers, config forms, tests or minimal bug fixes on a pinned feature branch.
---
# HSO Implementation

**Goal:** Deliver the smallest complete behavior while preserving honest operator state and existing contracts. Code only within explicitly approved scope.

## Entry

Pin main/base/head and source snapshot; inspect local dirty state where available. Read root and `src/AGENTS.md` or `supabase/AGENTS.md`. If debugging or changing cross-repo contract, use `hso-contract-trace` first. If the work would modify DB migrations, `ZeusApi`, permissions, wire schema, queue ownership or deploy state, request explicit contract scope approval before edits.

## Vertical slice

1. Name the operator-visible acceptance condition and trace the real route, store, data provider and Agent/DB consumer; identify touched tests.
2. Identify/create one focused red-capable regression, not a fake green helper assertion. If it requires Supabase/runtime and unavailable, state NOT_RUN and define an operator gate.
3. Implement the narrowest change in the responsible layer; reuse existing UI primitives and provider patterns. For UI tasks, honor `PRODUCT.md`, `DESIGN.md` and `GEMINI.md`, using external UI skills only if installed.
4. Validate negative cases: 401/403 ownership, offline device/stale capability, conflicting/duplicate queue, expired viewer lease, control-version mismatch and state readback **where relevant**. Do not widen unrelated tests.
5. Run focused `node:test`/domain scripts plus lint/typecheck/build when scoped. Check exit code, real output and env; don't claim passing CI unless fetched from GitHub.
6. Review diff for accidental migrations, `ZeusApi`, product docs, secrets, live services, generated files, unrelated refactor and no-op tests. Only user-authorized feature-branch commit/push/PR; no merge or deploy.

## Handoff

```text
TASK_ID; BASE_SHA; HEAD_SHA; DIRTY_STATE
INTENT; CONTRACT_TRACE; FILES_CHANGED
FOCUSED_TEST_RED/GREEN + commands or NOT_RUN
AUTH/RLS/QUEUE/CAS/CONFIG impact; residual risk
GITHUB_PR/CI actual result
VERDICT: READY_FOR_INDEPENDENT_REVIEW | BLOCKED
```

The browser's optimistic toast is not authoritative confirmation of a queue/Agent action. Never make runtime success claims from mock mode.
