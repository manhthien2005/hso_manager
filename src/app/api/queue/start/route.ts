import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { executeStartQueueFlow, QueueError } from "@/services/queue-service";
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

    // Authenticated scoped client with user's JWT
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
    const { accountId, items } = body;

    if (!accountId || typeof accountId !== "string") {
      return NextResponse.json(
        { code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID, error: "Thiếu accountId" },
        { status: 400 },
      );
    }

    const job = await executeStartQueueFlow(
      client,
      { accountId, items },
      { userId: userData.user.id },
    );

    return NextResponse.json({ ok: true, job }, { status: 200 });
  } catch (err) {
    if (err instanceof QueueError) {
      const statusMap: Record<string, number> = {
        [QUEUE_ERROR_CODES.QUEUE_RUNTIME_UNSUPPORTED]: 400,
        [QUEUE_ERROR_CODES.QUEUE_RUNTIME_STALE]: 400,
        [QUEUE_ERROR_CODES.QUEUE_ALREADY_ACTIVE]: 409,
        [QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT]: 409,
        [QUEUE_ERROR_CODES.QUEUE_EMPTY]: 400,
        [QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID]: 400,
        [QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED]: 400,
        [QUEUE_ERROR_CODES.AMBIGUOUS_WIRE_TARGET]: 400,
        [QUEUE_ERROR_CODES.QUEUE_NOT_OWNED]: 403,
        [QUEUE_ERROR_CODES.QUEUE_DRAFT_WRITE_FAILED]: 500,
        [QUEUE_ERROR_CODES.QUEUE_PUBLISH_FAILED]: 500,
      };

      return NextResponse.json(
        { code: err.code, error: err.message },
        { status: statusMap[err.code] ?? 400 },
      );
    }

    return NextResponse.json(
      {
        code: QUEUE_ERROR_CODES.QUEUE_PUBLISH_FAILED,
        error: err instanceof Error ? err.message : "Lỗi máy chủ",
      },
      { status: 500 },
    );
  }
}
