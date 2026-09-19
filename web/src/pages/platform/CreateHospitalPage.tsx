import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "../../components/ui/Alert.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { Input } from "../../components/ui/Input.js";
import { ApiError } from "../../lib/api.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useCreateHospital } from "../../lib/queries.js";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function CreateHospitalPage() {
  usePageTitle("New hospital");
  const navigate = useNavigate();
  const createHospital = useCreateHospital();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [outboundCapacity, setOutboundCapacity] = useState(10);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const hospital = await createHospital.mutateAsync({
        name,
        slug: slug || slugify(name),
        timezone,
        outboundCapacity,
      });
      navigate(`/platform/hospitals/${hospital.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the hospital.");
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
        <Field>
          <FieldLabel htmlFor="name" required>
            Hospital name
          </FieldLabel>
          <Input
            id="name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="slug" required>
            Slug
          </FieldLabel>
          <Input
            id="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="capacity">Outbound calling capacity</FieldLabel>
          <Input
            id="capacity"
            type="number"
            min={1}
            value={outboundCapacity}
            onChange={(e) => setOutboundCapacity(Number(e.target.value))}
          />
        </Field>
        <Button type="submit" disabled={createHospital.isPending}>
          {createHospital.isPending ? "Creating…" : "Create hospital"}
        </Button>
      </form>
    </Card>
  );
}
