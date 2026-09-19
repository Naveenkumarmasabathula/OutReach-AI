import { Activity } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Alert } from "../components/ui/Alert.js";
import { Button } from "../components/ui/Button.js";
import { Field, FieldLabel } from "../components/ui/FieldLabel.js";
import { Input } from "../components/ui/Input.js";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

export function LoginPage() {
  const { user, login, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-ds-lg bg-canvas-parchment px-ds-lg">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-on-primary">
          <Activity className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-tagline text-ink">Outreach</span>
      </div>
      <div className="w-full max-w-sm rounded-lg border border-hairline bg-canvas p-ds-xl">
        <h1 className="text-display-lg text-ink">Outreach Console</h1>
        <p className="mb-ds-lg mt-1 text-body text-ink-muted-48">Sign in to your hospital account</p>

        <form onSubmit={handleSubmit} noValidate>
          {error ? (
            <Field>
              <Alert>{error}</Alert>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
