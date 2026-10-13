# HSO Verification Gates

A PASS is scoped to **the checked evidence**, not a license to deploy.

| Gate | Required signal | Verdict |
| --- | --- | --- |
| G0 BASELINE | Remote/local HEAD, dirty state, dependent Knight commit/JAR when relevant, deployed Vercel/Supabase versions | MATCH / MISMATCH |
| G1 SOURCE TRACE | Real UI → Store → ZeusApi → route/service → RLS/RPC → agent/consumer paths; current Next docs when changing version-sensitive APIs | TRACE_PASS / UNKNOWN |
| G2 IMPLEMENTATION | Minimal diff within approved scope; red-capable focused test at affected contract; compile/lint/typecheck as relevant | PATCH_PASS / FAIL / NOT_RUN |
| G3 INDEPENDENT REVIEW | Spec/PRODUCT + security/contract + tests/maintainability checked by separate reviewer on pinned diff | REVIEW_PASS_STATIC_ONLY / REWORK / BLOCKED |
| G4 PREVIEW/DB CHECK | Same commit in safe preview, authorized Supabase project/migration state, RLS checks and required env; no hidden writes | PREVIEW_PASS / NOT_RUN / BLOCKED |
| G5 LIVE INTEGRATION | Human/operator verifies requested effect via authoritative DB/Agent/viewer/runtime status, not optimistic UI | RUNTIME_PASS / FAIL / NOT_RUN |
| G6 MERGE/DEPLOY | Separate explicit approval, required CI checks, target/environment and rollback | APPROVED / BLOCKED |

## Verification commands: choose by impact

| Change | Relevant commands (check actual environment) |
| --- | --- |
| General TypeScript / Next | `npm run lint`; `npx tsc --noEmit`; `npm run build` when env is valid |
| Script/compiler | `npm run typecheck:scripts` |
| Catalog/map/server | `npm run verify:catalog`; relevant generated-catalog tests |
| Attack spot | `npm run verify:attack-spot`; focused `node --test` cases |
| Queue lifecycle/authorization | Relevant `tests/unit/*queue*test.ts` and route/auth/SQL contracts |
| Migration/RPC | Static contract tests first; executable migration tests only with an **approved isolated DB** |
| UI | Required local `GEMINI.md` checks and target screenshot/manual review; if Impeccable CLI absent report `NOT_RUN` |
| Live integrated controls | Operator-approved preview/read-only status observation; no automatic commands or mutations |

`node --test` against TypeScript requires a compatible Node runtime/loader. Verify rather than assume the installed Node version can execute TS directly. `npm run build` may need configured env vars; failing a build due to missing env is not a claim about program correctness.

## Non-negotiable test quality

For bugs: at least one test should be **red-capable for the original failure**, not tautologically asserting a mocked helper. Examples: stale queue state, duplicate/concurrent publishes, auth/ownership denial, JAR/CTL mismatch and Map 0 sentinel. A green unit test alone does not prove Supabase policy is deployed or Agent has applied changes.

## Review format

```text
task_id:
role:
repo/branch/base_sha/head_sha:
observed_goal:
contract_path / expected vs actual:
changed_files:
executed_checks: command, exit, result
not_run: command, reason
auth_rls / queue_cas / wire_version / viewer_security impact:
review_findings: severity, path:line, scenario, evidence
preview_commit / supabase_project / migration_state: if relevant
live_operator_observation: if relevant
verdict:
next_action / approval_required:
```

Avoid fabricated CI, preview status or stale test output. Coder and Reviewer approvals are distinct from actual deployment status.
