/**
 * Enhancement Queue Schema Contract & Domain Type Tests (ENHANCE-05A)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type {
  EnhancementQueueJobStatus,
  EnhancementQueueItemStatus,
  EnhancementAttemptPhase,
  EnhancementPaymentType,
  EnhancementCharmMode,
  EnhancementQueueJob,
  EnhancementQueueItem,
  EnhancementQueueJobSummary,
} from "../../src/lib/types";

describe("Enhancement Queue Schema Contract & Invariants (ENHANCE-05A)", () => {
  const migrationPath = path.resolve(process.cwd(), "supabase/migrations/013_enhancement_queue.sql");
  const sqlContent = fs.readFileSync(migrationPath, "utf-8");

  describe("File Integrity & Forward-Only Migration", () => {
    it("migration 013 file exists and is non-empty", () => {
      assert.ok(fs.existsSync(migrationPath));
      assert.ok(sqlContent.length > 500);
    });

    it("migration 013 is forward-only and contains no destructive statements", () => {
      assert.doesNotMatch(sqlContent, /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
      assert.doesNotMatch(sqlContent, /TRUNCATE/i);
      assert.doesNotMatch(sqlContent, /ALTER\s+TABLE\s+public\.farm_spots/i);
      assert.doesNotMatch(sqlContent, /ALTER\s+TABLE\s+public\.devices\s+DROP/i);
      assert.doesNotMatch(sqlContent, /ALTER\s+TABLE\s+public\.accounts\s+DROP/i);
    });
  });

  describe("Jobs Table Specification", () => {
    it("creates public.enhancement_queue_jobs with canonical ownership FKs", () => {
      assert.match(sqlContent, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.enhancement_queue_jobs/i);
      assert.match(sqlContent, /account_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+public\.accounts\(id\)/i);
      assert.match(sqlContent, /device_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+public\.devices\(id\)/i);
      assert.match(sqlContent, /user_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+auth\.users\(id\)/i);
    });

    it("enforces required job lifecycle statuses with DRAFT default", () => {
      assert.match(sqlContent, /status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'DRAFT'/i);
      const expectedStatuses = [
        "DRAFT",
        "QUEUED",
        "RUNNING",
        "PAUSING",
        "PAUSED",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "MANUAL_REVIEW_REQUIRED",
      ];
      for (const st of expectedStatuses) {
        assert.ok(sqlContent.includes(`'${st}'`), `Job status ${st} missing from CHECK`);
      }
    });

    it("includes agent claiming and cooperative pause/cancel tracking fields", () => {
      assert.match(sqlContent, /claimed_by\s+text/i);
      assert.match(sqlContent, /claimed_at\s+timestamptz/i);
      assert.match(sqlContent, /claim_expires_at\s+timestamptz/i);
      assert.match(sqlContent, /pause_requested_at\s+timestamptz/i);
      assert.match(sqlContent, /cancel_requested_at\s+timestamptz/i);
    });

    it("enforces database-level unresolved queue exclusivity per account", () => {
      assert.match(
        sqlContent,
        /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_enhancement_queue_jobs_account_unresolved_exclusivity/i,
      );
      assert.match(
        sqlContent,
        /WHERE\s+status\s+IN\s+\('QUEUED',\s*'RUNNING',\s*'PAUSING',\s*'PAUSED',\s*'MANUAL_REVIEW_REQUIRED'\)/i,
      );
    });
  });

  describe("Items Table Specification", () => {
    it("creates public.enhancement_queue_items with job_id cascade delete", () => {
      assert.match(sqlContent, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.enhancement_queue_items/i);
      assert.match(sqlContent, /job_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+public\.enhancement_queue_jobs\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    });

    it("enforces deterministic unique positive queue_order per job", () => {
      assert.match(sqlContent, /queue_order\s+integer\s+NOT\s+NULL/i);
      assert.match(sqlContent, /CHECK\s*\(queue_order\s*>=\s*1\)/i);
      assert.match(sqlContent, /UNIQUE\s*\(job_id,\s*queue_order\)/i);
    });

    it("enforces level constraints: target_level > initial_level", () => {
      assert.match(sqlContent, /initial_level\s+integer\s+NOT\s+NULL/i);
      assert.match(sqlContent, /target_level\s+integer\s+NOT\s+NULL/i);
      assert.match(sqlContent, /CHECK\s*\(target_level\s*>\s*initial_level\)/i);
      assert.match(sqlContent, /CHECK\s*\(initial_level\s*>=\s*0\s+AND\s+initial_level\s*<=\s*14\)/i);
      assert.match(sqlContent, /CHECK\s*\(target_level\s*>=\s*1\s+AND\s+target_level\s*<=\s*15\)/i);
    });

    it("enforces payment and charm modes without magic strings", () => {
      assert.match(sqlContent, /payment_type\s+text\s+NOT\s+NULL/i);
      assert.match(sqlContent, /CHECK\s*\(payment_type\s+IN\s+\('GOLD',\s*'GEMS'\)\)/i);
      assert.match(sqlContent, /charm_mode\s+text\s+NOT\s+NULL\s+DEFAULT\s+'NONE'/i);
      assert.match(sqlContent, /'NONE'/i);
      assert.match(sqlContent, /'CO_3_LA'/i);
      assert.match(sqlContent, /'CO_4_LA'/i);
      assert.match(sqlContent, /'AUTO_POLICY'/i);
    });

    it("persists all candidate crash-safe attempt phase fields", () => {
      const requiredFields = [
        "active_attempt_uuid",
        "attempt_phase",
        "attempt_expected_level",
        "attempt_target_level",
        "attempt_started_at",
        "execute_may_have_been_sent_at",
        "attempt_settled_at",
        "last_result_code",
      ];
      for (const field of requiredFields) {
        assert.ok(sqlContent.includes(field), `Attempt phase field ${field} missing from items table`);
      }
    });

    it("enforces attempt phase allowlist", () => {
      const phases = [
        "NONE",
        "PREPARING",
        "READY_TO_EXECUTE",
        "EXECUTE_MAY_HAVE_BEEN_SENT",
        "WAITING_RESULT",
        "WAITING_SETTLEMENT",
        "SETTLED",
      ];
      for (const ph of phases) {
        assert.ok(sqlContent.includes(`'${ph}'`), `Attempt phase ${ph} missing from items CHECK`);
      }
    });

    it("tracks authoritative separate actual spend with non-negative constraints", () => {
      const spendCols = [
        "actual_gold_spent",
        "actual_gem_spent",
        "actual_material_1_spent",
        "actual_material_2_spent",
        "actual_material_3_spent",
        "actual_material_4_spent",
        "actual_charm_spent",
      ];
      for (const col of spendCols) {
        assert.ok(sqlContent.includes(col), `Spend column ${col} missing from items table`);
        assert.match(sqlContent, new RegExp(`CHECK\\s*\\(${col}\\s*>=\\s*0\\)`, "i"));
      }
    });
  });

  describe("Derived Job Spend View & Double Count Prevention", () => {
    it("creates public.enhancement_queue_job_summaries view with security_invoker = true", () => {
      assert.match(sqlContent, /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.enhancement_queue_job_summaries/i);
      assert.match(sqlContent, /WITH\s*\(security_invoker\s*=\s*true\)/i);
      assert.match(sqlContent, /COALESCE\(SUM\(i\.actual_gold_spent\),\s*0\)/i);
      assert.match(sqlContent, /COALESCE\(SUM\(i\.actual_gem_spent\),\s*0\)/i);
      assert.match(sqlContent, /COALESCE\(SUM\(i\.actual_material_1_spent\),\s*0\)/i);
      assert.match(sqlContent, /COALESCE\(SUM\(i\.actual_charm_spent\),\s*0\)/i);
    });
  });

  describe("Atomic Publish Contract", () => {
    it("creates publish_enhancement_queue_job function with validation checks", () => {
      assert.match(sqlContent, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.publish_enhancement_queue_job/i);
      assert.match(sqlContent, /auth\.uid\(\)\s+IS\s+NULL/i);
      assert.match(sqlContent, /status\s+<>\s+'DRAFT'/i);
      assert.match(sqlContent, /v_item_count\s+=\s+0/i);
      assert.match(sqlContent, /status\s+IN\s+\('QUEUED',\s*'RUNNING',\s*'PAUSING',\s*'PAUSED',\s*'MANUAL_REVIEW_REQUIRED'\)/i);
      assert.match(sqlContent, /SET\s+status\s+=\s+'QUEUED'/i);
    });
  });

  describe("Row Level Security and Realtime", () => {
    it("enables RLS on both jobs and items tables", () => {
      assert.match(sqlContent, /ALTER\s+TABLE\s+public\.enhancement_queue_jobs\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      assert.match(sqlContent, /ALTER\s+TABLE\s+public\.enhancement_queue_items\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    });

    it("restricts insert to jobs and items owned by auth.uid()", () => {
      assert.match(sqlContent, /user_id\s*=\s*auth\.uid\(\)/i);
    });

    it("adds enhancement_queue_jobs to supabase_realtime publication", () => {
      assert.match(sqlContent, /ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+public\.enhancement_queue_jobs/i);
    });
  });

  describe("TypeScript Domain Types Consistency", () => {
    it("instantiates domain types cleanly without type errors", () => {
      const mockJob: EnhancementQueueJob = {
        id: "job-1",
        accountId: "acc-1",
        deviceId: "dev-1",
        userId: "user-1",
        status: "QUEUED",
        activeItemId: null,
        activeAttemptUuid: null,
        activeCommandId: null,
        totalItems: 1,
        completedItems: 0,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
        pauseRequestedAt: null,
        cancelRequestedAt: null,
        errorCode: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        updatedAt: new Date().toISOString(),
      };

      const mockItem: EnhancementQueueItem = {
        id: "item-1",
        jobId: "job-1",
        accountId: "acc-1",
        userId: "user-1",
        queueOrder: 1,
        capturedSlot: 0,
        templateId: 101,
        category: 3,
        baseName: "Sword",
        tier: 1,
        icon: 10,
        initialLevel: 0,
        currentLevel: 0,
        targetLevel: 5,
        paymentType: "GOLD",
        charmMode: "CO_3_LA",
        status: "PENDING",
        attemptCount: 0,
        activeAttemptUuid: null,
        attemptPhase: "NONE",
        attemptExpectedLevel: null,
        attemptTargetLevel: null,
        attemptStartedAt: null,
        executeMayHaveBeenSentAt: null,
        attemptSettledAt: null,
        lastResultCode: null,
        actualGoldSpent: 0,
        actualGemSpent: 0,
        actualMaterial1Spent: 0,
        actualMaterial2Spent: 0,
        actualMaterial3Spent: 0,
        actualMaterial4Spent: 0,
        actualCharmSpent: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockSummary: EnhancementQueueJobSummary = {
        ...mockJob,
        actualGoldSpent: 1000,
        actualGemSpent: 0,
        actualMaterial1Spent: 5,
        actualMaterial2Spent: 0,
        actualMaterial3Spent: 0,
        actualMaterial4Spent: 0,
        actualCharmSpent: 0,
        totalAttemptCount: 2,
      };

      assert.equal(mockJob.status, "QUEUED");
      assert.equal(mockItem.paymentType, "GOLD");
      assert.equal(mockSummary.totalAttemptCount, 2);
    });
  });
});
