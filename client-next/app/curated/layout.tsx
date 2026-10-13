import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '精选资讯',
  description: '全部通过内容与展示规则筛选的海外涉华报道，支持来源、主题、时间与关键词筛选，质量评分只用于排序。',
  openGraph: {
    title: '精选资讯 | China Radar',
    description: '通过筛选的海外涉华报道，质量评分只用于排序',
  },
  twitter: {
    title: '精选资讯 | China Radar',
    description: '通过筛选的海外涉华报道，质量评分只用于排序',
  },
  alternates: {
    canonical: '/curated',
  },
};

export default function CuratedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
