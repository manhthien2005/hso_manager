import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button with built-in busy state so command flows don't re-implement it.
 * `busy` disables the button and swaps the icon for a spinner.
 *
 * `ButtonLink` renders the same visuals as a real anchor — never nest a
 * `<button>` inside a `<Link>` at the call site.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-fill text-white border-accent-fill hover:bg-accent-fill/85",
  secondary: "bg-elevated text-foreground border-border hover:bg-surface hover:border-muted/50",
  ghost: "bg-transparent text-muted border-transparent hover:bg-elevated hover:text-foreground",
  danger: "bg-transparent text-danger border-danger/40 hover:bg-danger/12",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

function buttonClass(variant: Variant, size: Size, className: string): string {
  return `inline-flex shrink-0 items-center justify-center rounded-md border font-medium transition-colors duration-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  icon,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`${buttonClass(variant, size, className)} disabled:cursor-not-allowed disabled:opacity-50`}
      {...rest}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /** Renders disabled-looking and blocks navigation; anchors can't be disabled. */
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  target?: string;
  rel?: string;
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  disabled = false,
  className = "",
  children,
  target,
  rel,
}: ButtonLinkProps) {
  const classes = disabled
    ? `${buttonClass(variant, size, className)} pointer-events-none opacity-50`
    : buttonClass(variant, size, className);

  return (
    <Link
      href={href}
      target={target}
      rel={rel}
      className={classes}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
    >
      {icon}
      {children}
    </Link>
  );
}

export function Spinner({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`animate-spin ${className}`} aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
