import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type Tab = { key: string; label: string };

type TabsProps = {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  children?: ReactNode;
};

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-ds-lg border-b border-hairline" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "border-b-2 pb-2.5 text-body-strong transition-colors",
            active === tab.key
              ? "border-primary text-ink"
              : "border-transparent text-ink-muted-48 hover:text-ink-muted-80",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
