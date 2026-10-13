import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '我的关注',
  description: '关注人物、国家、机构和事件，查看涉华相关报道与关注档案，接收新报道提醒。',
  openGraph: {
    title: '我的关注 | China Radar',
    description: '关注关键词，查看海外涉华相关报道与档案',
  },
  twitter: {
    title: '我的关注 | China Radar',
    description: '关注关键词，查看海外涉华相关报道与档案',
  },
  alternates: {
    canonical: '/keywords',
  },
};

export default function KeywordsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
