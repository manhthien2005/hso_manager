import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { executeResolveManualReviewFlow, QueueError } from "@/services/queue-service";
import { QUEUE_ERROR_CODES } from "@/lib/queue";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!token) {
      return NextResponse.json(
        { code: QUEUE_ERROR_CODES.QUEUE_NOT_OWNED, error: "Chưa đăng nhập (thiếu Bearer token)" },
        { status: 401 },
      );
    }

    const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: userData, error: authError } = await client.auth.getUser(token);
    if (authError || !userData?.user) {
      return NextResponse.json(
        { code: QUEUE_ERROR_CODES.QUEUE_NOT_OWNED, error: "Phiên đăng nhập không hợp lệ" },
        { status: 401 },
      );
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID, error: "Dữ liệu JSON không hợp lệ" },
        { status: 400 },
      );
    }

    const jobId = body?.jobId || body?.job_id;
    if (!jobId || typeof jobId !== "string") {
      return NextResponse.json(
        { code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID, error: "Thiếu jobId" },
        { status: 400 },
      );
    }

    const disposition = (body?.disposition || body?.action || "ABANDON_UNRESOLVED") as "ABANDON_UNRESOLVED";
    const note = typeof body?.note === "string" ? body.note : null;

    const job = await executeResolveManualReviewFlow(
      client,
      jobId,
      userData.user.id,
      disposition,
      note,
    );

    return NextResponse.json(
      {
        ok: true,
        job,
        message: "Đã xử lý và đóng hàng đợi sau kiểm tra thủ công.",
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof QueueError) {
      const statusMap: Record<string, number> = {
        [QUEUE_ERROR_CODES.QUEUE_NOT_OWNED]: 403,
        [QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED]: 500,
        [QUEUE_ERROR_CODES.MANUAL_REVIEW_STATE_CHANGED]: 409,
        [QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT]: 409,
        [QUEUE_ERROR_CODES.MANUAL_REVIEW_INVALID_DISPOSITION]: 400,
        [QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID]: 400,
      };

      return NextResponse.json(
        { code: err.code, error: err.message },
        { status: statusMap[err.code] ?? 400 },
      );
    }

    return NextResponse.json(
      {
        code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
        error: err instanceof Error ? err.message : "Lỗi xử lý yêu cầu",
      },
      { status: 500 },
    );
  }
}
