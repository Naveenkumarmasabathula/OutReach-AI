import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  "aria-label": string;
};

/** The spec's floating circular control chip — repurposed for compact icon-only actions (close, menu). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-chip text-ink transition-transform active:scale-95 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
      className,
    )}
    {...props}
  />
));
IconButton.displayName = "IconButton";
