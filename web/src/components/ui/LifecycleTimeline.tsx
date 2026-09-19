import { Check, X } from "lucide-react";
import { cn } from "../../lib/cn.js";

export type LifecycleStep = { key: string; label: string };

type LifecycleTimelineProps = {
  /** The canonical happy-path, in order. */
  steps: LifecycleStep[];
  /** The record's actual current status. */
  current: string;
  /**
   * A status that legitimately branches off a step rather than replacing it
   * (e.g. a campaign "paused" mid-run, an escalation "waiting for
   * information" mid-review) — rendered as a small side badge next to the
   * step it branches from, without breaking the main progression.
   */
  branch?: { atKey: string; label: string } | null;
  /**
   * A status outside the happy path entirely (cancelled/failed) — rendered
   * as a distinct terminal marker after the steps, which render
   * de-emphasized rather than guessing how far progress actually got.
   */
  offPathLabel?: string | null;
};

/**
 * A visual stepper for record lifecycles (campaign status, escalation
 * status) — replacing a bare status Badge with "where is this in its
 * lifecycle, and what's the happy path" at a glance. Deliberately not used
 * for the outreach-task queue, which is many tasks in parallel states, not
 * one record progressing through a single path — see the queue state
 * grouping on CampaignDetailPage instead.
 */
export function LifecycleTimeline({ steps, current, branch, offPathLabel }: LifecycleTimelineProps) {
  const currentIndex = steps.findIndex((s) => s.key === current);
  const isOffPath = currentIndex === -1 && !branch;
  const effectiveIndex = branch ? steps.findIndex((s) => s.key === branch.atKey) : currentIndex;

  return (
    <div className="flex flex-wrap items-center gap-y-3">
      {steps.map((step, i) => {
        const isDone = !isOffPath && i < effectiveIndex;
        const isCurrent = !isOffPath && i === effectiveIndex;
        const isBranchPoint = branch && step.key === branch.atKey;
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-caption-strong transition-colors",
                  isDone && "border-primary bg-primary text-on-primary",
                  isCurrent && "border-primary bg-canvas text-primary ring-4 ring-primary/15",
                  !isDone && !isCurrent && "border-hairline bg-canvas text-ink-muted-48",
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </div>
              <div className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "whitespace-nowrap text-fine-print",
                    isCurrent ? "text-body-strong text-ink" : isDone ? "text-ink-muted-80" : "text-ink-muted-48",
                  )}
                >
                  {step.label}
                </span>
                {isBranchPoint ? (
                  <span className="whitespace-nowrap rounded-pill bg-status-warning/15 px-2 py-0.5 text-micro-legal font-semibold text-[#8a5a00]">
                    {branch.label}
                  </span>
                ) : null}
              </div>
            </div>
            {i < steps.length - 1 ? (
              <div className={cn("mx-1.5 h-0.5 w-8 shrink-0 sm:w-12", isDone ? "bg-primary" : "bg-hairline")} />
            ) : null}
          </div>
        );
      })}
      {isOffPath && offPathLabel ? (
        <>
          <div className="mx-1.5 h-0.5 w-8 shrink-0 bg-status-critical/40 sm:w-12" />
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-status-critical bg-status-critical/10 text-status-critical">
              <X className="h-3.5 w-3.5" aria-hidden />
            </div>
            <span className="whitespace-nowrap text-body-strong text-status-critical">{offPathLabel}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
