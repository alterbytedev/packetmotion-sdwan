import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';

export default async function HomePage() {
  redirect((await getUser()) ? '/dashboard' : '/login');
}
