import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";
import { fieldBase } from "./Input.js";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select ref={ref} className={cn(fieldBase, "appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-ds-sm top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted-48"
        aria-hidden
      />
    </div>
  ),
);
Select.displayName = "Select";
