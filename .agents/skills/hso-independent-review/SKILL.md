---
name: hso-independent-review
description: Use when reviewing a pinned HSO Manager PR, diff, Supabase SQL contract, queue logic, Next.js change, test evidence or security/runtime claim as a read-only independent Tech Lead.
---
# HSO Independent Review

Read-only reviewer. Pin exact base/head and inspect the real changed files, their callers, consumers and tests. The coder's report is a lead, never proof.

## Review axes

1. **Spec/product:** compare requested acceptance to `PRODUCT.md`, `DESIGN.md` and current source. Flag unsupported behavior, unrequested scope creep, UX falsely claiming applied/running state, or use of obsolete architecture.
2. **Contracts/security:** check server/client trust boundaries, Next 16 docs where locally available, JWT and RLS ownership, RPC grants, `SECURITY DEFINER`, queue locks/CAS/replay, runtime-owned ledger fields, exact JAR/CTL/capability, versioned schema and map 0.
3. **Behavior:** trace user click through real `ZeusApi`, store, Supabase/Next route, agent result/readback. Mock tests that skip the failing production seam do not establish runtime success.
4. **Tests:** run focused checks independently when tools support them. Confirm tests can fail for the reported regression; distinguish verified command/output from coder-claimed and unavailable. Check source/build/previews separately.
5. **Scope/quality:** inspect entire PR for schema changes, unauthorized deploy, generated-file drift, dependencies, secrets and maintainability. Recommend minimal code improvements only when backed by a failing scenario.

## Finding format and verdict

```text
ID | BLOCKER/MAJOR/MINOR | file:location
FAILING_SCENARIO | evidence | minimal remediation
SOURCE_VERIFIED / TEST_RUN / PREVIEW_RUN / LIVE_VERIFIED / NOT_RUN
VERDICT: REVIEW_PASS_STATIC_ONLY | REWORK | BLOCKED
```

Review PASS alone does not authorize merge, cloud schema changes or Vercel deployment. If the PR changes auth/RLS/queue data semantics and lacks executable verification, report the uncovered gate rather than inventing a runtime PASS.
