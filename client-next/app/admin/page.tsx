import type { Metadata } from 'next';
import { AdminConsole } from '@/components/news/admin/AdminConsole';

export const metadata: Metadata = { title: '后台管理 · China Radar', robots: { index: false, follow: false } };
export default function AdminPage() { return <AdminConsole />; }
