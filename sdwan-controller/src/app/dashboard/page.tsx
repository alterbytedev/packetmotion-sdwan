import { ControllerDashboard } from '@/components/controller-dashboard';
import { dashboardPageData } from '@/lib/dashboard-page';

export default async function DashboardPage() {
  return <ControllerDashboard {...(await dashboardPageData('overview'))} view="overview" />;
}
