import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Page title row. `back` renders a breadcrumb link on its own so the heading
 * stays readable on mobile without a separate nav component.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {back.label}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {icon ? (
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-elevated/70 text-accent"
                aria-hidden="true"
              >
                {icon}
              </span>
            ) : null}
            <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
          </div>
          {subtitle ? <div className={`mt-1 text-sm text-muted ${icon ? "sm:pl-[2.375rem]" : ""}`}>{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
