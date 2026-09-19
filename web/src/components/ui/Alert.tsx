import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type AlertProps = {
  variant?: "error" | "success";
  children: ReactNode;
  className?: string;
};

export function Alert({ variant = "error", children, className }: AlertProps) {
  const Icon = variant === "error" ? AlertCircle : CheckCircle2;
  return (
    <div
      role={variant === "error" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-sm px-ds-md py-3 text-caption",
        variant === "error" ? "bg-status-critical/10 text-status-critical" : "bg-status-good/10 text-status-good",
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
