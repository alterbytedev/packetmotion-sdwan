import { ControllerDashboard } from '@/components/controller-dashboard';
import { dashboardPageData } from '@/lib/dashboard-page';

export default async function DevicesPage() {
  return <ControllerDashboard {...(await dashboardPageData('devices'))} view="devices" />;
}
