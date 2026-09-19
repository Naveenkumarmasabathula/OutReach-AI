import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type FieldLabelProps = LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode; required?: boolean };

export function FieldLabel({ className, children, required, ...props }: FieldLabelProps) {
  return (
    <label className={cn("mb-1.5 block text-caption-strong text-ink-muted-80", className)} {...props}>
      {children}
      {required ? <span className="text-status-critical"> *</span> : null}
    </label>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-caption text-status-critical">{children}</p>;
}

export function Field({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-ds-md", className)}>{children}</div>;
}
