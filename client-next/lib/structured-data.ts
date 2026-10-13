/**
 * 生成式引擎优化：结构化数据工厂
 * 为 AI 搜索引擎（Perplexity、ChatGPT Search、Claude）提供明确的语义标记
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://aihotradar.com';

/**
 * HTML-safe JSON serialization for `<script type="application/ld+json">`.
 *
 * `JSON.stringify` does not HTML-escape, so a `</script>` sequence inside any
 * string value would close the tag early and allow injection. Always use this
 * instead of bare `JSON.stringify` when rendering JSON-LD — it matters as soon
 * as a schema carries scraped data (article titles, summaries) rather than
 * hardcoded constants.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * 日报页面 Article Schema
 * @param date - 日报日期 YYYY-MM-DD
 * @param sections - 日报各板块内容摘要
 */
export function generateDigestSchema(date: string, sections: string[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `AI 日报 ${date}`,
    datePublished: `${date}T08:00:00+08:00`,
    dateModified: `${date}T08:00:00+08:00`,
    author: {
      '@type': 'Organization',
      name: 'AI Hot Radar',
    },
    publisher: {
      '@type': 'Organization',
      name: 'AI Hot Radar',
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/og-image.png`,
      },
    },
    description: `每日 AI 行业动态精选：${sections.slice(0, 3).join('、')}等 ${sections.length} 个板块`,
    articleSection: sections,
    inLanguage: 'zh-CN',
    url: `${SITE_URL}/digest/${date}`,
  };
}

/**
 * 热点列表 ItemList Schema
 * 用于精选/热点页，帮助 AI 理解这是一个聚合列表而非单篇文章
 *
 * `name` / `description` 由调用方传入：精选页与热点页的语义不同，共用一段
 * 描述会让 AI 无法区分两者。
 */
export function generateHotspotListSchema(
  items: Array<{
    title: string;
    url: string;
    publishedAt: string;
    description?: string;
  }>,
  meta: { name: string; description: string } = {
    name: 'AI 热点资讯',
    description: 'AI 评分筛选后的高质量 AI 行业资讯',
  },
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: meta.name,
    description: meta.description,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Article',
        headline: item.title,
        url: item.url,
        datePublished: item.publishedAt,
        description: item.description,
      },
    })),
  };
}
