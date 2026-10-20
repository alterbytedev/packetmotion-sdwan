import { redirect } from 'next/navigation';

export default async function TelemetryPage() {
  redirect('/dashboard/devices');
}
