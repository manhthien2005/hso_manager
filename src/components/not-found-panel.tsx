import Link from "next/link";
import { Card, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

/**
 * Route-param lookup failure (deleted device, mistyped URL).
 * Client pages can't reliably call `notFound()`, so they render this instead.
 */
export function NotFoundPanel({
  title,
  hint,
  identifier,
}: {
  title: string;
  hint: string;
  identifier: string;
}) {
  return (
    <>
      <PageHeader back={{ href: "/", label: "Tổng quan" }} title="Không tìm thấy" />
      <Card>
        <EmptyState
          title={title}
          hint={hint}
          action={
            <p className="font-mono text-xs text-muted">{identifier}</p>
          }
        />
        <div className="border-t border-border px-4 py-3">
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-md border border-border bg-elevated px-4 text-sm font-medium hover:bg-surface"
          >
            Quay lại trang tổng quan
          </Link>
        </div>
      </Card>
    </>
  );
}
