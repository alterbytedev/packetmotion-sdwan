import { ControllerDashboard } from '@/components/controller-dashboard';
import { dashboardPageData } from '@/lib/dashboard-page';

export default async function TelemetryPage() {
  return <ControllerDashboard {...(await dashboardPageData('telemetry'))} view="telemetry" />;
}
