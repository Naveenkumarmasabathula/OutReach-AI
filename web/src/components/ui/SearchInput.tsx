import { Search } from "lucide-react";
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

/** Pill-shaped per spec — reserved for search/filter inputs, not general form fields. */
export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted-48" />
      <input
        ref={ref}
        type="search"
        className={cn(
          "h-11 w-full rounded-pill border border-hairline bg-canvas py-3 pl-10 pr-5 text-body text-ink placeholder:text-ink-muted-48 focus:outline focus:outline-2 focus:outline-primary-focus",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
SearchInput.displayName = "SearchInput";
