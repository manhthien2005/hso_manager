/**
 * Migration 022: Executable Real-PostgreSQL Migration Proof & Bach Ho Runtime Contract Tests
 * Task: KNIGHT_V403_BACH_HO_R3_1_FINAL_CROSS_REPO_CONTRACT_CORRECTION
 *
 * Proves that:
 * 1. Clean database starts and Supabase baseline environment bootstraps.
 * 2. Migrations 001 through 021 apply in canonical order without error.
 * 3. Seed legacy accounts and devices across servers 0..7 before migration 022.
 * 4. Corrected Migration 022 executes cleanly on real PostgreSQL with zero errors.
 * 5. Existing legacy 0..7 rows survive migration 022 unchanged.
 * 6. Server 9 direct insert/update rejected.
 * 7. Direct account INSERT with foreign user's device_id rejected.
 * 8. Direct UPDATE attempting user_id or device_id change rejected.
 * 9. Incompatible device / missing agent capability cannot insert or transition to server 8.
 * 10. Exact compatible device can insert and transition to server 8.
 * 11. Existing server 8 metadata-only edit and transition to legacy succeed.
 * 12. RPC create_game_account and update_game_account enforce full capability gate.
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

describe("Migration 022: Real PostgreSQL Executable Migration & Bach Ho Contract Proof", () => {
  const testDbName = "test_zeus_migration_proof_022";
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

  const R2_3_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const OLD_SHA = "b18baf709e7c5ecbc0c8b6b1076b1f20b784a9e3e78bdf1b4a2bfec19280d0d1";

  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  const devCompatible = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const devMissingToken = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const devOldJar = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const devForeignB = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  const accLegacy = "55555555-5555-5555-5555-555555555555";
  const accServer8 = "66666666-6666-6666-6666-666666666666";

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

  it("2. Migrations 001 through 021 apply in canonical order without error", () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.substring(0, 3);
      if (Number(version) >= 22) continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const res = runPsql(testDbName, content);
      assert.equal(res.status, 0, `Migration ${file} failed: ${res.stderr}`);
      runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${file}');`);
    }

    const checkRes = runPsql(testDbName, "SELECT count(*) FROM supabase_migrations.schema_migrations;");
    assert.match(checkRes.stdout, /21/);
  });

  it("3. Seed legacy accounts and devices across servers 0..7 before migration 022", () => {
    const seedSql = `
INSERT INTO auth.users (id, email) VALUES
  ('${userA}', 'usera@test.com'),
  ('${userB}', 'userb@test.com');

INSERT INTO public.devices (id, user_id, device_auth_id, name, status, agent_version, jar_ctl_version, jar_sha256, pubkey, next_slot_index) VALUES
  ('${devCompatible}', '${userA}', gen_random_uuid(), 'dev-compat', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${R2_3_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=', 'base64'), 20),
  ('${devMissingToken}', '${userA}', gen_random_uuid(), 'dev-missing-tok', 'online', '0.1.0+visual-qol-v1', 15, '${R2_3_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=', 'base64'), 20),
  ('${devOldJar}', '${userA}', gen_random_uuid(), 'dev-old-jar', 'online', '0.1.0+managed-identity-restart-v1', 14, '${OLD_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM=', 'base64'), 20),
  ('${devForeignB}', '${userB}', gen_random_uuid(), 'dev-foreign', 'online', '0.1.0+managed-identity-restart-v1', 15, '${R2_3_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=', 'base64'), 20);

-- Seed accounts across legacy servers 0..7
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accLegacy}', '${devCompatible}', '${userA}', 'Acc Server 0', 1, 'user0', 0),
  (gen_random_uuid(), '${devCompatible}', '${userA}', 'Acc Server 1', 2, 'user1', 1),
  (gen_random_uuid(), '${devCompatible}', '${userA}', 'Acc Server 7', 3, 'user7', 7);
`;
    const res = runPsql(testDbName, seedSql);
    assert.equal(res.status, 0, `Seed failed: ${res.stderr}`);
  });

  it("4. Corrected Migration 022 executes cleanly on real PostgreSQL with zero errors", () => {
    const file022 = fs.readdirSync(migrationsDir).find(f => f.startsWith("022_"));
    assert.ok(file022, "Migration 022 file must exist");
    const content022 = fs.readFileSync(path.join(migrationsDir, file022), "utf-8");

    const res022 = runPsql(testDbName, content022);
    assert.equal(res022.status, 0, `Migration 022 failed: ${res022.stderr}`);
    assert.doesNotMatch(res022.stderr, /ERROR/i);

    runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('022', '${file022}');`);
  });

  it("5. Case 1: existing legacy 0..7 rows survive 022 unchanged", () => {
    const res = runPsql(testDbName, "SELECT count(*) FROM public.accounts WHERE server_index IN (0, 1, 7);");
    assert.match(res.stdout, /3/);
  });

  it("6. Case 2: server9 direct insert rejected", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devCompatible}', '${userA}', 'Bad 9', 10, 'bad9', 9);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /accounts_server_index_check|server_index must be between 0 and 8/);
  });

  it("7. Case 3: server9 direct update rejected", () => {
    const sql = `
UPDATE public.accounts SET server_index = 9 WHERE id = '${accLegacy}';
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /accounts_server_index_check|server_index must be between 0 and 8/);
  });

  it("8. Case 4: direct account INSERT with foreign user's device_id rejected", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForeignB}', '${userA}', 'Spoofed Device', 11, 'spoofed', 0);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /does not belong to user/);
  });

  it("9. Case 5: direct UPDATE attempting user_id change rejected", () => {
    const sql = `
UPDATE public.accounts SET user_id = '${userB}' WHERE id = '${accLegacy}';
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /accounts\.user_id is immutable after insert/);
  });

  it("10. Case 6: direct UPDATE attempting device_id change rejected", () => {
    const sql = `
UPDATE public.accounts SET device_id = '${devMissingToken}' WHERE id = '${accLegacy}';
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /accounts\.device_id is immutable after insert/);
  });

  it("11. Case 7: incompatible own device (old JAR/CTL) cannot insert server8", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devOldJar}', '${userA}', 'Old Jar Server 8', 12, 'oldjar8', 8);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });

  it("12. Case 8: correct JAR+CTL but missing agent capability cannot insert/transition to server8", () => {
    // Direct insert attempt
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devMissingToken}', '${userA}', 'Missing Token Server 8', 13, 'notok8', 8);
`;
    const insertRes = runPsql(testDbName, insertSql);
    assert.notEqual(insertRes.status, 0);
    assert.match(insertRes.stderr, /not compatible with Bach Ho server/);

    // Transition attempt from legacy account on devMissingToken
    const seedAccount = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index)
VALUES ('77777777-7777-7777-7777-777777777777', '${devMissingToken}', '${userA}', 'Legacy NoToken', 14, 'legnotok', 0);
`;
    runPsql(testDbName, seedAccount);

    const transSql = `
UPDATE public.accounts SET server_index = 8 WHERE id = '77777777-7777-7777-7777-777777777777';
`;
    const transRes = runPsql(testDbName, transSql);
    assert.notEqual(transRes.status, 0);
    assert.match(transRes.stderr, /not compatible with Bach Ho server/);
  });

  it("13. Case 9: exact compatible device can insert server8", () => {
    const sql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index)
VALUES ('${accServer8}', '${devCompatible}', '${userA}', 'Bach Ho Account', 15, 'bachho1', 8);
`;
    const res = runPsql(testDbName, sql);
    assert.equal(res.status, 0, `Direct server 8 insert failed: ${res.stderr}`);

    const check = runPsql(testDbName, `SELECT server_index FROM public.accounts WHERE id = '${accServer8}';`);
    assert.match(check.stdout, /8/);
  });

  it("14. Case 10: exact compatible device can transition legacy -> server8", () => {
    const sql = `
UPDATE public.accounts SET server_index = 8 WHERE id = '${accLegacy}';
`;
    const res = runPsql(testDbName, sql);
    assert.equal(res.status, 0, `Legacy -> server 8 transition failed: ${res.stderr}`);

    const check = runPsql(testDbName, `SELECT server_index FROM public.accounts WHERE id = '${accLegacy}';`);
    assert.match(check.stdout, /8/);
  });

  it("15. Case 11: existing server8 metadata-only edit succeeds", () => {
    const sql = `
UPDATE public.accounts SET label = 'Updated Bach Ho Label' WHERE id = '${accServer8}';
`;
    const res = runPsql(testDbName, sql);
    assert.equal(res.status, 0, `Server 8 metadata update failed: ${res.stderr}`);

    const check = runPsql(testDbName, `SELECT label FROM public.accounts WHERE id = '${accServer8}';`);
    assert.match(check.stdout, /Updated Bach Ho Label/);
  });

  it("16. Case 12: server8 -> legacy succeeds", () => {
    const sql = `
UPDATE public.accounts SET server_index = 1 WHERE id = '${accLegacy}';
`;
    const res = runPsql(testDbName, sql);
    assert.equal(res.status, 0, `Server 8 -> legacy failed: ${res.stderr}`);

    const check = runPsql(testDbName, `SELECT server_index FROM public.accounts WHERE id = '${accLegacy}';`);
    assert.match(check.stdout, /1/);
  });

  it("17. Case 13: create_game_account server8 compatible succeeds", () => {
    const sql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devCompatible}'::uuid,
  'RPC Bach Ho Valid',
  'rpcbh1',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
) AS account_id;
`;
    const res = runPsql(testDbName, sql);
    assert.equal(res.status, 0, `create_game_account failed: ${res.stderr}`);
    assert.match(res.stdout, /[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("18. Case 14: create_game_account server8 incompatible fails", () => {
    const sql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devMissingToken}'::uuid,
  'RPC Bach Ho Invalid',
  'rpcbhinval',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });

  it("19. Case 15: update_game_account legacy -> server8 compatible succeeds", () => {
    const sql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '${accLegacy}'::uuid,
  'RPC Legacy to Server 8',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const res = runPsql(testDbName, sql);
    assert.equal(res.status, 0, `update_game_account transition failed: ${res.stderr}`);

    const check = runPsql(testDbName, `SELECT server_index FROM public.accounts WHERE id = '${accLegacy}';`);
    assert.match(check.stdout, /8/);
  });

  it("20. Case 16: update_game_account incompatible fails", () => {
    // Account '77777777-7777-7777-7777-777777777777' is on devMissingToken, currently on server 0
    const sql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '77777777-7777-7777-7777-777777777777'::uuid,
  'RPC Incompatible Transition',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });
});
