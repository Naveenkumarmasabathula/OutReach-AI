import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

const fieldBase =
  "w-full rounded-sm border border-hairline bg-canvas px-ds-sm py-2 text-body text-ink placeholder:text-ink-muted-48 focus:outline focus:outline-2 focus:outline-primary-focus disabled:bg-canvas-parchment disabled:text-ink-muted-48";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(fieldBase, className)} {...props} />,
);
Input.displayName = "Input";

export { fieldBase };
