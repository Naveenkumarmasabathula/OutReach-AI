import type { ReactNode } from "react";
import { Card } from "./Card.js";

type StatTileProps = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
};

/**
 * Per the dataviz skill's stat-tile contract: sentence-case label with no
 * trailing colon, and the value in the font's default proportional figures
 * (not tabular-nums — that's reserved for table columns that must align).
 */
export function StatTile({ label, value, icon }: StatTileProps) {
  return (
    <Card className="flex items-center gap-ds-md">
      {icon ? <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div> : null}
      <div>
        <p className="text-caption text-ink-muted-48">{label}</p>
        <p className="text-display-md text-ink">{value}</p>
      </div>
    </Card>
  );
}
