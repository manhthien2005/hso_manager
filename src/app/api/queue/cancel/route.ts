import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { executeCancelQueueFlow, QueueError } from "@/services/queue-service";
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

    const body = await req.json();
    const { jobId } = body;

    if (!jobId || typeof jobId !== "string") {
      return NextResponse.json(
        { code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID, error: "Thiếu jobId" },
        { status: 400 },
      );
    }

    const job = await executeCancelQueueFlow(client, jobId, userData.user.id);

    return NextResponse.json(
      {
        ok: true,
        job,
        message: "Đã gửi yêu cầu hủy bỏ. Lượt cường hóa đang thực hiện (nếu có) có thể sẽ hoàn tất trước khi hủy hẳn các lượt sau.",
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof QueueError) {
      const status = err.code === QUEUE_ERROR_CODES.QUEUE_NOT_OWNED ? 403 : 409;
      return NextResponse.json({ code: err.code, error: err.message }, { status });
    }

    return NextResponse.json(
      {
        code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
        error: err instanceof Error ? err.message : "Lỗi xử lý yêu cầu hủy",
      },
      { status: 500 },
    );
  }
}
