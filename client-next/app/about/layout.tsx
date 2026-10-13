import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '关于',
  description: 'China Radar 由蓝芷怡维护，基于 ai-hot-radar 聚合海外涉华报道，提供精选、热点、日报与关注档案。',
  openGraph: {
    title: '关于 China Radar',
    description: '海外涉华报道聚合 · 作者蓝芷怡 · 基于 ai-hot-radar',
  },
  twitter: {
    title: '关于 China Radar',
    description: '海外涉华报道聚合 · 作者蓝芷怡 · 基于 ai-hot-radar',
  },
  alternates: {
    canonical: '/about',
  },
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
