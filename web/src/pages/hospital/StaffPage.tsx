import { useState, type FormEvent } from "react";
import { Alert } from "../../components/ui/Alert.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table.js";
import { ApiError } from "../../lib/api.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useCreateMyStaff, useMyStaff } from "../../lib/queries.js";

const ROLE_LABELS: Record<string, string> = {
  HOSPITAL_ADMIN: "Hospital Admin",
  CAMPAIGN_MANAGER: "Campaign Manager",
  CLINICAL_REVIEWER: "Clinical Reviewer",
};

export function StaffPage() {
  usePageTitle("Staff");
  const { data: staff, isLoading } = useMyStaff();
  const createStaff = useCreateMyStaff();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"HOSPITAL_ADMIN" | "CAMPAIGN_MANAGER" | "CLINICAL_REVIEWER">("CAMPAIGN_MANAGER");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createStaff.mutateAsync({ email, name, password, role });
      setEmail("");
      setName("");
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the staff user.");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-12">
      <div className="lg:col-span-8">
        <p className="mb-ds-md text-body text-ink-muted-48">{staff?.length ?? 0} staff member(s)</p>
        {isLoading || !staff ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {staff.map((member) => (
                <TR key={member.id}>
                  <TD>{member.name}</TD>
                  <TD className="text-ink-muted-48">{member.email}</TD>
                  <TD>{ROLE_LABELS[member.role] ?? member.role}</TD>
                  <TD>
                    <Badge variant={member.status === "active" ? "good" : "neutral"}>{member.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <div className="lg:col-span-4">
        <Card>
          <CardHeader>
            <CardTitle>Add staff user</CardTitle>
          </CardHeader>
          <form onSubmit={handleSubmit} noValidate>
            {error ? (
              <div className="mb-ds-md">
                <Alert>{error}</Alert>
              </div>
            ) : null}
            <Field>
              <FieldLabel htmlFor="name" required>
                Name
              </FieldLabel>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="email" required>
                Email
              </FieldLabel>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="password" required>
                Temporary password
              </FieldLabel>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="role">Role</FieldLabel>
              <Select id="role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="HOSPITAL_ADMIN">Hospital Admin</option>
                <option value="CAMPAIGN_MANAGER">Campaign Manager</option>
                <option value="CLINICAL_REVIEWER">Clinical Reviewer</option>
              </Select>
            </Field>
            <Button type="submit" size="sm" className="w-full" disabled={createStaff.isPending}>
              {createStaff.isPending ? "Creating…" : "Create staff user"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
