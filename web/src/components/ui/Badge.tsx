import { AlertCircle, AlertTriangle, CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export type BadgeVariant = "good" | "warning" | "serious" | "critical" | "info" | "neutral";

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  good: "bg-status-good/10 text-status-good",
  warning: "bg-status-warning/15 text-[#8a5a00]",
  serious: "bg-status-serious/15 text-[#9c4a2c]",
  critical: "bg-status-critical/10 text-status-critical",
  info: "bg-primary/10 text-primary",
  neutral: "bg-divider-soft text-ink-muted-80",
};

const VARIANT_ICONS: Record<BadgeVariant, typeof CheckCircle2 | null> = {
  good: CheckCircle2,
  warning: AlertTriangle,
  serious: AlertCircle,
  critical: XCircle,
  info: Clock,
  neutral: Circle,
};

type BadgeProps = {
  variant: BadgeVariant;
  children: ReactNode;
  className?: string;
};

/**
 * Status colors are informational only, never on anything clickable — Action
 * Blue remains the sole interactive color. Icon + label always ship together
 * per the dataviz skill's accessibility rule: color never carries meaning alone.
 */
export function Badge({ variant, children, className }: BadgeProps) {
  const Icon = VARIANT_ICONS[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-caption-strong",
        VARIANT_STYLES[variant],
        className,
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
      {children}
    </span>
  );
}
