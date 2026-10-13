# HSO Next.js / TypeScript — Scoped Agent Rules

Inherits root `AGENTS.md`. Applies under `src/`.

## Read the actual call chain

- `app/(app)/`: operator-facing protected pages; `app/api/queue/*/route.ts`: authenticated queue handlers. Keep client/server boundaries clear.
- `store/zeus-store.tsx` is the main client-side fleet state/action surface. `services/api.ts` defines `ZeusApi`, implemented by `services/supabase-api.ts` and `services/mock-api.ts`. Check both backends and `onUpdate` before altering visible state.
- `services/queue-service.ts`, `lib/queue.ts`, `lib/queue-progress.ts`: enhancement queue creation, authoritative progress, lifecycle, error codes and safety gates. Trace route → authenticated Supabase client → service → RLS/RPC → runtime actor → UI, not just the button.
- `lib/config-schema.ts` contains version-keyed control descriptors: v13/v14 legacy **34 stored keys** and v15 **37 stored keys** (excluding `v`). The README's generic “34 keys” is not sufficient to reason about current versions. Preserve gating on actual `jar_ctl_version`, not presumed compatibility.
- `lib/types.ts`: `DeviceStatus = online|offline|error`; `HealthStatus = running|degraded|stopped`, with defined snapshot/process semantics. Do not infer health from `atkstate`, invent states, or report “Agent applied” solely from a DB save.
- `lib/attack-spot.ts`: real map `0` is valid; no-spot wire tuple is `(atk.map=0, atk.zone=-1, atk.x=-1, atk.y=-1)`, UI sentinel `__none__` must not be persisted. Keep existing attack-map intent handling.
- `lib/game-*.ts` and generated catalogs: preserve verified map/server contracts. For changing catalogs use `verify:catalog` and relevant generator/fixture only when justified.

## Security, authority and UI

- Queue API routes currently create a scoped Supabase client from the authenticated user's Bearer JWT, then resolve `auth.getUser(token)`. Preserve authorization and RLS, validate untrusted JSON, and do not elevate to service-role access.
- Enhancement queue Web **requests** are not terminal runtime effects: `DRAFT` → published queue → Agent consumes; pause/cancel/manual-review can require CAS/reconciliation. Web must not write runtime-owned attempt/settlement fields or assert completion prematurely.
- Account pairing, viewer timed lease, credentials sealing, state transitions and noVNC URL sanitization are sensitive flows. Trace real data provenance, freshness, expiry and URL sanitization before showing “connected”.
- Respect `PRODUCT.md`, `DESIGN.md`, `GEMINI.md` when UI changes. Keep Storm Steel operational, dense, responsive and accessible; no generic SaaS embellishments. Distinguish an unavailable UI Skill command from a passing quality check.
- `src/lib/supabase.ts` explicitly throws without NEXT_PUBLIC Supabase env vars. An older README statement that mock automatically works without variables may be stale; verify `services/api.ts` selection before asserting a mock fallback.

## Test seam selection

Prefer a smallest reliable reproduction at the meaningful boundary: `node:test` unit/contract test for parsers and domain state, Next route with authenticated/unauthorized cases, SQL migration executable tests where environment exists, or operator-approved preview for integration. Do not use mocked command success to prove Agent execution. Identify needed catalog/attack-spot checks separately, not blindly on every edit.

Never edit the `ZeusApi` public interface, migration/RLS contract, control schema/wire format or deployment by opportunistic refactor. Escalate a contract change for explicit product decision.
