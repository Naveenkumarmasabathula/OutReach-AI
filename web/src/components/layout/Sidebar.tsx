import {
  AlertTriangle,
  Activity,
  BookText,
  Building2,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  Settings,
  Users,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "../../lib/cn.js";
import type { Role } from "../../lib/types.js";

type NavItem = { to: string; label: string; icon: typeof Building2 };

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  PLATFORM_ADMIN: [
    { to: "/", label: "Overview", icon: LayoutDashboard },
    { to: "/platform/hospitals", label: "Hospitals", icon: Building2 },
  ],
  HOSPITAL_ADMIN: [
    { to: "/", label: "Overview", icon: LayoutDashboard },
    { to: "/patients", label: "Patients", icon: Users },
    { to: "/campaigns", label: "Campaigns", icon: Megaphone },
    { to: "/protocols", label: "Protocols", icon: BookText },
    { to: "/escalations", label: "Escalations", icon: AlertTriangle },
    { to: "/staff", label: "Staff", icon: ClipboardList },
    { to: "/settings", label: "Hospital settings", icon: Settings },
  ],
  CAMPAIGN_MANAGER: [
    { to: "/", label: "Overview", icon: LayoutDashboard },
    { to: "/patients", label: "Patients", icon: Users },
    { to: "/campaigns", label: "Campaigns", icon: Megaphone },
    { to: "/protocols", label: "Protocols", icon: BookText },
    { to: "/escalations", label: "Escalations", icon: AlertTriangle },
  ],
  CLINICAL_REVIEWER: [
    { to: "/", label: "Overview", icon: LayoutDashboard },
    { to: "/patients", label: "Patients", icon: Users },
    { to: "/campaigns", label: "Campaigns", icon: Megaphone },
    { to: "/protocols", label: "Protocols", icon: BookText },
    { to: "/escalations", label: "Escalations", icon: AlertTriangle },
  ],
};

export function Sidebar({ role }: { role: Role }) {
  const items = NAV_BY_ROLE[role];

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-surface-black text-body-on-dark">
      <div className="flex h-11 items-center gap-2 px-ds-lg">
        <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary/20 text-primary-on-dark">
          <Activity className="h-4 w-4" aria-hidden />
        </span>
        <span className="text-tagline text-body-on-dark">Outreach</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-ds-sm py-ds-md">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/" || to === "/platform/hospitals"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-sm px-ds-sm py-2.5 text-nav-link transition-colors",
                isActive ? "bg-surface-tile-1 text-body-on-dark" : "text-body-muted hover:bg-surface-tile-2",
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
