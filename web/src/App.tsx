import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell.js";
import { useAuth } from "./lib/auth.js";
import { LoginPage } from "./pages/LoginPage.js";
import { CreateHospitalPage } from "./pages/platform/CreateHospitalPage.js";
import { HospitalDetailPage } from "./pages/platform/HospitalDetailPage.js";
import { HospitalsListPage } from "./pages/platform/HospitalsListPage.js";
import { PlatformDashboardPage } from "./pages/platform/PlatformDashboardPage.js";
import { CampaignDetailPage } from "./pages/hospital/CampaignDetailPage.js";
import { CampaignsListPage } from "./pages/hospital/CampaignsListPage.js";
import { CreateCampaignPage } from "./pages/hospital/CreateCampaignPage.js";
import { CreatePatientPage } from "./pages/hospital/CreatePatientPage.js";
import { EscalationDetailPage } from "./pages/hospital/EscalationDetailPage.js";
import { EscalationsListPage } from "./pages/hospital/EscalationsListPage.js";
import { OverviewPage } from "./pages/hospital/OverviewPage.js";
import { PatientDetailPage } from "./pages/hospital/PatientDetailPage.js";
import { PatientsListPage } from "./pages/hospital/PatientsListPage.js";
import { CreateProtocolPage } from "./pages/hospital/CreateProtocolPage.js";
import { ProtocolDetailPage } from "./pages/hospital/ProtocolDetailPage.js";
import { ProtocolsListPage } from "./pages/hospital/ProtocolsListPage.js";
import { SettingsPage } from "./pages/hospital/SettingsPage.js";
import { StaffPage } from "./pages/hospital/StaffPage.js";

export function App() {
  const { user } = useAuth();

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const isPlatformAdmin = user.role === "PLATFORM_ADMIN";
  const isHospitalAdmin = user.role === "HOSPITAL_ADMIN";
  const canManageCampaigns = user.role === "HOSPITAL_ADMIN" || user.role === "CAMPAIGN_MANAGER";

  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        {isPlatformAdmin ? (
          <>
            <Route index element={<PlatformDashboardPage />} />
            <Route path="platform/hospitals" element={<HospitalsListPage />} />
            <Route path="platform/hospitals/new" element={<CreateHospitalPage />} />
            <Route path="platform/hospitals/:hospitalId" element={<HospitalDetailPage />} />
          </>
        ) : (
          <>
            <Route index element={<OverviewPage />} />
            <Route path="patients" element={<PatientsListPage />} />
            <Route path="patients/:patientId" element={<PatientDetailPage />} />
            {isHospitalAdmin ? <Route path="patients/new" element={<CreatePatientPage />} /> : null}
            <Route path="campaigns" element={<CampaignsListPage />} />
            <Route path="campaigns/:campaignId" element={<CampaignDetailPage />} />
            {canManageCampaigns ? <Route path="campaigns/new" element={<CreateCampaignPage />} /> : null}
            <Route path="protocols" element={<ProtocolsListPage />} />
            <Route path="protocols/:protocolId" element={<ProtocolDetailPage />} />
            {isHospitalAdmin ? <Route path="protocols/new" element={<CreateProtocolPage />} /> : null}
            <Route path="escalations" element={<EscalationsListPage />} />
            <Route path="escalations/:escalationId" element={<EscalationDetailPage />} />
            {isHospitalAdmin ? <Route path="staff" element={<StaffPage />} /> : null}
            {isHospitalAdmin ? <Route path="settings" element={<SettingsPage />} /> : null}
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
