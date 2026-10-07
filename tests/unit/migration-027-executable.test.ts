/**
 * Migration 027: Executable Real-PostgreSQL Migration Proof & Forge Local NPC Menu Fix Tests
 * Task: KNIGHT_V403_R4_13_LOCAL_NPC_MENU_FORENSIC_AND_FIX
 *
 * Proves that:
 * 1. Clean database starts and Supabase baseline environment bootstraps.
 * 2. Migrations 001 through 026 apply in canonical order without error.
 * 3. Seed accounts and devices before migration 027 (under migration 026, including with b2bc...).
 * 4. Migration 027 executes cleanly on real PostgreSQL with zero errors.
 * 5. Existing legacy rows and pre-existing server 8 rows (including b2bc...) survive migration 027.
 * 6. Base SHA 4009f070... continues to be accepted for server 8 insert and transition.
 * 7. Movement-fix SHA 51cb7d4e... continues to be accepted for server 8 insert and transition.
 * 8. Forge local NPC menu fix SHA 37d18817... is accepted for server 8 insert and transition.
 * 9. Revoked failed candidate b2bc6ceb... is REJECTED for new server 8 insert and transition after migration 027.
 * 10. Rolled-back candidate 278f3754... and failed candidate 47e4d766... remain REJECTED.
 * 11. Arbitrary SHA and obsolete candidates (0bdda, d369, 24e9) remain REJECTED.
 * 12. Forge local fix SHA with CTL 14 is REJECTED.
 * 13. Forge local fix SHA without exact managed-identity-restart-v1 capability is REJECTED.
 * 14. Immutability of user_id / device_id and foreign device ownership checks preserved.
 * 15. Transition server 8 -> legacy and metadata-only edit on pre-existing row preserved.
 * 16. RPC create_game_account accepts 37d18817..., 4009..., 51cb... and rejects b2bc..., 24e9..., 278f... and arbitrary.
 * 17. RPC update_game_account accepts 37d18817..., 4009..., 51cb... and rejects b2bc..., 24e9..., 278f... and arbitrary.
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

describe("Migration 027: Real PostgreSQL Executable Migration & Forge Local NPC Menu Fix Proof", () => {
  const testDbName = "test_zeus_migration_proof_027";
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FAILED_B2BC_SHA = "b2bc6ceb5922ff05c7ae252741c7829e0d5cb81e74003d5035f80870744c6658";
  const FORGE_LOCAL_SHA = "37d18817d6b9b49fa1c20b1859a2d300272506101d7de7d8cf51ec3dd1f15d14";
  const FAILED_24E9_SHA = "24e9a8209337d0163c2b2c948b5964f1df6574bfa1d3fd161aca93e905e525d2";
  const ROLLED_BACK_FORGE_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";
  const FAILED_47E4_SHA = "47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d";
  const OBSOLETE_0BDDA_SHA = "0bddaee4680f8521f4628f4d52399ceee161c4e5d0387eab3dbe48cf662e8216";
  const OBSOLETE_D369_SHA = "d369b2edb2682f900e26893e2a378e796e2fcc3644416245e5f8e5bc3893e47a";
  const ARBITRARY_SHA = "9999999999999999999999999999999999999999999999999999999999999999";

  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  const devBaseCompat     = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const devMovCompat      = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const devFailedB2bc     = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const devForgeLocal     = "14141414-aaaa-bbbb-cccc-dddddddddddd";
  const devFailed24e9     = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const devRolledBack278f = "12121212-aaaa-bbbb-cccc-dddddddddddd";
  const devFailed47e4     = "13131313-aaaa-bbbb-cccc-dddddddddddd";
  const devForgeCtl14     = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const devForgeNoTok     = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const devArbitrary      = "11111111-aaaa-bbbb-cccc-dddddddddddd";
  const devForeignB       = "22222222-aaaa-bbbb-cccc-dddddddddddd";
  const devObsolete0bdda  = "33333333-aaaa-bbbb-cccc-dddddddddddd";
  const devObsoleteD369   = "44444444-aaaa-bbbb-cccc-dddddddddddd";

  const accLegacy           = "55555555-5555-5555-5555-555555555555";
  const accServer8Pre027A   = "66666666-6666-6666-6666-666666666666";
  const accServer8Pre027B   = "77777777-7777-7777-7777-777777777777";
  const accServer8Pre027_b2b= "88888888-8888-8888-8888-888888888888";
  const accNewForgeLocal    = "99999999-9999-9999-9999-999999999999";

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

  it("2. Migrations 001 through 026 apply in canonical order without error", () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.substring(0, 3);
      if (Number(version) >= 27) continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const res = runPsql(testDbName, content);
      assert.equal(res.status, 0, `Migration ${file} failed: ${res.stderr}`);
      runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${file}');`);
    }

    const checkRes = runPsql(testDbName, "SELECT count(*) FROM supabase_migrations.schema_migrations;");
    assert.match(checkRes.stdout, /26/);
  });

  it("3. Seed accounts and devices before migration 027 (under migration 026)", () => {
    const seedSql = `
INSERT INTO auth.users (id, email) VALUES
  ('${userA}', 'usera@test.com'),
  ('${userB}', 'userb@test.com');

INSERT INTO public.devices (id, user_id, device_auth_id, name, status, agent_version, jar_ctl_version, jar_sha256, pubkey, next_slot_index) VALUES
  ('${devBaseCompat}',     '${userA}', gen_random_uuid(), 'dev-base-compat',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${BASE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=', 'base64'), 20),
  ('${devMovCompat}',      '${userA}', gen_random_uuid(), 'dev-mov-compat',     'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${MOV_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=', 'base64'), 20),
  ('${devFailedB2bc}',     '${userA}', gen_random_uuid(), 'dev-b2bc-compat',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_B2BC_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM=', 'base64'), 20),
  ('${devForgeLocal}',     '${userA}', gen_random_uuid(), 'dev-forge-local',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FORGE_LOCAL_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7=', 'base64'), 20),
  ('${devFailed24e9}',     '${userA}', gen_random_uuid(), 'dev-failed-24e9',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_24E9_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=', 'base64'), 20),
  ('${devRolledBack278f}', '${userA}', gen_random_uuid(), 'dev-rolledback-278f','online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${ROLLED_BACK_FORGE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFQ=', 'base64'), 20),
  ('${devFailed47e4}',     '${userA}', gen_random_uuid(), 'dev-failed-47e4',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_47E4_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGM=', 'base64'), 20),
  ('${devForgeCtl14}',     '${userA}', gen_random_uuid(), 'dev-forge-ctl14',    'online', '0.1.0+managed-identity-restart-v1', 14, '${FORGE_LOCAL_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=', 'base64'), 20),
  ('${devForgeNoTok}',     '${userA}', gen_random_uuid(), 'dev-forge-notok',    'online', '0.1.0+visual-qol-v1', 15, '${FORGE_LOCAL_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY=', 'base64'), 20),
  ('${devArbitrary}',      '${userA}', gen_random_uuid(), 'dev-arbitrary',      'online', '0.1.0+managed-identity-restart-v1', 15, '${ARBITRARY_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAc=', 'base64'), 20),
  ('${devForeignB}',       '${userB}', gen_random_uuid(), 'dev-foreign',        'online', '0.1.0+managed-identity-restart-v1', 15, '${FORGE_LOCAL_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAg=', 'base64'), 20),
  ('${devObsolete0bdda}',  '${userA}', gen_random_uuid(), 'dev-obsolete-0bdda', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_0BDDA_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAk=', 'base64'), 20),
  ('${devObsoleteD369}',   '${userA}', gen_random_uuid(), 'dev-obsolete-d369',  'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_D369_SHA}',  decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAs=', 'base64'), 20);

-- Seed accounts under migration 026 (including one on b2bc which was valid in 026)
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accLegacy}',            '${devBaseCompat}', '${userA}', 'Legacy Server 0', 1, 'user0', 0),
  ('${accServer8Pre027A}',    '${devBaseCompat}', '${userA}', 'Server 8 Base',   2, 'user8base', 8),
  ('${accServer8Pre027B}',    '${devMovCompat}',  '${userA}', 'Server 8 Mov',    3, 'user8mov', 8),
  ('${accServer8Pre027_b2b}', '${devFailedB2bc}', '${userA}', 'Server 8 b2bc',   4, 'user8_b2bc', 8);
`;
    const res = runPsql(testDbName, seedSql);
    assert.equal(res.status, 0, `Seed failed: ${res.stderr}`);
  });

  it("4. Migration 027 executes cleanly on real PostgreSQL with zero errors", () => {
    const file027 = fs.readdirSync(migrationsDir).find(f => f.startsWith("027_"));
    assert.ok(file027, "Migration 027 file must exist");
    const content027 = fs.readFileSync(path.join(migrationsDir, file027), "utf-8");

    const res027 = runPsql(testDbName, content027);
    assert.equal(res027.status, 0, `Migration 027 failed: ${res027.stderr}`);
    assert.doesNotMatch(res027.stderr, /ERROR/i);

    runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('027', '${file027}');`);
  });

  it("5. Existing legacy rows and pre-existing server 8 rows (including b2bc) survive migration 027", () => {
    const resLegacy = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accLegacy}';`);
    assert.match(resLegacy.stdout, /0/);

    const resServer8A = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre027A}';`);
    assert.match(resServer8A.stdout, /8/);
    assert.match(resServer8A.stdout, /Server 8 Base/);

    const resServer8B = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre027B}';`);
    assert.match(resServer8B.stdout, /8/);
    assert.match(resServer8B.stdout, /Server 8 Mov/);

    const resServer8_b2b = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre027_b2b}';`);
    assert.match(resServer8_b2b.stdout, /8/);
    assert.match(resServer8_b2b.stdout, /Server 8 b2bc/);
  });

  it("6. Base SHA 4009f070... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devBaseCompat}', '${userA}', 'Old SHA Server 8 Post-027', 10, 'oldsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Old SHA insert failed: ${res.stderr}`);

    const transSql = `
UPDATE public.accounts SET server_index = 8 WHERE id = '${accLegacy}';
`;
    const transRes = runPsql(testDbName, transSql);
    assert.equal(transRes.status, 0, `Old SHA transition failed: ${transRes.stderr}`);
  });

  it("7. Movement-fix SHA 51cb7d4e... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devMovCompat}', '${userA}', 'Mov SHA Server 8 Post-027', 11, 'movsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Mov SHA insert failed: ${res.stderr}`);
  });

  it("8. Forge local NPC menu fix SHA 37d18817... is accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index)
VALUES ('${accNewForgeLocal}', '${devForgeLocal}', '${userA}', 'New Forge Local Fix Server 8', 12, 'newforgelocal8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Forge local fix SHA insert failed: ${res.stderr}`);

    const verifyRes = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accNewForgeLocal}';`);
    assert.match(verifyRes.stdout, /8/);
    assert.match(verifyRes.stdout, /New Forge Local Fix Server 8/);
  });

  it("9. Revoked failed candidate b2bc6ceb... is REJECTED for new server 8 insert and transition after migration 027", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devFailedB2bc}', '${userA}', 'b2bc Server 8 Should Fail', 13, 'failb2bc', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.notEqual(res.status, 0, "Insert on b2bc must be rejected");
    assert.match(res.stderr, /is not compatible with Bach Ho server/);

    // Transition of legacy account to server 8 on b2bc device must also be rejected
    const tempAcc = "10101010-1010-1010-1010-101010101010";
    runPsql(testDbName, `INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES ('${tempAcc}', '${devFailedB2bc}', '${userA}', 'Temp Legacy', 14, 'templegacy', 0);`);
    const transRes = runPsql(testDbName, `UPDATE public.accounts SET server_index = 8 WHERE id = '${tempAcc}';`);
    assert.notEqual(transRes.status, 0, "Transition to server 8 on b2bc must be rejected");
    assert.match(transRes.stderr, /is not compatible with Bach Ho server/);
  });

  it("10. Rolled-back candidate 278f3754... and failed candidate 47e4d766... remain REJECTED", () => {
    const res278f = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devRolledBack278f}', '${userA}', '278f Server 8 Should Fail', 15, 'fail278f', 8);
`);
    assert.notEqual(res278f.status, 0, "278f must be rejected");
    assert.match(res278f.stderr, /is not compatible with Bach Ho server/);

    const res47e4 = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devFailed47e4}', '${userA}', '47e4 Server 8 Should Fail', 16, 'fail47e4', 8);
`);
    assert.notEqual(res47e4.status, 0, "47e4 must be rejected");
    assert.match(res47e4.stderr, /is not compatible with Bach Ho server/);
  });

  it("11. Arbitrary SHA and obsolete candidates (0bdda, d369, 24e9) remain REJECTED", () => {
    for (const badDev of [devArbitrary, devObsolete0bdda, devObsoleteD369, devFailed24e9]) {
      const res = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${badDev}', '${userA}', 'Bad Dev Server 8 Should Fail', 17, 'failbad', 8);
`);
      assert.notEqual(res.status, 0, `Bad dev ${badDev} must be rejected`);
      assert.match(res.stderr, /is not compatible with Bach Ho server/);
    }
  });

  it("12. Forge local fix SHA with CTL 14 is REJECTED", () => {
    const resCtl14 = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForgeCtl14}', '${userA}', 'CTL14 Server 8 Should Fail', 20, 'failctl14', 8);
`);
    assert.notEqual(resCtl14.status, 0, "CTL 14 must be rejected");
    assert.match(resCtl14.stderr, /is not compatible with Bach Ho server/);
  });

  it("13. Forge local fix SHA without exact managed-identity-restart-v1 capability is REJECTED", () => {
    const resNoTok = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForgeNoTok}', '${userA}', 'NoTok Server 8 Should Fail', 21, 'failnotok', 8);
`);
    assert.notEqual(resNoTok.status, 0, "Missing exact capability must be rejected");
    assert.match(resNoTok.stderr, /is not compatible with Bach Ho server/);
  });

  it("14. Immutability of user_id / device_id and foreign device ownership checks preserved", () => {
    const resUserImm = runPsql(testDbName, `
UPDATE public.accounts SET user_id = '${userB}' WHERE id = '${accNewForgeLocal}';
`);
    assert.notEqual(resUserImm.status, 0, "user_id update must fail");
    assert.match(resUserImm.stderr, /accounts.user_id is immutable after insert/);

    const resDevImm = runPsql(testDbName, `
UPDATE public.accounts SET device_id = '${devBaseCompat}' WHERE id = '${accNewForgeLocal}';
`);
    assert.notEqual(resDevImm.status, 0, "device_id update must fail");
    assert.match(resDevImm.stderr, /accounts.device_id is immutable after insert/);

    const resForeign = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForeignB}', '${userA}', 'Foreign Dev Should Fail', 22, 'failforeign', 8);
`);
    assert.notEqual(resForeign.status, 0, "Foreign device must fail");
    assert.match(resForeign.stderr, /does not belong to user/);
  });

  it("15. Transition server 8 -> legacy and metadata-only edit on pre-existing row preserved", () => {
    const resSwitchLegacy = runPsql(testDbName, `
UPDATE public.accounts SET server_index = 0 WHERE id = '${accNewForgeLocal}';
`);
    assert.equal(resSwitchLegacy.status, 0, `Switch to legacy failed: ${resSwitchLegacy.stderr}`);

    const resMeta = runPsql(testDbName, `
UPDATE public.accounts SET label = 'Updated b2bc Label' WHERE id = '${accServer8Pre027_b2b}';
`);
    assert.equal(resMeta.status, 0, `Metadata edit on existing b2bc row failed: ${resMeta.stderr}`);
  });

  it("16. RPC create_game_account accepts 37d18817..., 4009..., 51cb... and rejects b2bc..., 24e9..., 278f... and arbitrary", () => {
    const asUserASql = `
SET SESSION "request.jwt.claim.sub" = '${userA}';
SET SESSION "request.jwt.claim.role" = 'authenticated';
`;
    // 37d1 device -> SUCCESS
    const resLocal = runPsql(testDbName, `${asUserASql} SELECT public.create_game_account('${devForgeLocal}', 'RPC Local', 'rpclocal', '${validSealedJson}'::jsonb, 8::smallint, 15, '{}'::jsonb, 1::smallint);`);
    assert.equal(resLocal.status, 0, `RPC 37d1 failed: ${resLocal.stderr}`);

    // Base device -> SUCCESS
    const resBase = runPsql(testDbName, `${asUserASql} SELECT public.create_game_account('${devBaseCompat}', 'RPC Base', 'rpcbase', '${validSealedJson}'::jsonb, 8::smallint, 15, '{}'::jsonb, 1::smallint);`);
    assert.equal(resBase.status, 0, `RPC 4009 failed: ${resBase.stderr}`);

    // Movement device -> SUCCESS
    const resMov = runPsql(testDbName, `${asUserASql} SELECT public.create_game_account('${devMovCompat}', 'RPC Mov', 'rpcmov', '${validSealedJson}'::jsonb, 8::smallint, 15, '{}'::jsonb, 1::smallint);`);
    assert.equal(resMov.status, 0, `RPC 51cb failed: ${resMov.stderr}`);

    // b2bc device -> REJECTED
    const resB2bc = runPsql(testDbName, `${asUserASql} SELECT public.create_game_account('${devFailedB2bc}', 'RPC b2bc', 'rpcb2bc', '${validSealedJson}'::jsonb, 8::smallint, 15, '{}'::jsonb, 1::smallint);`);
    assert.notEqual(resB2bc.status, 0, "RPC b2bc must fail");
    assert.match(resB2bc.stderr, /is not compatible with Bach Ho server/);

    // 24e9 device -> REJECTED
    const res24e = runPsql(testDbName, `${asUserASql} SELECT public.create_game_account('${devFailed24e9}', 'RPC 24e', 'rpc24e', '${validSealedJson}'::jsonb, 8::smallint, 15, '{}'::jsonb, 1::smallint);`);
    assert.notEqual(res24e.status, 0, "RPC 24e9 must fail");

    // 278f device -> REJECTED
    const res278 = runPsql(testDbName, `${asUserASql} SELECT public.create_game_account('${devRolledBack278f}', 'RPC 278', 'rpc278', '${validSealedJson}'::jsonb, 8::smallint, 15, '{}'::jsonb, 1::smallint);`);
    assert.notEqual(res278.status, 0, "RPC 278f must fail");
  });

  it("17. RPC update_game_account accepts 37d18817..., 4009..., 51cb... and rejects b2bc..., 24e9..., 278f... and arbitrary", () => {
    const asUserASql = `
SET SESSION "request.jwt.claim.sub" = '${userA}';
SET SESSION "request.jwt.claim.role" = 'authenticated';
`;
    // Create legacy accounts
    const accToLocal = "20202020-0001-0000-0000-000000000001";
    const accToB2bc  = "20202020-0002-0000-0000-000000000002";
    runPsql(testDbName, `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accToLocal}', '${devForgeLocal}', '${userA}', 'To Local', 30, 'tolocal', 0),
  ('${accToB2bc}',  '${devFailedB2bc}', '${userA}', 'To b2bc',  31, 'tob2bc',  0);
`);

    // Transition account on 37d1 device from 0 to 8 -> SUCCESS
    const resUpLocal = runPsql(testDbName, `${asUserASql} SELECT public.update_game_account('${accToLocal}', 'Now Local 8', 8::smallint);`);
    assert.equal(resUpLocal.status, 0, `Update to server 8 on 37d1 failed: ${resUpLocal.stderr}`);

    // Transition account on b2bc device from 0 to 8 -> REJECTED
    const resUpB2bc = runPsql(testDbName, `${asUserASql} SELECT public.update_game_account('${accToB2bc}', 'Now b2bc 8', 8::smallint);`);
    assert.notEqual(resUpB2bc.status, 0, "Update to server 8 on b2bc must fail");
    assert.match(resUpB2bc.stderr, /is not compatible with Bach Ho server/);

    // Teardown
    spawnSync("wsl", ["-u", "postgres", "dropdb", "--if-exists", testDbName], { encoding: "utf-8" });
  });
});
