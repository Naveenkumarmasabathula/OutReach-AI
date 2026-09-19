import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export function Table({ children, className, ...props }: HTMLAttributes<HTMLTableElement> & { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-canvas">
      <table className={cn("w-full border-collapse text-body", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-hairline bg-canvas-parchment">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children, className, ...props }: HTMLAttributes<HTMLTableRowElement> & { children: ReactNode }) {
  return (
    <tr className={cn("border-b border-divider-soft last:border-0 hover:bg-canvas-parchment/60", className)} {...props}>
      {children}
    </tr>
  );
}

export function TH({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <th className={cn("px-ds-md py-2.5 text-left text-caption-strong text-ink-muted-80", className)} {...props}>
      {children}
    </th>
  );
}

type TDProps = TdHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode; numeric?: boolean };

export function TD({ children, className, numeric, ...props }: TDProps) {
  return (
    <td
      className={cn("px-ds-md py-3 text-body text-ink", numeric && "text-right tabular-nums", className)}
      {...props}
    >
      {children}
    </td>
  );
}
