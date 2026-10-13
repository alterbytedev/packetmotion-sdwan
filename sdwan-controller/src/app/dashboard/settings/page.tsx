import { ControllerDashboard } from '@/components/controller-dashboard';
import { dashboardPageData } from '@/lib/dashboard-page';

export default async function SettingsPage() {
  return <ControllerDashboard {...(await dashboardPageData('settings'))} view="settings" />;
}
