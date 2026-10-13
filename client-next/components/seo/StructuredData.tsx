/**
 * JSON-LD structured data components for SEO.
 * Based on schema.org standards used by Google, Bing, etc.
 */

import { safeJsonLd } from '../../lib/structured-data';

// Static schemas live at module scope so they are never rebuilt on re-render.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://china-news.951211.xyz';
const projectSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'China Radar',
  url: siteUrl,
  applicationCategory: 'NewsApplication',
  description: '聚合海外涉华报道，提供精选、热点、日报与关注档案',
  sameAs: [
    'https://github.com/KazeLiu/china-news-radar',
  ],
  author: { '@type': 'Person', name: '蓝芷怡', url: 'https://github.com/KazeLiu', email: 'kaze.liu@qq.com' },
};

export function ProjectSchema() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(projectSchema) }}
    />
  );
}

const webSiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'China Radar',
  url: siteUrl,
  description: '聚合海外涉华报道，提供精选、热点、日报与关注档案',
};

export function WebSiteSchema() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(webSiteSchema) }}
    />
  );
}
