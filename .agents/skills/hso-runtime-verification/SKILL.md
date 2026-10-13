---
name: hso-runtime-verification
description: Use when validating HSO Manager preview or live Next.js/Vercel/Supabase integration, authenticated UI flows, queue state, RLS, viewer leases, config apply and Agent readback after a reviewed change.
---
# HSO Runtime Verification

Runtime tests are explicit operator-assisted gates, never permission to mutate production. Read root `AGENTS.md`, affected scoped rules, and `docs/agent/VERIFICATION_GATES.md`.

## Preflight

1. Pin GitHub commit, Vercel preview deployment ID, environment, Supabase project/migration baseline, test account/device ownership and dependent Knight Agent/JAR SHA/CTL if relevant. Verify preview corresponds to reviewed commit.
2. Check permissions and impact; prefer an isolated preview/database or non-destructive read-only inspection. Never copy real credentials into screenshots/reports or use the production service role in a client.
3. Establish a single concrete acceptance: e.g. unauthorized request denied, correct queue state readback, config saved versus applied, viewer lease expired, or true runtime command completion. Define stop and rollback.
4. Inspect any live actions and request operator approval before triggering queue start/cancel, pairing, account lifecycle, database changes, production deployment, viewer session, or writes.

## Observe and conclude

- Capture initial state, action requested, authoritative response/DB state, Realtime event and Agent observed state if in scope. A UI toast alone is not a pass.
- For queue work, distinguish `DRAFT`, published `QUEUED`, intermediate, terminal and manual-review states; verify whether Agent actually consumed it. Check stale, replay, duplicate and ownership boundaries only with safe authorized tests.
- For control versions, validate against actual `jar_ctl_version` and capability; for viewer access validate URL sanitization, expiry and ownership.
- If test cannot be run without destructive access, mark NOT_RUN/BLOCKED and request a safe environment. Never fake credentials, snapshots or outcomes.
- On mismatch, stop and hand one focused observation to `hso-contract-trace`; avoid unlimited live retests.

## Output

```text
COMMIT / DEPLOYMENT / SUPABASE_PROJECT / DB_VERSION / AGENT_JAR_CTL
TESTED_BOUNDARY / AUTHORITY / OPERATOR_APPROVAL
PRESTATE / ACTION / OBSERVED_DB_EVENT / OBSERVED_AGENT / UI_RESULT
EXECUTED_CHECKS / NOT_RUN / STOP-ROLLBACK
VERDICT: PREVIEW_PASS | RUNTIME_PASS | RUNTIME_FAIL | BLOCKED
```

Production promotion, migration and merge remain separate explicit operator decisions.
