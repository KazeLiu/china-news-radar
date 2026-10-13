import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { AppLayout } from '@/components/layout/AppLayout';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://china-news.951211.xyz'),
  title: 'China Radar · 海外涉华资讯',
  description: '追踪海外涉华报道，提供精选、热点、日报与关注档案，保留原始出处与时间。',
  robots: { index: false, follow: false },
  icons: { icon: '/radar-icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#101722' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><body><ThemeProvider><AppLayout unreadCount={0}>{children}</AppLayout></ThemeProvider></body></html>;
}
