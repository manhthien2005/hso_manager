/**
 * Migration 020: Executable Real-PostgreSQL Migration Proof & RLS Runtime Tests
 * Task: ENHANCE-06H1A-MIGRATION-020-RLS-SQL-CORRECTIVE
 *
 * Proves that:
 * 1. Migration 020 executes successfully on real PostgreSQL against clean DB migrated through 019.
 * 2. SQLSTATE 42702 (ambiguous column) is completely eliminated.
 * 3. All CREATE POLICY, TRIGGER, FUNCTION, GRANT, and RPC statements succeed.
 * 4. Device-authenticated RLS allows valid own-device ledger mutations while rejecting cross-device / cross-account attacks.
 * 5. Attempt identity and settled terminal immutability invariants hold under real PostgreSQL evaluation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function runPsql(db: string, sql: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("wsl", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

describe("Migration 020: Real PostgreSQL Executable Migration & RLS Proof", () => {
  const testDbName = "test_zeus_migration_proof";
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

  it("1. Clean database starts and Supabase baseline environment bootstraps", () => {
    spawnSync("wsl", ["-u", "postgres", "dropdb", "--if-exists", testDbName], { encoding: "utf-8" });
    const createRes = spawnSync("wsl", ["-u", "postgres", "createdb", testDbName], { encoding: "utf-8" });
    assert.equal(createRes.status, 0, `createdb failed: ${createRes.stderr}`);

    const bootstrapSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON TABLE auth.users TO service_role, postgres;
GRANT SELECT ON TABLE auth.users TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role, postgres;
GRANT ALL ON SCHEMA public TO service_role, postgres;

CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);
`;
    const bootRes = runPsql(testDbName, bootstrapSql);
    assert.equal(bootRes.status, 0, `Bootstrap failed: ${bootRes.stderr}`);
  });

  it("2. Migrations 001 through 019 apply in canonical order without error", () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.substring(0, 3);
      if (version === "020") continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const res = runPsql(testDbName, content);
      assert.equal(res.status, 0, `Migration ${file} failed: ${res.stderr}`);
      runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${file}');`);
    }

    const checkRes = runPsql(testDbName, "SELECT count(*) FROM supabase_migrations.schema_migrations;");
    assert.match(checkRes.stdout, /19/);
  });

  it("3. Corrected Migration 020 executes cleanly on real PostgreSQL with zero errors and no SQLSTATE 42702", () => {
    const file020 = fs.readdirSync(migrationsDir).find(f => f.startsWith("020_"));
    assert.ok(file020, "Migration 020 file must exist");
    const content020 = fs.readFileSync(path.join(migrationsDir, file020), "utf-8");

    const res020 = runPsql(testDbName, content020);
    assert.equal(res020.status, 0, `Migration 020 failed: ${res020.stderr}`);
    assert.doesNotMatch(res020.stderr, /42702/);
    assert.doesNotMatch(res020.stderr, /ambiguous/i);
    assert.doesNotMatch(res020.stderr, /ERROR/i);

    // Record migration in test history
    runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('020', '${file020}');`);
    const historyCheck = runPsql(testDbName, "SELECT version FROM supabase_migrations.schema_migrations WHERE version = '020';");
    assert.match(historyCheck.stdout, /020/);
  });

  it("4. Database object verification: policies, triggers, and RPCs are live in PostgreSQL catalog", () => {
    // Check policies
    const polRes = runPsql(testDbName, "SELECT policyname FROM pg_policies WHERE tablename = 'enhancement_queue_item_attempts' ORDER BY policyname;");
    assert.match(polRes.stdout, /device_enhancement_queue_item_attempts_insert/);
    assert.match(polRes.stdout, /device_enhancement_queue_item_attempts_update/);
    assert.match(polRes.stdout, /own_enhancement_queue_item_attempts_select/);

    // Check grants
    const grantRes = runPsql(testDbName, "SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = 'enhancement_queue_item_attempts' AND grantee = 'authenticated' ORDER BY privilege_type;");
    assert.match(grantRes.stdout, /INSERT/);
    assert.match(grantRes.stdout, /UPDATE/);
    assert.doesNotMatch(grantRes.stdout, /DELETE/);

    // Check functions
    const funcRes = runPsql(testDbName, "SELECT proname FROM pg_proc WHERE proname IN ('admin_recover_stranded_prefence_job', 'publish_enhancement_queue_job');");
    assert.match(funcRes.stdout, /admin_recover_stranded_prefence_job/);
    assert.match(funcRes.stdout, /publish_enhancement_queue_job/);
  });

  describe("5. RLS Runtime Security & Trigger Behavior", () => {
    const userA = "11111111-1111-1111-1111-111111111111";
    const userB = "22222222-2222-2222-2222-222222222222";
    const devAuthA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const devAuthB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const devIdA = "33333333-3333-3333-3333-333333333333";
    const devIdB = "44444444-4444-4444-4444-444444444444";
    const accA = "55555555-5555-5555-5555-555555555555";
    const accB = "66666666-6666-6666-6666-666666666666";
    const jobIdA = "77777777-7777-7777-7777-777777777777";
    const itemIdA = "88888888-8888-8888-8888-888888888888";
    const attemptUuidA = "99999999-9999-9999-9999-999999999999";

    it("seeds test fixture accounts, devices, and RUNNING queue job/item", () => {
      const seedSql = `
INSERT INTO auth.users (id, email) VALUES
  ('${userA}', 'usera@test.com'),
  ('${userB}', 'userb@test.com');

INSERT INTO public.devices (id, user_id, device_auth_id, name, status, agent_version, last_seen) VALUES
  ('${devIdA}', '${userA}', '${devAuthA}', 'device-a', 'online', '0.1.0+enhancement-queue-v2.enhancement-multilevel-v1', now()),
  ('${devIdB}', '${userB}', '${devAuthB}', 'device-b', 'online', '0.1.0+enhancement-queue-v2.enhancement-multilevel-v1', now());

INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username) VALUES
  ('${accA}', '${devIdA}', '${userA}', 'Account A', 1, 'usera1'),
  ('${accB}', '${devIdB}', '${userB}', 'Account B', 1, 'userb1');

INSERT INTO public.enhancement_queue_jobs (id, user_id, account_id, device_id, status, total_items) VALUES
  ('${jobIdA}', '${userA}', '${accA}', '${devIdA}', 'DRAFT', 1);

INSERT INTO public.enhancement_queue_items (id, job_id, user_id, account_id, queue_order, captured_slot, initial_level, current_level, target_level, template_id, icon, tier, category, base_name, payment_type, status) VALUES
  ('${itemIdA}', '${jobIdA}', '${userA}', '${accA}', 1, 1, 4, 4, 7, 69, 517, 3, 3, 'Sword', 'GOLD', 'PENDING');

UPDATE public.enhancement_queue_jobs SET status = 'RUNNING' WHERE id = '${jobIdA}';
UPDATE public.enhancement_queue_items SET status = 'RUNNING' WHERE id = '${itemIdA}';
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
`;
      const res = runPsql(testDbName, seedSql);
      assert.equal(res.status, 0, `Seed failed: ${res.stderr}`);
    });

    it("valid own-device authenticated INSERT succeeds and inherits canonical parent bindings", () => {
      const insertSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthA}';
SET request.jwt.claim.role = 'authenticated';

INSERT INTO public.enhancement_queue_item_attempts (
  job_id, item_id, account_id, user_id,
  attempt_uuid, attempt_number, expected_level, step_target_level, queue_item_final_target_level,
  attempt_phase, payment_type
) VALUES (
  '${jobIdA}', '${itemIdA}', '${accA}', '${userA}',
  '${attemptUuidA}', 1, 4, 5, 7,
  'PREPARING', 'GOLD'
);
`;
      const res = runPsql(testDbName, insertSql);
      assert.equal(res.status, 0, `Own-device insert failed: ${res.stderr}`);

      // Verify row exists
      const checkRes = runPsql(testDbName, `SELECT attempt_uuid, attempt_phase, attempt_number FROM public.enhancement_queue_item_attempts WHERE attempt_uuid = '${attemptUuidA}';`);
      assert.match(checkRes.stdout, new RegExp(attemptUuidA));
      assert.match(checkRes.stdout, /PREPARING/);
    });

    it("valid own-device authenticated monotonic UPDATE succeeds", () => {
      const updateSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthA}';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.enhancement_queue_item_attempts
SET attempt_phase = 'READY_TO_EXECUTE'
WHERE attempt_uuid = '${attemptUuidA}';
`;
      const res = runPsql(testDbName, updateSql);
      assert.equal(res.status, 0, `Own-device update failed: ${res.stderr}`);

      const checkRes = runPsql(testDbName, `SELECT attempt_phase FROM public.enhancement_queue_item_attempts WHERE attempt_uuid = '${attemptUuidA}';`);
      assert.match(checkRes.stdout, /READY_TO_EXECUTE/);
    });

    it("cross-device INSERT is blocked by RLS", () => {
      const crossInsertSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthB}';
SET request.jwt.claim.role = 'authenticated';

INSERT INTO public.enhancement_queue_item_attempts (
  job_id, item_id, account_id, user_id,
  attempt_uuid, attempt_number, expected_level, step_target_level, queue_item_final_target_level,
  attempt_phase, payment_type
) VALUES (
  '${jobIdA}', '${itemIdA}', '${accA}', '${userA}',
  'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 2, 5, 6, 7,
  'PREPARING', 'GOLD'
);
`;
      const res = runPsql(testDbName, crossInsertSql);
      assert.notEqual(res.status, 0, "Cross-device INSERT must fail");
      assert.match(res.stderr, /row-level security|Parent enhancement queue item.*does not exist|not authorized/i);
    });

    it("cross-device UPDATE affects 0 rows under RLS", () => {
      const crossUpdateSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthB}';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.enhancement_queue_item_attempts
SET attempt_phase = 'WAITING_RESULT'
WHERE attempt_uuid = '${attemptUuidA}';
`;
      const res = runPsql(testDbName, crossUpdateSql);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /UPDATE 0/);

      // Verify phase remained READY_TO_EXECUTE
      const checkRes = runPsql(testDbName, `SELECT attempt_phase FROM public.enhancement_queue_item_attempts WHERE attempt_uuid = '${attemptUuidA}';`);
      assert.match(checkRes.stdout, /READY_TO_EXECUTE/);
    });

    it("same device cannot rebind account_id (blocked by trigger)", () => {
      const rebindSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthA}';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.enhancement_queue_item_attempts
SET account_id = '${accB}'
WHERE attempt_uuid = '${attemptUuidA}';
`;
      const res = runPsql(testDbName, rebindSql);
      assert.notEqual(res.status, 0, "Account rebind must fail");
      assert.match(res.stderr, /account_id is immutable/);
    });

    it("same device cannot rebind item_id (blocked by trigger)", () => {
      const rebindSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthA}';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.enhancement_queue_item_attempts
SET item_id = gen_random_uuid()
WHERE attempt_uuid = '${attemptUuidA}';
`;
      const res = runPsql(testDbName, rebindSql);
      assert.notEqual(res.status, 0, "item_id rebind must fail");
      assert.match(res.stderr, /item_id is immutable/);
    });

    it("same device cannot change expected_level or step_target_level (blocked by trigger)", () => {
      const changeLevelSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthA}';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.enhancement_queue_item_attempts
SET expected_level = 9
WHERE attempt_uuid = '${attemptUuidA}';
`;
      const res = runPsql(testDbName, changeLevelSql);
      assert.notEqual(res.status, 0, "Level modification must fail");
      assert.match(res.stderr, /expected_level is immutable/);
    });

    it("settling attempt with valid settlement_source succeeds, then row is permanently immutable", () => {
      const settleSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthA}';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.enhancement_queue_item_attempts
SET attempt_phase = 'SETTLED',
    settlement_source = 'RESULT_CODE',
    result_code = 'SUCCESS',
    actual_gold_spent = 50000
WHERE attempt_uuid = '${attemptUuidA}';
`;
      const settleRes = runPsql(testDbName, settleSql);
      assert.equal(settleRes.status, 0, `Settle failed: ${settleRes.stderr}`);

      // Now attempt to reopen or modify spend
      const reopenSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthA}';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.enhancement_queue_item_attempts
SET attempt_phase = 'READY_TO_EXECUTE'
WHERE attempt_uuid = '${attemptUuidA}';
`;
      const reopenRes = runPsql(testDbName, reopenSql);
      assert.notEqual(reopenRes.status, 0, "Reopening settled row must fail");
      assert.match(reopenRes.stderr, /cannot be rewritten or reopened/);

      // Attempt to rewrite spend on settled row
      const rewriteSpendSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${devAuthA}';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.enhancement_queue_item_attempts
SET actual_gold_spent = 0
WHERE attempt_uuid = '${attemptUuidA}';
`;
      const spendRes = runPsql(testDbName, rewriteSpendSql);
      assert.notEqual(spendRes.status, 0, "Rewriting spend on settled row must fail");
      assert.match(spendRes.stderr, /cannot be rewritten or reopened/);
    });

    it("unauthorized anonymous mutation is rejected", () => {
      const anonSql = `
SET ROLE anon;
SET request.jwt.claim.role = 'anon';

INSERT INTO public.enhancement_queue_item_attempts (
  job_id, item_id, account_id, user_id,
  attempt_uuid, attempt_number, expected_level, step_target_level, queue_item_final_target_level,
  attempt_phase, payment_type
) VALUES (
  '${jobIdA}', '${itemIdA}', '${accA}', '${userA}',
  gen_random_uuid(), 2, 5, 6, 7,
  'PREPARING', 'GOLD'
);
`;
      const anonRes = runPsql(testDbName, anonSql);
      assert.notEqual(anonRes.status, 0, "Anon insert must fail");
      assert.match(anonRes.stderr, /permission denied/i);
    });

    it("service-role administrative recovery RPC functions and is service_role only", () => {
      // Test calling from authenticated role -> must fail
      const authCallSql = `
SET ROLE authenticated;
SELECT public.admin_recover_stranded_prefence_job('${jobIdA}'::uuid);
`;
      const authRes = runPsql(testDbName, authCallSql);
      assert.notEqual(authRes.status, 0, "Authenticated call to admin RPC must fail");
      assert.match(authRes.stderr, /permission denied/i);

      // Test calling from service_role
      const srvCallSql = `
SET ROLE service_role;
-- Set cancel_requested_at on job
UPDATE public.enhancement_queue_jobs SET cancel_requested_at = now() WHERE id = '${jobIdA}';
-- Set status on item to PENDING with zero spend, zero fence
UPDATE public.enhancement_queue_items SET status = 'PENDING', execute_may_have_been_sent_at = NULL, actual_gold_spent = 0 WHERE id = '${itemIdA}';
-- Delete post-fence attempts so pre-fence precondition passes
DELETE FROM public.enhancement_queue_item_attempts WHERE job_id = '${jobIdA}';

SELECT status FROM public.admin_recover_stranded_prefence_job('${jobIdA}'::uuid);
`;
      const srvRes = runPsql(testDbName, srvCallSql);
      assert.equal(srvRes.status, 0, `Service role admin recovery failed: ${srvRes.stderr}`);
      assert.match(srvRes.stdout, /CANCELLED/);
    });
  });
});
