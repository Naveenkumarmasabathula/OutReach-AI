import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type CardAccent = "primary" | "critical" | "warning" | "good";

const ACCENT_BORDER: Record<CardAccent, string> = {
  primary: "border-l-primary",
  critical: "border-l-status-critical",
  warning: "border-l-status-warning",
  good: "border-l-status-good",
};

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /**
   * A 3px left-border accent for at-a-glance scanning of what kind of
   * information a card holds (queue = primary, escalations = critical, …) —
   * a common clinical-dashboard convention, used sparingly (never on every
   * card) and always in addition to, never instead of, the icon + text
   * label the content itself already carries.
   */
  accent?: CardAccent;
};

/** Adapted from the spec's store-utility-card: flat, hairline border, no shadow. */
export function Card({ className, children, accent, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-hairline bg-canvas p-ds-lg",
        accent && `border-l-4 ${ACCENT_BORDER[accent]}`,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: CardProps) {
  return (
    <div className={cn("mb-ds-sm flex items-center justify-between", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: CardProps) {
  return (
    <h2 className={cn("text-body-strong text-ink", className)} {...props}>
      {children}
    </h2>
  );
}
