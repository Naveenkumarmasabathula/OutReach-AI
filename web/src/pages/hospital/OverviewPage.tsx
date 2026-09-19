import {
  AlertTriangle,
  Building2,
  Clock,
  Database,
  Megaphone,
  PhoneCall,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { Badge } from "../../components/ui/Badge.js";
import { Card, CardTitle } from "../../components/ui/Card.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { StatTile } from "../../components/ui/StatTile.js";
import { useAuth } from "../../lib/auth.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useHospitalAnalytics, useMyHospital, useMyStaff, usePatients } from "../../lib/queries.js";
import { hospitalStatusVariant, QUEUE_STATUS_GROUPS } from "../../lib/statusMaps.js";

function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

/**
 * PRD §20: distinct dashboards per role (Campaign Manager: queue-centric
 * operational view; Hospital Admin: hospital-wide governance view). Kept as
 * one role-conditional component rather than three separate files/routes —
 * both roles share the same underlying `/analytics/hospital` data and most
 * of the same layout, and the only genuine difference PRD asks for (staff
 * activity being Hospital-Admin-only) is a small, clearly-scoped addition,
 * not a structurally different page. `CLINICAL_REVIEWER` has no
 * `analytics.read` grant, so its query is disabled rather than erroring.
 */
export function OverviewPage() {
  usePageTitle("Overview");
  const { user } = useAuth();
  const { data: hospital, isLoading: hospitalLoading } = useMyHospital();
  const { data: patientPage, isLoading: patientsLoading } = usePatients(1, 1);
  const canViewStaff = user?.role === "HOSPITAL_ADMIN";
  const canViewAnalytics = user?.role === "HOSPITAL_ADMIN" || user?.role === "CAMPAIGN_MANAGER";
  const staffQuery = useMyStaff(canViewStaff);
  const { data: analytics, isLoading: analyticsLoading } = useHospitalAnalytics(canViewAnalytics);

  if (hospitalLoading || !hospital) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-ds-lg">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-ds-md">
          <div className="flex items-center gap-3">
            <CardTitle>{hospital.name}</CardTitle>
            <Badge variant={hospitalStatusVariant(hospital.status)}>{hospital.status}</Badge>
          </div>
          <p className="text-caption text-ink-muted-48">
            {hospital.timezone} · calling hours {hospital.callingHoursStart}–{hospital.callingHoursEnd} · capacity{" "}
            {hospital.outboundCapacity} · max retries {hospital.maxRetries}
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-ds-md sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Patients"
          value={patientsLoading ? "…" : (patientPage?.pagination.total ?? 0)}
          icon={<Users className="h-5 w-5" />}
        />
        <StatTile
          label="Outbound capacity"
          value={hospital.outboundCapacity}
          icon={<PhoneCall className="h-5 w-5" />}
        />
        <StatTile label="Max retries" value={hospital.maxRetries} icon={<Clock className="h-5 w-5" />} />
        {canViewStaff ? (
          <StatTile
            label="Staff"
            value={staffQuery.isLoading ? "…" : (staffQuery.data?.length ?? 0)}
            icon={<Building2 className="h-5 w-5" />}
          />
        ) : null}
      </div>

      {canViewAnalytics ? (
        analyticsLoading || !analytics ? (
          <PageSpinner />
        ) : (
          <div className="flex flex-col gap-ds-lg">
            <div className="grid grid-cols-1 gap-ds-md sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Active campaigns"
                value={analytics.campaigns.byStatus["running"] ?? 0}
                icon={<Megaphone className="h-5 w-5" />}
              />
              <StatTile
                label="Eligible patients (running campaigns)"
                value={analytics.eligiblePatientCount}
                icon={<UserCheck className="h-5 w-5" />}
              />
              <StatTile
                label="Active calls"
                value={`${analytics.capacity.activeCalls} / ${analytics.capacity.outboundCapacity}`}
                icon={<PhoneCall className="h-5 w-5" />}
              />
              <StatTile
                label="Contact rate"
                value={`${Math.round(analytics.outreach.contactRate * 100)}%`}
                icon={<TrendingUp className="h-5 w-5" />}
              />
            </div>

            <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-2">
              <Card accent="primary">
                <h2 className="text-title-sm text-ink">Queue state</h2>
                <div className="mt-ds-md flex flex-col gap-ds-sm">
                  {QUEUE_STATUS_GROUPS.map((group) => {
                    const entries = group.statuses
                      .filter((status) => analytics.outreach.byStatus[status])
                      .map((status) => [status, analytics.outreach.byStatus[status]] as const);
                    if (entries.length === 0) return null;
                    return (
                      <div key={group.key}>
                        <p className="text-caption text-ink-muted-48">{group.label}</p>
                        {entries.map(([status, total]) => (
                          <div key={status} className="flex items-center justify-between text-body text-ink">
                            <span className="capitalize">{status.replace(/_/g, " ")}</span>
                            <span className="tabular-nums">{total}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-ds-md text-caption text-ink-muted-48">
                  Avg. time to contact {formatHours(analytics.timing.averageTimeToContactHours)} · avg. queue wait{" "}
                  {formatHours(analytics.timing.averageQueueWaitHours)} · avg.{" "}
                  {analytics.outreach.averageAttemptsPerCompletedTask?.toFixed(1) ?? "—"} attempts per completed task
                </p>
              </Card>

              <Card accent="critical">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-status-critical" />
                  <h2 className="text-title-sm text-ink">Escalations & follow-ups</h2>
                </div>
                <div className="mt-ds-md flex flex-col gap-1.5">
                  {Object.entries(analytics.escalations.byStatus).map(([status, total]) => (
                    <div key={status} className="flex items-center justify-between text-body text-ink">
                      <span className="capitalize">{status.replace(/_/g, " ")}</span>
                      <span className="tabular-nums">{total}</span>
                    </div>
                  ))}
                  {analytics.escalations.total === 0 ? (
                    <p className="text-body text-ink-muted-48">No escalations.</p>
                  ) : null}
                </div>
                <p className="mt-ds-md text-caption text-ink-muted-48">
                  {analytics.outreach.manualFollowUps} manual follow-up(s) · {analytics.activeProtocolCount} active
                  protocol(s)
                </p>
              </Card>
            </div>

            {canViewStaff ? (
              <Card>
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <h2 className="text-title-sm text-ink">EHR write activity (last {analytics.ehrWriteActivity.windowHours}h)</h2>
                </div>
                <p className="mt-1 text-caption text-ink-muted-48">
                  Rows written through the EHR interface — a mock EHR has no real sync concept, so this is activity,
                  not sync status.
                </p>
                <div className="mt-ds-md grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <p className="text-caption text-ink-muted-48">Communications</p>
                    <p className="text-body-strong text-ink tabular-nums">
                      {analytics.ehrWriteActivity.communications}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption text-ink-muted-48">Observations</p>
                    <p className="text-body-strong text-ink tabular-nums">{analytics.ehrWriteActivity.observations}</p>
                  </div>
                  <div>
                    <p className="text-caption text-ink-muted-48">Follow-up tasks</p>
                    <p className="text-body-strong text-ink tabular-nums">
                      {analytics.ehrWriteActivity.manualFollowUpTasks}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption text-ink-muted-48">Escalation records</p>
                    <p className="text-body-strong text-ink tabular-nums">
                      {analytics.ehrWriteActivity.escalationRecords}
                    </p>
                  </div>
                </div>
              </Card>
            ) : null}

            {canViewStaff ? (
              <Card>
                <h2 className="text-title-sm text-ink">Staff by role</h2>
                <div className="mt-ds-md flex flex-wrap gap-2">
                  {Object.entries(analytics.staffByRole).map(([role, total]) => (
                    <Badge key={role} variant="neutral">
                      {role.replace(/_/g, " ")}: {total}
                    </Badge>
                  ))}
                </div>
              </Card>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
