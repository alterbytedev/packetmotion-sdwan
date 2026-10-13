import { ControllerDashboard } from '@/components/controller-dashboard';
import { dashboardPageData } from '@/lib/dashboard-page';

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ControllerDashboard {...(await dashboardPageData('devices', id))} view="devices" />;
}
