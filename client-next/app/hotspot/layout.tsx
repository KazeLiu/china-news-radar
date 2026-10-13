import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '热点雷达',
  description: '聚合海外涉华报道，按来源、主题、时间和重要度筛选；保留原始出处，同标题折叠展示。',
  openGraph: {
    title: '热点雷达 | China Radar',
    description: '海外涉华报道与质量评分',
  },
  twitter: {
    title: '热点雷达 | China Radar',
    description: '海外涉华报道与质量评分',
  },
  alternates: {
    canonical: '/hotspot',
  },
};

export default function HotspotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
