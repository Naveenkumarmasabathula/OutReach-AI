import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Pagination } from "../../components/ui/Pagination.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table.js";
import { useAuth } from "../../lib/auth.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { usePatients } from "../../lib/queries.js";
import { contactMethodLabel } from "../../lib/statusMaps.js";

const LIMIT = 20;

export function PatientsListPage() {
  usePageTitle("Patients");
  const { user } = useAuth();
  const canCreate = user?.role === "HOSPITAL_ADMIN";
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePatients(page, LIMIT);

  if (isLoading || !data) return <PageSpinner />;

  return (
    <div>
      <div className="mb-ds-lg flex items-center justify-between">
        <p className="text-body text-ink-muted-48">{data.pagination.total} patients</p>
        {canCreate ? (
          <Link to="/patients/new">
            <Button size="sm">
              <Plus className="h-4 w-4" /> New patient
            </Button>
          </Link>
        ) : null}
      </div>

      {data.data.length === 0 ? (
        <EmptyState title="No patients yet" description="Imported discharge patients will appear here." />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>MRN</TH>
                <TH>Contact</TH>
                <TH>Consent</TH>
              </TR>
            </THead>
            <TBody>
              {data.data.map((patient) => (
                <TR key={patient.id}>
                  <TD>
                    <Link to={`/patients/${patient.id}`} className="text-primary hover:underline">
                      {patient.firstName} {patient.lastName}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted-48">{patient.mrn}</TD>
                  <TD>{contactMethodLabel(patient.preferredContactMethod)}</TD>
                  <TD>
                    <Badge variant={patient.communicationConsent ? "good" : "neutral"}>
                      {patient.communicationConsent ? "Consented" : "Opted out"}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} limit={LIMIT} total={data.pagination.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
