import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI 日报',
  description: '每天北京时间 08:05 汇总前一日海外涉华报道，覆盖政策、经济、外交、科技、安全和社会，保留来源链接。',
  openGraph: {
    title: 'AI 日报 | China Radar',
    description: '海外涉华日报与原始出处',
  },
  twitter: {
    title: 'AI 日报 | China Radar',
    description: '海外涉华日报与原始出处',
  },
  alternates: {
    canonical: '/digest',
  },
};

export default function DigestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
