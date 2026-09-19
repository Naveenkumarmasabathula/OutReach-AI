import { Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth.js";
import { PageTitleProvider, usePageTitleContext } from "../../lib/pageTitle.js";
import { Sidebar } from "./Sidebar.js";
import { TopBar } from "./TopBar.js";

function AppShellInner() {
  const { user } = useAuth();
  const { title } = usePageTitleContext();
  if (!user) return null;

  return (
    <div className="flex h-screen bg-canvas-parchment">
      <Sidebar role={user.role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title={title} />
        <main className="flex-1 overflow-y-auto p-ds-lg">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <PageTitleProvider>
      <AppShellInner />
    </PageTitleProvider>
  );
}
