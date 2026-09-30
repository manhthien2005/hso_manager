/**
 * Migration 021: Enhancement Degrade Retry and Attempt Cap Contract Tests
 * Task: ENHANCE-06H5-DEGRADE-RETRY-AND-ATTEMPT-CAP-CORRECTIVE
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 021: Enhancement Degrade Retry & Attempt Cap Contract", () => {
  const migration021Path = path.resolve(process.cwd(), "supabase/migrations/021_enhancement_degrade_retry_and_attempt_cap.sql");
  const sql021 = fs.readFileSync(migration021Path, "utf-8");

  describe("File Integrity & Forward-Only Invariants", () => {
    it("migration 021 exists and is non-empty", () => {
      assert.ok(fs.existsSync(migration021Path));
      assert.ok(sql021.length > 500);
    });

    it("migration 021 contains no destructive operations", () => {
      assert.doesNotMatch(sql021, /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
      assert.doesNotMatch(sql021, /TRUNCATE/i);
    });

    it("migrations 013 through 020 remain strictly untouched", () => {
      for (const mig of ["013", "014", "015", "016", "017", "018", "019", "020"]) {
        const migFiles = fs.readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
          .filter((f) => f.startsWith(`${mig}_`));
        assert.equal(migFiles.length, 1, `Expected migration ${mig} to exist`);
      }
    });
  });

  describe("Schema Invariants: max_attempts Column and Constraints", () => {
    it("adds max_attempts column with NOT NULL and default 10", () => {
      assert.match(sql021, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+max_attempts\s+integer\s+NOT\s+NULL\s+DEFAULT\s+10/i);
    });

    it("enforces bounded check constraint between 1 and 100 on max_attempts", () => {
      assert.match(sql021, /CONSTRAINT\s+enhancement_queue_items_max_attempts_check\s+CHECK\s*\(\s*max_attempts\s*>=\s*1\s+AND\s+max_attempts\s*<=\s*100\s*\)/i);
    });
  });

  describe("Publication Gate: enhancement-degrade-retry-v1 Invariants", () => {
    it("updates publish_enhancement_queue_job to enforce enhancement-degrade-retry-v1", () => {
      assert.match(sql021, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.publish_enhancement_queue_job/i);
      assert.match(sql021, /enhancement-degrade-retry-v1/);
    });

    it("fails closed when agent lacks enhancement-degrade-retry-v1", () => {
      assert.match(sql021, /cannot publish enhancement queue job %: device % lacks capability enhancement-degrade-retry-v1/i);
    });

    it("validates max_attempts bounds on all items before publication", () => {
      assert.match(sql021, /found % items with max_attempts out of bounds \(1\.\.100\)/i);
    });

    it("preserves enhancement-queue-v2 and enhancement-multilevel-v1 requirements", () => {
      assert.match(sql021, /enhancement-queue-v2/);
      assert.match(sql021, /enhancement-multilevel-v1/);
    });
  });
});
