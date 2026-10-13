import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { AppLayout } from '@/components/layout/AppLayout';

export const metadata: Metadata = {
  title: 'China Radar · 海外涉华快讯',
  description: '从海外媒体的公开 RSS 追踪中国相关报道，保留原始出处与发现时间。',
  robots: { index: false, follow: false },
  icons: { icon: '/radar-icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#101722' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><body><ThemeProvider><AppLayout unreadCount={0}>{children}</AppLayout></ThemeProvider></body></html>;
}
