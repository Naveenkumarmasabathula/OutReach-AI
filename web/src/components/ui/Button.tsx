import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type Variant = "primary" | "secondary" | "utility" | "ghost" | "danger";
type Size = "default" | "sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const base =
  "inline-flex items-center justify-center gap-2 font-text text-body transition-transform active:scale-95 disabled:opacity-48 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus";

const variants: Record<Variant, string> = {
  // The signature Apple pill CTA — reserved for the primary action on a screen.
  primary: "bg-primary text-on-primary rounded-pill hover:bg-primary-focus",
  // Ghost pill — secondary action alongside a primary one.
  secondary: "bg-transparent text-primary border border-primary rounded-pill hover:bg-canvas-parchment",
  // Compact dark utility rect — nav/toolbar actions.
  utility: "bg-ink text-body-on-dark rounded-sm text-button-utility hover:opacity-90",
  // Quiet, borderless — table row actions, low-emphasis actions.
  ghost: "bg-transparent text-ink-muted-80 rounded-sm hover:bg-divider-soft",
  danger: "bg-status-critical text-on-primary rounded-pill hover:opacity-90",
};

const sizes: Record<Size, string> = {
  default: "px-[22px] py-[11px]",
  sm: "px-[15px] py-[8px] text-button-utility",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...props} />
  ),
);
Button.displayName = "Button";
