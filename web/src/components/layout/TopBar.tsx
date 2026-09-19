import { LogOut } from "lucide-react";
import { useAuth } from "../../lib/auth.js";
import { IconButton } from "../ui/IconButton.js";

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "Platform Admin",
  HOSPITAL_ADMIN: "Hospital Admin",
  CAMPAIGN_MANAGER: "Campaign Manager",
  CLINICAL_REVIEWER: "Clinical Reviewer",
};

export function TopBar({ title }: { title: string }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  const initial = user.name.charAt(0).toUpperCase();

  return (
    <header className="flex h-16 items-center justify-between border-b border-hairline bg-canvas px-ds-lg">
      <h1 className="text-tagline text-ink">{title}</h1>
      <div className="flex items-center gap-ds-md">
        <div className="text-right">
          <p className="text-caption-strong text-ink">{user.name}</p>
          <p className="text-fine-print text-ink-muted-48">{ROLE_LABELS[user.role] ?? user.role}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-caption-strong text-primary">
          {initial}
        </div>
        <IconButton aria-label="Sign out" onClick={logout} className="h-9 w-9">
          <LogOut className="h-4 w-4" />
        </IconButton>
      </div>
    </header>
  );
}
