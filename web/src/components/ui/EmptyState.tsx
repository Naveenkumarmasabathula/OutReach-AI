import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-ds-lg py-ds-xxl text-center">
      {icon ? <div className="text-ink-muted-48">{icon}</div> : null}
      <p className="text-body-strong text-ink">{title}</p>
      {description ? <p className="max-w-sm text-caption text-ink-muted-48">{description}</p> : null}
      {action}
    </div>
  );
}
