import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "../../components/ui/Alert.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { ApiError } from "../../lib/api.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useCreatePatient } from "../../lib/queries.js";

export function CreatePatientPage() {
  usePageTitle("New patient");
  const navigate = useNavigate();
  const createPatient = useCreatePatient();
  const [mrn, setMrn] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [preferredContactMethod, setPreferredContactMethod] = useState<"phone" | "sms" | "email">("phone");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // A patient can only be reached by whichever contact method actually has
    // a value on file — letting someone pick "Email" as the preference with
    // no email address (or "SMS"/"Phone" with no phone number) would create
    // a patient the outreach queue can never actually contact, silently.
    if ((preferredContactMethod === "email") && !email) {
      setError("An email address is required when the preferred contact method is Email.");
      return;
    }
    if ((preferredContactMethod === "phone" || preferredContactMethod === "sms") && !phone) {
      setError(`A phone number is required when the preferred contact method is ${preferredContactMethod === "sms" ? "SMS" : "Phone"}.`);
      return;
    }
    try {
      const patient = await createPatient.mutateAsync({
        mrn,
        firstName,
        lastName,
        phone: phone || undefined,
        email: email || undefined,
        preferredContactMethod,
      });
      navigate(`/patients/${patient.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the patient.");
    }
  }

  return (
    <Card className="max-w-lg">
      <form onSubmit={handleSubmit} noValidate>
        {error ? (
          <Field>
            <Alert>{error}</Alert>
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-ds-md">
          <Field>
            <FieldLabel htmlFor="firstName" required>
              First name
            </FieldLabel>
            <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lastName" required>
              Last name
            </FieldLabel>
            <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="mrn" required>
            Medical record number
          </FieldLabel>
          <Input id="mrn" required value={mrn} onChange={(e) => setMrn(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-ds-md">
          <Field>
            <FieldLabel htmlFor="phone">Phone</FieldLabel>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="contactMethod">Preferred contact method</FieldLabel>
          <Select
            id="contactMethod"
            value={preferredContactMethod}
            onChange={(e) => setPreferredContactMethod(e.target.value as typeof preferredContactMethod)}
          >
            <option value="phone">Phone</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </Select>
        </Field>
        <Button type="submit" disabled={createPatient.isPending}>
          {createPatient.isPending ? "Creating…" : "Create patient"}
        </Button>
      </form>
    </Card>
  );
}
