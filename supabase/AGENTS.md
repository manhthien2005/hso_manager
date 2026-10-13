# Supabase SQL / RLS / RPC — Scoped Agent Rules

Inherits root `AGENTS.md`. Applies under `supabase/`.

**Default is READ-ONLY.** `PRODUCT.md` explicitly constrains DB schema/migration changes. Do not add/edit migration files, run `supabase db push`, `db reset`, execute modifying SQL, or alter production until the operator explicitly approves that contract and deployment scope.

## Current evidence surface

- Numbered migrations in `migrations/` currently extend through `029_v403_forge_release_candidate_runtime_compat.sql`. Inspect the exact HEAD, migration order, function bodies and relevant `tests/unit/migration-0xx-*contract.test.ts` and `*executable.test.ts` for contract claims.
- Pairing/auth flows include `claim_device`, device token verification, RLS grants and Ed25519 material. Protect device ownership and authenticated caller scope.
- Queue migrations contain publish/reconcile/manual-review/captured-result/retry/attempt semantics. Preserve single-active-job/exclusivity and runtime-owned fields, atomic updates, locks/CAS and idempotence, including failed/replayed requests.
- Migration 029 Bạch Hổ runtime support uses explicit JAR allowlist, exact CTL version 15 and capability gating; never add a SHA to satisfy a test without independent artifact/runtime evidence. `server_index=8` and grants/ownership checks are contract boundaries.
- SQL `SECURITY DEFINER`, `search_path`, execute grants and `auth.uid()` ownership checks deserve explicit review. A query working as `service_role` does not demonstrate user-RLS correctness.

## Allowed verification without approved writes

Inspect migration/test source, verify exact diff, run offline static contract checks where environment allows, and report `NOT_RUN` for an unavailable Supabase local/remote instance. Do not run destructive SQL against remote. If authorized for a new migration, require: one numbered forward-only migration, test for old/invalid/ownership/replay/concurrent cases, rollback or compensation plan, and an explicit approval for target Supabase project and deployment command.

Report assumptions and source-versus-runtime confidence separately.
