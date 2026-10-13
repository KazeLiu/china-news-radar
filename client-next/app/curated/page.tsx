import { CuratedView } from '@/components/curated/CuratedView';
import { fetchCuratedSSR } from '@/lib/server-api';
import { generateHotspotListSchema, safeJsonLd } from '@/lib/structured-data';

/**
 * Rendered per request rather than prerendered at build time.
 *
 * `next build` runs in an isolated Docker builder stage that is not on the
 * compose network, so the backend is unreachable and `NEXT_PUBLIC_API_URL` is
 * undefined there. Prerendering would bake an empty page into the image;
 * `force-dynamic` skips it, so the first visitor — often a crawler — gets real
 * content instead.
 */
export const dynamic = 'force-dynamic';

export default async function CuratedPage() {
  const { items, total } = await fetchCuratedSSR('today', 50);

  // ItemList tells AI engines this page is an aggregated feed rather than one
  // article, so individual entries can be attributed to their own source.
  const listSchema = generateHotspotListSchema(
    items.map((item) => ({
      title: item.title,
      url: item.url,
      // publishedAt is optional on Hotspot; createdAt is always present.
      publishedAt: item.publishedAt || item.createdAt,
      description: item.summary,
    })),
    {
      name: 'China Radar · 精选资讯',
      description: '全部通过涉华与展示规则筛选的报道，质量评分只用于排序',
    },
  );

  return (
    <>
      {items.length > 0 && (
        <script
          type="application/ld+json"
          // safeJsonLd, not JSON.stringify: titles and summaries come from
          // scraped sources, so a `</script>` in one would break out of the tag.
          dangerouslySetInnerHTML={{ __html: safeJsonLd(listSchema) }}
        />
      )}
      <CuratedView initialItems={items} initialTotal={total} />
    </>
  );
}
