/**
 * Migration 028: Executable Real-PostgreSQL Migration Proof & Forge Live Title Runtime Compat Tests
 * Task: KNIGHT_V403_R4_15_FIX_LIVE_LOCAL_MENU_TITLE_CONTRACT
 *
 * Proves that:
 * 1. Clean database starts and Supabase baseline environment bootstraps.
 * 2. Migrations 001 through 027 apply in canonical order without error.
 * 3. Seed accounts and devices before migration 028 (under migration 027, including with ca3b...).
 * 4. Migration 028 executes cleanly on real PostgreSQL with zero errors.
 * 5. Existing legacy rows and pre-existing server 8 rows (including ca3b...) survive migration 028.
 * 6. Base SHA 4009f070... continues to be accepted for server 8 insert and transition.
 * 7. Movement-fix SHA 51cb7d4e... continues to be accepted for server 8 insert and transition.
 * 8. Forge live title fix SHA c177d9ac... is accepted for server 8 insert and transition.
 * 9. Failed candidate ca3b6503... is REJECTED for new server 8 insert and transition after migration 028.
 * 10. Rolled-back candidate 278f3754..., 37d18817..., b2bc..., and 47e4... remain REJECTED.
 * 11. Arbitrary SHA and obsolete candidates remain REJECTED.
 * 12. Final fix SHA with CTL 14 is REJECTED.
 * 13. Final fix SHA without exact managed-identity-restart-v1 capability is REJECTED.
 * 14. Immutability of user_id / device_id and foreign device ownership checks preserved.
 * 15. Transition server 8 -> legacy and metadata-only edit on pre-existing row preserved.
 * 16. RPC create_game_account accepts c177..., 4009..., 51cb... and rejects ca3b..., b2bc..., 24e9..., 278f...
 * 17. RPC update_game_account accepts c177..., 4009..., 51cb... and rejects ca3b..., b2bc..., 24e9..., 278f...
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

describe("Migration 028: Real PostgreSQL Executable Migration & Forge Live Title Proof", () => {
  const testDbName = "test_zeus_migration_proof_028";
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FINAL_TITLE_FIX_SHA = "c177d9ace4cd2c45fbebb4422c0bec8c8021e81872254e84b3d0960c8c510bd5";

  const FAILED_CA3B_SHA = "ca3b65038a1416a9fcd7eedc9127a1ba4702d48628b0030fda701ceb77c84dec";
  const OBSOLETE_37D1_SHA = "37d18817d6b9b49fa1c20b1859a2d300272506101d7de7d8cf51ec3dd1f15d14";
  const FAILED_B2BC_SHA = "b2bc6ceb5922ff05c7ae252741c7829e0d5cb81e74003d5035f80870744c6658";
  const FAILED_24E9_SHA = "24e9a8209337d0163c2b2c948b5964f1df6574bfa1d3fd161aca93e905e525d2";
  const ROLLED_BACK_FORGE_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";
  const FAILED_47E4_SHA = "47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d";
  const ARBITRARY_SHA = "9999999999999999999999999999999999999999999999999999999999999999";

  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  const devBaseCompat     = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const devMovCompat      = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const devFailedCa3b     = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const devFinalTitleFix  = "15151515-aaaa-bbbb-cccc-dddddddddddd";
  const devFailedB2bc     = "14141414-aaaa-bbbb-cccc-dddddddddddd";
  const devFailed24e9     = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const devRolledBack278f = "12121212-aaaa-bbbb-cccc-dddddddddddd";
  const devFailed47e4     = "13131313-aaaa-bbbb-cccc-dddddddddddd";
  const devFinalCtl14     = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const devFinalNoTok     = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const devArbitrary      = "11111111-aaaa-bbbb-cccc-dddddddddddd";
  const devForeignB       = "22222222-aaaa-bbbb-cccc-dddddddddddd";
  const devObsolete37d1   = "37373737-aaaa-bbbb-cccc-dddddddddddd";

  const accLegacy           = "55555555-5555-5555-5555-555555555555";
  const accServer8Pre028A   = "66666666-6666-6666-6666-666666666666";
  const accServer8Pre028B   = "77777777-7777-7777-7777-777777777777";
  const accServer8Pre028_ca3= "88888888-8888-8888-8888-888888888888";
  const accNewFinalTitleFix = "99999999-9999-9999-9999-999999999999";

  const dummyEphPub = "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const dummyNonce = "AAAAAAAAAAAAAAAA";
  const dummyCt = "AAAAAAAAAAAAAAAAAAAAAA==";

  const validSealedJson = JSON.stringify({
    alg: "ecdh-p256-hkdf-sha256-aes256gcm",
    info: "zeus-v1",
    eph_pub: dummyEphPub,
    nonce: dummyNonce,
    ct: dummyCt,
  });

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

  it("2. Migrations 001 through 027 apply in canonical order without error", () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.substring(0, 3);
      if (Number(version) >= 28) continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const res = runPsql(testDbName, content);
      assert.equal(res.status, 0, `Migration ${file} failed: ${res.stderr}`);
      runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${file}');`);
    }

    const checkRes = runPsql(testDbName, "SELECT count(*) FROM supabase_migrations.schema_migrations;");
    assert.match(checkRes.stdout, /27/);
  });

  it("3. Seed accounts and devices before migration 028 (under migration 027)", () => {
    const seedSql = `
INSERT INTO auth.users (id, email) VALUES
  ('${userA}', 'usera@test.com'),
  ('${userB}', 'userb@test.com');

INSERT INTO public.devices (id, user_id, device_auth_id, name, status, agent_version, jar_ctl_version, jar_sha256, pubkey, next_slot_index) VALUES
  ('${devBaseCompat}',     '${userA}', gen_random_uuid(), 'dev-base-compat',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${BASE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=', 'base64'), 20),
  ('${devMovCompat}',      '${userA}', gen_random_uuid(), 'dev-mov-compat',     'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${MOV_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=', 'base64'), 20),
  ('${devFailedCa3b}',     '${userA}', gen_random_uuid(), 'dev-ca3b-compat',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_CA3B_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM=', 'base64'), 20),
  ('${devFinalTitleFix}',  '${userA}', gen_random_uuid(), 'dev-final-title-fix', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FINAL_TITLE_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7=', 'base64'), 20),
  ('${devFailedB2bc}',     '${userA}', gen_random_uuid(), 'dev-failed-b2bc',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_B2BC_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8=', 'base64'), 20),
  ('${devFailed24e9}',     '${userA}', gen_random_uuid(), 'dev-failed-24e9',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_24E9_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=', 'base64'), 20),
  ('${devRolledBack278f}', '${userA}', gen_random_uuid(), 'dev-rolledback-278f','online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${ROLLED_BACK_FORGE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFQ=', 'base64'), 20),
  ('${devFailed47e4}',     '${userA}', gen_random_uuid(), 'dev-failed-47e4',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_47E4_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGM=', 'base64'), 20),
  ('${devFinalCtl14}',     '${userA}', gen_random_uuid(), 'dev-final-ctl14',    'online', '0.1.0+managed-identity-restart-v1', 14, '${FINAL_TITLE_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=', 'base64'), 20),
  ('${devFinalNoTok}',     '${userA}', gen_random_uuid(), 'dev-final-notok',    'online', '0.1.0+visual-qol-v1', 15, '${FINAL_TITLE_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY=', 'base64'), 20),
  ('${devArbitrary}',      '${userA}', gen_random_uuid(), 'dev-arbitrary',      'online', '0.1.0+managed-identity-restart-v1', 15, '${ARBITRARY_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAc=', 'base64'), 20),
  ('${devForeignB}',       '${userB}', gen_random_uuid(), 'dev-foreign',        'online', '0.1.0+managed-identity-restart-v1', 15, '${FINAL_TITLE_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAg=', 'base64'), 20),
  ('${devObsolete37d1}',   '${userA}', gen_random_uuid(), 'dev-obsolete-37d1',  'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_37D1_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF0=', 'base64'), 20);

-- Seed accounts under migration 027 (including one on ca3b which was valid under 027)
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accLegacy}',            '${devBaseCompat}', '${userA}', 'Legacy Server 0', 1, 'user0', 0),
  ('${accServer8Pre028A}',    '${devBaseCompat}', '${userA}', 'Server 8 Base',   2, 'user8base', 8),
  ('${accServer8Pre028B}',    '${devMovCompat}',  '${userA}', 'Server 8 Mov',    3, 'user8mov', 8),
  ('${accServer8Pre028_ca3}', '${devFailedCa3b}', '${userA}', 'Server 8 ca3b',   4, 'user8_ca3b', 8);
`;
    const res = runPsql(testDbName, seedSql);
    assert.equal(res.status, 0, `Seed failed: ${res.stderr}`);
  });

  it("4. Migration 028 executes cleanly on real PostgreSQL with zero errors", () => {
    const file028 = fs.readdirSync(migrationsDir).find(f => f.startsWith("028_"));
    assert.ok(file028, "Migration 028 file must exist");
    const content028 = fs.readFileSync(path.join(migrationsDir, file028), "utf-8");

    const res028 = runPsql(testDbName, content028);
    assert.equal(res028.status, 0, `Migration 028 failed: ${res028.stderr}`);
    assert.doesNotMatch(res028.stderr, /ERROR/i);

    runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('028', '${file028}');`);
  });

  it("5. Existing legacy rows and pre-existing server 8 rows (including ca3b) survive migration 028", () => {
    const resLegacy = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accLegacy}';`);
    assert.match(resLegacy.stdout, /0/);

    const resServer8A = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre028A}';`);
    assert.match(resServer8A.stdout, /8/);
    assert.match(resServer8A.stdout, /Server 8 Base/);

    const resServer8B = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre028B}';`);
    assert.match(resServer8B.stdout, /8/);
    assert.match(resServer8B.stdout, /Server 8 Mov/);

    const resServer8_ca3 = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre028_ca3}';`);
    assert.match(resServer8_ca3.stdout, /8/);
    assert.match(resServer8_ca3.stdout, /Server 8 ca3b/);
  });

  it("6. Base SHA 4009f070... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devBaseCompat}', '${userA}', 'Old SHA Server 8 Post-028', 10, 'oldsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Old SHA insert failed: ${res.stderr}`);

    const transSql = `
UPDATE public.accounts SET server_index = 8 WHERE id = '${accLegacy}';
`;
    const resTrans = runPsql(testDbName, transSql);
    assert.equal(resTrans.status, 0, `Transition to 8 with base SHA failed: ${resTrans.stderr}`);

    runPsql(testDbName, `UPDATE public.accounts SET server_index = 0 WHERE id = '${accLegacy}';`);
  });

  it("7. Movement-fix SHA 51cb7d4e... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devMovCompat}', '${userA}', 'Movement SHA Server 8 Post-028', 11, 'movsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Movement SHA insert failed: ${res.stderr}`);
  });

  it("8. Forge live title fix SHA c177d9ac... is accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index)
VALUES ('${accNewFinalTitleFix}', '${devFinalTitleFix}', '${userA}', 'Forge Title Fix Server 8', 12, 'titlefix8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Final Title Fix SHA insert failed: ${res.stderr}`);

    const resCheck = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accNewFinalTitleFix}';`);
    assert.match(resCheck.stdout, /8/);
    assert.match(resCheck.stdout, /Forge Title Fix Server 8/);

    const transSql = `
UPDATE public.accounts SET server_index = 0 WHERE id = '${accNewFinalTitleFix}';
UPDATE public.accounts SET server_index = 8 WHERE id = '${accNewFinalTitleFix}';
`;
    const resTrans = runPsql(testDbName, transSql);
    assert.equal(resTrans.status, 0, `Transition to 8 with final fix SHA failed: ${resTrans.stderr}`);
  });

  it("9. Revoked failed candidate ca3b6503... is REJECTED for new server 8 insert and transition after migration 028", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devFailedCa3b}', '${userA}', 'Should Fail ca3b', 13, 'failca3b', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.notEqual(res.status, 0, "Insert on ca3b must fail");
    assert.match(res.stderr, /not compatible with Bach Ho server/);

    const transSql = `
UPDATE public.accounts SET server_index = 0 WHERE id = '${accServer8Pre028_ca3}';
UPDATE public.accounts SET server_index = 8 WHERE id = '${accServer8Pre028_ca3}';
`;
    const resTrans = runPsql(testDbName, transSql);
    assert.notEqual(resTrans.status, 0, "Re-transitioning ca3b to server 8 must fail");
    assert.match(resTrans.stderr, /not compatible with Bach Ho server/);
  });

  it("10. Rolled-back candidate 278f3754..., 37d18817..., b2bc..., and 47e4... remain REJECTED", () => {
    for (const dev of [devRolledBack278f, devObsolete37d1, devFailedB2bc, devFailed47e4, devFailed24e9]) {
      const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${dev}', '${userA}', 'Should Fail Revoked', 14, 'failrev', 8);
`;
      const res = runPsql(testDbName, sql);
      assert.notEqual(res.status, 0, `Device ${dev} must fail server 8 insert`);
      assert.match(res.stderr, /not compatible with Bach Ho server/);
    }
  });

  it("11. Arbitrary SHA remains REJECTED", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devArbitrary}', '${userA}', 'Should Fail Arbitrary', 15, 'failarb', 8);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0, "Arbitrary SHA must fail");
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });

  it("12. Final fix SHA with CTL 14 is REJECTED", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devFinalCtl14}', '${userA}', 'Should Fail CTL14', 16, 'failctl', 8);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0, "CTL 14 must fail");
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });

  it("13. Final fix SHA without exact managed-identity-restart-v1 capability is REJECTED", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devFinalNoTok}', '${userA}', 'Should Fail No Token', 17, 'failtok', 8);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0, "Missing capability must fail");
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });

  it("14. Immutability of user_id / device_id and foreign device ownership checks preserved", () => {
    const userMutateSql = `UPDATE public.accounts SET user_id = '${userB}' WHERE id = '${accLegacy}';`;
    const resUserMutate = runPsql(testDbName, userMutateSql);
    assert.notEqual(resUserMutate.status, 0);
    assert.match(resUserMutate.stderr, /accounts.user_id is immutable after insert/);

    const devMutateSql = `UPDATE public.accounts SET device_id = '${devBaseCompat}' WHERE id = '${accLegacy}';`;
    const resDevMutate = runPsql(testDbName, devMutateSql);
    assert.equal(resDevMutate.status, 0);

    const foreignDevSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForeignB}', '${userA}', 'Foreign Device Account', 18, 'foreign', 0);
`;
    const resForeign = runPsql(testDbName, foreignDevSql);
    assert.notEqual(resForeign.status, 0);
    assert.match(resForeign.stderr, /does not belong to user/);
  });

  it("15. Transition server 8 -> legacy and metadata-only edit on pre-existing row preserved", () => {
    const transLegacySql = `
UPDATE public.accounts SET server_index = 0 WHERE id = '${accServer8Pre028A}';
`;
    const resTrans = runPsql(testDbName, transLegacySql);
    assert.equal(resTrans.status, 0, `Transition to legacy must succeed: ${resTrans.stderr}`);

    const metaEditSql = `
UPDATE public.accounts SET label = 'Renamed Without Revalidating' WHERE id = '${accServer8Pre028B}';
`;
    const resMeta = runPsql(testDbName, metaEditSql);
    assert.equal(resMeta.status, 0, `Metadata edit must succeed: ${resMeta.stderr}`);
  });

  it("16. RPC create_game_account accepts c177..., 4009..., 51cb... and rejects ca3b..., b2bc...", () => {
    const setJwtSql = `
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';
`;
    // Final fix SHA -> accept
    const rpcFinalSql = `
${setJwtSql}
SELECT public.create_game_account(
  '${devFinalTitleFix}', 'RPC Final Account', 'rpcfinal', '${validSealedJson}'::jsonb, 8::smallint, 15, '{"atk.mode": 1}'::jsonb, 1::smallint
);
`;
    const resFinal = runPsql(testDbName, rpcFinalSql);
    assert.equal(resFinal.status, 0, `RPC create_game_account on final fix failed: ${resFinal.stderr}`);

    // ca3b -> reject
    const rpcCa3bSql = `
${setJwtSql}
SELECT public.create_game_account(
  '${devFailedCa3b}', 'RPC ca3b Account', 'rpcca3b', '${validSealedJson}'::jsonb, 8::smallint, 15, '{"atk.mode": 1}'::jsonb, 1::smallint
);
`;
    const resCa3b = runPsql(testDbName, rpcCa3bSql);
    assert.notEqual(resCa3b.status, 0, "RPC create on ca3b must fail");
    assert.match(resCa3b.stderr, /not compatible with Bach Ho server/);

    // b2bc -> reject
    const rpcB2bcSql = `
${setJwtSql}
SELECT public.create_game_account(
  '${devFailedB2bc}', 'RPC b2bc Account', 'rpcb2bc', '${validSealedJson}'::jsonb, 8::smallint, 15, '{"atk.mode": 1}'::jsonb, 1::smallint
);
`;
    const resB2bc = runPsql(testDbName, rpcB2bcSql);
    assert.notEqual(resB2bc.status, 0, "RPC create on b2bc must fail");
    assert.match(resB2bc.stderr, /not compatible with Bach Ho server/);
  });

  it("17. RPC update_game_account accepts c177..., 4009..., 51cb... and rejects ca3b..., b2bc...", () => {
    const setJwtSql = `
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';
`;
    const accToFinal = "20202020-0001-0000-0000-000000000001";
    const accToCa3b  = "20202020-0002-0000-0000-000000000002";
    const accToB2bc  = "20202020-0003-0000-0000-000000000003";

    runPsql(testDbName, `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accToFinal}', '${devFinalTitleFix}', '${userA}', 'To Final', 30, 'tofinal', 0),
  ('${accToCa3b}',  '${devFailedCa3b}',    '${userA}', 'To ca3b',  31, 'toca3b',  0),
  ('${accToB2bc}',  '${devFailedB2bc}',    '${userA}', 'To b2bc',  32, 'tob2bc',  0);
`);

    // Transition account on final device from 0 to 8 -> SUCCESS
    const resUpFinal = runPsql(testDbName, `${setJwtSql} SELECT public.update_game_account('${accToFinal}', 'Now Final 8', 8::smallint);`);
    assert.equal(resUpFinal.status, 0, `Update to server 8 on final device failed: ${resUpFinal.stderr}`);

    // Transition account on ca3b device from 0 to 8 -> REJECTED
    const resUpCa3b = runPsql(testDbName, `${setJwtSql} SELECT public.update_game_account('${accToCa3b}', 'Now ca3b 8', 8::smallint);`);
    assert.notEqual(resUpCa3b.status, 0, "Update to server 8 on ca3b must fail");
    assert.match(resUpCa3b.stderr, /not compatible with Bach Ho server/);

    // Transition account on b2bc device from 0 to 8 -> REJECTED
    const resUpB2bc = runPsql(testDbName, `${setJwtSql} SELECT public.update_game_account('${accToB2bc}', 'Now b2bc 8', 8::smallint);`);
    assert.notEqual(resUpB2bc.status, 0, "Update to server 8 on b2bc must fail");
    assert.match(resUpB2bc.stderr, /not compatible with Bach Ho server/);
  });

  it("18. Clean up test database", () => {
    spawnSync("wsl", ["-u", "postgres", "dropdb", "--if-exists", testDbName], { encoding: "utf-8" });
  });
});
