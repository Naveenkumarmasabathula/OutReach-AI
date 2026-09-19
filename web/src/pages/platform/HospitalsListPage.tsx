import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table.js";
import { usePlatformHospitals } from "../../lib/queries.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { hospitalStatusVariant } from "../../lib/statusMaps.js";

export function HospitalsListPage() {
  usePageTitle("Hospitals");
  const { data: hospitals, isLoading } = usePlatformHospitals();

  if (isLoading) return <PageSpinner />;

  return (
    <div>
      <div className="mb-ds-lg flex items-center justify-between">
        <p className="text-body text-ink-muted-48">{hospitals?.length ?? 0} hospitals onboarded</p>
        <Link to="/platform/hospitals/new">
          <Button size="sm">
            <Plus className="h-4 w-4" /> New hospital
          </Button>
        </Link>
      </div>

      {!hospitals || hospitals.length === 0 ? (
        <EmptyState
          title="No hospitals yet"
          description="Onboard the first hospital to start configuring campaigns and outreach."
          action={
            <Link to="/platform/hospitals/new">
              <Button size="sm">
                <Plus className="h-4 w-4" /> New hospital
              </Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Slug</TH>
              <TH>Status</TH>
              <TH>Timezone</TH>
              <TH className="text-right">Outbound capacity</TH>
            </TR>
          </THead>
          <TBody>
            {hospitals.map((hospital) => (
              <TR key={hospital.id}>
                <TD>
                  <Link to={`/platform/hospitals/${hospital.id}`} className="text-primary hover:underline">
                    {hospital.name}
                  </Link>
                </TD>
                <TD className="text-ink-muted-48">{hospital.slug}</TD>
                <TD>
                  <Badge variant={hospitalStatusVariant(hospital.status)}>{hospital.status}</Badge>
                </TD>
                <TD>{hospital.timezone}</TD>
                <TD numeric>{hospital.outboundCapacity}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
