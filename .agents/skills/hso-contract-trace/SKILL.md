---
name: hso-contract-trace
description: Use when debugging HSO Manager bugs or investigating Next.js, Supabase Auth/RLS/RPC, queue lifecycle, ZeusApi, control wire versions, JAR capability, Realtime, viewer or cross-repo Agent integration before any fix.
---
# HSO Contract Trace

Read `AGENTS.md`, `src/AGENTS.md` or `supabase/AGENTS.md` as applicable. Read `PRODUCT.md` and source, not the obsolete `ZEUS_ARCHITECTURE.md` as authoritative architecture.

## Trace precisely

1. Pin HSO repository/ref/HEAD; separate local Antigravity changes, Supabase deployment state, Vercel deployment SHA and dependent Knight JAR/CTL. Stop on `BASELINE_MISMATCH`.
2. Start with the operator-visible symptom and a **red-capable reproducer or one focused evidence capture**. Find entry → store → `ZeusApi` → mock/real provider → Next route/service → authenticated Supabase/RLS/RPC → Agent consumer → UI readback. Mark missing edges UNKNOWN.
3. Compare real contracts: stored config version, `jar_ctl_version`, capability gate, queue state/CAS, replay/idempotency, Map 0 sentinel, viewer expiry and authoritative snapshots. Check timestamps/freshness.
4. For bugs involving Next 16 API behavior, inspect locally installed `node_modules/next/dist/docs/`. With GitHub-only access, mark this NOT_VERIFIED rather than guessing from old documentation.
5. Identify 1–3 falsifiable hypotheses if root cause is not proven, each with an expected observation. Prefer one discriminating probe over repeated broad tests.
6. Map the exact affected files, necessary tests, compatible prior behavior and stop/rollback path. No code edits under this skill by default.

## Output

```text
BASELINE: source/deploy/DB/Agent versions
OBSERVED vs EXPECTED: with artifact/source evidence
TRACE: real call path and source locations
ROOT_CAUSE: VERIFIED | PROBABLE | UNKNOWN
SMALLEST_REPRO: command/output or NOT_RUN
CONTRACT_RISKS: Auth/RLS, CAS, schema/wire, viewer, data-loss
NEXT: minimal bounded task or one missing observation
```

Never label a successful DB write as an Agent action completed. Do not infer that `skills-lock.json` implies installed CLI tools.
