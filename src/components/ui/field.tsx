import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Form primitives. Every field takes `label`, `error` and `help` so the
 * schema-driven config form and the login form share one error presentation.
 */

const BASE =
  "w-full rounded-md border bg-elevated px-3 text-sm text-foreground placeholder:text-muted/70 disabled:opacity-50";
const BORDER_OK = "border-border focus:border-accent";
const BORDER_ERR = "border-danger/60 focus:border-danger";

function FieldShell({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : help ? (
        <p className="text-xs text-muted/80">{help}</p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  help?: string;
  error?: string;
  suffix?: string;
}

export function TextField({
  id,
  label,
  help,
  error,
  suffix,
  className = "",
  type = "text",
  ...rest
}: TextFieldProps) {
  const fieldId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell id={fieldId} label={label} help={help} error={error}>
      <div className="relative">
        <input
          id={fieldId}
          type={type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={`${BASE} ${error ? BORDER_ERR : BORDER_OK} ${suffix ? "pr-14" : ""} h-10 ${className}`}
          {...rest}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
            {suffix}
          </span>
        ) : null}
      </div>
    </FieldShell>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  help?: string;
  error?: string;
  options: Array<{ value: string | number; label: string; disabled?: boolean }>;
}

export function SelectField({
  id,
  label,
  help,
  error,
  options,
  className = "",
  ...rest
}: SelectFieldProps) {
  const fieldId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell id={fieldId} label={label} help={help} error={error}>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={`${BASE} ${error ? BORDER_ERR : BORDER_OK} h-10 appearance-none ${className}`}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  help?: string;
  error?: string;
}

export function TextArea({
  id,
  label,
  help,
  error,
  className = "",
  ...rest
}: TextAreaProps) {
  const fieldId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell id={fieldId} label={label} help={help} error={error}>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={`${BASE} ${error ? BORDER_ERR : BORDER_OK} min-h-20 py-2 font-mono text-xs ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

/** ON/OFF switch — the spec's `Auto Start  ON` rows. */
export function ToggleField({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  id?: string;
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <label htmlFor={fieldId} className="block text-sm text-foreground">
          {label}
        </label>
        {help ? <p className="mt-0.5 text-xs text-muted/80">{help}</p> : null}
      </div>
      <button
        id={fieldId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-100 disabled:opacity-50 ${
          checked ? "border-accent bg-accent/30" : "border-border bg-elevated"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full transition-[left] duration-100 ${
            checked ? "left-[22px] bg-accent" : "left-0.5 bg-muted"
          }`}
          aria-hidden="true"
        />
        <span className="sr-only">{checked ? "BẬT" : "TẮT"}</span>
      </button>
    </div>
  );
}
